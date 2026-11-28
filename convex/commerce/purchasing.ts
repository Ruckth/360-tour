/**
 * Stock › Purchasing endpoints. Every call authenticates staff for the selected branch, then the handler checks the
 * current stock permission for the record's branch before any replay lookup. Writes require an operation key.
 */
import { omit } from 'convex-helpers';
import { paginationOptsValidator, paginationResultValidator } from 'convex/server';
import { v } from 'convex/values';
import { staffMutation, staffQuery } from '../auth/model';
import {
  findPurchaseReference, getOrder, getOrderRevision, getReceipt, getRequest, listHistory, listHolds, listOrderReceipts, listOrderRevisions,
  listOrders, listReceiptAdjustments, listReceipts, listRequests, listSuppliers, previewCorrection, readIncomingFor,
} from './private/purchasingReads';
import { amendOrder, closeOrderRemainder, deleteOrderDraft, issueOrder, saveOrderDraft } from './private/purchasingOrders';
import {
  correctReceiptLine, declineHold, receiveDirect, receiveOrder, returnToSupplier, reverseSupplierReturn, updateReceiptDetails,
} from './private/purchasingReceipts';
import {
  approveRequest, closeRequest, declineRequest, deleteRequest, saveRequestDraft, sendBackRequest, submitRequest, withdrawRequest,
} from './private/purchasingRequests';
import { createSupplier, updateSupplier } from './private/purchasingSuppliers';
import {
  adjustmentLotEvidence, correctionBlock, correctionResult, followUpLink, holdFields, holdStatus, historyChange, orderFields, orderLineFields, orderPhase, orderRevisionFields, orderStatus,
  purchasingEntity, purchasingResult, receiptAdjustmentFields, receiptFields, receiptLineFields, requestFields,
  receiptLotEvidence, requestLineFields, requestStatus, supplierFields, supplierStatus, undercountLink,
} from './purchasingTables';

const key = { operationKey: v.string() };
const paged = { paginationOpts: paginationOptsValidator };

// ---------- Published row shapes (actor keys never leave the server) ----------

const system = <T extends 'purchaseRequests' | 'purchaseRequestLines' | 'purchaseOrders' | 'purchaseOrderLines' | 'purchaseOrderRevisions' | 'supplierReceipts' | 'supplierReceiptLines' | 'supplierReceiptAdjustments' | 'purchaseHolds' | 'suppliers' | 'purchaseEvents'>(table: T) =>
  ({ _id: v.id(table), _creationTime: v.number() });

const requestPublic = omit(requestFields, ['requesterKey', 'decidedByKey']);
const requestLinePublic = omit(requestLineFields, ['requesterKey']);
const orderPublic = omit(orderFields, ['createdByKey']);
const receiptPublic = omit(receiptFields, ['actorKey', 'deliveryKey']);
const adjustmentPublic = omit(receiptAdjustmentFields, ['actorKey']);
const holdPublic = omit(holdFields, ['resolvedByKey']);
const revisionPublic = omit(orderRevisionFields, ['actorKey']);

export const requestRowValidator = v.object({ ...system('purchaseRequests'), ...requestPublic, mine: v.boolean() });
export const requestLineRowValidator = v.object({ ...system('purchaseRequestLines'), ...requestLinePublic, available: v.number() });
export const orderRowValidator = v.object({ ...system('purchaseOrders'), ...orderPublic });
export const orderLineRowValidator = v.object({ ...system('purchaseOrderLines'), ...orderLineFields, due: v.number() });
export const orderListRowValidator = v.object({ ...system('purchaseOrders'), ...orderPublic, line: v.union(orderLineRowValidator, v.null()) });
export const receiptRowValidator = v.object({ ...system('supplierReceipts'), ...receiptPublic });
export const receiptLineRowValidator = v.object({ ...system('supplierReceiptLines'), ...receiptLineFields, eligible: v.number() });
export const adjustmentRowValidator = v.object({ ...system('supplierReceiptAdjustments'), ...adjustmentPublic });
export const holdRowValidator = v.object({ ...system('purchaseHolds'), ...holdPublic });
export const supplierRowValidator = v.object({ ...system('suppliers'), ...supplierFields });
export const permissionsValidator = v.object({
  requester: v.boolean(), approver: v.boolean(), buyer: v.boolean(), receiver: v.boolean(), lead: v.boolean(),
  directOrder: v.boolean(), directReceipt: v.boolean(),
});
export const historyRowValidator = v.object({
  ...system('purchaseEvents'), entity: purchasingEntity, entityId: v.string(), branchId: v.optional(v.id('branches')),
  action: v.string(), reason: v.optional(v.string()), changes: v.optional(v.array(historyChange)),
  relatedId: v.optional(v.string()), actorLabel: v.string(), createdAt: v.number(),
});

