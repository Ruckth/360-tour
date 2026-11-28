/**
 * Purchasing records: suppliers, purchase requests (PR), purchase orders (PO), supplier receipts, held goods and
 * the per-branch On order projection. Core Commerce owns balances, movements and stock access; the parent spreads
 * `purchasingTables` into `commerceTables`. Validators here are the published browser contract for Stock › Purchasing.
 */
import { defineTable } from 'convex/server';
import { v, type Infer } from 'convex/values';
import { lotAllocation, lotReceipt } from './stockExpansionTables';

export const PURCHASING_MAX_LINES = 50;
export const PURCHASING_PAGE_SIZE = 25;
export const PURCHASING_MAX_QUANTITY = 1_000_000;
/** Satang, per unit. */
export const PURCHASING_MAX_UNIT_COST = 100_000_000_00;
export const PURCHASING_TEXT_LIMITS = { name: 120, reference: 64, reason: 500, note: 2_000, contact: 200 } as const;
/** Lots one receipt, correction, return or reversal line may name. */
export const PURCHASING_MAX_LOTS_PER_LINE = 20;
/**
 * Lot evidence entries across one receipt: a `lotReceipt` counts 1 and each `lotAllocations` row counts 1. Each entry
 * costs core about 5 index ranges and 3 writes beyond an untracked line (bench: 50 untracked lines 208 ranges / 305
 * writes; 50 single-lot tracked lines 458 / 455, gated at 500 / 500). 100 entries stay under ~725 ranges and ~650 writes,
 * far inside Convex transaction limits. Larger lot splits go on a second receipt.
 */
export const PURCHASING_MAX_RECEIPT_LOTS = 100;

/**
 * Lot evidence for a tracked item, passed to core `writeStockMovement`. A receipt line names either a new or existing
 * lot (`lotReceipt`) or explicit existing lots (`lotAllocations`); untracked items must omit both. Corrections,
 * supplier returns and reversals trace the original movement and may name the actual lots (`lotAllocations`).
 */
export const receiptLotEvidence = { lotReceipt: v.optional(lotReceipt), lotAllocations: v.optional(v.array(lotAllocation)) };
export const adjustmentLotEvidence = { lotAllocations: v.optional(v.array(lotAllocation)) };
export type ReceiptLotEvidence = { lotReceipt?: Infer<typeof lotReceipt>; lotAllocations?: Infer<typeof lotAllocation>[] };

export const requestStatus = v.union(
  v.literal('draft'), v.literal('awaiting_approval'), v.literal('approved'), v.literal('needs_changes'),
  v.literal('declined'), v.literal('closed'), v.literal('deleted'),
);
export const orderStatus = v.union(
  v.literal('draft'), v.literal('ordered'), v.literal('partially_received'), v.literal('received'),
  v.literal('closed_short'), v.literal('cancelled'), v.literal('deleted'),
  /** A direct order above the branch limit waits for a different approver before it is issued (draft phase). */
  v.literal('awaiting_approval'),
);
/** Coarse list bucket: open covers Ordered and Partially received. */
export const orderPhase = v.union(v.literal('draft'), v.literal('open'), v.literal('closed'), v.literal('deleted'));
export const supplierStatus = v.union(v.literal('active'), v.literal('inactive'));
export const receiptKind = v.union(v.literal('order'), v.literal('direct'), v.literal('rejected'));
/** Fixed rejection reasons at the door, so supplier quality can be counted (free text stays beside the code). */
export const REJECT_REASON_CODES = ['damaged', 'expired', 'wrong_item', 'not_ordered', 'quality'] as const;
export const rejectReasonCode = v.union(
  v.literal('damaged'), v.literal('expired'), v.literal('wrong_item'), v.literal('not_ordered'), v.literal('quality'),
);
export type RejectReasonCode = Infer<typeof rejectReasonCode>;
/** What the supplier will do about returned goods. Older returns have none. */
export const returnOutcome = v.union(v.literal('credit_expected'), v.literal('replacement_expected'), v.literal('no_action'));
/** Optional evidence when declined held goods leave: carrier, supplier return reference, note and the pickup time. */
export const holdHandoff = v.object({
  carrier: v.optional(v.string()), returnReference: v.optional(v.string()), note: v.optional(v.string()),
  collectedAt: v.optional(v.number()),
});
export const holdStatus = v.union(v.literal('open'), v.literal('accepted'), v.literal('declined'));
export const receiptAdjustmentKind = v.union(
  v.literal('correction'), v.literal('supplier_return'), v.literal('return_reversal'),
);
export const purchasingEntity = v.union(
  v.literal('request'), v.literal('order'), v.literal('receipt'), v.literal('supplier'), v.literal('hold'),
);
/** Movement kinds purchasing writes through core `writeStockMovement` (all in core `stockMovementKind`). */
export const PURCHASING_MOVEMENT_KINDS = {
  receive: 'purchase_receipt', direct: 'direct_receipt', correct: 'correction',
  supplierReturn: 'supplier_return', returnReversal: 'correction',
} as const;

