import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { recordAppointmentPayment } from '../private/appointmentFinance';
import { manualPaymentMethod } from '../../lib/financeValidators';
import { loadAppointment } from '../private/administration';

export const markAppointmentPaid = adminMutation({
 args: { appointmentId: v.id('appointments'), expectedRevision: v.optional(v.number()), effectiveAt: v.optional(v.number()), method: v.optional(manualPaymentMethod), idempotencyKey: v.optional(v.string()) },
 handler: async (ctx, args) => {
  const admin = ctx.admin;
  return await recordAppointmentPayment(ctx, await loadAppointment(ctx, args.appointmentId), args, admin.email);
 }
});