export const purchaseReference = staffQuery({
  capability: 'checkout', scope: 'selectedBranch',
  args: { branchId: v.id('branches'), reference: v.string() },
  returns: v.object({ request: v.union(requestRowValidator, v.null()), order: v.union(orderRowValidator, v.null()) }),
  handler: (ctx, { branchId, reference }) => findPurchaseReference(ctx, ctx.staff, branchId, reference),
});

// ---------- Requests ----------

const requestView = v.union(
  v.object({ kind: v.literal('mine') }), v.object({ kind: v.literal('all') }),
  v.object({ kind: v.literal('status'), status: requestStatus }),
  v.object({ kind: v.literal('item'), variantId: v.id('productVariants') }),
);

export const requests = staffQuery({
  capability: 'checkout', scope: 'selectedBranch',
  args: { branchId: v.id('branches'), view: requestView, ...paged },
  returns: paginationResultValidator(requestRowValidator),
  handler: (ctx, args) => listRequests(ctx, ctx.staff, args),
});

export const request = staffQuery({
  capability: 'checkout', scope: 'selectedBranch',
  args: { requestId: v.id('purchaseRequests') },
  returns: v.object({
    request: requestRowValidator, lines: v.array(requestLineRowValidator), orders: v.array(orderRowValidator), permissions: permissionsValidator,
  }),
  handler: (ctx, { requestId }) => getRequest(ctx, ctx.staff, requestId),
});

const requestLineInput = v.object({ variantId: v.id('productVariants'), quantity: v.number() });
const transition = { requestId: v.id('purchaseRequests'), expectedRevision: v.number(), ...key };

export const saveRequest = staffMutation({
  capability: 'checkout', scope: 'selectedBranch',
  args: {
    branchId: v.id('branches'), requestId: v.optional(v.id('purchaseRequests')), expectedRevision: v.optional(v.number()),
    needBy: v.optional(v.string()), note: v.optional(v.string()), lines: v.array(requestLineInput), ...key,
  },
  returns: purchasingResult,
  handler: (ctx, args) => saveRequestDraft(ctx, ctx.staff, args),
});

export const submitRequestForApproval = staffMutation({
  capability: 'checkout', scope: 'selectedBranch', args: transition, returns: purchasingResult,
  handler: (ctx, args) => submitRequest(ctx, ctx.staff, args),
});

export const withdrawPendingRequest = staffMutation({
  capability: 'checkout', scope: 'selectedBranch', args: transition, returns: purchasingResult,
  handler: (ctx, args) => withdrawRequest(ctx, ctx.staff, args),
});

/** Delete a draft or discard a request that needs changes (reason required for the latter). */
export const removeRequest = staffMutation({
  capability: 'checkout', scope: 'selectedBranch', args: { ...transition, reason: v.optional(v.string()) }, returns: purchasingResult,
  handler: (ctx, args) => deleteRequest(ctx, ctx.staff, args),
});

