import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { recordReturnDestination, releaseReturn, reserveReturn } from '../../services/model';
import type { StaffActor } from '../../auth/model';
import { writeStockMovement, insertVoucherCode } from '../../commerce/model';
import { reserveWrites } from '../../lib/readBudget';
import { appendRecordHistory } from '../../settings/model';
import { apportionMoney, benefitExpiresAt, COMMERCE_LIMITS, DEFAULT_COMMERCE_SETTINGS, quotePackageVoucherReturn } from '../../shared/commerce';
import { resortTodayIso } from '../../shared/time';
import { readOrderProjection } from './orderLifecycle';
import { planReturnParts, planReturnStock, returnError, returnGet, voucherStatus, type OrderReturn, type ReturnRow } from './returnPlan';

type Parts = Awaited<ReturnType<typeof planReturnParts>>;
type Stock = Awaited<ReturnType<typeof planReturnStock>>['stock'];
type Effect = OrderReturn['effectsApplied'][number];
type HeldHandover = { handover: Doc<'handovers'>; products: Parts['products'] };
type Voucher = Doc<'vouchers'>;
type ChangedOrders = Set<Id<'orders'>>;

function changedHandover(orders: ChangedOrders, handover: Doc<'handovers'>) {
  orders.add(handover.orderId);
  if (handover.successorOrderId) orders.add(handover.successorOrderId);
}

export async function returnAudit(
  ctx: MutationCtx, row: OrderReturn, actor: StaffActor, kind: string, details: Record<string, unknown> = {},
) {
  reserveWrites(ctx, 1);
  await appendRecordHistory(ctx, {
    entityType: 'order', entityId: row.orderId, actor: actor.email, kind, reason: row.reason,
    after: { returnId: row._id, ...details },
  });
}

function groupHandovers(planned: Parts): HeldHandover[] {
  const groups = new Map<Id<'handovers'>, HeldHandover>();
  for (const product of planned.products) {
    const { handover } = product;
    if (!handover) continue;
    const group = groups.get(handover._id) ?? { handover, products: [] };
    group.products.push(product);
    groups.set(handover._id, group);
  }
  return [...groups.values()];
}

export async function takeReturnBenefits(
  ctx: MutationCtx, row: OrderReturn, planned: Parts, funding: Map<Id<'vouchers'>, Voucher>, actor: StaffActor, pending: boolean, changedOrders: ChangedOrders,
): Promise<Effect[]> {
  const effects: Effect[] = [];
  await reserveReturn(ctx, row);
  for (const { grant, paid, goodwill } of planned.grants) {
    changedOrders.add(grant.orderId);
    const before = { paid: grant.paidUnits, goodwill: grant.goodwillUnits };
    const after = { paid: before.paid - paid, goodwill: before.goodwill - goodwill };
    reserveWrites(ctx, 2);
    await ctx.db.patch(grant._id, {
      paidUnits: after.paid, goodwillUnits: after.goodwill, returnedUnits: grant.returnedUnits + paid,
      revision: grant.revision + 1, ...(pending ? { pendingReturnId: row._id } : {}),
    });
    if (after.paid + after.goodwill === 0) {
      reserveWrites(ctx, grant.grantServiceIds.length);
      await Promise.all(grant.grantServiceIds.map(id => ctx.db.patch(id, { usable: false })));
    }
    const useId = await ctx.db.insert('sessionUses', {
      grantId: grant._id, kind: 'cancel', sourceKey: `return:${row._id}:${grant._id}`,
      before, after, lineId: grant.lineId, guestFact: 'Unused sessions returned', actor: actor.email, createdAt: row.createdAt,
    });
    effects.push({ kind: 'session', grantId: grant._id, useId });
  }
  for (const voucher of planned.issued) {
    changedOrders.add(voucher.source.orderId);
    const before = { paid: voucher.paidBalance, goodwill: voucher.goodwillBalance };
    const after = { paid: 0, goodwill: 0 };
    reserveWrites(ctx, 2);
    await ctx.db.patch(voucher._id, {
      paidBalance: 0, goodwillBalance: 0, revision: voucher.revision + 1,
      ...(pending ? { pendingReturnId: row._id } : { status: 'revoked', packageUnusedPaid: undefined }),
    });
    const entryId = await ctx.db.insert('voucherEntries', {
      voucherId: voucher._id, kind: 'revoke', sourceKey: `return:${row._id}:${voucher._id}`,
      before, after, guestFact: 'Unused voucher value returned', actor: actor.email, createdAt: row.createdAt,
    });
    effects.push({ kind: 'voucher', voucherId: voucher._id, entryId });
  }
  for (const { handover, products } of groupHandovers(planned)) {
    if (pending) {
      changedHandover(changedOrders, handover);
      reserveWrites(ctx, 1);
      await ctx.db.patch(handover._id, { pendingReturnId: row._id, revision: handover.revision + 1 });
    }
    for (const { contentKey, units } of products) effects.push({ kind: 'handover', handoverId: handover._id, contentKey, units });
  }
  if (pending) {
    for (const { voucherId } of row.voucherCredits) {
      const voucher = funding.get(voucherId)!;
      changedOrders.add(voucher.source.orderId);
      reserveWrites(ctx, 1);
      await ctx.db.patch(voucherId, { pendingReturnId: row._id, revision: voucher.revision + 1 });
    }
  }
  return effects;
}

