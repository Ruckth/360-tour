// POS model interface. Implementations stay private; endpoints are never re-exported.
export { orderLineLinks, sourceLineLinks, activeSourceLink } from './private/lineLinks';
export { isOpenOrder, isSettledOrder, nextCounter, insertOrder, ensureLinkedOrder, orderDeleteBlocker, deletePlaceholderOrders, assertNotOnOpenOrder } from './private/orderLinks';
export { orderPaymentRecord } from './private/orderLifecycle';
