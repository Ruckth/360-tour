import { ConvexError } from 'convex/values';
import { internal } from '../../_generated/api';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { canAccessCheckoutOrderBranch, canReadCheckoutOrder, staffCapabilities, type StaffActor } from '../../auth/model';
import { bumpOrderCommerceRevision } from '../../commerce/model';
import { readBudget, reserveWrites } from '../../lib/readBudget';
import { applyAffiliatePayout } from '../../marketing/model';
import { cashierRules } from '../../settings/model';
import { COMMERCE_LIMITS, refundDueOn, type ExternalTender } from '../../shared/commerce';
import { addDays } from '../../shared/dates';
import { excludesAffiliateCredit } from '../../shared/tenderProjection';
import { sha256 } from '../../shared/displayTokens';
import { assertMoney } from '../../shared/money';
import { APPROVAL_TTL_MS } from '../../shared/staffTypes';
import { resortMidnight, resortTodayIso } from '../../shared/time';
import { openOrderReturn, readOrderProjection, voucherCodeMask } from './orderLifecycle';
import { readAttemptByKey } from './paymentAttempt';
import {
  destinationShares, finishReturnEffects, replacementSlips, returnAudit, reverseReturnEffects, takeReturnBenefits, writeReturnMirrors,
} from './returnEffects';
import { orderLines } from './orderLines';
import { assertNoOpenReturn } from './returnGuards';
import {
  approvalReturnReview, planReturnMoney, planReturnParts, planReturnStock, receiptRowsForReturn, returnedDelta, returnError, returnGet, rowsReturned,
  selectReturnRows, type OrderReturn, type ReturnPart,
} from './returnPlan';
import { MAX_RETURN_LOTS, packedReturnLots, readReturnMovementLots } from './returnLots';
import { returnApprovalCheckpoint, isOwnApproval, requesterFingerprint, rulesFingerprint } from './staffApprovalState';

type ReadCtx = MutationCtx | QueryCtx;
type Order = Doc<'orders'>;
type Approval = Extract<Doc<'staffApprovalRequests'>, { kind: 'returnItems' }>;
type Claim = OrderReturn['claims'][number];
type ReturnInput = {
  orderId: Id<'orders'>; expectedRevision: number; expectedCorrectionRevision: number;
  clientKey: string; tillId: string; reason: string; parts: ReturnPart[]; mistakenSale?: boolean;
};
type Control = { returnId: Id<'orderReturns'>; tillId: string; operatorRevision: number };
type RecordPayout = Control & {
  destinationKey: string; outcome: 'given' | 'failed' | 'unknown'; reference?: string; givenAt?: number;
};
type Retry = Control & { destinationKey: string; method?: Claim['method']; reason: string };

function manager(actor: StaffActor) {
  return actor.role === 'owner' || actor.role === 'manager';
}

function boundedText(value: string, min: number, max: number, label: string) {
  const clean = value.trim();
  if (clean.length < min || clean.length > max) returnError('RETURN_INVALID_INPUT', `Enter a valid ${label}.`);
  return clean;
}

function validateInput(args: ReturnInput): ReturnInput {
  if (!args.parts.length || args.parts.length > COMMERCE_LIMITS.return.parts) {
    returnError('RETURN_PART_LIMIT', 'Return these in two parts.');
  }
  for (const part of args.parts) {
    if ('lotAllocations' in part && part.lotAllocations &&
        (!part.lotAllocations.length || part.lotAllocations.length > MAX_RETURN_LOTS)) {
      returnError('RETURN_INVALID_LOTS', 'Confirm up to 100 original lots for goods received back.');
    }
  }
  return { ...args, clientKey: boundedText(args.clientKey, 8, 128, 'request key'),
    tillId: boundedText(args.tillId, 1, 128, 'till'), reason: boundedText(args.reason, 1, 500, 'reason') };
}

const returnKey = async (args: Pick<ReturnInput, 'clientKey'>, requester: string) =>
  `return:${await sha256(JSON.stringify([requester, args.clientKey]))}`;

async function fingerprint(args: ReturnInput, destinations: ExternalTender[] | undefined) {
  return await sha256(JSON.stringify([
    args.orderId, args.expectedRevision, args.expectedCorrectionRevision, args.tillId, args.reason, args.mistakenSale ?? false,
    args.parts.map(part => [part.kind, part.lineId, 'units' in part ? part.units : null,
      'contentKey' in part ? part.contentKey : null, 'disposition' in part ? part.disposition : null, 'useId' in part ? part.useId : null,
      ...('lotAllocations' in part && part.lotAllocations ? [part.lotAllocations.map(({ lotId, quantity }) => [lotId, quantity]).sort()] : [])]),
    destinations?.map(({ amount, method }) => [amount, method]),
  ]));
}

function byReturnKey(ctx: ReadCtx, key: string) {
  return readOrderProjection(ctx, () => ctx.db.query('orderReturns').withIndex('by_key', q => q.eq('key', key)).unique());
}

async function returnOrder(ctx: ReadCtx, orderId: Id<'orders'>, actor: StaffActor) {
  const order = await returnGet(ctx, orderId);
  if (!order || !canReadCheckoutOrder(actor, order)) returnError('RETURN_ORDER_NOT_FOUND', 'Order not found.');
  return order;
}

// The desk only treats the key from its own mutation response as a fresh instruction.
const claimViewKey = ({ key, instructionId, state }: Pick<Claim, 'key' | 'instructionId' | 'state'>) =>
  instructionId ?? (state === 'instructed' || state === 'unknown' ? `check:${key}` : key);

