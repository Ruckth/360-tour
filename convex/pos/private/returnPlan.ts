import { compareValues, ConvexError, type Infer } from 'convex/values';
import type { Doc, Id, TableNames } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { quoteReturn, type VisitReturn } from '../../services/model';
import {
  apportionMoney, COMMERCE_LIMITS, incrementalShare, isProtectedUnusedRefund, quotePackageVoucherReturn,
  quoteSessionReturn, quoteStandaloneVoucherReturn, routeReceiptRefund, type VoucherRefundStatus,
} from '../../shared/commerce';
import { resortTodayIso } from '../../shared/time';
import { handoverForLine } from './handoverCustody';
import { activeLineLink } from './lineLinks';
import { isCommerceReceipt, orderPaymentRecord, readOrderProjection, voucherOrderPayments } from './orderLifecycle';
import { MAX_LINES, orderLines } from './orderLines';
import { hasCommerceReceipt, returnPayments } from './returnGuards';
import type { encodeReturnApprovalReview } from './staffApprovalState';
import type { returnPart } from '../validators';
import { readReturnMovementLots, packedReturnLots, remainingReturnLots, selectReturnLots, type LotAllocation, type ReturnLot, type ReturnLotState } from './returnLots';

export type ReturnPart = Infer<typeof returnPart>;
export type OrderReturn = Doc<'orderReturns'>;
type ReadCtx = QueryCtx | MutationCtx;
type Line = Doc<'orderLines'>;
type Snapshot = NonNullable<Line['saleSnapshot']>;
type Content = Snapshot['contents'][number];
type Grant = Doc<'sessionGrants'>;
type Voucher = Doc<'vouchers'>;
type Handover = Doc<'handovers'>;
type Stock = Doc<'stockLevels'>;
type Review = Parameters<typeof encodeReturnApprovalReview>[0];

type ReturnPartAmount = {
  /** `visit` is an attached appointment's money; `restore` puts a used session back (no money). */
  kind: 'line' | 'session' | 'product' | 'voucher' | 'visit' | 'restore';
  label: string;
  amount: number;
  contentKey?: string;
  disposition?: 'sellable' | 'damaged';
  units?: number;
  lots?: ReturnLot[];
};
export type ReturnRow = { line: Line; snapshot: Snapshot; amount: number; parts: ReturnPartAmount[]; visit?: VisitReturn };
export type ReturnProduct = {
  contentKey: string; units: number; disposition: 'sellable' | 'damaged';
  movementId: Id<'stockMovements'>; handover?: Handover; selection: UnitSelection; summary: ReturnPartAmount; content?: Snapshot['contents'][number];
};
type GrantClaim = { grant: Grant; paid: number; goodwill: number };
type GoodsReturn = { stock: Stock; movementId: Id<'stockMovements'>; sellable: number; damaged: number; lotAllocations?: LotAllocation[] };