export const approvePurchaseRequest = staffMutation({
  capability: 'checkout', scope: 'selectedBranch',
  args: { ...transition, lines: v.optional(v.array(v.object({ lineId: v.id('purchaseRequestLines'), approvedQuantity: v.number() }))) },
  returns: purchasingResult,
  handler: (ctx, args) => approveRequest(ctx, ctx.staff, args),
});

export const sendBackPurchaseRequest = staffMutation({
  capability: 'checkout', scope: 'selectedBranch', args: { ...transition, reason: v.string() }, returns: purchasingResult,
  handler: (ctx, args) => sendBackRequest(ctx, ctx.staff, args),
});

export const declinePurchaseRequest = staffMutation({
  capability: 'checkout', scope: 'selectedBranch', args: { ...transition, reason: v.string() }, returns: purchasingResult,
  handler: (ctx, args) => declineRequest(ctx, ctx.staff, args),
});

export const closePurchaseRequest = staffMutation({
  capability: 'checkout', scope: 'selectedBranch', args: { ...transition, reason: v.string() }, returns: purchasingResult,
  handler: (ctx, args) => closeRequest(ctx, ctx.staff, args),
});

// ---------- Orders ----------

const orderView = v.union(
  v.object({ kind: v.literal('phase'), phase: orderPhase }),
  v.object({ kind: v.literal('status'), status: orderStatus }),
  v.object({ kind: v.literal('supplier'), supplierId: v.id('suppliers') }),
  v.object({ kind: v.literal('item'), variantId: v.id('productVariants'), openOnly: v.boolean() }),
  v.object({ kind: v.literal('openSearch'), search: v.string() }),
);

export const orders = staffQuery({
  capability: 'checkout', scope: 'selectedBranch',
  args: { branchId: v.id('branches'), view: orderView, ...paged },
  returns: paginationResultValidator(orderListRowValidator),
  handler: (ctx, args) => listOrders(ctx, ctx.staff, args),
});

export const revisionSummaryValidator = v.object({ revision: v.number(), issuedAt: v.number(), actorLabel: v.string(), reason: v.optional(v.string()) });
/** An open hold this order can accept now, on `orderLineId`: received on this order, or the hold a replacement was raised for. */
export const acceptableHoldValidator = v.object({
  holdId: v.id('purchaseHolds'), holdRevision: v.number(), orderLineId: v.id('purchaseOrderLines'), variantId: v.id('productVariants'),
  remaining: v.number(), due: v.number(), link: v.union(v.literal('own_order'), v.literal('replacement')),
});

/** Order header, current lines and held goods. */
export const order = staffQuery({
  capability: 'checkout', scope: 'selectedBranch',
  args: { orderId: v.id('purchaseOrders') },
  returns: v.object({
    order: orderRowValidator, lines: v.array(orderLineRowValidator), holds: v.array(holdRowValidator),
    acceptableHolds: v.array(acceptableHoldValidator), permissions: permissionsValidator,
  }),
  handler: (ctx, { orderId }) => getOrder(ctx, ctx.staff, orderId),
});

/** Every issued revision, newest first; open one with `orderRevision` to print it. */
export const orderRevisions = staffQuery({
  capability: 'checkout', scope: 'selectedBranch',
  args: { orderId: v.id('purchaseOrders'), ...paged },
  returns: paginationResultValidator(revisionSummaryValidator),
  handler: (ctx, { orderId, paginationOpts }) => listOrderRevisions(ctx, ctx.staff, orderId, paginationOpts),
});

/** Supplier-facing copy of one issued revision, for print or download. */
export const orderRevision = staffQuery({
  capability: 'checkout', scope: 'selectedBranch',
  args: { orderId: v.id('purchaseOrders'), revision: v.number() },
  returns: v.object({ ...system('purchaseOrderRevisions'), ...revisionPublic, branchName: v.string() }),
  handler: (ctx, { orderId, revision }) => getOrderRevision(ctx, ctx.staff, orderId, revision),
});

