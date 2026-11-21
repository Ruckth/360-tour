import { v } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { readBudget, reserveWrites } from '../../lib/readBudget';
import { sha256 } from '../../shared/displayTokens';

const TILL_STATUS_PAGE_SIZE = 32;
const ATTEMPT_STATUS_LIMIT = 12;

const directPanel = v.object({
  panelKey: v.string(),
  orderId: v.id('orders'),
  actor: v.string(),
  openedAt: v.number(),
});

export const tillPaymentRollout = v.object({
  acknowledged: v.optional(v.object({
    mode: v.literal('attempts'),
    revision: v.number(),
    at: v.number(),
  })),
  panels: v.optional(v.array(directPanel)),
  retired: v.optional(v.object({
    at: v.number(),
    actor: v.string(),
    reason: v.string(),
  })),
});

export async function readPaymentRows<T>(ctx: QueryCtx, read: () => Promise<readonly T[]>) {
  const budget = readBudget(ctx);
  budget.range();
  budget.assert();
  const rows = await read();
  for (const row of rows) budget.document(row);
  budget.assert();
  return rows;
}

export async function readPaymentOrder(ctx: QueryCtx, orderId: Id<'orders'>): Promise<Doc<'orders'> | undefined> {
  const [order] = await readPaymentRows(ctx, async () => {
    const order = await ctx.db.get('orders', orderId);
    return order ? [order] : [];
  });
  return order;
}

export async function findPaymentTill(ctx: QueryCtx, tillId?: Id<'tills'>): Promise<Doc<'tills'> | undefined> {
  const [till] = await readPaymentRows(ctx, async () => {
    const till = tillId
      ? await ctx.db.get('tills', tillId)
      : await ctx.db.query('tills').withIndex('by_key', q => q.eq('key', 'default')).unique();
    return till ? [till] : [];
  });
  return till;
}

export function validPaymentDeviceKey(key: string | undefined): key is string {
  return key !== undefined && /^[A-Za-z0-9_-]{20,128}$/.test(key);
}

export const paymentTabArgs = { tabKey: v.optional(v.string()) };
type PaymentTab = { tillId: string; tabKey?: string };

export async function ownsPaymentAttempt(
  attempt: Doc<'paymentAttempts'>, actor: { tokenIdentifier?: string }, args: PaymentTab,
) {
  return actor.tokenIdentifier !== undefined && attempt.tillId === args.tillId && attempt.ownerToken === actor.tokenIdentifier &&
    validPaymentDeviceKey(args.tabKey) && attempt.ownerTab === await sha256(args.tabKey);
}

export async function findDevicePaymentTill(ctx: QueryCtx, deviceKey: string) {
  const hash = await sha256(deviceKey);
  const [till] = await readPaymentRows(ctx, () => ctx.db.query('tills')
    .withIndex('by_paymentDeviceHash', q => q.eq('paymentDeviceHash', hash)).take(1));
  return till;
}

export async function ensurePaymentTill(ctx: MutationCtx, deviceKey?: string) {
  const till = deviceKey ? await findDevicePaymentTill(ctx, deviceKey) : await findPaymentTill(ctx);
  if (till) return till._id;
  if (deviceKey) {
    reserveWrites(ctx, 1);
    return await ctx.db.insert('tills', { key: 'payment', paymentDeviceHash: await sha256(deviceKey) });
  }
  reserveWrites(ctx, 1);
  return await ctx.db.insert('tills', { key: 'default' });
}

export function paymentTillLabel(till: Pick<Doc<'tills'>, '_id'> & Partial<Pick<Doc<'tills'>, 'key'>>) {
  return till.key === 'default' ? 'Default till' : `Till ${till._id.slice(-6).toUpperCase()}`;
}

export async function patchPaymentTill(
  ctx: MutationCtx, till: Doc<'tills'>, patch: NonNullable<Doc<'tills'>['paymentRollout']>,
) {
  reserveWrites(ctx, 1);
  await ctx.db.patch('tills', till._id, { paymentRollout: { ...till.paymentRollout, ...patch } });
}

export async function retirePaymentTill(
  ctx: MutationCtx, till: Doc<'tills'>, info: { at: number; actor: string; reason: string },
) {
  reserveWrites(ctx, 1);
  await ctx.db.patch('tills', till._id, {
    key: 'retired',
    paymentRollout: { ...till.paymentRollout, retired: info },
  });
}

export async function tillHasDirectPanels(ctx: QueryCtx, till: Doc<'tills'>) {
  if (till.paymentRollout?.panels?.length) return true;
  const rows = await readPaymentRows(ctx, () => ctx.db.query('directPaymentPanels')
    .withIndex('by_tillId_and_panelKey', q => q.eq('tillId', till._id)).take(1));
  return rows.length > 0;
}

export async function paymentTillsAtRevision(ctx: QueryCtx, revision: number, limit = TILL_STATUS_PAGE_SIZE + 1) {
  const [acknowledged, older, newer] = await Promise.all([
    readPaymentRows(ctx, () => ctx.db.query('tills').withIndex('by_key_and_acknowledgedRevision', q =>
      q.eq('key', 'payment').eq('paymentRollout.acknowledged.revision', revision)).take(limit)),
    readPaymentRows(ctx, () => ctx.db.query('tills').withIndex('by_key_and_acknowledgedRevision', q =>
      q.eq('key', 'payment').lt('paymentRollout.acknowledged.revision', revision)).take(limit)),
    readPaymentRows(ctx, () => ctx.db.query('tills').withIndex('by_key_and_acknowledgedRevision', q =>
      q.eq('key', 'payment').gt('paymentRollout.acknowledged.revision', revision)).take(limit)),
  ]);
  const pending = [...older, ...newer];
  return {
    acknowledged: acknowledged.slice(0, TILL_STATUS_PAGE_SIZE),
    pending: pending.slice(0, TILL_STATUS_PAGE_SIZE),
    moreTills: acknowledged.length > TILL_STATUS_PAGE_SIZE || pending.length > TILL_STATUS_PAGE_SIZE,
  };
}

export async function openPaymentAttempts(ctx: QueryCtx) {
  const states = ['collecting', 'refused', 'recovering'] as const;
  const groups = await Promise.all(states.map(status => readPaymentRows(ctx, () =>
    ctx.db.query('paymentAttempts').withIndex('by_status', q => q.eq('status', status)).take(ATTEMPT_STATUS_LIMIT + 1),
  )));
  return {
    attempts: groups.flatMap(group => group.slice(0, ATTEMPT_STATUS_LIMIT).map(attempt => ({
      attemptId: attempt._id, orderId: attempt.orderId, tillId: attempt.tillId,
      owner: attempt.owner, status: attempt.status, openedAt: attempt.createdAt,
    }))),
    moreAttempts: groups.some(group => group.length > ATTEMPT_STATUS_LIMIT),
  };
}