export type RequestStatus = Infer<typeof requestStatus>;
export type OrderStatus = Infer<typeof orderStatus>;
export type OrderPhase = Infer<typeof orderPhase>;

/** Display snapshot captured when a line is written so lists never join products. */
export const itemSnapshot = v.object({ productName: v.string(), variantLabel: v.string(), sku: v.optional(v.string()) });
export const supplierTerms = {
  address: v.optional(v.string()), taxId: v.optional(v.string()),
  paymentTerms: v.optional(v.string()), leadTimeDays: v.optional(v.number()),
  deliveryDays: v.optional(v.string()), minimumOrder: v.optional(v.string()),
};
export const supplierSnapshot = v.object({
  ...supplierTerms,
  name: v.string(), contactName: v.optional(v.string()), phone: v.optional(v.string()), email: v.optional(v.string()),
});
export const actorFields = { actorKey: v.string(), actorLabel: v.string() };
export const historyValue = v.union(v.string(), v.number(), v.boolean(), v.null());
export const historyChange = v.object({ field: v.string(), before: historyValue, after: historyValue });

export const supplierFields = {
  contactKeysApplied: v.optional(v.boolean()),
  emailKey: v.optional(v.string()), phoneKey: v.optional(v.string()),
  ...supplierTerms,
  name: v.string(), nameKey: v.string(),
  contactName: v.optional(v.string()), phone: v.optional(v.string()), email: v.optional(v.string()), note: v.optional(v.string()),
  status: supplierStatus, revision: v.number(), createdAt: v.number(), updatedAt: v.number(),
};

export const requestFields = {
  branchId: v.id('branches'), reference: v.string(), status: requestStatus,
  requesterKey: v.string(), requesterLabel: v.string(),
  needBy: v.optional(v.string()), note: v.optional(v.string()),
  lineCount: v.number(), revision: v.number(),
  /** First item names for list rows (≤ 3), written on save. */
  itemSummary: v.optional(v.array(v.string())),
  /** needBy, or '9999-12-31' when none, so the approval queue sorts the most urgent first. Written on every status change. */
  needBySort: v.optional(v.string()),
  /** Approved and every line fully committed to orders. Display-only; the status stays Approved. */
  fullyOrdered: v.optional(v.boolean()),
  /** The request this one was copied from. */
  copiedFromId: v.optional(v.id('purchaseRequests')), copiedFromReference: v.optional(v.string()),
  /** Last 5 characters of the reference, for fragment lookup. */
  referenceCode: v.optional(v.string()),
  /** Most recent send-back, decline, discard or close reason. */
  lastReason: v.optional(v.string()),
  decidedByKey: v.optional(v.string()), decidedByLabel: v.optional(v.string()), decidedAt: v.optional(v.number()),
  submittedAt: v.optional(v.number()), createdAt: v.number(), updatedAt: v.number(),
};