export const receipts = staffQuery({
  capability: 'checkout', scope: 'selectedBranch',
  args: {
    branchId: v.id('branches'),
    match: v.optional(v.object({ kind: v.union(v.literal('receipt'), v.literal('delivery')), reference: v.string() })),
    ...paged,
  },
  returns: paginationResultValidator(receiptRowValidator),
  handler: (ctx, args) => listReceipts(ctx, ctx.staff, args),
});

export const orderReceipts = staffQuery({
  capability: 'checkout', scope: 'selectedBranch',
  args: { orderId: v.id('purchaseOrders'), ...paged },
  returns: paginationResultValidator(receiptRowValidator),
  handler: (ctx, { orderId, paginationOpts }) => listOrderReceipts(ctx, ctx.staff, orderId, paginationOpts),
});

const orderAction = { orderId: v.id('purchaseOrders'), expectedRevision: v.number(), ...key };

export const saveOrder = staffMutation({
  capability: 'checkout', scope: 'selectedBranch',
  args: {
    branchId: v.id('branches'), orderId: v.optional(v.id('purchaseOrders')), expectedRevision: v.optional(v.number()),
    supplierId: v.id('suppliers'), requestId: v.optional(v.id('purchaseRequests')),
    expectedDate: v.optional(v.string()), supplierReference: v.optional(v.string()), note: v.optional(v.string()),
    replacesReturnId: v.optional(v.id('supplierReceiptAdjustments')), forHoldId: v.optional(v.id('purchaseHolds')),
    lines: v.array(v.object({
      variantId: v.id('productVariants'), quantity: v.number(), unitCost: v.optional(v.number()),
      requestLineId: v.optional(v.id('purchaseRequestLines')),
    })),
    ...key,
  },
  returns: purchasingResult,
  handler: (ctx, args) => saveOrderDraft(ctx, ctx.staff, args),
});

export const issuePurchaseOrder = staffMutation({
  capability: 'checkout', scope: 'selectedBranch', args: orderAction, returns: purchasingResult,
  handler: (ctx, args) => issueOrder(ctx, ctx.staff, args),
});

export const deletePurchaseOrderDraft = staffMutation({
  capability: 'checkout', scope: 'selectedBranch', args: orderAction, returns: purchasingResult,
  handler: (ctx, args) => deleteOrderDraft(ctx, ctx.staff, args),
});

export const amendPurchaseOrder = staffMutation({
  capability: 'checkout', scope: 'selectedBranch',
  args: {
    ...orderAction, reason: v.string(), expectedDate: v.optional(v.string()), supplierReference: v.optional(v.string()),
    lines: v.array(v.object({ orderLineId: v.id('purchaseOrderLines'), due: v.optional(v.number()), unitCost: v.optional(v.number()) })),
  },
  returns: purchasingResult,
  handler: (ctx, args) => amendOrder(ctx, ctx.staff, args),
});

export const closePurchaseOrderRemainder = staffMutation({
  capability: 'checkout', scope: 'selectedBranch', args: { ...orderAction, reason: v.string() }, returns: purchasingResult,
  handler: (ctx, args) => closeOrderRemainder(ctx, ctx.staff, args),
});

// ---------- Receiving, corrections, returns and holds ----------

const duplicateConfirmation = v.optional(v.object({ receiptId: v.id('supplierReceipts'), reason: v.string() }));
const heldInput = v.optional(v.array(v.object({ variantId: v.id('productVariants'), quantity: v.number(), reason: v.string() })));
/**
 * `followUp` closes an open correction (wrong item or wrong branch): name the actually received item and exactly the
 * corrected quantity. A correction at another branch also needs the stock lead grant there.
 * `undercount` receives units an earlier receipt at this branch missed: same order, or for a receipt without an order a
 * direct receipt from the same supplier (or both supplierless); accepted items must be on it. Not combinable with `followUp`.
 * Received plus held lines are at most 50 entries; lot evidence across the receipt is at most 100 entries.
 */
