/**
 * Stock › Purchasing endpoints. Every call authenticates staff for the selected branch, then the handler checks the
 * current stock permission for the record's branch before any replay lookup. Writes require an operation key.
 */
import { omit } from 'convex-helpers';
import { paginationOptsValidator, paginationResultValidator } from 'convex/server';
import { v } from 'convex/values';
import { internalMutation, staffMutation, staffQuery } from '../auth/model';
import {
  approverCoverage, findPurchaseReference, getOrder, getOrderRevision, getReceipt, getRequest, listHistory, myRequestCounts, listHolds, countOpenHolds, supplierRejections, supplierRow, listOrderReceipts, listOrderRevisions,
  listOrders, listReceiptAdjustments, listReceipts, listRequests, listSuppliers, previewCorrection, readIncomingFor, resolveQueueFilter,
} from './private/purchasingReads';
import { purchasingAccess } from './private/purchasingCore';
import {
  amendOrder, approveOrderIssue, backfillLegacyPage, closeOrderRemainder, declineOrderIssue, deleteOrderDraft, issueOrder, saveOrderDraft,
} from './private/purchasingOrders';
import {
  acceptHoldOnOrder, correctReceiptLine, declineHold, receiveDirect, receiveOrder, recordHoldHandoff, returnToSupplier, reverseSupplierReturn,
  updateReceiptDetails,
} from './private/purchasingReceipts';
import {
  approveRequest, closeRequest, copyRequest, declineRequest, deleteRequest, saveRequestDraft, sendBackRequest, submitRequest, withdrawRequest,
} from './private/purchasingRequests';
import { createSupplier, updateSupplier, similarSuppliers, supplierStatusImpact, supplierContactKeys } from './private/purchasingSuppliers';
import { projectSupplierDelivery, projectSupplierOrder } from './private/supplierActivity';
import {
  adjustmentLotEvidence, correctionBlock, correctionResult, followUpLink, holdFields, holdStatus, historyChange, itemSnapshot, orderFields, orderLineFields, orderPhase, orderRevisionFields, orderStatus,
  purchasingEntity, purchasingResult, receiptAdjustmentFields, receiptFields, receiptLineFields, requestFields,
  receiptLotEvidence, rejectReasonCode, requestLineFields, requestStatus, returnOutcome, supplierFields, supplierStatus, supplierTerms, undercountLink,
} from './purchasingTables';
import { lotReceipt } from './stockExpansionTables';

const key = { operationKey: v.string() };
const paged = { paginationOpts: paginationOptsValidator };

// ---------- Published row shapes (actor keys never leave the server) ----------

const system = <T extends 'purchaseRequests' | 'purchaseRequestLines' | 'purchaseOrders' | 'purchaseOrderLines' | 'purchaseOrderRevisions' | 'supplierReceipts' | 'supplierReceiptLines' | 'supplierReceiptAdjustments' | 'purchaseHolds' | 'suppliers' | 'purchaseEvents'>(table: T) =>
  ({ _id: v.id(table), _creationTime: v.number() });

const requestPublic = omit(requestFields, ['requesterKey', 'decidedByKey']);
const requestLinePublic = omit(requestLineFields, ['requesterKey']);
const orderPublic = omit(orderFields, ['createdByKey', 'approvalRequestedByKey', 'supplierActivityApplied']);
const receiptPublic = omit(receiptFields, ['actorKey', 'deliveryKey', 'supplierActivityApplied']);
const adjustmentPublic = omit(receiptAdjustmentFields, ['actorKey']);
const holdPublic = omit(holdFields, ['resolvedByKey']);
const revisionPublic = omit(orderRevisionFields, ['actorKey']);