export const requestLineFields = {
  requestId: v.id('purchaseRequests'), branchId: v.id('branches'), requesterKey: v.string(),
  variantId: v.id('productVariants'), item: itemSnapshot,
  quantity: v.number(), approvedQuantity: v.number(),
  /** Ordered − cancelled across issued orders, including already accepted units. */
  committedQuantity: v.number(),
  /** Mirrors the header so line indexes can select only open approvals. */
  requestStatus, sort: v.number(),
};

export const orderFields = {
  supplierActivityApplied: v.optional(v.boolean()),
  branchId: v.id('branches'), reference: v.string(), status: orderStatus, phase: orderPhase,
  supplierId: v.id('suppliers'), supplier: supplierSnapshot,
  requestId: v.optional(v.id('purchaseRequests')),
  expectedDate: v.optional(v.string()), supplierReference: v.optional(v.string()), note: v.optional(v.string()),
  /** 0 for a draft; the latest issued revision afterwards. */
  issuedRevision: v.number(),
  revision: v.number(), lineCount: v.number(), openLineCount: v.number(),
  orderedUnits: v.number(), acceptedUnits: v.number(), dueUnits: v.number(), totalCost: v.number(),
  createdByKey: v.string(), createdByLabel: v.string(),
  issuedAt: v.optional(v.number()), closedReason: v.optional(v.string()),
  /** Value accepted at each receipt's recorded unit cost, and the open commitment at the current price. */
  receivedValue: v.optional(v.number()), outstandingValue: v.optional(v.number()),
  /** Committed lines without a unit cost (TBC lines included). */
  unpricedLines: v.optional(v.number()),
  rejectedUnits: v.optional(v.number()),
  referenceCode: v.optional(v.string()),
  /** Direct order above the branch limit: who asked for issue approval, and who approved it. */
  approvalRequestedByKey: v.optional(v.string()), approvalRequestedByLabel: v.optional(v.string()), approvalRequestedAt: v.optional(v.number()),
  approvedByLabel: v.optional(v.string()),
  /** Linked supplier return or hold this order replaces or accepts. */
  replacesReturnId: v.optional(v.id('supplierReceiptAdjustments')), forHoldId: v.optional(v.id('purchaseHolds')),
  createdAt: v.number(), updatedAt: v.number(),
};

export const orderLineFields = {
  orderId: v.id('purchaseOrders'), branchId: v.id('branches'), variantId: v.id('productVariants'), item: itemSnapshot,
  requestLineId: v.optional(v.id('purchaseRequestLines')),
  ordered: v.number(), cancelled: v.number(),
  /** Net accepted: received − corrected. Supplier returns leave it unchanged. */
  accepted: v.number(), corrected: v.number(), returned: v.number(),
  unitCost: v.optional(v.number()),
  /** Price to be confirmed by the supplier: the line may issue without a unit cost and prints as TBC. */
  priceTbc: v.optional(v.boolean()),
  /** Units rejected at the door across receipts (they stay due). */
  rejected: v.optional(v.number()),
  /** Net accepted value at each receipt's recorded unit cost (absent on older lines: accepted × unitCost). */
  acceptedValue: v.optional(v.number()),
  /** Issued and with units still due; drives the On order index. */
  open: v.boolean(), sort: v.number(),
};

export const orderRevisionLine = v.object({
  orderLineId: v.id('purchaseOrderLines'), variantId: v.id('productVariants'), item: itemSnapshot,
  ordered: v.number(), cancelled: v.number(), unitCost: v.optional(v.number()), priceTbc: v.optional(v.boolean()),
});
export const orderRevisionFields = {
  orderId: v.id('purchaseOrders'), branchId: v.id('branches'), revision: v.number(), reference: v.string(),
  supplier: supplierSnapshot, expectedDate: v.optional(v.string()), supplierReference: v.optional(v.string()),
  note: v.optional(v.string()), lines: v.array(orderRevisionLine),
  reason: v.optional(v.string()), ...actorFields, issuedAt: v.number(),
};