function invalidateFreshInstruction(claim: Claim): Claim {
  return claim.state === 'instructed' || claim.state === 'unknown' ? { ...claim, instructionId: crypto.randomUUID() } : claim;
}

export function publicReturnClaim({ key, instructionId, state, method, amount, instructedAt, dueAt, reference }: Claim) {
  return { key: claimViewKey({ key, instructionId, state }), state, method, amount, instructedAt, dueAt, reference };
}

async function returnView(ctx: ReadCtx, row: OrderReturn, actor: StaffActor, tillId?: string) {
  return {
    returnId: row._id, orderId: row.orderId, status: row.status, parts: row.parts, reason: row.reason,
    claims: row.claims.map(publicReturnClaim), voucherCredits: row.voucherCredits, operatorRevision: row.operatorRevision,
    isOperator: row.operator === actor.tokenIdentifier, claimed: !!row.tillId,
    isOperatorTill: row.operator === actor.tokenIdentifier && tillId === row.tillId, approvalId: row.approvalId,
    createdAt: row.createdAt, completedAt: row.completedAt, giftSlips: await replacementSlips(ctx, row),
  };
}

export async function readReturn(
  ctx: ReadCtx, actor: StaffActor, args: { orderId?: Id<'orders'>; returnId?: Id<'orderReturns'>; tillId?: string; completed?: boolean },
) {
  if (args.returnId) {
    const row = await returnGet(ctx, args.returnId);
    if (!row || (args.orderId && row.orderId !== args.orderId)) return null;
    const order = await returnGet(ctx, row.orderId);
    if (!order || !canAccessCheckoutOrderBranch(actor, order)) return null;
    if (row.status === 'authorized') {
      if (row.operator !== actor.tokenIdentifier && !manager(actor)) return null;
    } else if (!canReadCheckoutOrder(actor, order)) return null;
    return await returnView(ctx, row, actor, args.tillId);
  }
  if (!args.orderId) returnError('RETURN_INVALID_INPUT', 'Choose an order or return.');
  if (args.completed) {
    await returnOrder(ctx, args.orderId, actor);
    const orderId = args.orderId;
    const latest = await readOrderProjection(ctx, () => ctx.db.query('orderReturns')
      .withIndex('by_orderId_and_hasReplacementSlips', q => q.eq('orderId', orderId).eq('hasReplacementSlips', true))
      .order('desc').first());
    if (latest) return await returnView(ctx, latest, actor, args.tillId);
    // Earlier completed returns did not write the replacement-slip index flag.
    const earlier = await readOrderProjection(ctx, () => ctx.db.query('orderReturns')
      .withIndex('by_orderId_and_status', q => q.eq('orderId', orderId).eq('status', 'completed')).order('desc').take(20));
    for (const row of earlier) {
      if (row.hasReplacementSlips === false) continue;
      const view = await returnView(ctx, row, actor, args.tillId);
      if (view.giftSlips.length) return view;
    }
    return null;
  }
  const order = await returnGet(ctx, args.orderId);
  if (!order || !canAccessCheckoutOrderBranch(actor, order)) returnError('RETURN_ORDER_NOT_FOUND', 'Order not found.');
  const active = await openOrderReturn(ctx, order._id);
  if (active?.operator === actor.tokenIdentifier) return await returnView(ctx, active, actor, args.tillId);
  if (!canReadCheckoutOrder(actor, order)) returnError('RETURN_ORDER_NOT_FOUND', 'Order not found.');
  return active && manager(actor) ? await returnView(ctx, active, actor, args.tillId) : null;
}

type LotLookupPart = { lineId: Id<'orderLines'>; contentKey?: string };
type LotLookupResult = Awaited<ReturnType<typeof readReturnMovementLots>> & { unavailable?: true };
const unavailableLots: LotLookupResult = { tracked: false, lots: [], unavailable: true };

async function lookupSaleLots(ctx: QueryCtx, actor: StaffActor, movementId: Id<'stockMovements'>): Promise<LotLookupResult> {
  if (readBudget(ctx).documents > 350) return unavailableLots;
  const movement = await returnGet(ctx, movementId);
  if (!movement || movement.delta >= 0) return unavailableLots;
  try {
    const options = await readReturnMovementLots(ctx, movement);
    if (options.tracked && !actor.companyScope && !actor.branchIds.includes(movement.branchId)) return unavailableLots;
    return options;
  } catch (error) {
    if (error instanceof ConvexError && error.data?.code === 'STOCK_LOT_RECONCILIATION') return unavailableLots;
    throw error;
  }
}

export async function readReturnLots(ctx: QueryCtx, actor: StaffActor, orderId: Id<'orders'>, parts: LotLookupPart[]) {
  const order = await returnOrder(ctx, orderId, actor);
  assertPaidReceipt(order);
  if (parts.length > COMMERCE_LIMITS.return.parts) returnError('RETURN_PART_LIMIT', 'Return these in two parts.');
  const lines = new Map<Id<'orderLines'>, Doc<'orderLines'>>();
  const byMovement = new Map<Id<'stockMovements'>, LotLookupResult>();
  const result = [];
  for (const { lineId, contentKey } of parts) {
    const line = lines.get(lineId) ?? await returnGet(ctx, lineId);
    if (line?.orderId !== orderId || line.bookingId || line.appointmentId || line.coverage ||
        (contentKey === undefined ? line.kind !== 'product' : line.kind !== 'package')) {
      returnError('RETURN_INVALID_PART', 'Select a product sold on this receipt.');
    }
    lines.set(lineId, line);
    const contents = line.saleSnapshot?.contents;
    const content = contentKey === undefined ? contents?.[0] : contents?.find(item => item.contentKey === contentKey);
    const movementId = content && content.returnedUnits < content.units ? content.stockMovementId : undefined;
    let options = movementId ? byMovement.get(movementId) : unavailableLots;
    if (!options && movementId) {
      options = await lookupSaleLots(ctx, actor, movementId);
      byMovement.set(movementId, options);
    }
    if (options && content?.packedLots) {
      options = { ...options, lots: packedReturnLots(options.lots, content.packedLots, content.returnedPackedLots) };
    }
    result.push({ ...(content?.packedLots ? { packed: true as const } : {}), lineId, ...(contentKey !== undefined ? { contentKey } : {}), ...(options ?? unavailableLots) });
  }
  return result;
}