export const requestRowValidator = v.object({ ...system('purchaseRequests'), ...requestPublic, mine: v.boolean() });
export const requestLineRowValidator = v.object({ ...system('purchaseRequestLines'), ...requestLinePublic, available: v.number() });
export const orderRowValidator = v.object({ ...system('purchaseOrders'), ...orderPublic, totalCost: v.optional(v.number()) });
export const orderLineRowValidator = v.object({ ...system('purchaseOrderLines'), ...orderLineFields, due: v.number() });
export const orderListRowValidator = v.object({ ...system('purchaseOrders'), ...orderPublic, totalCost: v.optional(v.number()), line: v.union(orderLineRowValidator, v.null()) });
export const receiptRowValidator = v.object({ ...system('supplierReceipts'), ...receiptPublic });
export const receiptLineRowValidator = v.object({ ...system('supplierReceiptLines'), ...receiptLineFields, eligible: v.number() });
export const adjustmentRowValidator = v.object({ ...system('supplierReceiptAdjustments'), ...adjustmentPublic });
export const holdRowValidator = v.object({ ...system('purchaseHolds'), ...holdPublic });
export const supplierRowValidator = v.object({
  ...system('suppliers'), ...omit(supplierFields, ['contactKeysApplied', 'emailKey', 'phoneKey']),
  openOrders: v.optional(v.number()), lastDeliveryAt: v.optional(v.number()), activityPending: v.optional(v.boolean()),
  datedDeliveries: v.optional(v.number()), onTimeDeliveries: v.optional(v.number()), rejectedUnits: v.optional(v.number()),
});
export const permissionsValidator = v.object({
  requester: v.boolean(), approver: v.boolean(), buyer: v.boolean(), receiver: v.boolean(), lead: v.boolean(),
  directOrder: v.boolean(), directReceipt: v.boolean(),
  /** Branch purchasing policies: the issuer may not receive; direct orders above the limit (satang) need approval. */
  separateReceiving: v.boolean(), directOrderLimit: v.union(v.number(), v.null()),
  /** Buyers, approvers and stock leads see order costs and values; others get them omitted. */
  seeCosts: v.boolean(),
});
/** Approver context for one request line at the request's branch. `lastUnitCost` is for branch-wide roles only. */
export const requestLineContextValidator = v.object({
  onHand: v.number(), onOrder: v.number(), otherDemand: v.number(), lastUnitCost: v.optional(v.number()),
});
export const historyRowValidator = v.object({
  ...system('purchaseEvents'), entity: purchasingEntity, entityId: v.string(), branchId: v.optional(v.id('branches')),
  action: v.string(), reason: v.optional(v.string()), changes: v.optional(v.array(historyChange)),
  relatedId: v.optional(v.string()), actorLabel: v.string(), createdAt: v.number(),
});

export const queueFilter = staffQuery({
  capability: 'checkout', scope: 'selectedBranch',
  args: { branchId: v.id('branches'), variant: v.optional(v.string()), supplier: v.optional(v.string()) },
  returns: v.object({
    variantId: v.union(v.id('productVariants'), v.null()),
    supplier: v.union(v.object({ id: v.id('suppliers'), name: v.string() }), v.null()),
  }),
  handler: (ctx, args) => resolveQueueFilter(ctx, ctx.staff, args),
});

export const purchaseReference = staffQuery({
  capability: 'checkout', scope: 'selectedBranch',
  args: { branchId: v.id('branches'), reference: v.string() },
  returns: v.object({
    request: v.union(requestRowValidator, v.null()), order: v.union(orderRowValidator, v.null()),
    /** Up to 10 matches by reference start or 5-character code. */
    requests: v.array(requestRowValidator), orders: v.array(orderRowValidator),
  }),
  handler: (ctx, { branchId, reference }) => findPurchaseReference(ctx, ctx.staff, branchId, reference),
});

// ---------- Requests ----------