/** Explicit follow-up selection on a receipt: the open correction, the actual received item, and its corrected quantity. */
export const followUpLink = v.object({
  adjustmentId: v.id('supplierReceiptAdjustments'), variantId: v.id('productVariants'), quantity: v.number(),
});
export type FollowUpLink = Infer<typeof followUpLink>;

/** Undercount supplement: these units arrived on `receiptId`'s delivery but were not counted on it. */
export const undercountLink = v.object({ receiptId: v.id('supplierReceipts') });
export type UndercountLink = Infer<typeof undercountLink>;

export const receiptFields = {
  supplierActivityApplied: v.optional(v.boolean()),
  branchId: v.id('branches'), reference: v.string(), kind: receiptKind,
  orderId: v.optional(v.id('purchaseOrders')), orderReference: v.optional(v.string()), orderRevision: v.optional(v.number()),
  supplierId: v.optional(v.id('suppliers')), supplier: v.optional(supplierSnapshot),
  deliveryReference: v.optional(v.string()), deliveryKey: v.optional(v.string()),
  duplicateOfReceiptId: v.optional(v.id('supplierReceipts')),
  /** The confirmed duplicate's reference and the receiver's confirmation reason, kept on create and on edit. */
  duplicateOfReference: v.optional(v.string()), duplicateReason: v.optional(v.string()),
  reason: v.optional(v.string()), note: v.optional(v.string()),
  /**
   * The correction this receipt follows up: the receiver explicitly chose which received item and how many units are the
   * goods the correction removed. The receipt's own branch is the actual destination; the correction may be at another branch.
   */
  followUp: v.optional(followUpLink),
  /** The receipt whose delivery these units were missing from (same branch, same order or same direct supplier). */
  undercountOf: v.optional(v.id('supplierReceipts')), undercountOfReference: v.optional(v.string()),
  lineCount: v.number(), acceptedUnits: v.number(), rejectedUnits: v.number(), heldUnits: v.number(),
  /** Rejected or held units on this receipt; drives the exceptions view. */
  hasExceptions: v.optional(v.boolean()),
  /** The receiver also issued the order's current revision (recorded when separation of duties is off). */
  selfReceipt: v.optional(v.boolean()),
  /** Supplier invoice total (satang) entered at receipt, and Σ accepted × recorded unit cost, for a price-variance check. */
  invoiceTotal: v.optional(v.number()), acceptedValue: v.optional(v.number()),
  /** Units accepted beyond the due quantity under the branch over-delivery tolerance. */
  overDeliveredUnits: v.optional(v.number()),
  ...actorFields, createdAt: v.number(), revision: v.number(),
};

export const receiptLineFields = {
  receiptId: v.id('supplierReceipts'), branchId: v.id('branches'),
  orderId: v.optional(v.id('purchaseOrders')), orderLineId: v.optional(v.id('purchaseOrderLines')),
  holdId: v.optional(v.id('purchaseHolds')),
  /** Accepted units on this line that came out of `holdId` (the rest were new goods). */
  holdQuantity: v.optional(v.number()),
  variantId: v.id('productVariants'), item: itemSnapshot,
  accepted: v.number(), rejected: v.number(), rejectReason: v.optional(v.string()), rejectReasonCode: v.optional(rejectReasonCode),
  corrected: v.number(), returned: v.number(), unitCost: v.optional(v.number()),
  movementId: v.optional(v.id('stockMovements')),
};