/** Select a deterministic matrix column. Each earlier destination consumes its capacity in order. */
export function destinationShares(rows: ReturnRow[], amounts: number[], index: number) {
  const remaining = rows.map(row => row.amount);
  let shares: number[] = [];
  for (const amount of amounts.slice(0, index + 1)) {
    shares = apportionMoney(amount, remaining);
    shares.forEach((share, rowIndex) => { remaining[rowIndex] -= share; });
  }
  return shares;
}

export async function writeReturnMirrors(
  ctx: MutationCtx, row: OrderReturn, rows: ReturnRow[], shares: number[],
  destination: Pick<Doc<'orderRefunds'>, 'method'> & { key: string; voucherId?: Id<'vouchers'> },
  actor: StaffActor, now: number,
) {
  const businessDate = resortTodayIso(now);
  for (const [index, item] of rows.entries()) {
    const amount = shares[index];
    if (!amount) continue;
    if (item.visit) {
      await recordReturnDestination(ctx, row, item.line._id, {
        key: destination.key, method: destination.method, amount, actor: actor.email, effectiveAt: now,
      });
      continue;
    }
    reserveWrites(ctx, 1);
    const base = {
      orderId: row.orderId, lineId: item.line._id, amount, currency: item.line.currency, returnId: row._id,
      reason: row.reason, idempotencyKey: `return:${row._id}:${destination.key}:${item.line._id}`,
      createdBy: actor.tokenIdentifier, createdByEmail: actor.email, createdAt: now, businessDate,
    };
    await ctx.db.insert('orderRefunds', destination.method === 'voucher'
      ? { ...base, method: 'voucher', voucherId: destination.voucherId! }
      : { ...base, method: destination.method });
  }
}

export async function replacementVoucher(
  ctx: MutationCtx, source: { orderId: Id<'orders'>; returnId?: Id<'orderReturns'>; key: string },
  voucher: Voucher, amount: number, actor: StaffActor, now: number,
) {
  const expiresAt = benefitExpiresAt(now, 'voucher', DEFAULT_COMMERCE_SETTINGS, 90)!;
  const voucherId = await ctx.db.insert('vouchers', {
    faceValue: amount, paidBalance: amount, goodwillBalance: 0, issuedExpiresAt: expiresAt, effectiveExpiresAt: expiresAt,
    status: 'active', branchId: voucher.branchId, customerId: voucher.customerId, name: voucher.name, revision: 0,
    source: { kind: 'refund_credit', voucherId: voucher._id, orderId: source.orderId, returnId: source.returnId },
    settingsRevision: voucher.settingsRevision, terms: { ...voucher.terms, voucherValidityDays: 90 },
  });
  const activeCodeId = await insertVoucherCode(ctx, voucherId);
  await ctx.db.patch(voucherId, { activeCodeId });
  const entryId = await ctx.db.insert('voucherEntries', {
    voucherId, kind: 'issue', sourceKey: source.key,
    before: { paid: 0, goodwill: 0 }, after: { paid: amount, goodwill: 0 },
    guestFact: 'Refund issued on a new gift voucher', actor: actor.email, createdAt: now,
  });
  return { kind: 'voucher' as const, voucherId, entryId };
}