function assertPaidReceipt(order: Order) {
  if (order.status !== 'paid' || order.paidAt === undefined || order.voidUnreceived || order.currency !== 'THB') {
    returnError('RETURN_ORDER_NOT_PAID', 'Only a settled THB receipt can be returned here.');
  }
}

async function prepare(ctx: ReadCtx, order: Order, args: ReturnInput, now: number, actor: StaffActor) {
  assertPaidReceipt(order);
  if (order.revision !== args.expectedRevision || (order.correctionRevision ?? 0) !== args.expectedCorrectionRevision) {
    returnError('RETURN_STALE', 'This receipt changed. Review it again.');
  }
  await assertNoOpenReturn(ctx, order);
  const { lines, previouslyReturned } = await receiptRowsForReturn(ctx, order, args.parts);
  const selected = await selectReturnRows(ctx, lines, args.parts);
  const parts = await planReturnParts(ctx, order, selected, now, args.mistakenSale ?? false);
  const [{ stock, allocationsByPart }, money] = await Promise.all([planReturnStock(ctx, parts.products), planReturnMoney(ctx, order, previouslyReturned, parts, now)]);
  if (!actor.companyScope && stock.some(group => (group.lotAllocations || parts.products.some(product => product.movementId === group.movementId && product.content?.packedLots)) && !actor.branchIds.includes(group.stock.branchId))) {
    returnError('RETURN_STOCK_MISSING', 'The original stock movement for this receipt is unavailable.');
  }
  const review = returnApprovalCheckpoint(order, approvalReturnReview(order, selected, parts, stock, money.funding),
    parts.products.flatMap(({ handover }) => handover ? [handover] : []));
  const amount = parts.rows.reduce((sum, item) => sum + item.amount, 0);
  // Keep headroom for the staff builder and completion reads made on voucher-only returns.
  if (readBudget(ctx).documents > 430) returnError('RETURN_READ_LIMIT', 'Return these in two parts.');
  const confirmedParts = args.parts.map(part => {
    const lotAllocations = 'units' in part ? allocationsByPart.get(part) : undefined;
    return lotAllocations ? { ...part, lotAllocations } : part;
  });
  return { parts, stock, money, review, amount, previouslyReturned, confirmedParts };
}

async function pendingPayoutSummary(ctx: ReadCtx, order: Order, money: Awaited<ReturnType<typeof planReturnMoney>>) {
  const payouts: NonNullable<Approval['payoutSummary']> = [];
  if (money.external) {
    const { method, amount } = money.external;
    let destinationMask: string | undefined;
    // A corrected tender or multiple card legs cannot identify a single original card.
    if (method === 'card' && order.amendedTenders === undefined) {
      const cards = money.payments.filter(payment => payment.method === 'card');
      if (cards.length === 1) {
        const [card] = cards;
        const attempt = await readAttemptByKey(ctx, card.idempotencyKey);
        if (attempt?.orderId === order._id && attempt.status === 'settled') {
          const legs = attempt.legs.filter(leg => leg.method === 'card' && leg.state === 'taken');
          if (legs.length === 1 && legs[0].amount === card.amount) {
            const lastFour = /^(?:[*•xX]{4,}[ -]?|ending in )([0-9]{4})$/i.exec(legs[0].reference?.trim() ?? '')?.[1];
            if (lastFour) destinationMask = `•••• ${lastFour}`;
          }
        }
      }
    }
    payouts.push({ label: method, amount, ...(destinationMask ? { destinationMask } : {}) });
  }
  for (const credit of money.credits) {
    const mask = await voucherCodeMask(ctx, money.funding.get(credit.voucherId)!);
    const destinationMask = mask && /^GV-••••-[A-Z0-9]{4}$/.test(mask) ? mask : undefined;
    const existing = destinationMask ? { destinationMask } : {};
    if (credit.paid) payouts.push({
      label: credit.destination?.kind === 'newVoucher' ? 'Replacement voucher' : 'Voucher',
      amount: credit.paid, ...existing,
    });
    if (credit.goodwill) payouts.push({ label: 'Goodwill voucher', amount: credit.goodwill, ...existing });
  }
  return payouts;
}

export async function previewReturn(ctx: ReadCtx, actor: StaffActor, input: ReturnInput) {
  const args = validateInput(input);
  const order = await returnOrder(ctx, args.orderId, actor);
  const { parts, money, amount } = await prepare(ctx, order, args, Date.now(), actor);
  const voucherCredits = await Promise.all(money.credits.map(async credit => {
    const maskedCode = await voucherCodeMask(ctx, money.funding.get(credit.voucherId)!);
    const destination = credit.destination?.kind === 'existingVoucher' ? { ...credit.destination, codeMask: maskedCode } : credit.destination;
    return { ...credit, maskedCode, destination };
  }));
  return {
    amount, external: money.external,
    rows: parts.rows.map(row => ({ lineId: row.line._id, label: row.snapshot.label, amount: row.amount, parts: row.parts })),
    voucherCredits,
    destinations: payoutDestinations(money.external ? [money.external] : [], voucherCredits),
  };
}