const requestView = v.union(
  v.object({ kind: v.literal('mine') }), v.object({ kind: v.literal('all') }),
  v.object({ kind: v.literal('status'), status: requestStatus }),
  v.object({ kind: v.literal('item'), variantId: v.id('productVariants') }),
  v.object({ kind: v.literal('mineStatus'), status: requestStatus }),
  v.object({ kind: v.literal('approvalQueue') }),
  v.object({ kind: v.literal('approved'), fullyOrdered: v.boolean() }),
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
    request: requestRowValidator,
    lines: v.array(v.object({ ...requestLineRowValidator.fields, context: requestLineContextValidator })),
    orders: v.array(orderRowValidator), permissions: permissionsValidator,
  }),
  handler: (ctx, { requestId }) => getRequest(ctx, ctx.staff, requestId),
});

/** The caller's own Needs changes and Draft counts at the branch (each capped at 100). */
export const myRequestCountsAt = staffQuery({
  capability: 'checkout', scope: 'selectedBranch',
  args: { branchId: v.id('branches') },
  returns: v.object({ needsChanges: v.number(), drafts: v.number() }),
  handler: (ctx, { branchId }) => myRequestCounts(ctx, ctx.staff, branchId),
});

/** How many other bound approvers the branch has, so a requester learns early that nobody can approve their request. */
export const requestApproverCoverage = staffQuery({
  capability: 'checkout', scope: 'selectedBranch',
  args: { branchId: v.id('branches') },
  returns: v.object({ otherApprovers: v.number(), branchName: v.string(), canManageAccess: v.boolean() }),
  handler: (ctx, { branchId }) => approverCoverage(ctx, ctx.staff, branchId),
});

/** Copy a declined, closed or sent-back request into a new draft (archived items are skipped). */
export const copyPurchaseRequest = staffMutation({
  capability: 'checkout', scope: 'selectedBranch',
  args: { requestId: v.id('purchaseRequests'), ...key }, returns: purchasingResult,
  handler: (ctx, args) => copyRequest(ctx, ctx.staff, args),
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
  v.object({ kind: v.literal('overdue') }),
  v.object({ kind: v.literal('dueSoon') }),
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
    sourceRequest: v.union(v.object({ id: v.id('purchaseRequests'), reference: v.string(), status: requestStatus }), v.null()),
    /** Approved source-request lines an amendment may add (not yet on the order, approval left). */
    addableRequestLines: v.array(v.object({
      requestLineId: v.id('purchaseRequestLines'), variantId: v.id('productVariants'), item: itemSnapshot, available: v.number(),
    })),
    /** Branch over-delivery tolerance (whole percent, 0 = off) the receive form previews against. */
    overReceiptTolerancePct: v.number(),
    /** Supplier returns on this order still expecting a credit note. */
    returnsAwaitingCredit: v.object({ count: v.number(), units: v.number() }),
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
  returns: v.object({
    ...system('purchaseOrderRevisions'), ...revisionPublic, branchName: v.string(),
    /** Buyer details for the supplier copy, from current branch settings. */
    buyer: v.object({
      legalName: v.string(), taxId: v.optional(v.string()), address: v.optional(v.string()), branchCode: v.optional(v.string()),
      receivingContact: v.string(), receivingPhone: v.optional(v.string()), contactName: v.string(),
    }),
  }),
  handler: (ctx, { orderId, revision }) => getOrderRevision(ctx, ctx.staff, orderId, revision),
});

export const receipts = staffQuery({
  capability: 'checkout', scope: 'selectedBranch',
  args: {
    branchId: v.id('branches'),
    supplierId: v.optional(v.id('suppliers')),
    exceptionsOnly: v.optional(v.boolean()),
    match: v.optional(v.object({ kind: v.union(v.literal('receipt'), v.literal('delivery')), reference: v.string() })),
    ...paged,
  },
  returns: paginationResultValidator(receiptRowValidator),
  handler: (ctx, args) => listReceipts(ctx, ctx.staff, args),
});

