// POS model interface. Implementations stay private; endpoints are never re-exported.
export type { SourceIssue } from './private/orderModel';
export { PAIRING_TTL_MS } from './private/displayModel';
export type { DisplayState, DisplayDriver } from '../shared/displayTypes';
export { MAX_LINES, orderLines } from './private/orderLines';
export { MAX_LINKS, orderLineLinks, activeLineLink, sourceLineLinks, activeSourceLink } from './private/lineLinks';
export { type OrderSource, orderState, ORDER_COUNTER, RECEIPT_COUNTER, nextCounter, openOrderCharging, linkedOpenOrder, activeOrderFor, ordersForSource, insertOrder, ensureLinkedOrder, orderDeleteBlocker, deletePlaceholderOrders, assertNotOnOpenOrder } from './private/orderLinks';
