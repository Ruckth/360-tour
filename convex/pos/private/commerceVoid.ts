import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import type { StaffActor } from '../../auth/model';
import { bumpOrderCommerceRevision } from '../../commerce/model';
import { reserveWrites } from '../../lib/readBudget';
import { apportionMoney, COMMERCE_LIMITS, incrementalShare, quotePackageVoucherReturn } from '../../shared/commerce';
import { lineNet } from '../../shared/orderMath';
import { handoverForLine } from './handoverCustody';
import { readOrderProjection, voucherOrderPayments } from './orderLifecycle';
import { nextCounter, ORDER_COUNTER } from './orderLinks';
import { replacementVoucher } from './returnEffects';
import { returnGet, voucherStatus } from './returnPlan';

type Order = Doc<'orders'>;
type Line = Doc<'orderLines'>;
type Handover = Doc<'handovers'>;
type Content = NonNullable<Handover['contents']>[number];
type Voucher = Doc<'vouchers'>;
type Correction = Doc<'orderCorrections'>;

function requireReconciliation(message: string): never {
  throw new ConvexError({ code: 'COMMERCE_VOID_RECONCILIATION_REQUIRED', message });
}

async function loadOwnedBenefits(ctx: MutationCtx, order: Order, lines: Line[]) {
  const grants: Doc<'sessionGrants'>[] = [];
  const vouchers: Voucher[] = [];
  for (const line of lines) {
    for (const content of line.saleSnapshot?.contents ?? []) {
      if (content.grantId) {
        const grant = await returnGet(ctx, content.grantId);
        if (!grant || grant.orderId !== order._id || grant.lineId !== line._id ||
            grant.contentKey !== content.contentKey || grant.pendingReturnId || grant.used > 0 ||
            grant.grantServiceIds.length > COMMERCE_LIMITS.servicesPerGrant) {
          requireReconciliation('Reconcile any used or reserved package sessions before voiding this sale.');
        }
        grants.push(grant);
      }
      if (content.voucherId) {
        const voucher = await returnGet(ctx, content.voucherId);
        if (!voucher || voucher.source.kind === 'refund_credit' || voucher.source.orderId !== order._id ||
            voucher.source.lineId !== line._id || voucher.pendingReturnId ||
            await readOrderProjection(ctx, () => ctx.db.query('voucherEntries')
              .withIndex('by_voucherId_and_kind', q => q.eq('voucherId', voucher._id).eq('kind', 'spend')).first())) {
          requireReconciliation('Reconcile any used or reserved issued voucher before voiding this sale.');
        }
        vouchers.push(voucher);
      }
    }
  }
  if (grants.length > COMMERCE_LIMITS.sale.sessionGrants || vouchers.length > COMMERCE_LIMITS.sale.voucherIssuances ||
      new Set(grants.map(row => row._id)).size !== grants.length || new Set(vouchers.map(row => row._id)).size !== vouchers.length) {
    requireReconciliation('The receipt exceeds the limits for an automatic void.');
  }
  return { grants, vouchers };
}