function payoutDestinations<T extends OrderReturn['voucherCredits'][number]>(external: ExternalTender[], vouchers: T[]) {
  return [
    ...external.map(({ method, amount }) => ({ kind: 'external' as const, method, amount })),
    ...vouchers.map(voucher => ({ ...voucher, kind: 'voucher' as const, amount: voucher.paid })),
  ];
}

async function setApproval(ctx: MutationCtx, requestId: Approval['_id'], status: Approval['status'], now: number, actor?: StaffActor) {
  reserveWrites(ctx, 1);
  await ctx.db.patch(requestId, {
    status, resolvedAt: now,
    ...(actor ? { approverEmail: actor.email, approverTokenIdentifier: actor.tokenIdentifier } : {}),
  });
}

async function startReturn(
  ctx: MutationCtx, order: Order, args: ReturnInput, prepared: Awaited<ReturnType<typeof prepare>>,
  actor: StaffActor, operator: string, key: string, requestFingerprint: string, now: number,
  destinations?: ExternalTender[], approvalId?: Approval['_id'],
) {
  const { parts, stock, money } = prepared;
  const methods = destinations ?? (money.external ? [money.external] : []);
  if (methods.length > COMMERCE_LIMITS.sale.paymentRows) returnError('RETURN_DESTINATION_TOTAL', 'Choose at most three payout destinations.');
  for (const { amount } of methods) assertMoney(amount, 'External payout');
  if (methods.reduce((sum, item) => sum + item.amount, 0) !== (money.external?.amount ?? 0)) {
    returnError('RETURN_DESTINATION_TOTAL', 'Payout destinations must match the external amount owed.');
  }

  const firstInstruction = operator === actor.tokenIdentifier && methods.length > 0;
  const claims: Claim[] = methods.map(({ method, amount }, index) => {
    const terms = parts.rows.filter(item => item.amount > 0).map(item => item.snapshot.terms.refundDueDays);
    const card = Math.min(...terms.map(days => days.card));
    const other = Math.min(...terms.map(days => days.cashOrTransfer));
    const dueOn = refundDueOn(resortTodayIso(now), method, { refundDays: { card, other } });
    return {
      key: `external:${index + 1}`, method, amount, operator,
      state: firstInstruction && index === 0 ? 'instructed' : 'owed',
      ...(firstInstruction && index === 0 ? { instructedAt: now, instructionId: crypto.randomUUID() } : {}),
      dueAt: resortMidnight(addDays(dueOn, 1)) - 1,
    };
  });
  const pending = claims.length > 0;
  const visitReturns = parts.rows.flatMap(({ visit }) => visit ? [visit] : []);
  const data = {
    orderId: order._id, key, fingerprint: requestFingerprint, parts: prepared.confirmedParts, effectsApplied: [],
    claims, voucherCredits: money.credits, status: 'authorized' as const, operator, tillId: args.tillId,
    operatorRevision: 0, approvalId, reason: args.reason, createdAt: now,
    ...(visitReturns.length ? { visitReturns } : {}),
  };
  reserveWrites(ctx, 3);
  const returnId = await ctx.db.insert('orderReturns', data);
  const row: OrderReturn = { ...data, _id: returnId, _creationTime: now };
  const changedOrders = new Set([order._id]);
  row.effectsApplied = await takeReturnBenefits(ctx, row, parts, money.funding, actor, pending, changedOrders);
  let hasReplacementSlips: boolean | undefined;
  if (!pending) {
    const priorEffects = row.effectsApplied.length;
    row.effectsApplied = await finishReturnEffects(ctx, row, parts, stock, money.funding, actor, now, false, changedOrders);
    hasReplacementSlips = hasReplacementEffects(row.effectsApplied.slice(priorEffects), row.voucherCredits);
    row.status = 'completed';
    row.completedAt = now;
  }
  await ctx.db.patch(returnId, { effectsApplied: row.effectsApplied, status: row.status, completedAt: row.completedAt,
    hasReplacementSlips });
  await ctx.db.patch(order._id, {
    revision: order.revision + 1, returnedTotal: order.returnedTotal ?? 0, updatedAt: now,
    rowReturnedTotal: prepared.previouslyReturned + (pending ? 0 : returnedDelta(parts.rows)),
  });
  await bumpOrderCommerceRevision(ctx, changedOrders);
  await returnAudit(ctx, row, actor, pending ? 'return_authorized' : 'return_completed', { amount: prepared.amount });
  if (approvalId) await setApproval(ctx, approvalId, pending ? 'authorized' : 'applied', now, actor);
  return {
    ...await returnView(ctx, row, actor, args.tillId), replayed: false,
    instruction: firstInstruction ? publicReturnClaim(claims[0]) : null,
    destinations: payoutDestinations(claims, row.voucherCredits),
  };
}