export function returnError(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

export function returnGet<T extends TableNames>(ctx: ReadCtx, id: Id<T>) {
  return readOrderProjection(ctx, () => ctx.db.get(id));
}

function voucherStatus(voucher: Voucher, now: number): VoucherRefundStatus {
  if (voucher.status === 'revoked' || voucher.status === 'disabled') return 'disabled';
  if (voucher.status === 'expired' || (!voucher.pause && voucher.effectiveExpiresAt !== null && now >= voucher.effectiveExpiresAt)) return 'expired';
  return voucher.pause ? 'paused' : 'active';
}

export async function receiptRows(ctx: ReadCtx, order: Doc<'orders'>) {
  const lines = await readOrderProjection(ctx, () => orderLines(ctx, order._id));
  if (!await hasCommerceReceipt(ctx, order, lines)) returnError('RETURN_NOT_COMMERCE', 'Use the existing refund flow for this receipt.');
  return lines;
}

/** Σ saleSnapshot.returnedAmount: what earlier returns took off these rows (external and voucher credits). */
export function rowsReturned(lines: readonly Line[]) {
  return lines.reduce((sum, line) => sum + (line.saleSnapshot?.returnedAmount ?? 0), 0);
}

/** How much a finished return adds to `rowsReturned` once its planned snapshots are written. */
export function returnedDelta(rows: readonly ReturnRow[]) {
  return rows.reduce((sum, row) => sum + row.snapshot.returnedAmount - (row.line.saleSnapshot?.returnedAmount ?? 0), 0);
}

const receiptOrder = (lines: Line[]) =>
  // Match by_orderId's creation-time/id order: it breaks refund-allocation ties.
  lines.sort((a, b) => a._creationTime - b._creationTime || compareValues(a._id, b._id));

async function fullReceipt(ctx: ReadCtx, order: Doc<'orders'>) {
  const lines = await receiptRows(ctx, order);
  return { lines, previouslyReturned: rowsReturned(lines) };
}

/**
 * Planning needs selected rows and the receipt's cumulative returned amount, not untouched siblings.
 * `orders.rowReturnedTotal` is that exact sum once a return has written it (authorize from this
 * planner's own total, payout from a full row read); without it, rows holding returned amounts are read.
 */
export async function receiptRowsForReturn(ctx: ReadCtx, order: Doc<'orders'>, parts: ReturnPart[]) {
  if (order.itemCount <= returnLimits.parts) return await fullReceipt(ctx, order);
  const total = order.returnedTotal === undefined ? undefined : order.rowReturnedTotal;
  if (total === undefined && order.returnedTotal === undefined &&
      !parts.some(part => part.kind === 'cancelPackage' || part.kind === 'content')) return await fullReceipt(ctx, order);
  const [positive, negative] = total !== undefined ? [[], []] : await Promise.all([
    readOrderProjection(ctx, () => ctx.db.query('orderLines')
      .withIndex('by_orderId_and_saleSnapshot_returnedAmount', q => q.eq('orderId', order._id)
        .gt('saleSnapshot.returnedAmount', 0)).take(MAX_LINES)),
    readOrderProjection(ctx, () => ctx.db.query('orderLines')
      .withIndex('by_orderId_and_saleSnapshot_returnedAmount', q => q.eq('orderId', order._id)
        .gte('saleSnapshot.returnedAmount', -Infinity).lt('saleSnapshot.returnedAmount', 0)).take(MAX_LINES)),
  ]);
  const byId = new Map([...positive, ...negative].map(line => [line._id, line]));
  const missing = [...new Set(parts.map(part => part.lineId))].filter(id => !byId.has(id));
  const selected = await Promise.all(missing.map(id => returnGet(ctx, id)));
  // Keep the complete receipt predicate and invalid-selection errors for ordinary siblings.
  if (selected.some(line => !line || line.orderId !== order._id)) return await fullReceipt(ctx, order);
  for (const line of selected) if (line) byId.set(line._id, line);
  const lines = [...byId.values()];
  if (!isCommerceReceipt(order, lines, false)) return await fullReceipt(ctx, order);
  return { lines: receiptOrder(lines), previouslyReturned: total ?? rowsReturned(lines) };
}

type Selection = Exclude<ReturnPart, { kind: 'restoreSession' }>;
type UnitSelection = Extract<Selection, { units: number }>;
type SelectedRow = {
  line: Line; selections: Selection[]; whole: boolean;
  link: Doc<'orderLineLinks'> | null; appointmentId?: Id<'appointments'>; restoreUseId?: Id<'sessionUses'>;
};
const { sale, return: returnLimits } = COMMERCE_LIMITS;

export async function selectReturnRows(ctx: ReadCtx, lines: Line[], parts: ReturnPart[], existing?: OrderReturn): Promise<SelectedRow[]> {
  if (!parts.length || parts.length > returnLimits.parts) returnError('RETURN_PART_LIMIT', 'Return these in two parts.');
  const selections = new Map<Id<'orderLines'>, SelectedRow>();
  const visits = new Set<Id<'appointments'>>();
  for (const part of parts) {
    const line = lines.find(row => row._id === part.lineId);
    if (!line) returnError('RETURN_INVALID_PART', 'Select an item on this receipt.');
    if (line.bookingId || line.kind === 'booking') {
      returnError('RETURN_BOOKING_OWNED', 'Use the booking page to refund accommodation.');
    }
    const frozen = existing?.visitReturns?.find(item => item.lineId === line._id);
    const link = frozen ? null : await readOrderProjection(ctx, () => activeLineLink(ctx, line._id));
    if (link?.kind === 'booking') returnError('RETURN_BOOKING_OWNED', 'Use the booking page to refund accommodation.');
    if (!line.saleSnapshot) returnError('RETURN_NO_SNAPSHOT', 'This item has no frozen sale details.');
    const appointmentId = frozen?.appointmentId ?? line.appointmentId ?? link?.appointmentId;
    const selected = selections.get(line._id) ?? { line, link, selections: [], whole: false };
    if (appointmentId) {
      if (existing && !frozen) returnError('RETURN_VISIT_CHANGED', 'The visit reservation is missing.');
      if (visits.has(appointmentId)) returnError('RETURN_DUPLICATE_PART', 'Select each visit once.');
      if (visits.size >= returnLimits.visits) returnError('RETURN_VISIT_LIMIT', 'Return these in two parts.');
      if (part.kind !== 'restoreSession' && (part.kind !== 'line' || part.units !== 1 || part.disposition || line.coverage)) {
        returnError('RETURN_INVALID_PART', 'Select the visit or restore its session.');
      }
      if (part.kind === 'restoreSession') selected.restoreUseId = part.useId;
      else selected.selections.push(part);
      selected.appointmentId = appointmentId;
      visits.add(appointmentId);
      selections.set(line._id, selected);
      continue;
    }
    if (part.kind === 'restoreSession' || line.coverage || line.kind === 'appointment') {
      returnError('RETURN_VISIT_SOURCE', 'This row has no linked visit to return.');
    }
    const samePart = selected.selections.some(previous => {
      if (previous.kind !== part.kind) return false;
      if (previous.kind === 'cancelPackage' || part.kind === 'cancelPackage') return true;
      return (previous.kind === 'line' || (part.kind === 'content' && previous.contentKey === part.contentKey)) &&
        previous.disposition === part.disposition;
    });
    if (samePart) returnError('RETURN_DUPLICATE_PART', 'Select each item or package content once.');
    if ('lotAllocations' in part && part.lotAllocations && part.disposition !== 'sellable' &&
        !(part.disposition === 'damaged' && line.saleSnapshot?.contents.find(content =>
          content.contentKey === (part.kind === 'content' ? part.contentKey : 'product'))?.packedLots)) {
      returnError('RETURN_INVALID_LOTS', 'Confirm lots only for eligible goods received back.');
    }
    if (part.kind === 'content' ? line.kind !== 'package' : part.kind === 'cancelPackage' ? line.kind !== 'package' : line.kind === 'package') {
      returnError('RETURN_INVALID_PART', 'Choose the package or its individual contents.');
    }
    if (part.kind === 'cancelPackage') selected.whole = true;
    else if (!Number.isSafeInteger(part.units) || part.units < 1) returnError('RETURN_INVALID_UNITS', 'Choose a positive whole quantity.');
    selected.selections.push(part);
    selections.set(line._id, selected);
  }
  // Receipt order is the tie-breaker for refund allocation.
  return lines.flatMap(line => {
    const selected = selections.get(line._id);
    return selected ? [selected] : [];
  });
}

export async function receiptVisitReturnParts(ctx: ReadCtx, lines: Line[], links: Doc<'orderLineLinks'>[]) {
  const activeByLine = new Map(links.map(link => [link.lineId, link]));
  return (await Promise.all(lines.map(async line => {
    const link = activeByLine.get(line._id) ?? null;
    const appointmentId = line.appointmentId ?? link?.appointmentId;
    const snapshot = line.saleSnapshot;
    if (!appointmentId || !snapshot || snapshot.returnedUnits >= line.qty ||
        line.bookingId || line.kind === 'booking' || link?.kind === 'booking') return null;
    try {
      const quote = await quoteReturn(ctx, {
        appointmentId, orderId: line.orderId, lineId: line._id, restoreUseId: line.coverage?.useId,
        amount: snapshot.paidShare - snapshot.returnedAmount,
      }, line, link);
      if (!quote.restore && !quote.amount && !snapshot.goodwillDiscounts.length) return null;
      return {
        lineId: line._id, label: snapshot.label, amount: quote.amount, appointmentId,
        part: quote.restore
          ? { kind: 'restoreSession' as const, lineId: line._id, useId: quote.restore.useId }
          : { kind: 'line' as const, lineId: line._id, units: 1 },
      };
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      return null;
    }
  }))).flatMap(part => part ? [part] : []);
}

async function handoversForReturn(ctx: ReadCtx, order: Doc<'orders'>, lines: readonly Line[], existing?: OrderReturn) {
  if (existing) {
    const ids = [...new Set(existing.effectsApplied.flatMap(effect => effect.kind === 'handover' ? [effect.handoverId] : []))];
    return await Promise.all(ids.map(async id => {
      const handover = await returnGet(ctx, id);
      if (handover?.pendingReturnId !== existing._id) returnError('RETURN_EFFECT_CHANGED', 'The reserved handover changed.');
      return handover;
    }));
  }
  const handovers = await Promise.all(lines.map(line => handoverForLine(ctx, order, line)));
  return handovers.filter((row): row is Handover => row !== null);
}

export async function planReturnParts(
  ctx: ReadCtx, order: Doc<'orders'>, selected: SelectedRow[], now: number, mistakenSale: boolean, existing?: OrderReturn,
) {
  const grants: GrantClaim[] = [];
  const issued: Voucher[] = [];
  const products: ReturnProduct[] = [];
  const rows: ReturnRow[] = [];
  const goodwill = new Map<Id<'vouchers'>, number>();
  const goodsLines = selected.flatMap(({ line }) => line.kind === 'product' || line.kind === 'package' ? [line] : []);
  const handovers = goodsLines.length ? await handoversForReturn(ctx, order, goodsLines, existing) : [];

  for (const { line, selections, whole, link, appointmentId, restoreUseId } of selected) {
    const before = line.saleSnapshot!;
    const snapshot = { ...before, contents: before.contents.map(content => ({ ...content })) };
    const parts: ReturnPartAmount[] = [];
    const handover = handovers.find(record => (record.successorOrderId === order._id ? record.successorLineId : record.lineId) === line._id);
    const tracksContents = line.kind === 'package' || line.kind === 'product' || line.kind === 'voucher';
    if (tracksContents && (!snapshot.contents.length || snapshot.contents.length > COMMERCE_LIMITS.package.contents)) {
      returnError('RETURN_NO_SNAPSHOT', 'This item has incomplete frozen sale details.');
    }
    const lineSelections = selections.filter(part => part.kind === 'line');
    const [lineSelection] = lineSelections;
    if (!tracksContents && lineSelection) {
      if (lineSelections.some(item => item.disposition)) returnError('RETURN_INVALID_PART', 'Only goods have a stock disposition.');
      const progress = progressFor(snapshot, line.qty, lineSelection.units);
      Object.assign(snapshot, progress);
      parts.push({ kind: 'line', label: before.label, amount: progress.returnedAmount - before.returnedAmount });
      addGoodwill(goodwill, before.goodwillDiscounts, line.qty, before.returnedUnits, lineSelection.units);
    }

    if (appointmentId) {
      const visit = existing?.visitReturns?.find(item => item.lineId === line._id)
        ?? await quoteReturn(ctx, {
          appointmentId, orderId: order._id, lineId: line._id, restoreUseId,
          amount: parts.reduce((sum, part) => sum + part.amount, 0),
        }, line, link);
      if (restoreUseId) Object.assign(snapshot, progressFor(snapshot, line.qty, 1));
      snapshot.returnedAmount = before.returnedAmount + visit.amount;
      const visitParts: ReturnPartAmount[] = visit.restore
        ? [{ kind: 'restore', label: before.label, amount: 0 }]
        : [{ kind: 'visit', label: before.label, amount: visit.amount }];
      rows.push({ line, snapshot, amount: visit.amount, parts: visitParts, visit });
      continue;
    }

    const explicitlySelected = selections.flatMap(part => part.kind === 'content' ? [part.contentKey] : []);
    if (explicitlySelected.some(key => !snapshot.contents.some(content => content.contentKey === key))) {
      returnError('RETURN_INVALID_PART', 'Select a content item sold on this receipt.');
    }
    const protectedUnused = whole && isProtectedUnusedRefund({
      soldOn: resortTodayIso(order.paidAt!), cancelOn: resortTodayIso(now), unused: true,
    }, { unusedRefundDays: before.terms.unusedFullRefundDays });
    for (const [index, content] of snapshot.contents.entries()) {
      const requested: UnitSelection[] = lineSelection ? lineSelections : selections.flatMap(item =>
        item.kind === 'content' && item.contentKey === content.contentKey ? [item] : []);
      const [part] = requested;
      if ((!part && !whole) || (!part && !content.grantId && !content.voucherId)) continue;
      const prior = before.contents[index];
      if (prior.returnedUnits >= prior.units && !(whole && content.grantId && !part)) {
        if (part) returnError('RETURN_UNITS_EXCEEDED', 'These units have already been returned.');
        continue;
      }
      if (content.grantId) {
        if (existing && !existing.effectsApplied.some(effect => effect.kind === 'session' && effect.grantId === content.grantId)) continue;
        if (grants.length >= returnLimits.affectedGrants) returnError('RETURN_GRANT_LIMIT', 'Return these in two parts.');
        const grant = await originalGrant(ctx, line, content, existing);
        if (requested.some(item => item.disposition)) returnError('RETURN_INVALID_PART', 'Sessions have no stock disposition.');
        const expired = !grant.pause && now >= grant.expiresAt;
        const available = expired && !grant.terms.preserveExpiredPackageValue && !(protectedUnused && grant.used === 0)
          ? 0 : grant.paidUnits;
        const units = part?.units ?? available;
        if (units > available) returnError('RETURN_UNITS_EXCEEDED', 'There are fewer unused paid sessions left.');
        const giftUnits = whole ? grant.goodwillUnits : 0;
        if (units || giftUnits) {
          const quote = quoteSessionReturn({
            paidShare: prior.paidShare, unitsSold: prior.units, unitsBefore: prior.returnedUnits,
            unitsThrough: prior.returnedUnits + units, normalUnitPrice: 0,
            paidUnitsUsed: prior.units - prior.returnedUnits - grant.paidUnits,
          }, { sessionRefundMode: 'paid_share' });
          content.returnedUnits += units;
          content.returnedAmount = quote.total;
          grants.push({ grant, paid: units, goodwill: giftUnits });
          parts.push({ kind: 'session', contentKey: content.contentKey, label: content.label,
            amount: content.returnedAmount - prior.returnedAmount, units: units + giftUnits });
        }
      } else if (content.voucherId) {
        if (existing && !existing.effectsApplied.some(effect => effect.kind === 'voucher' && effect.voucherId === content.voucherId)) continue;
        if (issued.length >= sale.voucherIssuances) returnError('RETURN_VOUCHER_LIMIT', 'Return these in two parts.');
        if (requested.some(item => item.units !== 1 || item.disposition)) returnError('RETURN_INVALID_PART', 'Return the unused voucher balance as one part.');
        const voucher = await originalIssuedVoucher(ctx, line, content, existing);
        let credit = 0;
        if (voucher.source.kind === 'sale') {
          const spent = await readOrderProjection(ctx, () => ctx.db.query('voucherEntries')
            .withIndex('by_voucherId_and_kind', q => q.eq('voucherId', voucher._id).eq('kind', 'spend')).first());
          credit = quoteStandaloneVoucherReturn({
            face: voucher.faceValue, paidBalance: voucher.paidBalance, onIssuingReceipt: true,
            everSpent: spent !== null, mistakenSale: mistakenSale && ['active', 'paused'].includes(voucherStatus(voucher, now)),
          });
          if (!credit) returnError('RETURN_VOUCHER_NOT_REFUNDABLE', 'Only an untouched voucher sold by mistake can be returned for money.');
        } else if (voucherStatus(voucher, now) === 'expired') {
          credit = voucher.terms.preserveExpiredPackageValue ? voucher.packageUnusedPaid ?? 0 : 0;
        } else {
          credit = quotePackageVoucherReturn({
            paidShare: prior.paidShare, face: voucher.faceValue, faceSpent: voucher.faceValue - voucher.paidBalance,
            faceReturned: 0, faceThrough: voucher.paidBalance,
          }).amount;
        }
        if (credit || voucher.paidBalance || voucher.goodwillBalance) {
          issued.push(voucher);
          content.returnedUnits = 1;
          content.returnedAmount = credit;
          parts.push({ kind: 'voucher', contentKey: content.contentKey, label: content.label,
            amount: content.returnedAmount - prior.returnedAmount });
        }
      } else if (part) {
        const physical = requested.filter(item => !!item.disposition);
        if (handover && physical.length !== requested.length) {
          returnError('RETURN_CUSTODY_REQUIRED', 'Items staying with the guest stay charged. Choose the condition of items taken back.');
        }
        const summaries = new Map<UnitSelection, ReturnPartAmount>();
        for (const item of requested) {
          const { units, disposition } = item;
          const previous = content.returnedAmount;
          Object.assign(content, progressFor(content, prior.units, units));
          const summary: ReturnPartAmount = { kind: 'product', contentKey: content.contentKey, label: content.label,
            amount: content.returnedAmount - previous, units, ...(disposition ? { disposition } : {}) };
          summaries.set(item, summary);
          parts.push(summary);
        }
        const physicalUnits = physical.reduce((sum, item) => sum + item.units, 0);
        if (physicalUnits) {
          if (!content.stockMovementId) returnError('RETURN_NO_SNAPSHOT', 'The original stock movement is missing.');
          const custody = handover?.contents?.find(item => item.contentKey === content.contentKey) ?? handover;
          if (custody && (custody.paid < physicalUnits || custody.withGuest < physicalUnits ||
              (handover?.pendingReturnId && handover.pendingReturnId !== existing?._id))) {
            returnError('RETURN_CUSTODY_CHANGED', 'The item is no longer in paid guest custody.');
          }
          for (const item of physical) {
            products.push({ contentKey: content.contentKey, units: item.units, disposition: item.disposition!,
              movementId: content.stockMovementId, handover, content, selection: item, summary: summaries.get(item)! });
          }
        }
      }
    }
    const amount = parts.reduce((sum, part) => sum + part.amount, 0);
    if (tracksContents) {
      snapshot.returnedAmount += amount;
      snapshot.returnedUnits = line.kind === 'package'
        ? Number(snapshot.contents.every(content => content.returnedUnits === content.units))
        : snapshot.contents[0].returnedUnits;
      if (line.kind === 'package' && before.goodwillDiscounts.length) {
        const weights = before.contents.map(content => content.paidShare || 0);
        for (const discount of before.goodwillDiscounts) {
          const shares = apportionMoney(discount.amount, weights.some(Boolean) ? weights : before.contents.map(content => content.units));
          snapshot.contents.forEach((content, index) => {
            const prior = before.contents[index];
            addGoodwill(goodwill, [{ ...discount, amount: shares[index] }], content.units,
              prior.returnedUnits, content.returnedUnits - prior.returnedUnits);
          });
        }
      } else {
        addGoodwill(goodwill, before.goodwillDiscounts, line.qty, before.returnedUnits, snapshot.returnedUnits - before.returnedUnits);
      }
    }
    if (amount || JSON.stringify(before) !== JSON.stringify(snapshot)) rows.push({ line, snapshot, amount, parts });
  }
  const restores = new Set(rows.flatMap(({ visit }) => visit?.restore ? [visit.restore.grantId] : []));
  if (grants.some(({ grant }) => restores.has(grant._id)) || restores.size + grants.length > returnLimits.affectedGrants) {
    returnError('RETURN_GRANT_LIMIT', 'Return these in two parts.');
  }
  if (!rows.length && !grants.length && !issued.length) returnError('RETURN_NOTHING_LEFT', 'There is no returnable value or quantity left.');
  const physical = new Set(products.map(product => product.selection));
  if (selected.some(row => row.selections.some(part => 'lotAllocations' in part && part.lotAllocations && !physical.has(part)))) {
    returnError('RETURN_INVALID_LOTS', 'Confirm lots only for eligible goods received back.');
  }
  return { rows, grants, issued, products, goodwill };
}

function progressFor(prior: { paidShare: number; returnedUnits: number }, sold: number, units: number) {
  const returnedUnits = prior.returnedUnits + units;
  if (returnedUnits > sold) returnError('RETURN_UNITS_EXCEEDED', 'There are fewer units left to return.');
  const { total: returnedAmount } = incrementalShare(prior.paidShare, {
    unitsSold: sold, unitsBefore: prior.returnedUnits, unitsThrough: returnedUnits,
  });
  return { returnedUnits, returnedAmount };
}

function addGoodwill(
  credits: Map<Id<'vouchers'>, number>, discounts: Snapshot['goodwillDiscounts'],
  unitsSold: number, unitsBefore: number, units: number,
) {
  for (const { voucherId, amount } of discounts) {
    const share = incrementalShare(amount, { unitsSold, unitsBefore, unitsThrough: unitsBefore + units }).amount;
    if (share) credits.set(voucherId, (credits.get(voucherId) ?? 0) + share);
  }
}

async function originalGrant(ctx: ReadCtx, line: Line, content: Content, existing?: OrderReturn) {
  const grant = await returnGet(ctx, content.grantId!);
  if (!grant || grant.lineId !== line._id || grant.contentKey !== content.contentKey ||
      grant.grantServiceIds.length > COMMERCE_LIMITS.servicesPerGrant) {
    returnError('RETURN_EFFECT_CHANGED', 'The issued sessions have changed.');
  }
  const effect = existing?.effectsApplied.find(item => item.kind === 'session' && item.grantId === grant._id);
  if (grant.pendingReturnId && (grant.pendingReturnId !== existing?._id || effect?.kind !== 'session')) {
    returnError('RETURN_BENEFIT_CLAIMED', 'The issued sessions are reserved by another return.');
  }
  if (effect?.kind !== 'session') return grant;
  const use = await returnGet(ctx, effect.useId);
  if (use?.grantId !== grant._id || use.kind !== 'cancel') returnError('RETURN_EFFECT_CHANGED', 'The session reversal evidence is missing.');
  return { ...grant, paidUnits: use.before.paid, goodwillUnits: use.before.goodwill };
}

async function originalIssuedVoucher(ctx: ReadCtx, line: Line, content: Content, existing?: OrderReturn) {
  const voucher = await returnGet(ctx, content.voucherId!);
  if (!voucher || voucher.source.kind === 'refund_credit' || voucher.source.lineId !== line._id ||
      (voucher.source.kind === 'package' && voucher.source.contentKey !== content.contentKey)) {
    returnError('RETURN_EFFECT_CHANGED', 'The issued voucher has changed.');
  }
  const effect = existing?.effectsApplied.find(item => item.kind === 'voucher' && item.voucherId === voucher._id);
  if (voucher.pendingReturnId && (voucher.pendingReturnId !== existing?._id || effect?.kind !== 'voucher')) {
    returnError('RETURN_BENEFIT_CLAIMED', 'The issued voucher is reserved by another return.');
  }
  if (effect?.kind !== 'voucher') return voucher;
  const entry = await returnGet(ctx, effect.entryId);
  if (entry?.voucherId !== voucher._id || entry.kind !== 'revoke') returnError('RETURN_EFFECT_CHANGED', 'The voucher reversal evidence is missing.');
  return { ...voucher, paidBalance: entry.before.paid, goodwillBalance: entry.before.goodwill, revision: voucher.revision - 1 };
}

export async function planReturnStock(ctx: ReadCtx, products: ReturnProduct[]) {
  const moves = new Map<Id<'stockMovements'>, Doc<'stockMovements'>>();
  const groups = new Map<Id<'stockMovements'>, GoodsReturn>();
  const remainingByMove = new Map<Id<'stockMovements'>, Map<LotAllocation['lotId'], ReturnLotState> | null>();
  const allocationsByPart = new Map<ReturnProduct['selection'], LotAllocation[]>();
  for (const product of products) {
    const move = moves.get(product.movementId) ?? await returnGet(ctx, product.movementId);
    if (!move || move.delta >= 0) returnError('RETURN_NO_SNAPSHOT', 'The original stock movement is missing.');
    moves.set(move._id, move);
    let group = groups.get(move._id);
    if (!group) {
      if (groups.size >= sale.distinctVariants) returnError('RETURN_STOCK_LIMIT', 'Return these in two parts.');
      const stock = await readOrderProjection(ctx, () => ctx.db.query('stockLevels').withIndex('by_variantId_and_branchId', q =>
        q.eq('variantId', move.variantId).eq('branchId', move.branchId)).unique());
      if (!stock) returnError('RETURN_STOCK_MISSING', 'The original stock record is missing.');
      group = { stock, movementId: move._id, sellable: 0, damaged: 0 };
      groups.set(move._id, group);
    }
    group[product.disposition] += product.units;
    const packed = product.content?.packedLots;
    if (product.disposition !== 'sellable' && !packed) continue;
    if (!remainingByMove.has(move._id)) {
      const { tracked, lots } = await readReturnMovementLots(ctx, move);
      remainingByMove.set(move._id, tracked ? remainingReturnLots(lots) : null);
    }
    const remaining = remainingByMove.get(move._id);
    if (!remaining) {
      if (packed || product.selection.lotAllocations) returnError('RETURN_INVALID_LOTS', 'This item has no tracked lots.');
      continue;
    }
    const partRemaining = packed && remainingReturnLots(packedReturnLots(
      [...remaining.values()].map(({ lot, remaining }) => ({ ...lot, quantity: remaining })),
      packed, product.content?.returnedPackedLots,
    ));
    const confirmedLots = selectReturnLots(product.units, product.selection.lotAllocations, partRemaining || remaining);
    if (packed && product.content) {
      const used = new Map(product.content.returnedPackedLots?.map(lot => [lot.lotId, lot.quantity]));
      for (const { lotId, quantity } of confirmedLots) used.set(lotId, (used.get(lotId) ?? 0) + quantity);
      product.content.returnedPackedLots = Array.from(used, ([lotId, quantity]) => ({ lotId, quantity }));
    }
    const allocations = confirmedLots.map(({ lotId, quantity }) => ({ lotId, quantity }));
    product.summary.lots = confirmedLots;
    allocationsByPart.set(product.selection, allocations);
    if (product.disposition !== 'sellable') continue;
    if (partRemaining) {
      for (const { lotId, quantity } of allocations) remaining.get(lotId)!.remaining -= quantity;
    }
    const combined = new Map(group.lotAllocations?.map(lot => [lot.lotId, lot.quantity]));
    for (const { lotId, quantity } of allocations) combined.set(lotId, (combined.get(lotId) ?? 0) + quantity);
    group.lotAllocations = Array.from(combined, ([lotId, quantity]) => ({ lotId, quantity }));
  }
  return { stock: [...groups.values()], allocationsByPart };
}

export async function planReturnMoney(
  ctx: ReadCtx, order: Doc<'orders'>, previouslyReturned: number, parts: Awaited<ReturnType<typeof planReturnParts>>, now: number,
) {
  const payments = await returnPayments(ctx, order);
  if (payments.length > sale.paymentRows) returnError('RETURN_PAYMENT_LIMIT', 'The receipt has too many tenders.');
  const vouchers = voucherOrderPayments(payments);
  const funding = new Map<Id<'vouchers'>, Voucher>();
  for (const id of new Set([...vouchers.map(item => item.voucherId), ...parts.goodwill.keys()])) {
    if (funding.size >= sale.distinctFundingVouchers) returnError('RETURN_PAYMENT_LIMIT', 'The receipt has too many funding vouchers.');
    const voucher = await returnGet(ctx, id);
    if (!voucher) returnError('RETURN_VOUCHER_MISSING', 'A funding voucher is missing.');
    if (voucher.pendingReturnId) returnError('RETURN_BENEFIT_CLAIMED', 'A funding voucher is reserved by another return.');
    funding.set(id, voucher);
  }
  const externalRefunded = order.returnedTotal ?? 0;
  // Finished returns always spend the same frozen voucher capacities in tender order.
  let credited = previouslyReturned - externalRefunded;
  if (credited < 0 || credited > vouchers.reduce((sum, voucher) => sum + voucher.amount, 0)) {
    returnError('RETURN_TOTAL_CHANGED', 'The receipt return balances do not reconcile.');
  }
  const { external, voucherCredits, goodwillCredits } = routeReceiptRefund({
    amount: parts.rows.reduce((sum, row) => sum + row.amount, 0),
    vouchers: vouchers.map(voucher => {
      const prior = Math.min(credited, voucher.amount);
      credited -= prior;
      return { voucherId: voucher.voucherId, paid: voucher.amount, credited: prior, status: voucherStatus(funding.get(voucher.voucherId)!, now) };
    }),
    externalTenders: orderPaymentRecord(order, payments).tenders,
    externalRefunded,
    goodwill: [...parts.goodwill].map(([voucherId, amount]) => ({ voucherId, amount, status: voucherStatus(funding.get(voucherId)!, now) })),
  });
  const credits: OrderReturn['voucherCredits'] = [...funding.values()].flatMap(voucher => {
    const paidCredit = voucherCredits.find(item => item.voucherId === voucher._id);
    const paid = paidCredit?.amount ?? 0;
    const goodwill = goodwillCredits.find(item => item.voucherId === voucher._id)?.amount ?? 0;
    if (!paid && !goodwill) return [];
    const destination = paidCredit?.replacementValidityDays
      ? { kind: 'newVoucher' as const }
      : { kind: 'existingVoucher' as const, voucherId: voucher._id, codeMask: null };
    return [{ voucherId: voucher._id, paid, goodwill, destination }];
  });
  return { external, credits, funding, payments };
}

export function approvalReturnReview(
  order: Doc<'orders'>, selected: SelectedRow[], parts: Awaited<ReturnType<typeof planReturnParts>>,
  stock: GoodsReturn[], funding: Map<Id<'vouchers'>, Voucher>,
): Review {
  const revisions: Review['revisions'] = [
    ...parts.rows.flatMap(({ visit }) => visit ? [
      { table: 'appointments' as const, id: visit.appointmentId, revision: visit.expectedRevision },
      ...(visit.restore ? [{ table: 'sessionGrants' as const, id: visit.restore.grantId, revision: visit.restore.grantRevision }] : []),
    ] : []),
    ...parts.grants.map(({ grant }) => ({ table: 'sessionGrants' as const, id: grant._id, revision: grant.revision })),
    ...[...parts.issued, ...funding.values()].map(voucher => ({ table: 'vouchers' as const, id: voucher._id, revision: voucher.revision })),
    ...stock.map(({ stock: item }) => ({ table: 'stockLevels' as const, id: item._id, revision: item.revision })),
    ...parts.products.flatMap(({ handover }) => handover
      ? [{ table: 'handovers' as const, id: handover._id, revision: handover.revision }] : []),
  ];
  return {
    correctionRevision: order.correctionRevision ?? 0,
    revisions: [...new Map(revisions.map(item => [item.id, item])).values()],
    rows: selected.map(({ line }) => ({ lineId: line._id, label: line.saleSnapshot!.label })),
  };
}

export { voucherStatus };