async function releaseVoucherCredits(
  ctx: MutationCtx, row: OrderReturn, planned: Parts, funding: Map<Id<'vouchers'>, Voucher>, actor: StaffActor, now: number, pending: boolean, changedOrders: ChangedOrders,
) {
  const effects: Effect[] = [];
  const amounts = row.voucherCredits.map(credit => credit.paid);
  for (const [index, { voucherId, paid, goodwill }] of row.voucherCredits.entries()) {
    const voucher = funding.get(voucherId) ?? await returnGet(ctx, voucherId);
    if (!voucher || (pending && voucher.pendingReturnId !== row._id)) {
      returnError('RETURN_EFFECT_CHANGED', 'The funding voucher reservation is missing.');
    }
    const status = voucherStatus(voucher, now);
    const canCredit = status === 'active' || status === 'paused';
    let creditedVoucher = voucherId;
    if (canCredit) {
      changedOrders.add(voucher.source.orderId);
      const before = { paid: voucher.paidBalance, goodwill: voucher.goodwillBalance };
      const after = { paid: before.paid + paid, goodwill: before.goodwill + goodwill };
      let packageUnusedPaid = voucher.packageUnusedPaid;
      if (paid && voucher.source.kind === 'package') {
        const sale = await returnGet(ctx, voucher.source.lineId);
        const contentKey = voucher.source.contentKey;
        const content = sale?.saleSnapshot?.contents.find(part => part.contentKey === contentKey && part.voucherId === voucherId);
        if (!content || after.paid > voucher.faceValue) returnError('RETURN_EFFECT_CHANGED', 'The package voucher balance does not reconcile.');
        // This is the same paid-share quote used when settlement debited the voucher.
        packageUnusedPaid = quotePackageVoucherReturn({
          paidShare: content.paidShare, face: voucher.faceValue,
          faceSpent: voucher.faceValue - after.paid, faceReturned: 0, faceThrough: after.paid,
        }).total;
      }
      reserveWrites(ctx, 2);
      await ctx.db.patch(voucherId, {
        paidBalance: after.paid, goodwillBalance: after.goodwill, pendingReturnId: undefined,
        packageUnusedPaid, revision: voucher.revision + 1,
      });
      const entryId = await ctx.db.insert('voucherEntries', {
        voucherId, kind: 'refund_credit', sourceKey: `return-credit:${row._id}:${voucherId}`, before, after,
        guestFact: 'Refund credited to gift voucher', actor: actor.email, createdAt: now,
      });
      effects.push({ kind: 'voucher', voucherId, entryId });
    } else {
      if (pending) {
        changedOrders.add(voucher.source.orderId);
        reserveWrites(ctx, 1);
        await ctx.db.patch(voucherId, { pendingReturnId: undefined, revision: voucher.revision + 1 });
      }
      if (paid) {
        reserveWrites(ctx, 4);
        const replacement = await replacementVoucher(ctx, {
          orderId: row.orderId, returnId: row._id, key: `return-credit:${row._id}:${voucherId}`,
        }, voucher, paid, actor, now);
        effects.push(replacement);
        creditedVoucher = replacement.voucherId;
      }
    }
    if (paid) await writeReturnMirrors(ctx, row, planned.rows, destinationShares(planned.rows, amounts, index), {
      key: `voucher:${voucherId}`, method: 'voucher', voucherId: creditedVoucher,
    }, actor, now);
  }
  return effects;
}

