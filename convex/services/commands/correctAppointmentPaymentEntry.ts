import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { correctAppointmentPayment } from '../../lib/appointmentFinance';
import { manualPaymentMethod } from '../../lib/financeValidators';
import { loadAppointment } from '../model';

export const correctAppointmentPaymentEntry = adminMutation({
 args: { appointmentId: v.id('appointments'), expectedRevision: v.number(), paymentId: v.id('appointmentPayments'), idempotencyKey: v.string(), action: v.union(v.literal('amend'), v.literal('cancel')), reason: v.string(), method: v.optional(manualPaymentMethod), effectiveAt: v.optional(v.number()) },
 handler: async (ctx, args) => {
  const admin = ctx.admin;
  return await correctAppointmentPayment(ctx, await loadAppointment(ctx, args.appointmentId), args, admin.email);
 }
});
