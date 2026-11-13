import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { orderLines } from './orderLines';
import { isOpenOrder } from './orderLinks';
import { assertDiscount, assertOrderSize, assertPrice, assertPriceOverride, orderTotals, roundMoney } from '../../shared/orderMath';
import { executeOrderRefund, refundState } from './orderRefunds';
import { manualReduction, type StaffActor } from '../../auth/model';
import { type ApprovalPayload } from '../../lib/staffTypes';
import { executeAddItem, executeAttach, executeOverrideLinePrice, executeUpdateLine, executeUpdateSourceLine, executeVoidOrder } from './lineCommands';
import { ATTACHED_PRICE, FEE_FIXED, Line, Order, ReadCtx, appointmentLine, assertRoom, bookingLine, cleanText, isSourceRow, oneSource, orderCouponUnavailable, quoteOrderCoupon, sourceIssue } from './orderModel';
import { linkableRow } from './paidLinkModel';
import { executeLinkPaidLine, executeUnlinkPaidLine } from './paidLinks';
import { executeAmendOrderPayment, executeVoidUnreceivedOrder } from './paymentCorrections';

/** Read-only proposal for the approval card. Execution still runs every original validation. */
export async function previewStaffApproval(ctx: MutationCtx, order: Order, payload: ApprovalPayload) {
 if (payload.kind === 'refund') {
  const state = await refundState(ctx, { ...payload, amount: payload.amountSatang, orderId: order._id });
  const totalBefore = roundMoney(orderTotals(await orderLines(ctx, order._id)).total - state.refunds.reduce((sum, row) => sum + row.amount, 0));
  return { totalBefore, totalAfter: roundMoney(totalBefore - payload.amountSatang), amount: payload.amountSatang };
 }
 const lines = await orderLines(ctx, order._id);
 let proposed: Array<Pick<Line, 'kind' | 'unitPrice' | 'qty' | 'discount' | 'priceOverride' | 'couponDiscount' | 'bookingId' | 'fee'> & { _id: string }> = lines.map(line => ({ ...line }));
 const totalBefore = orderTotals(lines).total;
 let amount = 0;
 let percent: number | undefined;
 if (payload.kind === 'discount' || payload.kind === 'customPrice') {
  if (!isOpenOrder(order)) throw new ConvexError('Only an unpaid order can be changed');
  if ('lineId' in payload) {
   const line = lines.find(row => row._id === payload.lineId);
   if (!line) throw new ConvexError('Item not found on this order');
   let next: Line = { ...line };
   if (payload.kind === 'discount') {
    if (line.fee) throw new ConvexError(FEE_FIXED);
    if (line.kind === 'booking') throw new ConvexError(ATTACHED_PRICE);
    assertDiscount(payload.discount);
    next.discount = payload.discount;
   } else if (payload.action === 'overrideLinePrice') {
    if (payload.price !== null) {
     if (line.kind === 'booking') throw new ConvexError(ATTACHED_PRICE);
     if (line.fee) throw new ConvexError(FEE_FIXED);
     const note = assertPriceOverride(payload.price, payload.note);
     next.priceOverride = { price: roundMoney(payload.price), note, by: '', at: Date.now() };
    } else next.priceOverride = undefined;
   } else {
    if (!isSourceRow(line) || line.fee) throw new ConvexError('Only a booking or appointment row can be repriced');
    const issue = await sourceIssue(ctx, line);
    if (issue?.kind !== 'changed') throw new ConvexError('This source has no price update to approve');
    const fresh = line.bookingId ? await bookingLine(ctx, (await ctx.db.get(line.bookingId))!) : await appointmentLine(ctx, (await ctx.db.get(line.appointmentId!))!);
    next = { ...line, ...fresh };
   }
   const reduction = manualReduction(next);
   amount = reduction.reductionSatang;
   percent = reduction.percent;
   proposed = proposed.map(row => row._id === line._id ? next : row);
  } else if (payload.kind === 'customPrice' && payload.action === 'addCustomItem') {
   assertPrice(payload.price);
   const name = cleanText(payload.name, 'Item name', 80);
   if (!name) throw new ConvexError('Name the item');
   await assertRoom(ctx, order._id);
   proposed.push({ _id: 'proposed', kind: 'extra', unitPrice: roundMoney(payload.price), qty: 1 });
   amount = roundMoney(payload.price);
  } else if (payload.kind === 'customPrice' && payload.action === 'attachSource') {
   const source = oneSource(payload);
   const fresh = 'bookingId' in source ? await bookingLine(ctx, await requireBooking(ctx, source.bookingId)) : await appointmentLine(ctx, await requireAppointment(ctx, source.appointmentId));
   proposed.push({ ...fresh, _id: 'proposed' });
   const reduction = manualReduction(fresh);
   amount = reduction.reductionSatang;
   percent = reduction.percent;
  }
  if (order.promotion) {
   const quote = await quoteOrderCoupon(ctx, proposed, order.promotion.couponId, order.promotion.couponVersion);
   if (!quote.ok) orderCouponUnavailable(quote.problem);
   const shares = new Map(quote.allocation.map(row => [row.lineId, row.discount]));
   proposed = proposed.map(row => ({ ...row, couponDiscount: shares.get(row._id) }));
  }
  const totals = orderTotals(proposed);
  assertOrderSize(totals);
  return { totalBefore, totalAfter: totals.total, amount, ...(percent !== undefined ? { percent } : {}) };
 }
 if (order.status !== 'paid') throw new ConvexError('Only a paid order can be corrected');
 if (payload.kind === 'paymentFix') {
  if (payload.action === 'linkPaidLine') amount = linkableRow(order, await ctx.db.get(payload.lineId)).amount;
  if (payload.action === 'unlinkPaidLine') {
   const link = await ctx.db.get(payload.linkId);
   if (!link || link.orderId !== order._id || link.status !== 'active') throw new ConvexError('Link not found on this order');
   amount = link.amount;
  }
 }
 return { totalBefore, totalAfter: payload.kind === 'paymentFix' && payload.action === 'voidUnreceivedOrder' ? 0 : totalBefore, amount: amount || totalBefore };
}