function returnedCustody<T extends { withGuest: number; backSellable: number; backDamaged: number }>(
  custody: T, products: Parts['products'],
): T {
  const sellable = products.reduce((sum, product) => sum + (product.disposition === 'sellable' ? product.units : 0), 0);
  const damaged = products.reduce((sum, product) => sum + (product.disposition === 'damaged' ? product.units : 0), 0);
  return { ...custody, withGuest: custody.withGuest - sellable - damaged,
    backSellable: custody.backSellable + sellable, backDamaged: custody.backDamaged + damaged };
}

export async function finishReturnEffects(
  ctx: MutationCtx, row: OrderReturn, planned: Parts, stock: Stock, funding: Map<Id<'vouchers'>, Voucher>,
  actor: StaffActor, now: number, pending: boolean, changedOrders: ChangedOrders,
) {
  const effects = [...row.effectsApplied];
  for (const item of planned.rows) {
    reserveWrites(ctx, 1);
    await ctx.db.patch(item.line._id, { saleSnapshot: item.snapshot });
  }
  const stockGroups = new Map<Id<'stockLevels'>, number>();
  for (const { stock: level } of stock) stockGroups.set(level._id, (stockGroups.get(level._id) ?? 0) + 1);
  for (const { stock: level, movementId: originalMovementId, sellable, damaged, lotAllocations } of stock) {
    const suffix = stockGroups.get(level._id) === 1 ? level._id : `${level._id}:${originalMovementId}`;
    const { movementId } = await writeStockMovement(ctx, {
      branchId: level.branchId, variantId: level.variantId, delta: sellable, originalMovementId, lotAllocations,
      kind: sellable ? 'return' : 'write_off', sourceKey: `return:${row._id}:${suffix}`, sourceId: row._id,
      reason: `${sellable} sellable, ${damaged} damaged. ${row.reason}`, actor: actor.email, createdAt: now,
    }, stockGroups.get(level._id) === 1 ? level : undefined);
    effects.push({ kind: 'stock', movementId });
  }
  for (const { handover, products } of groupHandovers(planned)) {
    changedHandover(changedOrders, handover);
    const custody = returnedCustody(handover, products);
    reserveWrites(ctx, 1);
    await ctx.db.patch(handover._id, {
      withGuest: custody.withGuest, backSellable: custody.backSellable, backDamaged: custody.backDamaged,
      contents: handover.contents?.map(item => returnedCustody(item, products.filter(product => product.contentKey === item.contentKey))),
      pendingReturnId: undefined, revision: handover.revision + 1,
      status: custody.withGuest === 0 ? 'closed' : handover.status,
    });
  }
  if (pending) {
    for (const { grant } of planned.grants) {
      changedOrders.add(grant.orderId);
      reserveWrites(ctx, 1);
      await ctx.db.patch(grant._id, { pendingReturnId: undefined, revision: grant.revision + 1 });
    }
    for (const voucher of planned.issued) {
      changedOrders.add(voucher.source.orderId);
      reserveWrites(ctx, 1);
      // originalIssuedVoucher reconstructs the pre-authorization revision.
      await ctx.db.patch(voucher._id, { status: 'revoked', packageUnusedPaid: undefined, pendingReturnId: undefined, revision: voucher.revision + 2 });
    }
  }
  effects.push(...await releaseVoucherCredits(ctx, row, planned, funding, actor, now, pending, changedOrders));
  await releaseReturn(ctx, row, 'complete', actor.email, now);
  return effects;
}