export const receiptAdjustmentFields = {
  kind: receiptAdjustmentKind, branchId: v.id('branches'),
  receiptId: v.id('supplierReceipts'), receiptLineId: v.id('supplierReceiptLines'),
  orderId: v.optional(v.id('purchaseOrders')), orderLineId: v.optional(v.id('purchaseOrderLines')),
  variantId: v.id('productVariants'), item: itemSnapshot, quantity: v.number(), reason: v.string(),
  supplierReference: v.optional(v.string()), reversesAdjustmentId: v.optional(v.id('supplierReceiptAdjustments')),
  /** Physical count recorded as evidence before a stock lead overrides a negative balance. */
  countedOnHand: v.optional(v.number()), negativeOverride: v.optional(v.boolean()),
  /** Supplier returns: what the supplier will do (older returns have none). */
  returnOutcome: v.optional(returnOutcome),
  reversedQuantity: v.number(),
  /** Set once a linked receipt posts the goods where they actually belong; closes the correction exactly once. */
  followUpReceiptId: v.optional(v.id('supplierReceipts')),
  /** The follow-up receipt's branch when it differs from this correction's branch. */
  followUpBranchId: v.optional(v.id('branches')),
  movementId: v.id('stockMovements'), ...actorFields, createdAt: v.number(),
};

export const holdFields = {
  branchId: v.id('branches'), status: holdStatus,
  receiptId: v.id('supplierReceipts'), receiptReference: v.string(),
  orderId: v.optional(v.id('purchaseOrders')), orderReference: v.optional(v.string()),
  variantId: v.id('productVariants'), item: itemSnapshot,
  quantity: v.number(), acceptedQuantity: v.number(), reason: v.string(),
  /** The order and receipt that most recently accepted these goods (the hold's own order after an amend, or its linked replacement). */
  acceptedOrderId: v.optional(v.id('purchaseOrders')), acceptedOrderReference: v.optional(v.string()),
  acceptedReceiptId: v.optional(v.id('supplierReceipts')),
  resolution: v.optional(v.string()), resolvedByKey: v.optional(v.string()), resolvedByLabel: v.optional(v.string()),
  resolvedAt: v.optional(v.number()), createdAt: v.number(), revision: v.number(),
  /** Supplier on the source receipt, for the queue (older holds read it from the receipt). Name only: contacts stay buyer-only. */
  supplierId: v.optional(v.id('suppliers')), supplierName: v.optional(v.string()),
  /** Handoff evidence when declined goods leave; older declines have none. */
  handoff: v.optional(holdHandoff),
};

export const purchasingResult = v.object({
  id: v.string(), reference: v.optional(v.string()), revision: v.optional(v.number()),
  movementIds: v.optional(v.array(v.id('stockMovements'))),
  /** A non-blocking note for the caller, e.g. no other approver at the branch. */
  warning: v.optional(v.string()),
  /** Lines left out (archived items) when copying a request. */
  skipped: v.optional(v.number()),
  /** Direct order above the limit was sent for approval instead of issued. */
  awaitingApproval: v.optional(v.boolean()),
});
export type PurchasingResult = Infer<typeof purchasingResult>;

/**
 * Why a receipt correction posted nothing. `negative_stock`: On hand would go below zero, so a stock lead must count and
 * post with `negativeOverride` against the report. `lot_reconciliation`: the receipt's lots no longer hold the units, and
 * lots can never go negative, so a stock lead first corrects the lot evidence (Stock › Lots count or lot adjustment), then
 * reviews the report again.
 */
export const correctionBlock = v.union(v.literal('negative_stock'), v.literal('lot_reconciliation'));
export type CorrectionBlock = Infer<typeof correctionBlock>;

/** Receipt correction outcome. `reported` changed no stock; `posted` wrote the movement and resolved any linked report. */
export const correctionResult = v.union(
  v.object({
    outcome: v.literal('reported'), id: v.string(), reference: v.string(), reportId: v.id('stockProblemReports'),
    blockedBy: correctionBlock, requestedQuantity: v.number(), onHand: v.number(),
    /** Stock revision the report reviewed; a negative override must name it. */
    stockRevision: v.number(),
  }),
  v.object({
    outcome: v.literal('posted'), id: v.string(), reference: v.string(), adjustmentId: v.id('supplierReceiptAdjustments'),
    movementIds: v.array(v.id('stockMovements')), resolvedReportId: v.optional(v.id('stockProblemReports')),
  }),
);
export type CorrectionResult = Infer<typeof correctionResult>;

