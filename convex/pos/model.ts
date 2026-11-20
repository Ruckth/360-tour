// POS model interface. Implementations stay private; endpoints are never re-exported.
export { orderLineLinks, sourceLineLinks, activeSourceLink } from './private/lineLinks';
export { isOpenOrder, isSettledOrder, nextCounter, insertOrder, ensureLinkedOrder, orderDeleteBlocker, deletePlaceholderOrders, assertNotOnOpenOrder, activeOrderFor } from './private/orderLinks';
export { orderPaymentRecord } from './private/orderLifecycle';
export {
  ensurePaymentTill, findDevicePaymentTill, findPaymentTill, openPaymentAttempts, patchPaymentTill,
  paymentTillLabel, paymentTillsAtRevision, readPaymentOrder, validPaymentDeviceKey,
} from './private/tillPayments';
export {
  DIRECT_PANEL_STALE_MS, assertInstruction, closeSettledDirectPanel, deleteDirectPanel, directInstructionArgs, directPanelPage,
  directPanelSettled, directPanelTill, findDirectPanel, matchesInstruction, orderDirectPanels, ownsPanel, panelOwner,
  linkReceipt, patchDirectPanel, readDirectPanels, receiptRecordsPanel, receiptUsed, registerDirectPanel, settlingPanel, type DirectInstruction, type DirectPanel,
} from './private/directPanels';
