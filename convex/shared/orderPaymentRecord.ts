import type { Doc } from '../_generated/dataModel';

/** The receipt's current money and business date, shared with reporting. */
export function orderPaymentRecord(order: Doc<'orders'>, payments: Pick<Doc<'orderPayments'>, 'method' | 'amount' | 'received'>[]) {
	return {
		effectiveAt: order.paymentEffectiveAt ?? order.paidAt ?? null,
		tenders: order.amendedTenders ?? payments.map(({ method, amount, received }) => ({ method, amount, ...(received !== undefined ? { received } : {}) })),
		customer: order.amendedCustomer !== undefined ? order.amendedCustomer : (order.customerSnapshot ?? null)
	};
}