export const purchasingTables = {
  supplierActivity: defineTable({
    supplierId: v.id('suppliers'), branchId: v.optional(v.id('branches')),
    openOrders: v.number(), lastDeliveryAt: v.optional(v.number()),
    datedDeliveries: v.number(), onTimeDeliveries: v.number(), rejectedUnits: v.number(),
  }).index('by_supplier_branch', ['supplierId', 'branchId']),

  suppliers: defineTable(supplierFields)
    .index('by_contact_keys_applied', ['contactKeysApplied'])
    .index('by_email_key', ['emailKey'])
    .index('by_phone_key', ['phoneKey'])
    .searchIndex('search_name', { searchField: 'name', filterFields: ['status'] })
    .index('by_email', ['email'])
    .index('by_phone', ['phone'])
    .index('by_status_and_nameKey', ['status', 'nameKey'])
    .index('by_nameKey', ['nameKey']),

  purchaseRequests: defineTable(requestFields)
    .index('by_reference', ['reference'])
    .index('by_branchId_and_reference', ['branchId', 'reference'])
    .index('by_branchId_and_updatedAt', ['branchId', 'updatedAt'])
    .index('by_branchId_and_status_and_updatedAt', ['branchId', 'status', 'updatedAt'])
    .index('by_branchId_and_requesterKey_and_updatedAt', ['branchId', 'requesterKey', 'updatedAt'])
    .index('by_branchId_and_requesterKey_and_status_and_updatedAt', ['branchId', 'requesterKey', 'status', 'updatedAt'])
    .index('by_branchId_and_status_and_needBySort_and_submittedAt', ['branchId', 'status', 'needBySort', 'submittedAt'])
    .index('by_branchId_and_status_and_fullyOrdered_and_updatedAt', ['branchId', 'status', 'fullyOrdered', 'updatedAt'])
    .index('by_branchId_and_referenceCode', ['branchId', 'referenceCode']),

  purchaseRequestLines: defineTable(requestLineFields)
    .index('by_requestId_and_sort', ['requestId', 'sort'])
    .index('by_requestId_and_variantId', ['requestId', 'variantId'])
    .index('by_branchId_and_variantId', ['branchId', 'variantId'])
    .index('by_branchId_and_requesterKey_and_variantId', ['branchId', 'requesterKey', 'variantId']),

  purchaseOrders: defineTable(orderFields)
    .index('by_phase_activity', ['phase', 'supplierActivityApplied'])
    .index('by_branch_phase_activity', ['branchId', 'phase', 'supplierActivityApplied'])
    .index('by_reference', ['reference'])
    .index('by_branchId_and_reference', ['branchId', 'reference'])
    .index('by_branchId_and_phase_and_reference', ['branchId', 'phase', 'reference'])
    .searchIndex('search_supplier_name', { searchField: 'supplier.name', filterFields: ['branchId', 'phase'] })
    .index('by_branchId_and_updatedAt', ['branchId', 'updatedAt'])
    .index('by_branchId_and_status_and_updatedAt', ['branchId', 'status', 'updatedAt'])
    .index('by_branchId_and_phase_and_updatedAt', ['branchId', 'phase', 'updatedAt'])
    .index('by_branchId_and_supplierId_and_phase', ['branchId', 'supplierId', 'phase'])
    .index('by_supplierId_and_phase', ['supplierId', 'phase'])
    .index('by_branchId_and_supplierId_and_updatedAt', ['branchId', 'supplierId', 'updatedAt'])
    .index('by_branchId_and_phase_and_expectedDate', ['branchId', 'phase', 'expectedDate'])
    .index('by_branchId_and_referenceCode', ['branchId', 'referenceCode'])
    .index('by_requestId', ['requestId'])
    .index('by_forHoldId_and_phase', ['forHoldId', 'phase'])
    .index('by_replacesReturnId', ['replacesReturnId']),

  purchaseOrderLines: defineTable(orderLineFields)
    .index('by_orderId_and_sort', ['orderId', 'sort'])
    .index('by_orderId_and_variantId', ['orderId', 'variantId'])
    .index('by_requestLineId', ['requestLineId'])
    .index('by_branchId_and_variantId_and_open', ['branchId', 'variantId', 'open']),

  purchaseOrderRevisions: defineTable(orderRevisionFields)
    .index('by_orderId_and_revision', ['orderId', 'revision']),

  supplierReceipts: defineTable(receiptFields)
    .index('by_activity', ['supplierActivityApplied'])
    .index('by_branch_activity', ['branchId', 'supplierActivityApplied'])
    .index('by_reference', ['reference'])
    .index('by_branchId_and_reference', ['branchId', 'reference'])
    .index('by_branchId_and_deliveryKey_and_createdAt', ['branchId', 'deliveryKey', 'createdAt'])
    .index('by_orderId', ['orderId'])
    .index('by_branchId_and_supplierId_and_deliveryKey', ['branchId', 'supplierId', 'deliveryKey'])
    .index('by_branchId_and_createdAt', ['branchId', 'createdAt'])
    .index('by_branchId_and_supplierId_and_createdAt', ['branchId', 'supplierId', 'createdAt'])
    .index('by_branchId_and_hasExceptions_and_createdAt', ['branchId', 'hasExceptions', 'createdAt']),

  supplierReceiptLines: defineTable(receiptLineFields)
    .index('by_receiptId', ['receiptId'])
    .index('by_orderLineId', ['orderLineId']),

  supplierReceiptAdjustments: defineTable(receiptAdjustmentFields)
    .index('by_receiptId', ['receiptId'])
    .index('by_receiptLineId', ['receiptLineId'])
    .index('by_movementId', ['movementId'])
    .index('by_orderId_and_kind', ['orderId', 'kind']),

  purchaseHolds: defineTable(holdFields)
    .index('by_branchId_and_status_and_createdAt', ['branchId', 'status', 'createdAt'])
    .index('by_branchId_and_status_and_receiptReference', ['branchId', 'status', 'receiptReference'])
    .index('by_branchId_and_status_and_variantId', ['branchId', 'status', 'variantId'])
    .index('by_receiptId', ['receiptId'])
    .index('by_orderId', ['orderId'])
    .index('by_orderId_and_status', ['orderId', 'status']),

  /** On order per branch and variant: sum of due units on issued, open PO lines. Separate from checkout balances. */
  stockIncoming: defineTable({ branchId: v.id('branches'), variantId: v.id('productVariants'), quantity: v.number() })
    .index('by_branch_variant', ['branchId', 'variantId']),

  /**
   * Replay ledger: one row per actor, branch, action and operation key. The row is written before the command runs,
   * so its id is the stable, unique command id that movement source keys derive from.
   */
  purchaseOperations: defineTable({
    actorKey: v.string(), branchId: v.id('branches'), action: v.string(), operationKey: v.string(),
    fingerprint: v.string(), result: v.union(purchasingResult, correctionResult), createdAt: v.number(),
  }).index('by_actorKey_and_branchId_and_action_and_operationKey', ['actorKey', 'branchId', 'action', 'operationKey']),

  /** Immutable history for every purchasing record. Supplier events have no branch. */
  purchaseEvents: defineTable({
    entity: purchasingEntity, entityId: v.string(), branchId: v.optional(v.id('branches')),
    action: v.string(), reason: v.optional(v.string()), changes: v.optional(v.array(historyChange)),
    relatedId: v.optional(v.string()), ...actorFields, createdAt: v.number(),
  }).index('by_entity_and_entityId_and_createdAt', ['entity', 'entityId', 'createdAt']),
};