export async function authorizeReturn(ctx: MutationCtx, actor: StaffActor, input: ReturnInput & { destinations?: ExternalTender[] }) {
  if (!manager(actor) && (actor.role !== 'cashier' ||
      (await readOrderProjection(ctx, () => cashierRules(ctx))).refund !== 'cashier')) {
    returnError('RETURN_MANAGER_REQUIRED', 'Ask a manager to authorize this return.');
  }
  const args = validateInput(input);
  const order = await returnOrder(ctx, args.orderId, actor);
  const key = await returnKey(args, actor.tokenIdentifier);
  const payloadFingerprint = await fingerprint(args, input.destinations);
  const previous = await byReturnKey(ctx, key);
  if (previous) {
    checkFingerprint(previous, payloadFingerprint);
    return {
      ...await returnView(ctx, previous, actor, args.tillId), replayed: true, instruction: null,
      destinations: payoutDestinations(previous.claims, previous.voucherCredits),
    };
  }
  const now = Date.now();
  return await startReturn(ctx, order, args, await prepare(ctx, order, args, now, actor), actor,
    actor.tokenIdentifier, key, payloadFingerprint, now, input.destinations);
}

function hasReplacementEffects(effects: OrderReturn['effectsApplied'], credits: OrderReturn['voucherCredits']) {
  const original = new Set(credits.map(credit => credit.voucherId));
  return effects.some(effect => effect.kind === 'voucher' && !original.has(effect.voucherId));
}

function checkFingerprint(row: OrderReturn, value: string) {
  if (row.fingerprint !== value) returnError('RETURN_KEY_CONFLICT', 'This key was used for different return details.');
}

// The existing payload keeps its idempotency key as a string. Bind the request
// to the cashier's till and receipt correction revision in that key.
function approvalKey(args: ReturnInput) {
  return JSON.stringify([args.clientKey, args.tillId, args.expectedCorrectionRevision, args.mistakenSale ?? false]);
}

function approvalInput(request: Approval): ReturnInput | null {
  try {
    const value: unknown = JSON.parse(request.payload.idempotencyKey);
    if (!Array.isArray(value) || value.length !== 4) return null;
    const [clientKey, tillId, revision, mistakenSale] = value;
    if (typeof clientKey !== 'string' || typeof tillId !== 'string' || typeof revision !== 'number' || typeof mistakenSale !== 'boolean') return null;
    return validateInput({
      orderId: request.orderId, clientKey, tillId, expectedRevision: request.orderRevision, expectedCorrectionRevision: revision,
      reason: request.reason, parts: request.payload.parts, mistakenSale,
    });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof ConvexError) return null;
    throw error;
  }
}

export async function askReturnApproval(ctx: MutationCtx, actor: StaffActor, input: ReturnInput) {
  if (actor.role !== 'cashier') returnError('RETURN_CASHIER_REQUIRED', 'Cashier access is required to request approval.');
  const args = validateInput(input);
  const order = await returnOrder(ctx, args.orderId, actor);
  const payloadFingerprint = await fingerprint(args, undefined);
  const previous = await byReturnKey(ctx, await returnKey(args, actor.tokenIdentifier));
  if (previous?.approvalId) {
    checkFingerprint(previous, payloadFingerprint);
    const request = await returnGet(ctx, previous.approvalId);
    if (request?.kind === 'returnItems') return { requestId: request._id, status: request.status, expiresAt: request.expiresAt };
  }
  const recent = await readOrderProjection(ctx, () => ctx.db.query('staffApprovalRequests')
    .withIndex('by_orderId_and_createdAt', q => q.eq('orderId', order._id)).order('desc').take(20));
  const now = Date.now();
  for (const request of recent) {
    if (request.kind !== 'returnItems') continue;
    const original = approvalInput(request);
    if (request.requesterTokenIdentifier === actor.tokenIdentifier && original?.clientKey === args.clientKey) {
      if (await fingerprint(original, undefined) !== payloadFingerprint) returnError('RETURN_KEY_CONFLICT', 'This key was used for different return details.');
      return {
        requestId: request._id, status: request.status === 'pending' && request.expiresAt <= now ? 'expired' as const : request.status,
        expiresAt: request.expiresAt,
      };
    }
    if (request.status === 'pending' && request.expiresAt > now && request.orderRevision === order.revision &&
        original?.expectedCorrectionRevision === (order.correctionRevision ?? 0) &&
        (request.commerceRevision === undefined || request.commerceRevision === (order.commerceRevision ?? 0))) {
      throw new ConvexError({ code: 'RETURN_APPROVAL_PENDING', message: 'Resolve the existing return request.', requestId: request._id });
    }
  }
  const [prepared, rules, requester] = await Promise.all([
    prepare(ctx, order, args, now, actor), readOrderProjection(ctx, () => cashierRules(ctx)), requesterFingerprint(ctx, actor.tokenIdentifier),
  ]);
  if (requester.role !== 'cashier') returnError('RETURN_CASHIER_REQUIRED', 'Cashier access changed.');
  const payoutSummary = await pendingPayoutSummary(ctx, order, prepared.money);
  const expiresAt = now + APPROVAL_TTL_MS;
  reserveWrites(ctx, 2);
  const requestId = await ctx.db.insert('staffApprovalRequests', {
    kind: 'returnItems', orderId: order._id, stockBranchId: order.stockBranchId, ...prepared.review, payoutSummary,
    requesterEmail: actor.email, requesterTokenIdentifier: actor.tokenIdentifier, requesterAccessFingerprint: requester.fingerprint,
    rulesRevision: rules.revision, rulesFingerprint: rulesFingerprint(rules), reason: args.reason, status: 'pending', createdAt: now, expiresAt,
    amount: prepared.amount, totalBefore: order.total, totalAfter: order.total - prepared.amount,
    payload: { kind: 'returnItems', parts: args.parts, idempotencyKey: approvalKey(args) },
  });
  await ctx.scheduler.runAfter(APPROVAL_TTL_MS, internal.pos.staffApprovals.expire, { requestId });
  return { requestId, status: 'pending' as const, expiresAt };
}

