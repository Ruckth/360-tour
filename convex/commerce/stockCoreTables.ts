import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import { stockGrantRoles, stockOperationKind, stockOperationPreviewLine } from './stockValidators';

export const stockCoreTables = {
  stockGrants: defineTable({
    branchId: v.id('branches'), staffGrantId: v.id('staffGrants'), roles: stockGrantRoles,
    revision: v.number(), changedBy: v.string(), changedAt: v.number(),
  }).index('by_branch_staff', ['branchId', 'staffGrantId']),
  stockBranchPolicies: defineTable({
    branchId: v.id('branches'), directOrder: v.boolean(), directReceipt: v.boolean(),
    revision: v.number(), changedBy: v.string(), changedAt: v.number(),
  }).index('by_branch', ['branchId']),
  stockOperations: defineTable({
    branchId: v.id('branches'), kind: stockOperationKind, actor: v.string(), actorLabel: v.string(),
    reason: v.optional(v.string()), reasonCode: v.optional(v.string()), createdAt: v.number(),
    originalMovementId: v.optional(v.id('stockMovements')),
    physicalCount: v.optional(v.number()),
    lines: v.array(v.object({
      ...stockOperationPreviewLine, movementId: v.id('stockMovements'),
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
