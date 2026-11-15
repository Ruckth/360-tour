import { staffMutation } from '../../auth/model';
import { amendOrderPaymentArgs } from '../private/orderModel';
import { executeAmendOrderPayment } from '../private/paymentCorrections';

export const amendOrderPayment = staffMutation({
  capability: 'checkout',
 args: amendOrderPaymentArgs.fields,
 handler: async (ctx, args) => executeAmendOrderPayment(ctx, args, ctx.staff),
});