export async function decideReturnApproval(
  ctx: MutationCtx, actor: StaffActor, requestId: Approval['_id'], decision: 'approve' | 'reject' | 'cancel',
) {
  const request = await returnGet(ctx, requestId);
  if (request?.kind !== 'returnItems') returnError('RETURN_APPROVAL_NOT_FOUND', 'Return approval not found.');
  if (decision === 'cancel') {
    if (request.requesterTokenIdentifier !== actor.tokenIdentifier) returnError('RETURN_APPROVAL_NOT_FOUND', 'Return approval not found.');
  } else {
    if (isOwnApproval(actor, request)) returnError('RETURN_SELF_APPROVAL', 'You cannot approve your own request.');
    if (!manager(actor) || !actor.capabilities.approve) returnError('RETURN_MANAGER_REQUIRED', 'Manager access is required.');
  }
  const order = await returnOrder(ctx, request.orderId, actor);
  const args = approvalInput(request);
  if (request.status !== 'pending') {
    const row = args && (request.status === 'authorized' || request.status === 'applied')
      ? await byReturnKey(ctx, await returnKey(args, request.requesterTokenIdentifier)) : null;
    return { status: request.status, returnId: row?.approvalId === requestId ? row._id : undefined, replayed: true };
  }
  const now = Date.now();
  const resolve = async (status: Approval['status']) => {
    await setApproval(ctx, requestId, status, now, decision === 'cancel' ? undefined : actor);
    return { status, replayed: false };
  };
  if (now >= request.expiresAt) return await resolve('expired');
  if (decision !== 'approve') return await resolve(decision === 'cancel' ? 'cancelled' : 'rejected');
  if (!args) return await resolve('stale');
  const [rules, access] = await Promise.all([
    readOrderProjection(ctx, () => cashierRules(ctx)), requesterFingerprint(ctx, request.requesterTokenIdentifier),
  ]);
  const operator: StaffActor = {
    role: 'cashier', companyScope: false, branchIds: access.branchIds, capabilities: staffCapabilities('cashier'),
    tokenIdentifier: request.requesterTokenIdentifier,
    email: request.requesterEmail, pendingInvitation: null,
  };
  if (access.role !== 'cashier' || access.fingerprint !== request.requesterAccessFingerprint ||
      rules.revision !== request.rulesRevision || rulesFingerprint(rules) !== request.rulesFingerprint || !canReadCheckoutOrder(operator, order)) {
    return await resolve('stale');
  }
  let prepared;
  try {
    prepared = await prepare(ctx, order, args, now, operator);
  } catch (error) {
    if (error instanceof ConvexError) return await resolve('stale');
    throw error;
  }
  if (prepared.review.orderFingerprint !== request.orderFingerprint ||
      (request.commerceRevision !== undefined && prepared.review.commerceRevision !== request.commerceRevision) ||
      prepared.amount !== request.amount) return await resolve('stale');
  const key = await returnKey(args, operator.tokenIdentifier);
  if (await byReturnKey(ctx, key)) return await resolve('stale');
  const result = await startReturn(ctx, order, args, prepared, actor, operator.tokenIdentifier,
    key, await fingerprint(args, undefined), now, undefined, requestId);
  return { status: result.status === 'authorized' ? 'authorized' as const : 'applied' as const, returnId: result.returnId, replayed: false };
}

async function controlledReturn(ctx: MutationCtx, actor: StaffActor, args: Control) {
  const row = await returnGet(ctx, args.returnId);
  if (!row || row.operator !== actor.tokenIdentifier || row.tillId !== args.tillId || !row.tillId) {
    returnError('RETURN_OPERATOR_REQUIRED', 'Claim this return at this till first.');
  }
  const order = await returnGet(ctx, row.orderId);
  if (!order || !canAccessCheckoutOrderBranch(actor, order) || (row.status !== 'authorized' && !canReadCheckoutOrder(actor, order))) {
    returnError('RETURN_ORDER_NOT_FOUND', 'Return not found.');
  }
  return { row, order };
}

function assertControl(row: OrderReturn, args: Control) {
  if (row.operatorRevision !== args.operatorRevision) returnError('RETURN_OPERATOR_CHANGED', 'Reload this return before continuing.');
  if (row.status !== 'authorized') returnError('RETURN_CLOSED', 'This return is already closed.');
}

export async function claimReturn(
  ctx: MutationCtx, actor: StaffActor, args: Control & { previousOperatorStopped?: boolean; reason?: string },
) {
  const row = await returnGet(ctx, args.returnId);
  if (!row || (row.operator !== actor.tokenIdentifier && !manager(actor))) returnError('RETURN_ORDER_NOT_FOUND', 'Return not found.');
  const order = await returnGet(ctx, row.orderId);
  if (!order || !canAccessCheckoutOrderBranch(actor, order)) returnError('RETURN_ORDER_NOT_FOUND', 'Return not found.');
  assertControl(row, args);
  const tillId = boundedText(args.tillId, 1, 128, 'till');
  if (row.operator === actor.tokenIdentifier && row.tillId === tillId) return await returnView(ctx, row, actor, tillId);
  if (row.tillId && (!manager(actor) || !args.previousOperatorStopped || !args.reason?.trim())) {
    returnError('RETURN_TAKEOVER_REQUIRES_STOP', 'Confirm the previous operator has stopped before taking over.');
  }
  const reason = args.reason === undefined ? undefined : boundedText(args.reason, 1, 500, 'takeover reason');
  const patch = { operator: actor.tokenIdentifier, tillId, operatorRevision: row.operatorRevision + 1,
    claims: row.claims.map(item => ({ ...invalidateFreshInstruction(item), operator: actor.tokenIdentifier })) };
  reserveWrites(ctx, 1);
  await ctx.db.patch(row._id, patch);
  await bumpOrderCommerceRevision(ctx, [row.orderId]);
  await returnAudit(ctx, row, actor, 'return_claimed', { previousTill: row.tillId, tillId, reason });
  return await returnView(ctx, { ...row, ...patch }, actor, tillId);
}

