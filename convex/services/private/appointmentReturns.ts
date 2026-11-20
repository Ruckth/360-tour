import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { bumpOrderCommerceRevision } from '../../commerce/model';
import { readBudget, reserveWrites } from '../../lib/readBudget';
import { appointmentRevision } from '../../shared/appointmentWindow';
import { COMMERCE_LIMITS } from '../../shared/commerce/caps';
import { assertMoney } from '../../shared/money';
import { lineNet } from '../../shared/orderMath';
import { recordAppointmentChange } from './appointmentChanges';
import { appointmentMoney } from './appointmentFinance';
import { assertVisitReturnAvailable } from './visitReturnGuard';

type ReadCtx = MutationCtx | QueryCtx;
type OrderReturn = Doc<'orderReturns'>;
export type VisitReturn = NonNullable<OrderReturn['visitReturns']>[number];
type Visit = Doc<'appointments'>;
type Line = Doc<'orderLines'>;

function fail(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

async function readOne<T>(ctx: ReadCtx, read: () => Promise<T | null>) {
  const budget = readBudget(ctx);
  budget.range();
  budget.assert();
  const result = await read();
  if (result) budget.document(result);
  budget.assert();
  return result;
}

async function quoteRestore(ctx: ReadCtx, visit: Visit, line: Line, useId: Id<'sessionUses'>) {
  const coverage = visit.coverage;
  if (visit.paymentStatus !== 'paid' || visit.amountPaid || visit.amountRefunded || line.saleSnapshot?.paidShare !== 0 ||
      coverage?.useId !== useId || coverage.priceBefore === undefined ||
      (line.coverage && (line.coverage.useId !== useId || line.coverage.grantId !== coverage.grantId))) {
    fail('RETURN_VISIT_CHANGED', 'Review the session covering this visit.');
  }
  assertMoney(coverage.priceBefore, 'Visit price', { allowZero: true });
  const [use, grant] = await Promise.all([
    readOne(ctx, () => ctx.db.get(useId)),
    readOne(ctx, () => ctx.db.get(coverage.grantId)),
  ]);
  if (!use || use.kind !== 'use' || !use.bucket || use.lineId !== line._id ||
      use.activeAppointmentId !== visit._id || use.serviceId !== visit.serviceId || use.beneficiaryId !== visit.attendeeId ||
      !grant || grant._id !== use.grantId || grant.pendingReturnId || grant.used < 1 ||
      grant.grantServiceIds.length > COMMERCE_LIMITS.servicesPerGrant) {
    fail('RETURN_SESSION_CHANGED', 'This session can no longer be restored.');
  }
  const transfer = await readOne(ctx, () => ctx.db.query('sessionUses')
    .withIndex('by_grantId_and_kind_and_createdAt', q => q.eq('grantId', grant._id).eq('kind', 'transfer'))
    .order('desc').first());
  if (use.beneficiaryId !== grant.ownerId || (transfer && (transfer.createdAt > use.createdAt ||
      (transfer.createdAt === use.createdAt && transfer._creationTime > use._creationTime)))) {
    fail('RETURN_SESSION_TRANSFERRED', 'A session used before a package transfer cannot be restored.');
  }
  return { useId, grantId: grant._id, grantRevision: grant.revision };
}

export async function quoteReturn(
  ctx: ReadCtx,
  input: { appointmentId: Id<'appointments'>; orderId: Id<'orders'>; lineId: Id<'orderLines'>;
    expectedRevision?: number; restoreUseId?: Id<'sessionUses'>; amount: number },
  line: Line,
  link: Doc<'orderLineLinks'> | null,
): Promise<VisitReturn> {
  const { appointmentId, orderId, lineId, restoreUseId, amount } = input;
  const linked = link?.kind === 'appointment' && link.status === 'active' && link.appointmentId === appointmentId &&
    link.orderId === orderId && link.lineId === lineId && link.currency === line.currency;
  if (line._id !== lineId || line.orderId !== orderId || (line.appointmentId !== appointmentId && !linked)) {
    fail('RETURN_VISIT_SOURCE', 'This receipt row does not belong to the visit.');
  }
  const visit = await readOne(ctx, () => ctx.db.get(appointmentId));
  if (!visit || visit.currency !== line.currency) fail('RETURN_VISIT_CHANGED', 'The visit no longer matches this receipt.');
  assertVisitReturnAvailable(visit);
  const revision = appointmentRevision(visit);
  if (input.expectedRevision !== undefined && input.expectedRevision !== revision) {
    fail('RETURN_VISIT_CHANGED', 'The visit changed. Review it again.');
  }
  if (restoreUseId) {
    return { appointmentId, lineId, expectedRevision: revision, amount: 0, restore: await quoteRestore(ctx, visit, line, restoreUseId) };
  }
  const { gross, net } = appointmentMoney(visit);
  const charged = linked ? link.amount : line.saleSnapshot?.paidShare ?? lineNet(line);
  if (visit.coverage || visit.paymentStatus !== 'paid' || gross !== charged || net < 0) {
    fail('RETURN_VISIT_CHANGED', 'The visit payment no longer matches this receipt.');
  }
  assertMoney(amount, 'Visit return', { allowZero: true });
  return { appointmentId, lineId, expectedRevision: revision, amount: Math.min(net, amount) };
}

async function loadVisit(ctx: ReadCtx, { appointmentId }: VisitReturn) {
  const visit = await readOne(ctx, () => ctx.db.get(appointmentId));
  if (!visit) fail('RETURN_VISIT_CHANGED', 'The reserved visit is missing.');
  return visit;
}

export async function reserveReturn(ctx: MutationCtx, row: OrderReturn) {
  if (row.status !== 'authorized') return;
  const changedOrders = new Set<Id<'orders'>>();
  for (const quote of row.visitReturns ?? []) {
    const visit = await loadVisit(ctx, quote);
    assertVisitReturnAvailable(visit, row._id);
    if (visit.pendingReturn?.returnId === row._id) continue;
    if (appointmentRevision(visit) !== quote.expectedRevision) {
      fail('RETURN_VISIT_CHANGED', 'The visit changed. Review it again.');
    }
    const { restore } = quote;
    if (restore) {
      const grant = await readOne(ctx, () => ctx.db.get(restore.grantId));
      if (!grant || (grant.pendingReturnId ? grant.pendingReturnId !== row._id : grant.revision !== restore.grantRevision)) {
        fail('RETURN_SESSION_CHANGED', 'The package changed. Review it again.');
      }
      if (!grant.pendingReturnId) {
        reserveWrites(ctx, 1);
        await ctx.db.patch(grant._id, { pendingReturnId: row._id, revision: grant.revision + 1 });
        changedOrders.add(grant.orderId);
      }
    }
    reserveWrites(ctx, 1);
    await ctx.db.patch(visit._id, { pendingReturn: { returnId: row._id, remaining: quote.amount }, revision: appointmentRevision(visit) + 1 });
    changedOrders.add(row.orderId);
  }
  await bumpOrderCommerceRevision(ctx, changedOrders);
}

export async function recordReturnDestination(
  ctx: MutationCtx, row: OrderReturn, lineId: Id<'orderLines'>,
  destination: { key: string; method: Doc<'appointmentRefunds'>['method']; amount: number; actor: string; effectiveAt: number },
) {
  const quote = row.visitReturns?.find(item => item.lineId === lineId);
  if (!quote || quote.restore) fail('RETURN_VISIT_SOURCE', 'The payout does not match a reserved visit payment.');
  const { key, method, amount, actor, effectiveAt } = destination;
  const claim = row.claims.find(item => item.key === key);
  const voucher = row.voucherCredits.find(item => key === `voucher:${item.voucherId}`);
  if (method === 'voucher' ? !voucher || amount > voucher.paid || row.claims.some(item => item.state !== 'given')
    : claim?.state !== 'given' || claim.method !== method || amount > claim.amount) {
    fail('RETURN_NOT_VERIFIED', 'Verify the payout before recording this visit refund.');
  }
  assertMoney(amount, 'Visit refund');
  const idempotencyKey = `visit-return:${row._id}:${key}:${lineId}`;
  const previous = await readOne(ctx, () => ctx.db.query('appointmentRefunds')
    .withIndex('by_idempotencyKey', q => q.eq('idempotencyKey', idempotencyKey)).unique());
  if (previous) {
    if (previous.returnId !== row._id || previous.appointmentId !== quote.appointmentId || previous.orderId !== row.orderId ||
        previous.amount !== amount || previous.method !== method || previous.reason !== row.reason ||
        previous.effectiveAt !== effectiveAt || previous.recordedBy !== actor) {
      fail('RETURN_KEY_CONFLICT', 'This payout was recorded with different visit refund details.');
    }
    return { refundId: previous._id, replayed: true };
  }
  const visit = await loadVisit(ctx, quote);
  const pending = visit.pendingReturn;
  const { gross, net, refunded } = appointmentMoney(visit);
  if (row.status !== 'authorized' || pending?.returnId !== row._id || amount > pending.remaining ||
      amount > net || visit.paymentStatus !== 'paid') {
    fail('RETURN_VISIT_CAP', 'The payout exceeds the money reserved on this visit.');
  }
  const netAfter = net - amount;
  reserveWrites(ctx, 3);
  const refundId = await ctx.db.insert('appointmentRefunds', {
    appointmentId: visit._id, orderId: row.orderId, returnId: row._id, idempotencyKey,
    amount, method, reason: row.reason, currency: visit.currency, recordedBy: actor,
    netBefore: net, netAfter, effectiveAt, recordedAt: Date.now(),
  });
  await recordAppointmentChange(ctx, visit, {
    pendingReturn: { ...pending, remaining: pending.remaining - amount },
    amountPaid: gross, amountRefunded: refunded + amount, financialRevision: (visit.financialRevision ?? 0) + 1,
    ...(netAfter === 0 ? { paymentStatus: 'refunded', refundedAt: effectiveAt } : {}),
  }, { actor, kind: 'payment', reason: row.reason, effectiveAt, details: [
    { field: 'returnId', from: null, to: row._id }, { field: 'refundId', from: null, to: refundId },
    { field: 'refundMethod', from: null, to: method }, { field: 'refundAmount', from: null, to: amount },
  ] }, row._id);
  await bumpOrderCommerceRevision(ctx, [row.orderId]);
  return { refundId, replayed: false };
}

async function restoreVisit(
  ctx: MutationCtx, row: OrderReturn, visit: Visit, restore: NonNullable<VisitReturn['restore']>, actor: string, now: number,
) {
  const [use, grant] = await Promise.all([
    readOne(ctx, () => ctx.db.get(restore.useId)),
    readOne(ctx, () => ctx.db.get(restore.grantId)),
  ]);
  const price = visit.coverage?.priceBefore;
  if (price === undefined || visit.coverage?.useId !== restore.useId || use?.activeAppointmentId !== visit._id ||
      !use.bucket || use.grantId !== grant?._id || (grant.pendingReturnId && grant.pendingReturnId !== row._id) ||
      grant.used < 1 || grant.grantServiceIds.length > COMMERCE_LIMITS.servicesPerGrant) {
    fail('RETURN_SESSION_CHANGED', 'The reserved session no longer matches the visit.');
  }
  const before = { paid: grant.paidUnits, goodwill: grant.goodwillUnits };
  const expired = !grant.pause && now >= grant.expiresAt;
  const after = { paid: before.paid + Number(use.bucket === 'paid'), goodwill: before.goodwill + Number(use.bucket === 'goodwill' && !expired) };
  const reopen = !expired && !grant.pause && before.paid + before.goodwill === 0;
  reserveWrites(ctx, 5 + (reopen ? grant.grantServiceIds.length : 0));
  await ctx.db.patch(grant._id, {
    paidUnits: after.paid, goodwillUnits: after.goodwill, used: grant.used - 1, revision: grant.revision + 1, pendingReturnId: undefined,
  });
  if (reopen) await Promise.all(grant.grantServiceIds.map(id => ctx.db.patch(id, { usable: true })));
  await ctx.db.patch(use._id, { activeAppointmentId: undefined });
  await ctx.db.insert('sessionUses', {
    grantId: grant._id, kind: 'restore', sourceKey: `visit-return:${row._id}:${use._id}`, restoresUseId: use._id,
    bucket: use.bucket, lineId: use.lineId, serviceId: use.serviceId, beneficiaryId: use.beneficiaryId,
    before, after, actor, createdAt: now, guestFact: 'Session restored from a visit return',
  });
  await recordAppointmentChange(ctx, visit, {
    coverage: undefined, pendingReturn: undefined, paymentStatus: 'unpaid', price, amountPaid: 0, amountRefunded: 0,
    paidAt: undefined, paidBy: undefined, refundedAt: undefined, financialRevision: (visit.financialRevision ?? 0) + 1,
  }, { actor, kind: 'payment', reason: row.reason, effectiveAt: now, details: [
    { field: 'returnId', from: null, to: row._id }, { field: 'sessionUseId', from: use._id, to: null },
  ] }, row._id);
  return grant.orderId;
}

export async function releaseReturn(ctx: MutationCtx, row: OrderReturn, mode: 'cancel' | 'complete', actor: string, now: number) {
  if (row.status === (mode === 'cancel' ? 'cancelled' : 'completed')) return;
  if (row.status !== 'authorized') fail('RETURN_CLOSED', 'This return is already closed.');
  if (mode === 'cancel' ? row.claims.some(item => !['owed', 'failed', 'cancelled'].includes(item.state))
    : row.claims.some(item => item.state !== 'given')) {
    fail('RETURN_NOT_VERIFIED', 'Verify all payout destinations before releasing the visit.');
  }
  const changedOrders = new Set<Id<'orders'>>();
  for (const quote of row.visitReturns ?? []) {
    const visit = await loadVisit(ctx, quote);
    if (visit.pendingReturn?.returnId !== row._id) fail('RETURN_VISIT_CHANGED', 'The visit reservation is missing.');
    if (visit.pendingReturn.remaining !== (mode === 'cancel' ? quote.amount : 0)) {
      fail('RETURN_VISIT_CAP', 'The visit refund does not reconcile with the reservation.');
    }
    const { restore } = quote;
    if (restore && mode === 'complete') {
      changedOrders.add(await restoreVisit(ctx, row, visit, restore, actor, now));
    } else {
      if (restore) {
        const grant = await readOne(ctx, () => ctx.db.get(restore.grantId));
        if (!grant || (grant.pendingReturnId && grant.pendingReturnId !== row._id)) {
          fail('RETURN_SESSION_CHANGED', 'The reserved package changed.');
        }
        if (grant.pendingReturnId) {
          reserveWrites(ctx, 1);
          await ctx.db.patch(grant._id, { pendingReturnId: undefined, revision: grant.revision + 1 });
          changedOrders.add(grant.orderId);
        }
      }
      reserveWrites(ctx, 1);
      await ctx.db.patch(visit._id, { pendingReturn: undefined, revision: appointmentRevision(visit) + 1 });
    }
    changedOrders.add(row.orderId);
  }
  await bumpOrderCommerceRevision(ctx, changedOrders);
}