async function loadFunding(ctx: MutationCtx, order: Order, lines: Line[]) {
  const { paymentRows, distinctFundingVouchers } = COMMERCE_LIMITS.sale;
  const payments = await readOrderProjection(ctx, () => ctx.db.query('orderPayments')
    .withIndex('by_orderId_and_method', q => q.eq('orderId', order._id).eq('method', 'voucher')).take(paymentRows + 1));
  const credits = new Map<Id<'vouchers'>, { paid: number; goodwill: number }>();
  for (const { voucherId, amount } of voucherOrderPayments(payments)) {
    const credit = credits.get(voucherId) ?? { paid: 0, goodwill: 0 };
    credits.set(voucherId, { ...credit, paid: credit.paid + amount });
  }
  for (const { saleSnapshot } of lines) {
    for (const { voucherId, amount } of saleSnapshot?.goodwillDiscounts ?? []) {
      const credit = credits.get(voucherId) ?? { paid: 0, goodwill: 0 };
      credits.set(voucherId, { ...credit, goodwill: credit.goodwill + amount });
    }
  }
  if (credits.size > distinctFundingVouchers || payments.length > paymentRows) {
    requireReconciliation('The receipt exceeds the limits for automatic voucher restoration.');
  }
  return await Promise.all([...credits].map(async ([voucherId, credit]) => {
    const voucher = await returnGet(ctx, voucherId);
    if (!voucher || voucher.pendingReturnId) requireReconciliation('Finish the open return on the funding voucher before voiding this sale.');
    const source = voucher.source;
    let packageUnusedPaid = voucher.packageUnusedPaid;
    if (credit.paid && source.kind === 'package') {
      const issuedOn = await returnGet(ctx, source.lineId);
      const part = issuedOn?.saleSnapshot?.contents.find(item => item.contentKey === source.contentKey && item.voucherId === voucher._id);
      if (!part || voucher.paidBalance + credit.paid > voucher.faceValue) {
        requireReconciliation('The original package voucher value cannot be reconciled.');
      }
      const paidAfter = voucher.paidBalance + credit.paid;
      packageUnusedPaid = quotePackageVoucherReturn({
        paidShare: part.paidShare, face: voucher.faceValue, faceSpent: voucher.faceValue - paidAfter,
        faceReturned: 0, faceThrough: paidAfter,
      }).total;
    }
    return { voucher, ...credit, packageUnusedPaid };
  }));
}

async function recollectionRows(ctx: MutationCtx, order: Order, lines: Line[], now: number) {
  const movements = new Map<Id<'stockMovements'>, Promise<Doc<'stockMovements'> | null>>();
  const rows = await Promise.all(lines.map(async line => {
    if (line.kind !== 'product' && line.kind !== 'package') return null;
    const snapshot = line.saleSnapshot;
    if (!snapshot || !snapshot.contents.length || snapshot.contents.length > COMMERCE_LIMITS.package.contents) {
      requireReconciliation('The original sale details for handed-over items are missing.');
    }
    const previous = await handoverForLine(ctx, order, line);
    if (previous?.pendingReturnId) requireReconciliation('Finish the open return on the handed-over items before voiding this sale.');
    const goodwill = snapshot.goodwillDiscounts.reduce((sum, item) => sum + item.amount, 0);
    const weights = snapshot.contents.map(part => part.paidShare);
    const restoredDiscounts = apportionMoney(goodwill, weights.some(Boolean) ? weights : snapshot.contents.map(part => part.units));
    const parts = await Promise.all(snapshot.contents.map(async (part, index) => {
      if (part.grantId || part.voucherId) return null;
      if (!part.stockMovementId) requireReconciliation('The original stock movement for a handed-over item is missing.');
      if (!movements.has(part.stockMovementId)) movements.set(part.stockMovementId, returnGet(ctx, part.stockMovementId));
      const movement = await movements.get(part.stockMovementId);
      if (!movement || movement.delta >= 0) requireReconciliation('The original stock movement for a handed-over item is missing.');
      const custody = previous?.contents?.find(item => item.contentKey === part.contentKey) ?? previous;
      const units = custody?.withGuest ?? part.units;
      if (!units) return null;
      if (units > part.units || (custody && custody.paid < units)) requireReconciliation('The paid custody has changed. Reconcile the handed-over items first.');
      const allocatedPrice = incrementalShare(part.paidShare + (part.goodwillShare ?? restoredDiscounts[index]), {
        unitsSold: part.units, unitsBefore: 0, unitsThrough: units,
      }).total;
      const content: Content = {
        contentKey: part.contentKey, variantId: movement.variantId, originalMovementId: movement._id, allocatedPrice,
        quantity: units, withGuest: units, unpaid: units, paid: 0, backSellable: 0, backDamaged: 0,
      };
      return { content, snapshot: { ...part, units, paidShare: allocatedPrice, goodwillShare: undefined, tenderCells: [] } };
    }));
    const goods = parts.flatMap(part => part ? [part] : []);
    if (!goods.length) return null;
    const amount = goods.reduce((sum, { content }) => sum + content.allocatedPrice, 0);
    const quantity = goods.reduce((sum, { content }) => sum + content.quantity, 0);
    const qty = line.kind === 'product' ? quantity : 1;
    const unitPrice = Math.ceil(amount / qty);
    const roundingDiscount = unitPrice * qty - amount;
    const successorLine: Omit<Line, '_id' | '_creationTime' | 'orderId'> = {
      kind: line.kind, currency: line.currency, name: snapshot.label, detail: line.detail, qty, createdAt: now,
      variantId: line.variantId, packageVersionId: line.packageVersionId, unitPrice, catalogUnitPrice: unitPrice,
      discount: roundingDiscount ? { type: 'amount', value: roundingDiscount } : undefined,
      saleSnapshot: {
        ...snapshot, paidShare: amount, tenderCells: [], goodwillDiscounts: [],
        contents: goods.map(item => item.snapshot),
      },
    };
    return { line, previous, successorLine, goods: goods.map(item => item.content), quantity };
  }));
  return rows.flatMap(row => row ? [row] : []);
}

