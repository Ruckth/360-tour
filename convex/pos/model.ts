// POS model interface. Implementations stay private; endpoints are never re-exported.
export { type SourceIssue } from './private/orderModel';
export { executeAddItem, executeAttach, executeUpdateLine, executeOverrideLinePrice, executeUpdateSourceLine, executeVoidOrder } from './private/lineCommands';
export { executeAmendOrderPayment, executeVoidUnreceivedOrder } from './private/paymentCorrections';
export { executeLinkPaidLine, executeUnlinkPaidLine } from './private/paidLinks';
export { previewStaffApproval, executeStaffApproval } from './private/approvalModel';
export { CUSTOMER_POS_INTEGRATION_ENABLED, assertCustomerCanLink, assertCustomerReviewed, cleanCustomer, customerCard, mergeCustomerRecords } from './private/customerModel';
export { PAIRING_TTL_MS, type DisplayState, type DisplayDriver } from './private/displayModel';
