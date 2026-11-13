import type { Doc } from '../_generated/dataModel';

export const isOpenOrder = (order: Pick<Doc<'orders'>, 'status'>) => order.status === 'draft';

/**
 * Paid or void: an order that was settled and is history. Use this, not `!isOpenOrder`, wherever
 * "an order that took money" is meant: a discarded order is neither open nor settled.
 */
export const isSettledOrder = (order: Pick<Doc<'orders'>, 'status'>) => order.status === 'paid' || order.status === 'void';