export async function prepareCommerceVoid(ctx: MutationCtx, order: Order, lines: Line[], now: number) {
  if (await readOrderProjection(ctx, () => ctx.db.query('orderReturns')
    .withIndex('by_orderId_and_status', q => q.eq('orderId', order._id).eq('status', 'completed')).first())) {
    requireReconciliation('This receipt has a completed return. Reconcile what remains owed before voiding it.');
  }
  const [benefits, funding, goods] = await Promise.all([
    loadOwnedBenefits(ctx, order, lines), loadFunding(ctx, order, lines), recollectionRows(ctx, order, lines, now),
  ]);
  const credits = funding.map(item => {
    const status = voucherStatus(item.voucher, now);
    return { ...item, reusable: status === 'active' || status === 'paused' };
  });
  const changedOrders = new Set([
    order._id,
    ...credits.flatMap(({ voucher, reusable }) => reusable ? [voucher.source.orderId] : []),
    ...goods.flatMap(({ previous }) => previous ? [previous.orderId] : []),
  ]);
  const writeCount = benefits.grants.reduce((sum, grant) => sum + 2 + grant.grantServiceIds.length, 0) +
    benefits.vouchers.length * 2 + credits.reduce((sum, credit) => sum + (credit.reusable ? 2 : credit.paid ? 4 : 0), 0) +
    (goods.length ? 3 + goods.length * 2 : 0) + changedOrders.size;
  const apply = async (actor: StaffActor, key: string): Promise<Pick<Correction, 'recollectionOrderId' | 'voucherRestorations'>> => {
    for (const grant of benefits.grants) {
      const before = { paid: grant.paidUnits, goodwill: grant.goodwillUnits };
      const after = { paid: 0, goodwill: 0 };
      reserveWrites(ctx, 2 + grant.grantServiceIds.length);
      await ctx.db.patch(grant._id, {
        paidUnits: 0, goodwillUnits: 0, returnedUnits: grant.returnedUnits + before.paid, revision: grant.revision + 1,
      });
      await Promise.all(grant.grantServiceIds.map(id => ctx.db.patch(id, { usable: false })));
      await ctx.db.insert('sessionUses', {
        grantId: grant._id, lineId: grant.lineId, kind: 'cancel', sourceKey: `void:${key}:${grant._id}`,
        before, after, guestFact: 'Unused sessions reversed with the mistaken sale', actor: actor.email, createdAt: now,
      });
    }
    for (const voucher of benefits.vouchers) {
      reserveWrites(ctx, 2);
      await ctx.db.patch(voucher._id, {
        status: 'revoked', paidBalance: 0, goodwillBalance: 0, packageUnusedPaid: undefined, revision: voucher.revision + 1,
      });
      await ctx.db.insert('voucherEntries', {
        voucherId: voucher._id, kind: 'revoke', sourceKey: `void:${key}:${voucher._id}`,
        before: { paid: voucher.paidBalance, goodwill: voucher.goodwillBalance }, after: { paid: 0, goodwill: 0 },
        guestFact: 'Unused voucher reversed with the mistaken sale', actor: actor.email, createdAt: now,
      });
    }
    const voucherRestorations: NonNullable<Correction['voucherRestorations']> = [];
    for (const { voucher, paid, goodwill, packageUnusedPaid, reusable } of credits) {
      let creditedVoucherId = voucher._id;
      if (reusable) {
        const before = { paid: voucher.paidBalance, goodwill: voucher.goodwillBalance };
        const after = { paid: before.paid + paid, goodwill: before.goodwill + goodwill };
        reserveWrites(ctx, 2);
        await ctx.db.patch(voucher._id, { paidBalance: after.paid, goodwillBalance: after.goodwill, packageUnusedPaid, revision: voucher.revision + 1 });
        await ctx.db.insert('voucherEntries', {
          voucherId: voucher._id, kind: 'refund_credit', sourceKey: `void-credit:${key}:${voucher._id}`,
          before, after, guestFact: 'Voucher restored after a mistaken sale', actor: actor.email, createdAt: now,
        });
      } else {
        if (!paid) continue;
        reserveWrites(ctx, 4);
        const replacement = await replacementVoucher(ctx, {
          orderId: order._id, key: `void-credit:${key}:${voucher._id}`,
        }, voucher, paid, actor, now);
        creditedVoucherId = replacement.voucherId;
      }
      voucherRestorations.push({ voucherId: voucher._id, creditedVoucherId, paid,
        goodwill: creditedVoucherId === voucher._id ? goodwill : 0 });
    }
    let recollectionOrderId: Id<'orders'> | undefined;
    if (goods.length) {
      const total = goods.reduce((sum, row) => sum + lineNet(row.successorLine), 0);
      reserveWrites(ctx, 2 + goods.length * 2);
      const orderNumber = await nextCounter(ctx, ORDER_COUNTER);
      recollectionOrderId = await ctx.db.insert('orders', {
        status: 'draft', orderNumber, currency: order.currency, itemCount: goods.length, total, due: total,
        parentOrderId: order._id, customerId: order.customerId, hasItems: true, revision: 0,
        createdBy: actor.email, createdAt: now, updatedAt: now,
      });
      changedOrders.add(recollectionOrderId);
      for (const { line, previous, successorLine, goods: contents, quantity } of goods) {
        const successorLineId = await ctx.db.insert('orderLines', { ...successorLine, orderId: recollectionOrderId });
        const handover = {
          kind: 'recollect' as const, bookingId: undefined, unitPrice: successorLine.unitPrice,
          variantId: successorLine.variantId, originalMovementId: contents.length === 1 ? contents[0].originalMovementId : undefined,
          quantity, withGuest: quantity, unpaid: quantity, paid: 0, backSellable: 0, backDamaged: 0, contents,
          status: 'open' as const, successorOrderId: recollectionOrderId, successorLineId,
          movementIds: [...new Set([...previous?.movementIds ?? [], ...contents.map(item => item.originalMovementId)])],
        };
        if (previous) {
          await ctx.db.patch(previous._id, { ...handover, revision: previous.revision + 1 });
        } else {
          await ctx.db.insert('handovers', {
            ...handover, orderId: order._id, lineId: line._id, clientKey: key, revision: 0,
          });
        }
      }
    }
    await bumpOrderCommerceRevision(ctx, changedOrders);
    return { recollectionOrderId, ...(voucherRestorations.length ? { voucherRestorations } : {}) };
  };
  return { apply, writeCount };
}