export async function requireBooking(ctx: ReadCtx, id: Id<'bookings'>) {
 const row = await ctx.db.get(id);
 if (!row) throw new ConvexError('Booking not found');
 return row;
}

export async function requireAppointment(ctx: ReadCtx, id: Id<'appointments'>) {
 const row = await ctx.db.get(id);
 if (!row) throw new ConvexError('Appointment not found');
 return row;
}

/** Internal TypeScript helper, not a Convex endpoint; approval identity is server-derived. */
export async function executeStaffApproval(ctx: MutationCtx, request: Doc<'staffApprovalRequests'>, actor: StaffActor) {
 const payload = request.payload;
 const order = await ctx.db.get(request.orderId);
 if (!order) throw new ConvexError('Order not found');
 const correction = { orderId: order._id, reason: request.reason, expectedCorrectionRevision: order.correctionRevision ?? 0, idempotencyKey: `approval:${request._id}` };
 switch (payload.kind) {
  case 'refund': return await executeOrderRefund(ctx, { ...payload, amount: payload.amountSatang, orderId: order._id }, actor);
  case 'discount': return await executeUpdateLine(ctx, { lineId: payload.lineId, discount: payload.discount }, actor);
  case 'customPrice':
   switch (payload.action) {
    case 'overrideLinePrice': return await executeOverrideLinePrice(ctx, payload, actor);
    case 'updateSourceLine': return await executeUpdateSourceLine(ctx, payload, actor);
    case 'addCustomItem': return await executeAddItem(ctx, { orderId: order._id, item: { kind: 'extra', name: payload.name, price: payload.price } }, actor);
    case 'attachSource': return await executeAttach(ctx, { orderId: order._id, bookingId: payload.bookingId, appointmentId: payload.appointmentId }, actor);
   }
  case 'voidPaidSale': return await executeVoidOrder(ctx, { orderId: order._id, reason: request.reason }, actor);
  case 'paymentFix':
   switch (payload.action) {
    case 'amendOrderPayment': return await executeAmendOrderPayment(ctx, { ...correction, ...payload }, actor);
    case 'voidUnreceivedOrder': return await executeVoidUnreceivedOrder(ctx, correction, actor);
    case 'linkPaidLine': return await executeLinkPaidLine(ctx, { ...correction, ...payload }, actor);
    case 'unlinkPaidLine': return await executeUnlinkPaidLine(ctx, { ...correction, ...payload }, actor);
   }
 }
}
