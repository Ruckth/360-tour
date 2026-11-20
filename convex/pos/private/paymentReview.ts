import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { assertNoBookingOverlap, nightRows, NIGHT_ROWS_ERROR, OVERLAP_INCOMPLETE_ERROR, STAY_BLOCKED_ERROR, STAY_TAKEN_ERROR } from '../../bookings/model';
import { stayDates } from '../../shared/dates';
import { orderTotals } from '../../shared/orderMath';
import { ReadBudgetExceeded, readBudget } from '../../lib/readBudget';
import { assertCustomerReviewed } from './customerModel';
import { ATTACHED_PRICE, isSourceRow, orderCouponUnavailable, quoteOrderCoupon, sourceIssue } from './orderModel';
import { assertNoPendingApprovals } from './staffApprovalState';
import { paymentError, paymentGet, paymentRange, type Attempt, type PaymentCtx } from './paymentAttempt';

export function isCommerceLine(line: Doc<'orderLines'>) {
  return line.kind === 'product' || line.kind === 'package' || line.kind === 'voucher' || !!line.coverage;
}

export async function readPaymentLines(ctx: PaymentCtx, order: Doc<'orders'>, { allowEmpty = false } = {}) {
  const lines = await paymentRange(ctx, () => ctx.db.query('orderLines').withIndex('by_orderId', q => q.eq('orderId', order._id)).take(101));
  if (!allowEmpty && !lines.length) paymentError('empty_order', 'Add an item first');
  if (lines.length > 100) paymentError('order_limit', 'Split this order into smaller payments.');
  return lines;
}

export async function checkPaymentTotals(
  ctx: MutationCtx, order: Doc<'orders'>, lines: Doc<'orderLines'>[], expected: { revision: number; due: number },
  attempts: boolean, booking?: (id: Id<'bookings'>) => Promise<Doc<'bookings'> | null>,
) {
  if (order.promotion) {
    const extraBookingId = attempts ? order.bookingId : undefined;
    const result = await quoteOrderCoupon(ctx, lines, order.promotion.couponId, order.promotion.couponVersion, extraBookingId, booking);
    if (!result.ok) orderCouponUnavailable(result.problem);
    const shares = new Map(result.allocation.map(share => [share.lineId, share.discount]));
    if (result.discount !== order.promotion.discount || lines.some(line => (line.couponDiscount ?? 0) !== (shares.get(line._id) ?? 0))) {
      throw new ConvexError({ code: 'coupon_changed', message: `The coupon now saves ฿${(result.discount / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}. Check the coupon again before taking payment.`, discount: result.discount });
    }
  }
  const totals = orderTotals(lines);
  if (totals.due !== expected.due || order.revision !== expected.revision) {
    const message = 'The order changed. Check the total and pay again.';
    // The direct panel keeps today's plain-message refusal; attempts read the typed code.
    if (!attempts) throw new ConvexError(message);
    paymentError('order_changed', message);
  }
  return totals;
}

export function assertCurrentPaymentSource(issue: Awaited<ReturnType<typeof sourceIssue>>, line: Doc<'orderLines'>) {
  if (issue) throw new ConvexError(issue.kind === 'changed' ? `${line.name} changed since it was added. Update the row and review the total.` : `${line.name}: ${issue.message}`);
  if (line.bookingId && (line.discount || line.priceOverride)) throw new ConvexError(ATTACHED_PRICE);
}