export async function reverseReturnEffects(ctx: MutationCtx, row: OrderReturn, actor: StaffActor, now: number, changedOrders: ChangedOrders) {
  await releaseReturn(ctx, row, 'cancel', actor.email, now);
  const clearedHandovers = new Set<Id<'handovers'>>();
  for (const effect of row.effectsApplied) {
    if (effect.kind === 'session') {
      const [grant, use] = await Promise.all([returnGet(ctx, effect.grantId), returnGet(ctx, effect.useId)]);
      if (grant?.pendingReturnId !== row._id || use?.grantId !== grant._id || use.kind !== 'cancel' ||
          grant.grantServiceIds.length > COMMERCE_LIMITS.servicesPerGrant) returnError('RETURN_EFFECT_CHANGED', 'The reserved sessions changed.');
      changedOrders.add(grant.orderId);
      reserveWrites(ctx, 2 + grant.grantServiceIds.length);
      await ctx.db.patch(grant._id, {
        paidUnits: use.before.paid, goodwillUnits: use.before.goodwill,
        returnedUnits: grant.returnedUnits - (use.before.paid - use.after.paid), pendingReturnId: undefined, revision: grant.revision + 1,
      });
      await Promise.all(grant.grantServiceIds.map(id => ctx.db.patch(id, {
        usable: !grant.pause && now < grant.expiresAt && use.before.paid + use.before.goodwill > 0,
      })));
      await ctx.db.insert('sessionUses', {
        grantId: grant._id, kind: 'cancel_reversed', sourceKey: `return-cancel:${row._id}:${grant._id}`,
        before: use.after, after: use.before, lineId: grant.lineId, guestFact: 'Return cancelled: sessions restored',
        actor: actor.email, createdAt: now,
      });
    } else if (effect.kind === 'voucher') {
      const [voucher, entry] = await Promise.all([returnGet(ctx, effect.voucherId), returnGet(ctx, effect.entryId)]);
      if (voucher?.pendingReturnId !== row._id || entry?.voucherId !== voucher._id || entry.kind !== 'revoke') {
        returnError('RETURN_EFFECT_CHANGED', 'The reserved voucher changed.');
      }
      reserveWrites(ctx, 2);
      changedOrders.add(voucher.source.orderId);
      await ctx.db.patch(voucher._id, {
        paidBalance: entry.before.paid, goodwillBalance: entry.before.goodwill, pendingReturnId: undefined, revision: voucher.revision + 1,
      });
      await ctx.db.insert('voucherEntries', {
        voucherId: voucher._id, kind: 'refund_credit', sourceKey: `return-cancel:${row._id}:${voucher._id}`,
        before: entry.after, after: entry.before, guestFact: 'Return cancelled: voucher value restored',
        actor: actor.email, createdAt: now,
      });
    } else if (effect.kind === 'handover' && !clearedHandovers.has(effect.handoverId)) {
      const handover = await returnGet(ctx, effect.handoverId);
      if (handover?.pendingReturnId !== row._id) returnError('RETURN_EFFECT_CHANGED', 'The reserved handover changed.');
      reserveWrites(ctx, 1);
      await ctx.db.patch(handover._id, { pendingReturnId: undefined, revision: handover.revision + 1 });
      clearedHandovers.add(handover._id);
      changedHandover(changedOrders, handover);
    }
  }
  for (const { voucherId } of row.voucherCredits) {
    const voucher = await returnGet(ctx, voucherId);
    if (voucher?.pendingReturnId !== row._id) returnError('RETURN_EFFECT_CHANGED', 'The funding voucher reservation is missing.');
    changedOrders.add(voucher.source.orderId);
    reserveWrites(ctx, 1);
    await ctx.db.patch(voucherId, { pendingReturnId: undefined, revision: voucher.revision + 1 });
  }
}

export async function replacementSlips(ctx: MutationCtx | QueryCtx, row: OrderReturn) {
  if (row.status !== 'completed') return [];
  const slips = [];
  const originals = new Set(row.voucherCredits.map(credit => credit.voucherId));
  for (const effect of row.effectsApplied) {
    if (effect.kind !== 'voucher' || originals.has(effect.voucherId)) continue;
    const voucher = await returnGet(ctx, effect.voucherId);
    if (voucher?.source.kind !== 'refund_credit' || voucher.source.returnId !== row._id || !voucher.activeCodeId) continue;
    const code = await readOrderProjection(ctx, () => ctx.db.get(voucher.activeCodeId!));
    if (code?.voucherId === voucher._id && code.status === 'active') {
      // `replaces`: the expired or disabled voucher this one stands in for, so staff are pointed here.
      slips.push({ voucherId: voucher._id, replaces: voucher.source.voucherId, code: code.code, amount: voucher.faceValue, expiresAt: voucher.effectiveExpiresAt });
    }
  }
  return slips;
}