const receiptCommon = {
  deliveryReference: v.optional(v.string()), note: v.optional(v.string()), confirmDuplicate: duplicateConfirmation,
  followUp: v.optional(followUpLink), undercount: v.optional(undercountLink), held: heldInput, ...key,
};

/** Receive against an order. The shared Receive form posts here when an order is chosen. */
export const receivePurchaseOrder = staffMutation({
  capability: 'checkout', scope: 'selectedBranch',
  args: {
    ...receiptCommon, orderId: v.id('purchaseOrders'), expectedIssuedRevision: v.number(), reason: v.optional(v.string()),
    lines: v.array(v.object({
      orderLineId: v.id('purchaseOrderLines'), accepted: v.number(), rejected: v.optional(v.number()),
      rejectReason: v.optional(v.string()), holdId: v.optional(v.id('purchaseHolds')), ...receiptLotEvidence,
    })),
  },
  returns: purchasingResult,
  handler: (ctx, args) => receiveOrder(ctx, ctx.staff, args),
});

/** Receive without PO: an allowed unplanned supplier delivery. Opening stock stays on core's stock operations. */
export const receiveWithoutOrder = staffMutation({
  capability: 'checkout', scope: 'selectedBranch',
  args: {
    ...receiptCommon, branchId: v.id('branches'), supplierId: v.optional(v.id('suppliers')), reason: v.string(),
    bypassOpenOrders: v.optional(v.boolean()),
    lines: v.array(v.object({ variantId: v.id('productVariants'), accepted: v.number(), unitCost: v.optional(v.number()), ...receiptLotEvidence })),
  },
  returns: purchasingResult,
  handler: (ctx, args) => receiveDirect(ctx, ctx.staff, args),
});

/** Receipt header, accepted lines and held goods. */
export const receipt = staffQuery({
  capability: 'checkout', scope: 'selectedBranch',
  args: { receiptId: v.id('supplierReceipts') },
  returns: v.object({
    receipt: receiptRowValidator, lines: v.array(receiptLineRowValidator),
    holds: v.array(holdRowValidator), permissions: permissionsValidator,
  }),
  handler: (ctx, { receiptId }) => getReceipt(ctx, ctx.staff, receiptId),
});

export const updateReceipt = staffMutation({
  capability: 'checkout', scope: 'selectedBranch',
  args: {
    receiptId: v.id('supplierReceipts'), expectedRevision: v.number(), deliveryReference: v.optional(v.string()),
    note: v.optional(v.string()), confirmDuplicate: duplicateConfirmation, ...key,
  },
  returns: purchasingResult,
  handler: (ctx, args) => updateReceiptDetails(ctx, ctx.staff, args),
});

export const receiptAdjustments = staffQuery({
  capability: 'checkout', scope: 'selectedBranch',
  args: { receiptId: v.id('supplierReceipts'), ...paged },
  returns: paginationResultValidator(adjustmentRowValidator),
  handler: (ctx, { receiptId, paginationOpts }) => listReceiptAdjustments(ctx, ctx.staff, receiptId, paginationOpts),
});

export const correctionPreview = staffQuery({
  capability: 'checkout', scope: 'selectedBranch',
  args: { receiptLineId: v.id('supplierReceiptLines'), quantity: v.number() },
  returns: v.object({
    eligible: v.number(), onHand: v.number(), onHandAfter: v.number(), negative: v.boolean(),
    stockRevision: v.number(), blockedBy: v.union(correctionBlock, v.null()), reportId: v.union(v.id('stockProblemReports'), v.null()),
    dueBefore: v.union(v.number(), v.null()), dueAfter: v.union(v.number(), v.null()), remainderClosed: v.boolean(),
  }),
  handler: (ctx, args) => previewCorrection(ctx, ctx.staff, args),
});

