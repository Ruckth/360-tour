import { assertNoActivePayment } from '../private/paymentAttempt';
import { v } from 'convex/values';
import { staffMutation } from '../../auth/model';
import { appendRecordHistory } from '../../settings/model';
import { swapOwnerArgs, editableLine, isSourceRow, lineSnapshot, logOrder, refreshOrder } from '../private/orderModel';

export const removeLine = staffMutation({
  capability: 'checkout',
	args: { ...swapOwnerArgs, lineId: v.id('orderLines') },
	handler: async (ctx, args) => {
		const admin = ctx.staff;
		const { line, order } = await editableLine(ctx, args.lineId, admin, args.swapOwner);
		if (isSourceRow(line)) assertNoActivePayment(order);
		await ctx.db.delete(line._id);
		await refreshOrder(ctx, order._id);
		await logOrder(ctx, order._id, admin.email, 'line_removed', { before: lineSnapshot(line) });
		if (line.fee && line.feeAppointmentId) {
			await appendRecordHistory(ctx, {
				entityType: 'appointment', entityId: line.feeAppointmentId, actor: admin.email, kind: 'fee_removed',
				before: { feeKind: line.fee.kind, amount: line.unitPrice, orderId: order._id }
			});
		}
	}
});