export const orderReceipts = staffQuery({
  capability: 'checkout', scope: 'selectedBranch',
  args: { orderId: v.id('purchaseOrders'), ...paged },
  returns: paginationResultValidator(v.object({
    ...receiptRowValidator.fields, expectedDate: v.union(v.string(), v.null()), receivedOn: v.string(), lateDays: v.union(v.number(), v.null()),
  })),
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
      requestLineId: v.optional(v.id('purchaseRequestLines')), priceTbc: v.optional(v.boolean()),
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
    addLines: v.optional(v.array(v.object({
      variantId: v.id('productVariants'), quantity: v.number(), unitCost: v.optional(v.number()),
      requestLineId: v.optional(v.id('purchaseRequestLines')), priceTbc: v.optional(v.boolean()),
    }))),
  },
  returns: purchasingResult,
  handler: (ctx, args) => amendOrder(ctx, ctx.staff, args),
});

/** `closeRequestDemand` (stock lead only) also closes the source request's remaining demand. */
export const closePurchaseOrderRemainder = staffMutation({
  capability: 'checkout', scope: 'selectedBranch',
  args: { ...orderAction, reason: v.string(), closeRequestDemand: v.optional(v.boolean()) }, returns: purchasingResult,
  handler: (ctx, args) => closeOrderRemainder(ctx, ctx.staff, args),
});

/** A different approver issues a direct order that exceeded the branch's direct order limit. */
export const approvePurchaseOrderIssue = staffMutation({
  capability: 'checkout', scope: 'selectedBranch', args: orderAction, returns: purchasingResult,
  handler: (ctx, args) => approveOrderIssue(ctx, ctx.staff, args),
});

