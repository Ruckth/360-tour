import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { recordAppointmentRefund } from '../private/appointmentFinance';
import { refundMethod } from '../../lib/financeValidators';
import { loadAppointment } from '../private/administration';

/** Records a refund given at the desk; no money moves through the app. */
export const refundAppointment = adminMutation({
 args: { appointmentId: v.id('appointments'), expectedRevision: v.optional(v.number()), effectiveAt: v.optional(v.number()), amount: v.optional(v.number()), currency: v.optional(v.string()), method: v.optional(refundMethod), reason: v.optional(v.string()), idempotencyKey: v.optional(v.string()), paymentId: v.optional(v.id('appointmentPayments')), orderId: v.optional(v.id('orders')) },
 handler: async (ctx, args) => {
  const admin = ctx.admin;
  return await recordAppointmentRefund(ctx, await loadAppointment(ctx, args.appointmentId), args, admin.email);
 }
});
