import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import { bookingPaymentUrl, humanToolResult, presentMutationToolResult } from './presentation';
import type { ToolArgs, ToolContext } from './types';
export async function previewCoupon(ctx: ActionCtx, fnArgs: ToolArgs, toolContext: ToolContext): Promise<string> {
  const quote = await ctx.runQuery(internal.bookings.bookings.previewChatCoupon, {
    sessionId: toolContext.sessionId, couponCode: String(fnArgs.couponCode), propertySlug: String(fnArgs.propertySlug),
    checkIn: String(fnArgs.checkIn), checkOut: String(fnArgs.checkOut), ...(typeof fnArgs.guests === 'number' ? { guests: fnArgs.guests } : {})
  });
  const params = new URLSearchParams({ unit: quote.propertySlug, checkin: quote.checkIn, checkout: quote.checkOut, guests: String(quote.guests), coupon: quote.coupon?.code ?? '' });
  return humanToolResult({ ...quote, bookingUrl: `${toolContext.siteUrl?.replace(/\/+$/, '') ?? ''}/booking?${params}` });
}

export async function prepareBooking(ctx: ActionCtx, fnName: 'prepare_booking', fnArgs: ToolArgs, toolContext: ToolContext): Promise<string> {
  const summary = await ctx.runMutation(internal.bookings.bookings.prepareChatBooking, {
    sessionId: toolContext.sessionId,
    ...(toolContext.durableTool ? { durableTool: toolContext.durableTool } : {}),
    ...(toolContext.deadlineAt !== undefined ? { deadlineAt: toolContext.deadlineAt } : {}),
    propertySlug: String(fnArgs.propertySlug ?? ''),
    checkIn: String(fnArgs.checkIn ?? ''),
    checkOut: String(fnArgs.checkOut ?? ''),
    guests: Number(fnArgs.guests),
    guestName: String(fnArgs.guestName ?? ''),
    ...(typeof fnArgs.guestPhone === 'string' ? { guestPhone: fnArgs.guestPhone } : {}),
    ...(typeof fnArgs.couponCode === 'string' ? { couponCode: fnArgs.couponCode } : {})
  });
  return presentMutationToolResult({ name: fnName, result: summary }, toolContext.siteUrl);
}

export async function confirmBooking(ctx: ActionCtx, fnName: 'confirm_booking', toolContext: ToolContext): Promise<string> {
  const booking = await ctx.runMutation(internal.bookings.bookings.confirmChatBooking, {
    sessionId: toolContext.sessionId,
    ...(toolContext.durableTool ? { durableTool: toolContext.durableTool } : {}),
    expectedProposal: toolContext.bookingProposal ?? '',
    ...(toolContext.deadlineAt !== undefined ? { deadlineAt: toolContext.deadlineAt } : {})
  });
  return presentMutationToolResult({ name: fnName, result: booking }, toolContext.siteUrl);
}

export async function getMyBookings(ctx: ActionCtx, toolContext: ToolContext): Promise<string> {
  const bookings = await ctx.runQuery(internal.bookings.bookings.listChatGuestBookings, {
    sessionId: toolContext.sessionId
  });
  const services = await ctx.runQuery(internal.services.serviceBookings.listChatGuestServiceBookings, {
    sessionId: toolContext.sessionId
  });
  return humanToolResult({
    bookings: bookings.map(({ bookingId, accessToken, ...booking }) => ({
      ...booking,
      ...(accessToken ? { paymentUrl: bookingPaymentUrl(toolContext.siteUrl, bookingId, accessToken) } : {})
    })),
    services
  });
}

export async function cancelBooking(ctx: ActionCtx, fnName: 'cancel_booking', fnArgs: ToolArgs, toolContext: ToolContext): Promise<string> {
  const reference = String(fnArgs.reference ?? '');
  const result = await ctx.runMutation(reference.trim().toUpperCase().startsWith('SVC-')
    ? internal.services.serviceBookings.cancelChatServiceBooking : internal.bookings.bookings.cancelChatBooking, {
    sessionId: toolContext.sessionId,
    ...(toolContext.durableTool ? { durableTool: toolContext.durableTool } : {}),
    reference,
    turnStartedAt: toolContext.turnStartedAt,
    ...(toolContext.deadlineAt !== undefined ? { deadlineAt: toolContext.deadlineAt } : {})
  });
  return presentMutationToolResult({ name: fnName, result }, toolContext.siteUrl);
}
