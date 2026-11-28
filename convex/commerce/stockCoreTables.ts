import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import { stockGrantRoles, stockOperationKind, stockOperationPreviewLine } from './stockValidators';

export const stockCoreTables = {
  stockBins: defineTable({
    branchId: v.id('branches'), name: v.string(), normalizedName: v.string(),
  }).index('by_branchId_and_normalizedName', ['branchId', 'normalizedName']),
  stockBinPositions: defineTable({
    branchId: v.id('branches'), variantId: v.id('productVariants'), binId: v.id('stockBins'),
    lotId: v.optional(v.id('stockLots')), quantity: v.number(),
  }).index('by_branchId_and_variantId_and_binId_and_lotId', ['branchId', 'variantId', 'binId', 'lotId']),
  stockBinRelocations: defineTable({
    branchId: v.id('branches'), variantId: v.id('productVariants'), requestKey: v.string(), lotId: v.optional(v.id('stockLots')),
    from: v.union(v.id('stockBins'), v.null()), to: v.union(v.id('stockBins'), v.null()),
    quantity: v.number(), fromBefore: v.number(), fromAfter: v.number(),
    toBefore: v.number(), toAfter: v.number(), actor: v.string(), actorTokenIdentifier: v.optional(v.string()), createdAt: v.number(),
  }).index('by_branchId_and_requestKey', ['branchId', 'requestKey'])
    .index('by_branchId_and_variantId', ['branchId', 'variantId']),
  stockReorderPoints: defineTable({
    branchId: v.id('branches'), variantId: v.id('productVariants'),
    quantity: v.optional(v.number()), revision: v.number(), changedBy: v.string(), changedAt: v.number(),
  }).index('by_branchId_and_variantId', ['branchId', 'variantId']),
  stockGrants: defineTable({
    branchId: v.id('branches'), staffGrantId: v.id('staffGrants'), roles: stockGrantRoles,
    revision: v.number(), changedBy: v.string(), changedAt: v.number(),
  }).index('by_branch_staff', ['branchId', 'staffGrantId']),
  stockBranchPolicies: defineTable({
    branchId: v.id('branches'), directOrder: v.boolean(), directReceipt: v.boolean(),
    /** Purchasing policies (optional; absent = off). The order issuer may not receive it. */
    separateReceiving: v.optional(v.boolean()),
    /** Satang. Direct orders above it need a different approver before they are issued. */
    directOrderLimit: v.optional(v.number()),
    /** Whole percent of a line's ordered quantity that may be accepted beyond due (absent = 0, off). Above it, hold the excess. */
    overReceiptTolerancePct: v.optional(v.number()),
    /** Printed on supplier copies of purchase orders. */
    receivingContact: v.optional(v.string()), receivingPhone: v.optional(v.string()),
    revision: v.number(), changedBy: v.string(), changedAt: v.number(),
  }).index('by_branch', ['branchId']),
  stockOperations: defineTable({
    branchId: v.id('branches'), kind: stockOperationKind, actor: v.string(), actorLabel: v.string(),
    reason: v.optional(v.string()), reasonCode: v.optional(v.string()), createdAt: v.number(),
    originalMovementId: v.optional(v.id('stockMovements')),
    physicalCount: v.optional(v.number()),
    lines: v.array(v.object({
      ...stockOperationPreviewLine, movementId: v.id('stockMovements'), unitCost: v.optional(v.number()),
    })),
  }).index('by_branch_and_date', ['branchId', 'createdAt']),
  stockOperationKeys: defineTable({
    branchId: v.id('branches'), actor: v.string(), action: v.string(), key: v.string(),
    fingerprint: v.string(), resultId: v.string(), resultType: v.union(v.literal('operation'), v.literal('report')),
  }).index('by_branch_actor_action_key', ['branchId', 'actor', 'action', 'key']),
  stockCorrections: defineTable({
    originalMovementId: v.id('stockMovements'), reversed: v.number(), revision: v.number(),
  }).index('by_original', ['originalMovementId']),
  stockProblemReports: defineTable({
    branchId: v.id('branches'), movementId: v.id('stockMovements'),
    actor: v.string(), actorLabel: v.string(), reason: v.string(), createdAt: v.number(),
    status: v.union(v.literal('open'), v.literal('resolved')), revision: v.number(),
    requestedQuantity: v.optional(v.number()), reviewedRevision: v.optional(v.number()),
    resolution: v.optional(v.string()), resolvedBy: v.optional(v.string()),
    resolvedAt: v.optional(v.number()), correctionId: v.optional(v.id('stockOperations')),
  }).index('by_branch_status_date', ['branchId', 'status', 'createdAt'])
    .index('by_movement_actor', ['movementId', 'actor'])
    .index('by_movementId_and_branchId_and_status', ['movementId', 'branchId', 'status']),
};
