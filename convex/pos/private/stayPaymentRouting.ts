import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { appendRecordHistory } from '../../settings/model';
import { COMMERCE_LIMITS } from '../../shared/commerce';
import { reserveWrites } from '../../lib/readBudget';
import { paymentError, paymentGet, paymentRange, type PaymentCtx } from './paymentAttempt';
import { insertOrder } from './orderLinks';

const ROUTING = 'checkoutRoomRouting';
const SPLIT_REQUEST = 'checkoutRoomSplitRequest';

export type RoomRoute = { roomOrderId: Id<'orders'>; shopOrderId: Id<'orders'> };

export function isRoomPaymentLine(line: Doc<'orderLines'>) {
  return line.kind === 'room' || line.kind === 'booking';
}

export async function readRoomRoute(ctx: PaymentCtx, bookingId: Id<'bookings'>): Promise<RoomRoute | null> {
  const [row] = await paymentRange(ctx, () => ctx.db.query('recordChanges')
    .withIndex('by_entityType_and_entityId_and_recordedAt', q => q.eq('entityType', ROUTING).eq('entityId', bookingId))
    .order('desc').take(1));
  if (row?.kind !== 'split') return null;
  return row.after as RoomRoute;
}

export async function updateRoomRoute(ctx: MutationCtx, bookingId: Id<'bookings'>, actor: string, result: RoomRoute, joined: boolean) {
  reserveWrites(ctx, 1);
  await appendRecordHistory(ctx, { entityType: ROUTING, entityId: bookingId, actor, kind: joined ? 'joined' : 'split', after: result });
}

export async function replayRoomRoutingRequest(ctx: PaymentCtx, key: string, fingerprint: string) {
  const [row] = await paymentRange(ctx, () => ctx.db.query('recordChanges')
    .withIndex('by_entityType_and_entityId_and_recordedAt', q => q.eq('entityType', SPLIT_REQUEST).eq('entityId', key)).take(1));
  if (!row) return null;
  if (row.reason !== fingerprint) paymentError('payment_key_conflict', 'This routing key was already used.');
  return row.after as RoomRoute;
}

export async function logRoomRoutingRequest(ctx: MutationCtx, key: string, fingerprint: string, actor: string, route: RoomRoute, joined: boolean) {
  reserveWrites(ctx, 1);
  await appendRecordHistory(ctx, { entityType: SPLIT_REQUEST, entityId: key, actor, kind: joined ? 'joined' : 'split', reason: fingerprint, after: route });
}

export async function openShopOrder(
  ctx: MutationCtx, bookingId: Id<'bookings'>, route: RoomRoute, actor: string, create: boolean,
) {
  const order = await paymentGet(ctx, route.shopOrderId);
  if (order?.status === 'draft') return order;
  if (!create) return null;
  const room = await paymentGet(ctx, route.roomOrderId);
  const shop = await insertOrder(ctx, actor, { bookingId, customerId: room?.customerId, parentOrderId: route.roomOrderId });
  await updateRoomRoute(ctx, bookingId, actor, { roomOrderId: route.roomOrderId, shopOrderId: shop._id }, false);
  return shop;
}

export async function readRoomHandovers(ctx: PaymentCtx, from: Id<'orders'>, lineIds: ReadonlySet<Id<'orderLines'>>) {
  const handovers = await paymentRange(ctx, () => ctx.db.query('handovers')
    .withIndex('by_orderId_and_status', q => q.eq('orderId', from).eq('status', 'open')).take(COMMERCE_LIMITS.sale.rows + 1));
  if (handovers.length > COMMERCE_LIMITS.sale.rows || handovers.some(handover => handover.pendingReturnId || !lineIds.has(handover.lineId))) {
    paymentError('handover_changed', 'Review the room charges before changing how they are paid.');
  }
  return handovers;
}

export async function moveRoomHandovers(ctx: MutationCtx, handovers: Doc<'handovers'>[], from: Id<'orders'>, to: Id<'orders'>) {
  for (const handover of handovers) {
    reserveWrites(ctx, 1);
    await ctx.db.patch(handover._id, {
      orderId: to, revision: handover.revision + 1,
      ...(handover.successorOrderId === from ? { successorOrderId: to } : {}),
    });
  }
}