/** Returns `outcome: 'reported'` (nothing posted, report opened or refreshed) or `outcome: 'posted'`. */
export const correctReceipt = staffMutation({
  capability: 'checkout', scope: 'selectedBranch',
  args: {
    receiptLineId: v.id('supplierReceiptLines'), quantity: v.number(), reason: v.string(),
    negativeOverride: v.optional(v.object({ countedOnHand: v.number(), stockRevision: v.number() })),
    reportId: v.optional(v.id('stockProblemReports')), ...adjustmentLotEvidence, ...key,
  },
  returns: correctionResult,
  handler: (ctx, args) => correctReceiptLine(ctx, ctx.staff, args),
});

export const supplierReturn = staffMutation({
  capability: 'checkout', scope: 'selectedBranch',
  args: {
    receiptLineId: v.id('supplierReceiptLines'), quantity: v.number(), reason: v.string(), supplierReference: v.optional(v.string()),
    ...adjustmentLotEvidence, ...key,
  },
  returns: purchasingResult,
  handler: (ctx, args) => returnToSupplier(ctx, ctx.staff, args),
});

export const reverseReturn = staffMutation({
  capability: 'checkout', scope: 'selectedBranch',
  args: { adjustmentId: v.id('supplierReceiptAdjustments'), quantity: v.number(), reason: v.string(), ...adjustmentLotEvidence, ...key },
  returns: purchasingResult,
  handler: (ctx, args) => reverseSupplierReturn(ctx, ctx.staff, args),
});

export const holds = staffQuery({
  capability: 'checkout', scope: 'selectedBranch',
  args: { branchId: v.id('branches'), status: holdStatus, ...paged },
  returns: paginationResultValidator(holdRowValidator),
  handler: (ctx, args) => listHolds(ctx, ctx.staff, args),
});

export const declineHeldGoods = staffMutation({
  capability: 'checkout', scope: 'selectedBranch',
  args: { holdId: v.id('purchaseHolds'), expectedRevision: v.number(), reason: v.string(), ...key },
  returns: purchasingResult,
  handler: (ctx, args) => declineHold(ctx, ctx.staff, args),
});

// ---------- Suppliers, On order and history ----------

const supplierInput = {
  name: v.string(), contactName: v.optional(v.string()), phone: v.optional(v.string()),
  email: v.optional(v.string()), note: v.optional(v.string()),
};

/** Contact details, on the master and on order, revision and receipt snapshots, are returned to buyers only. */
export const suppliers = staffQuery({
  capability: 'checkout', scope: 'selectedBranch',
  args: { branchId: v.id('branches'), search: v.optional(v.string()), status: supplierStatus, ...paged },
  returns: paginationResultValidator(supplierRowValidator),
  handler: (ctx, args) => listSuppliers(ctx, ctx.staff, args),
});

export const addSupplier = staffMutation({
  capability: 'checkout', scope: 'selectedBranch', args: { branchId: v.id('branches'), ...supplierInput, ...key }, returns: purchasingResult,
  handler: (ctx, args) => createSupplier(ctx, ctx.staff, args),
});

export const editSupplier = staffMutation({
  capability: 'checkout', scope: 'selectedBranch',
  args: {
    branchId: v.id('branches'), supplierId: v.id('suppliers'), expectedRevision: v.number(),
    status: v.optional(supplierStatus), ...supplierInput, ...key,
  },
  returns: purchasingResult,
  handler: (ctx, args) => updateSupplier(ctx, ctx.staff, args),
});

export const incoming = staffQuery({
  capability: 'checkout', scope: 'selectedBranch',
  args: { branchId: v.id('branches'), variantIds: v.array(v.id('productVariants')) },
  returns: v.array(v.object({ variantId: v.id('productVariants'), quantity: v.number() })),
  handler: (ctx, args) => readIncomingFor(ctx, ctx.staff, args),
});

export const history = staffQuery({
  capability: 'checkout', scope: 'selectedBranch',
  args: { branchId: v.id('branches'), entity: purchasingEntity, entityId: v.string(), ...paged },
  returns: paginationResultValidator(historyRowValidator),
  handler: (ctx, args) => listHistory(ctx, ctx.staff, args),
});
