// POS model interface. Implementations stay private; endpoints are never re-exported.
export type { SourceIssue } from './private/orderModel';
export { PAIRING_TTL_MS } from './private/displayModel';
export type { DisplayState, DisplayDriver } from '../shared/displayTypes';
export { MAX_LINES, orderLines } from './private/orderLines';
export { type OrderRefundInput, orderRefunds, orderRefundTotal, orderRefundView, isWalkInLine, assertNoPosRefunds, assertLineHasNoPosRefunds, refundState, executeOrderRefund } from './private/orderRefunds';
export { MAX_LINKS, orderLineLinks, activeLineLink, sourceLineLinks, activeSourceLink } from './private/lineLinks';
export { type OrderSource, orderState, ORDER_COUNTER, RECEIPT_COUNTER, nextCounter, openOrderCharging, linkedOpenOrder, activeOrderFor, ordersForSource, insertOrder, ensureLinkedOrder, orderDeleteBlocker, deletePlaceholderOrders, assertNotOnOpenOrder } from './private/orderLinks';
export { firstName, displayOrderState } from './private/displayView';
export { DISCARDED_ORDER, type FeeKind, FEE_STATUS, FEE_LABEL, feeBlocker, feePriceBlocker, assertFeeAmount, liveFees, otherFeeMessage } from './private/orderLifecycle';
export { rulesFingerprint, requesterFingerprint, orderFingerprint, effectiveRequestStatus, assertNoPendingApprovals } from './private/staffApprovalState';