export async function releaseReturn(ctx: MutationCtx, actor: StaffActor, args: Control) {
  const { row } = await controlledReturn(ctx, actor, args);
  assertControl(row, args);
  const patch = { tillId: '', operatorRevision: row.operatorRevision + 1,
    claims: row.claims.map(invalidateFreshInstruction) };
  reserveWrites(ctx, 1);
  await ctx.db.patch(row._id, patch);
  await bumpOrderCommerceRevision(ctx, [row.orderId]);
  await returnAudit(ctx, row, actor, 'return_released', { previousTill: row.tillId });
  return await returnView(ctx, { ...row, ...patch }, actor, args.tillId);
}

function locateClaim(row: OrderReturn, key: string) {
  const index = row.claims.findIndex(item => item.key === key || claimViewKey(item) === key);
  if (index < 0) returnError('RETURN_DESTINATION_NOT_FOUND', 'Payout destination not found.');
  return { index, claim: row.claims[index] };
}

function activeInstruction(row: OrderReturn) {
  return row.claims.some(item => item.state === 'instructed' || item.state === 'unknown');
}

export async function armReturn(ctx: MutationCtx, actor: StaffActor, args: Control & { destinationKey: string }) {
  const { row } = await controlledReturn(ctx, actor, args);
  assertControl(row, args);
  const { claim, index } = locateClaim(row, args.destinationKey);
  if (activeInstruction(row)) returnError('RETURN_CHECK_PREVIOUS', 'Check the previous refund before issuing another instruction.');
  if (claim.state !== 'owed') returnError('RETURN_DESTINATION_STATE', 'This payout is not ready to be instructed.');
  const instruction = { ...claim, state: 'instructed' as const, instructedAt: Date.now(), instructionId: crypto.randomUUID(), reference: undefined };
  const claims = [...row.claims];
  claims[index] = instruction;
  const patch = { claims, operatorRevision: row.operatorRevision + 1 };
  reserveWrites(ctx, 1);
  await ctx.db.patch(row._id, patch);
  await bumpOrderCommerceRevision(ctx, [row.orderId]);
  await returnAudit(ctx, row, actor, 'return_instructed', { destination: publicReturnClaim(instruction), tillId: row.tillId });
  return { ...await returnView(ctx, { ...row, ...patch }, actor, args.tillId), instruction: publicReturnClaim(instruction) };
}

export async function retryReturn(ctx: MutationCtx, actor: StaffActor, args: Retry) {
  const { row } = await controlledReturn(ctx, actor, args);
  assertControl(row, args);
  const { claim, index } = locateClaim(row, args.destinationKey);
  if (activeInstruction(row)) returnError('RETURN_CHECK_PREVIOUS', 'Check the previous refund before retrying.');
  if (claim.state !== 'failed') returnError('RETURN_NOT_VERIFIED', 'Verify that money was not given before retrying.');
  const method = args.method ?? claim.method;
  if (method !== claim.method && !manager(actor)) returnError('RETURN_MANAGER_REQUIRED', 'A manager must change the payout method.');
  const reason = boundedText(args.reason, 1, 500, 'retry reason');
  const claims = [...row.claims];
  claims[index] = { ...claim, method, state: 'owed', instructedAt: undefined, instructionId: undefined, reference: undefined };
  const patch = { claims, operatorRevision: row.operatorRevision + 1 };
  reserveWrites(ctx, 1);
  await ctx.db.patch(row._id, patch);
  await bumpOrderCommerceRevision(ctx, [row.orderId]);
  await returnAudit(ctx, row, actor, 'return_retry', { destinationKey: claim.key, previousMethod: claim.method, method, reason });
  return await returnView(ctx, { ...row, ...patch }, actor, args.tillId);
}