export async function checkPaymentCart(
  ctx: MutationCtx, order: Doc<'orders'>, expected: Pick<Attempt['reviewedRequest'], 'revision' | 'due' | 'customers'>,
  options: { lines?: Doc<'orderLines'>[] } = {},
) {
  await assertNoPendingApprovals(ctx, order._id);
  const lines = options.lines ?? await readPaymentLines(ctx, order);
  if (!lines.length) paymentError('empty_order', 'Add an item first');
  const bookingReads = new Map<Id<'bookings'>, Promise<Doc<'bookings'> | null>>();
  const appointmentReads = new Map<Id<'appointments'>, Promise<Doc<'appointments'> | null>>();
  const booking = (id: Id<'bookings'>) => {
    const value = bookingReads.get(id) ?? paymentGet(ctx, id);
    bookingReads.set(id, value);
    return value;
  };
  const appointment = (id: Id<'appointments'>) => {
    const value = appointmentReads.get(id) ?? paymentGet(ctx, id);
    appointmentReads.set(id, value);
    return value;
  };
  const totals = await checkPaymentTotals(ctx, order, lines, expected, true, booking);
  const attendees = new Set<Id<'customers'>>();
  if (order.customerId) attendees.add(order.customerId);
  const stays: Doc<'bookings'>[] = [];
  for (const line of lines) {
    if (!isSourceRow(line)) continue;
    const issue = await sourceIssue(ctx, line, {
      booking, appointment, property: id => paymentGet(ctx, id), service: id => paymentGet(ctx, id),
    }, true);
    assertCurrentPaymentSource(issue, line);
    if (line.bookingId) stays.push((await booking(line.bookingId))!);
    if (line.appointmentId) {
      const attendeeId = (await appointment(line.appointmentId))?.attendeeId;
      if (attendeeId) attendees.add(attendeeId);
    }
  }
  const revisions = new Map(expected.customers.map(review => [review.customerId, review.revision]));
  if (revisions.size !== attendees.size || expected.customers.length !== revisions.size) {
    paymentError('customer_changed', 'Review the current payer and attendees before taking payment.');
  }
  let customer: Doc<'customers'> | null = null;
  for (const customerId of attendees) {
    const doc = await paymentGet(ctx, customerId);
    assertCustomerReviewed(doc, revisions.get(customerId));
    if (customerId === order.customerId) customer = doc;
  }
  if (lines.some(isCommerceLine)) {
    const distinct = new Set([order.bookingId, ...stays.map(stay => stay._id)].filter(Boolean));
    if (distinct.size > 1) paymentError('split_stays', 'Pay these stays separately.');
    if (stays.reduce((sum, stay) => sum + stay.nights, 0) > 600) {
      paymentError('pay_room_first', 'Pay the room first.');
    }
  }
  const roomsAndGoods = lines.some(isCommerceLine) && lines.some(line => !line.bookingId);
  const before = readBudget(ctx).documents;
  for (const stay of stays) await checkStayNights(ctx, stay, roomsAndGoods ? before + 1650 : undefined);
  return { lines, totals, customer, appointment };
}

/** Match the booking writer's own-hold exception while checking availability before instruction. */
async function checkStayNights(ctx: PaymentCtx, stay: Doc<'bookings'>, limit?: number) {
  const { propertyId, checkIn, checkOut } = stay;
  try {
    await assertNoBookingOverlap(ctx, propertyId, checkIn, checkOut, stay._id);
    for (const date of stayDates(checkIn, checkOut)) {
      const rows = await nightRows(ctx, propertyId, date);
      if (limit !== undefined && readBudget(ctx).documents > limit) paymentError('pay_room_first', 'Pay the room first.');
      const own = rows.some(row => row.bookingId === stay._id);
      for (const row of rows) {
        if (row.bookingId === stay._id || row.status === 'available') continue;
        if (row.bookingId) throw new Error(STAY_TAKEN_ERROR);
        if (!row.icalSourceId || !own) throw new Error(STAY_BLOCKED_ERROR);
      }
    }
  } catch (error) {
    if (error instanceof ReadBudgetExceeded) paymentError('stay_review_limit', error.message);
    if (error instanceof Error && [STAY_BLOCKED_ERROR, STAY_TAKEN_ERROR, OVERLAP_INCOMPLETE_ERROR, NIGHT_ROWS_ERROR].includes(error.message)) {
      paymentError('stay_unavailable', error.message);
    }
    throw error;
  }
}