export const declinePurchaseOrderIssue = staffMutation({
  capability: 'checkout', scope: 'selectedBranch', args: { ...orderAction, reason: v.string() }, returns: purchasingResult,
  handler: (ctx, args) => declineOrderIssue(ctx, ctx.staff, args),
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
  /** Supplier invoice total (satang) for a price-variance check; stock is unchanged. */
  invoiceTotal: v.optional(v.number()),
};

/** Receive against an order. The shared Receive form posts here when an order is chosen. */
export const receivePurchaseOrder = staffMutation({
  capability: 'checkout', scope: 'selectedBranch',
  args: {
    ...receiptCommon, orderId: v.id('purchaseOrders'), expectedIssuedRevision: v.number(), reason: v.optional(v.string()),
    lines: v.array(v.object({
      orderLineId: v.id('purchaseOrderLines'), accepted: v.number(), rejected: v.optional(v.number()),
      rejectReason: v.optional(v.string()), rejectReasonCode: v.optional(rejectReasonCode),
      holdId: v.optional(v.id('purchaseHolds')), ...receiptLotEvidence,
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
    /** Required: credit note expected, replacement expected (a linked order follows) or no action. */
    outcome: returnOutcome,
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

const holdOrderRef = { orderId: v.id('purchaseOrders'), orderReference: v.string(), status: orderStatus };
/** How an open hold can be accepted now (null for resolved holds). */
export const holdAcceptPathValidator = v.union(
  v.object({ kind: v.literal('own_order'), ...holdOrderRef, orderLineId: v.id('purchaseOrderLines'), due: v.number() }),
  v.object({ kind: v.literal('no_due'), ...holdOrderRef }),
  v.object({ kind: v.literal('order_closed'), ...holdOrderRef }),
  v.object({ kind: v.literal('no_order') }),
  v.null(),
);
export const holdQueueRowValidator = v.object({
  ...system('purchaseHolds'), ...holdPublic, unresolved: v.number(), acceptPath: holdAcceptPathValidator,
});

/** Held goods queue. `receiptReference` (exact) or `variantId` narrows it through an index within the branch and status. */
export const holds = staffQuery({
  capability: 'checkout', scope: 'selectedBranch',
  args: {
    branchId: v.id('branches'), status: holdStatus, ...paged,
    receiptReference: v.optional(v.string()), variantId: v.optional(v.id('productVariants')),
  },
  returns: paginationResultValidator(holdQueueRowValidator),
  handler: (ctx, args) => listHolds(ctx, ctx.staff, args),
});

/**
 * Open held goods at the branch for the Stock nav badge; `capped` when there are more than `count`. `null` for branch
 * staff without stock permissions (no hold read); another branch stays forbidden.
 */
export const openHoldCount = staffQuery({
  capability: 'checkout', scope: 'selectedBranch',
  args: { branchId: v.id('branches') },
  returns: v.union(v.null(), v.object({ count: v.number(), capped: v.boolean() })),
  handler: (ctx, { branchId }) => countOpenHolds(ctx, ctx.staff, branchId),
});

const handoffInput = v.object({
  carrier: v.optional(v.string()), returnReference: v.optional(v.string()), note: v.optional(v.string()),
  /** Goods were handed over now; stamps the pickup time once. */
  collected: v.optional(v.boolean()),
});

export const declineHeldGoods = staffMutation({
  capability: 'checkout', scope: 'selectedBranch',
  args: { holdId: v.id('purchaseHolds'), expectedRevision: v.number(), reason: v.string(), handoff: v.optional(handoffInput), ...key },
  returns: purchasingResult,
  handler: (ctx, args) => declineHold(ctx, ctx.staff, args),
});

/** Add or complete the pickup evidence of declined held goods. */
export const recordHeldGoodsHandoff = staffMutation({
  capability: 'checkout', scope: 'selectedBranch',
  args: { holdId: v.id('purchaseHolds'), expectedRevision: v.number(), handoff: handoffInput, ...key },
  returns: purchasingResult,
  handler: (ctx, args) => recordHoldHandoff(ctx, ctx.staff, args),
});

/** Buyer accepts held goods onto their own open order line from the queue: On hand rises and the hold closes as accepted. */
export const acceptHeldGoods = staffMutation({
  capability: 'checkout', scope: 'selectedBranch',
  args: {
    holdId: v.id('purchaseHolds'), expectedRevision: v.number(), quantity: v.optional(v.number()),
    lotReceipt: v.optional(lotReceipt), ...key,
  },
  returns: purchasingResult,
  handler: (ctx, args) => acceptHoldOnOrder(ctx, ctx.staff, args),
});

/** Rejected units by reason code for a supplier over its recent receipts at the branch. */
export const supplierRejectionSummary = staffQuery({
  capability: 'checkout', scope: 'selectedBranch',
  args: { branchId: v.id('branches'), supplierId: v.id('suppliers') },
  returns: v.object({ receiptsScanned: v.number(), byReason: v.array(v.object({ reason: v.string(), units: v.number() })) }),
  handler: (ctx, args) => supplierRejections(ctx, ctx.staff, args),
});

// ---------- Suppliers, On order and history ----------

const supplierInput = {
  ...supplierTerms,
  name: v.string(), contactName: v.optional(v.string()), phone: v.optional(v.string()),
  email: v.optional(v.string()), note: v.optional(v.string()),
};

/** Contact details, on the master and on order, revision and receipt snapshots, are returned to buyers only. */
export const suppliers = staffQuery({
  capability: 'checkout', scope: 'selectedBranch',
  args: { branchId: v.id('branches'), search: v.optional(v.string()), status: v.union(supplierStatus, v.literal('all')), includeActivity: v.optional(v.boolean()), ...paged },
  returns: paginationResultValidator(supplierRowValidator),
  handler: (ctx, args) => listSuppliers(ctx, ctx.staff, args),
});

export const supplierMatches = staffQuery({
  capability: 'checkout', scope: 'selectedBranch',
  args: { branchId: v.id('branches'), name: v.string(), email: v.optional(v.string()), phone: v.optional(v.string()) },
  returns: v.array(supplierRowValidator),
  handler: async (ctx, args) => {
    await purchasingAccess(ctx, ctx.staff, args.branchId, 'buyer');
    return (await similarSuppliers(ctx, args)).map(supplier => supplierRow(supplier, true));
  },
});

export const supplierImpact = staffQuery({
  capability: 'checkout', scope: 'selectedBranch',
  args: { branchId: v.id('branches'), supplierId: v.id('suppliers') },
  returns: v.object({ organizationWide: v.boolean(), openOrders: v.optional(v.number()) }),
  handler: (ctx, { branchId, supplierId }) => supplierStatusImpact(ctx, ctx.staff, branchId, supplierId),
});

export const addSupplier = staffMutation({
  capability: 'checkout', scope: 'selectedBranch', args: { branchId: v.id('branches'), ...supplierInput, confirmSimilar: v.optional(v.boolean()), ...key }, returns: purchasingResult,
  handler: (ctx, args) => createSupplier(ctx, ctx.staff, args),
});

export const editSupplier = staffMutation({
  capability: 'checkout', scope: 'selectedBranch',
  args: {
    branchId: v.id('branches'), supplierId: v.id('suppliers'), expectedRevision: v.number(),
    status: v.optional(supplierStatus), statusReason: v.optional(v.string()), requestDeactivation: v.optional(v.boolean()), replaceTerms: v.optional(v.boolean()), ...supplierInput, ...key,
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


/** Repeat each source until isDone. Source markers and aggregate updates commit atomically. */
export const backfillSupplierData = internalMutation({
  args: { source: v.union(v.literal('orders'), v.literal('receipts'), v.literal('contacts')), dryRun: v.optional(v.boolean()) },
  returns: v.object({ processed: v.number(), isDone: v.boolean() }),
  handler: async (ctx, { source, dryRun }) => {
    const batchSize = 5;
    if (source === 'orders') {
      const rows = await ctx.db.query('purchaseOrders').withIndex('by_phase_activity', q =>
        q.eq('phase', 'open').eq('supplierActivityApplied', undefined)).take(batchSize + 1);
      if (!dryRun) for (const row of rows.slice(0, batchSize)) {
        await ctx.db.patch(row._id, await projectSupplierOrder(ctx, row, row.phase));
      }
      return { processed: Math.min(rows.length, batchSize), isDone: rows.length <= batchSize };
    }
    if (source === 'receipts') {
      const rows = await ctx.db.query('supplierReceipts').withIndex('by_activity', q =>
        q.eq('supplierActivityApplied', undefined)).take(batchSize + 1);
      if (!dryRun) for (const row of rows.slice(0, batchSize)) {
        const orderId = row.orderId;
        const revision = row.orderRevision;
        const issued = orderId !== undefined && revision !== undefined
          ? await ctx.db.query('purchaseOrderRevisions').withIndex('by_orderId_and_revision', q =>
            q.eq('orderId', orderId).eq('revision', revision)).unique()
          : null;
        await projectSupplierDelivery(ctx, row, issued?.expectedDate);
        await ctx.db.patch(row._id, { supplierActivityApplied: true });
      }
      return { processed: Math.min(rows.length, batchSize), isDone: rows.length <= batchSize };
    }
    const rows = await ctx.db.query('suppliers').withIndex('by_contact_keys_applied', q =>
      q.eq('contactKeysApplied', undefined)).take(batchSize + 1);
    if (!dryRun) for (const row of rows.slice(0, batchSize)) {
      await ctx.db.patch(row._id, supplierContactKeys(row));
    }
    return { processed: Math.min(rows.length, batchSize), isDone: rows.length <= batchSize };
  },
});

/**
 * Operator backfill for rows written before reference codes, receipt exception flags and order-line valuation existed.
 * Run per table until `isDone`, passing back `continueCursor`. Idempotent.
 */
export const backfillPurchasingLegacy = internalMutation({
  args: {
    table: v.union(v.literal('purchaseRequests'), v.literal('purchaseOrders'), v.literal('supplierReceipts')),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.object({ updated: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: (ctx, { table, cursor }) => backfillLegacyPage(ctx, table, cursor),
});