export async function recordReturnPayout(ctx: MutationCtx, actor: StaffActor, args: RecordPayout) {
  const { row, order } = await controlledReturn(ctx, actor, args);
  const { claim, index } = locateClaim(row, args.destinationKey);
  const reference = args.reference === undefined ? undefined : boundedText(args.reference, 1, 128, 'payout reference');
  const payoutKey = `return:${row._id}:${claim.key}`;
  if (claim.state === 'given' && args.outcome === 'given' && reference === claim.reference) {
    if (args.givenAt !== undefined) {
      const posted = await readOrderProjection(ctx, () => ctx.db.query('returnPayouts').withIndex('by_key', q => q.eq('key', payoutKey)).unique());
      if (posted?.createdAt !== args.givenAt) returnError('RETURN_KEY_CONFLICT', 'This payout was recorded at a different time.');
    }
    return { ...await returnView(ctx, row, actor, args.tillId), replayed: true };
  }
  assertControl(row, args);
  if (claim.state !== 'instructed' && claim.state !== 'unknown') {
    returnError('RETURN_NOT_INSTRUCTED', 'Only an instructed payout can be reconciled.');
  }
  const now = Date.now();
  const givenAt = args.givenAt ?? now;
  if (args.givenAt !== undefined && (args.outcome !== 'given' || !Number.isSafeInteger(givenAt) ||
      givenAt < (claim.instructedAt ?? row.createdAt) || givenAt > now)) {
    returnError('RETURN_INVALID_PAYOUT_TIME', 'Enter the verified time between instruction and now.');
  }
  const claims = [...row.claims];
  claims[index] = { ...claim, state: args.outcome, reference };
  const patch: Partial<OrderReturn> = { claims, operatorRevision: row.operatorRevision + 1 };
  const changedOrders = new Set([row.orderId]);
  if (args.outcome === 'given') {
    if (order.status !== 'paid') returnError('RETURN_EFFECT_CHANGED', 'The receipt is no longer settled.');
    const lines = await readOrderProjection(ctx, () => orderLines(ctx, order._id));
    const planned = await planReturnParts(ctx, order, await selectReturnRows(ctx, lines, row.parts, row), row.createdAt, true, row);
    const amounts = [...row.voucherCredits.map(item => item.paid), ...claims.map(item => item.amount)];
    if (planned.rows.reduce((sum, item) => sum + item.amount, 0) !== amounts.reduce((sum, amount) => sum + amount, 0)) {
      returnError('RETURN_EFFECT_CHANGED', 'The reserved refund amounts no longer reconcile.');
    }
    const shares = destinationShares(planned.rows, amounts, row.voucherCredits.length + index);
    const reconciled = { ...row, claims };
    await writeReturnMirrors(ctx, reconciled, planned.rows, shares, claim, actor, givenAt);
    const owners = planned.rows.filter((_, index) => shares[index] > 0);
    const soleVisit = owners.length === 1 ? owners[0].visit : undefined;
    reserveWrites(ctx, 2);
    await ctx.db.insert('returnPayouts', {
      returnId: row._id, orderId: order._id, key: payoutKey, destinationKey: claim.key, amount: claim.amount, method: claim.method,
      businessDate: resortTodayIso(givenAt),
      sourceOwner: soleVisit ? { kind: 'appointment', appointmentId: soleVisit.appointmentId } : { kind: 'pos' },
      operator: actor.tokenIdentifier, reference, createdAt: givenAt,
    });
    const finishing = claims.every(item => item.state === 'given');
    await ctx.db.patch(order._id, {
      returnedTotal: (order.returnedTotal ?? 0) + claim.amount, revision: order.revision + 1, updatedAt: now,
      // Every row was read above, so this is the exact receipt total after the snapshots below are written.
      rowReturnedTotal: rowsReturned(lines) + (finishing ? returnedDelta(planned.rows) : 0),
    });
    if (order.affiliateSnapshot?.candidates.length) {
      // Partner credit follows external money from credit-earning rows only (vouchers and packages don't earn).
      const credited = planned.rows.reduce((sum, item, rowIndex) => excludesAffiliateCredit(item.line.kind) ? sum : sum + shares[rowIndex], 0);
      reserveWrites(ctx, 2);
      await applyAffiliatePayout(ctx, order, credited, actor.email);
    }
    if (finishing) {
      patch.effectsApplied = await finishReturnEffects(ctx, reconciled, planned, (await planReturnStock(ctx, planned.products)).stock, new Map(), actor, now, true, changedOrders);
      patch.hasReplacementSlips = hasReplacementEffects(patch.effectsApplied.slice(row.effectsApplied.length), row.voucherCredits);
      patch.status = 'completed';
      patch.completedAt = now;
      if (row.approvalId) await setApproval(ctx, row.approvalId, 'applied', now);
    }
  }
  reserveWrites(ctx, 1);
  await ctx.db.patch(row._id, patch);
  await bumpOrderCommerceRevision(ctx, changedOrders);
  await returnAudit(ctx, row, actor, 'return_payout_recorded', { destination: publicReturnClaim(claims[index]), tillId: row.tillId, ...(args.outcome === 'given' ? { givenAt } : {}) });
  return { ...await returnView(ctx, { ...row, ...patch }, actor, args.tillId), replayed: false };
}

export async function cancelReturn(ctx: MutationCtx, actor: StaffActor, args: Control) {
  const { row, order } = await controlledReturn(ctx, actor, args);
  if (row.status === 'cancelled') return await returnView(ctx, row, actor, args.tillId);
  assertControl(row, args);
  if (row.claims.some(item => item.state === 'given')) returnError('RETURN_ALREADY_PAID', 'A payout was given. Complete the remaining destinations.');
  if (activeInstruction(row)) returnError('RETURN_CHECK_PREVIOUS', 'Verify every instructed refund before cancelling.');
  const now = Date.now();
  const changedOrders = new Set([row.orderId]);
  await reverseReturnEffects(ctx, row, actor, now, changedOrders);
  const patch = { status: 'cancelled' as const, operatorRevision: row.operatorRevision + 1,
    claims: row.claims.map(item => ({ ...item, state: 'cancelled' as const })) };
  reserveWrites(ctx, 2);
  await ctx.db.patch(row._id, patch);
  await ctx.db.patch(order._id, { revision: order.revision + 1, updatedAt: now });
  if (row.approvalId) await setApproval(ctx, row.approvalId, 'cancelled', now);
  await bumpOrderCommerceRevision(ctx, changedOrders);
  await returnAudit(ctx, row, actor, 'return_cancelled');
  return await returnView(ctx, { ...row, ...patch }, actor, args.tillId);
}
