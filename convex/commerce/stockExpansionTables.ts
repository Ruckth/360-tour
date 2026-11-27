import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const lotAllocation = v.object({ lotId: v.id('stockLots'), quantity: v.number() });
export const transferState = v.union(v.literal('draft'), v.literal('inTransit'), v.literal('received'), v.literal('short'), v.literal('cancelled'));
export const transferEventKind = v.union(v.literal('receive'), v.literal('short'), v.literal('cancel'));
export const transferEvidence = v.object({
  lineId: v.id('stockTransferLines'), quantity: v.number(), movementId: v.id('stockMovements'),
  allocations: v.array(lotAllocation),
});
export const lotReceipt = v.object({ code: v.string(), expiresAt: v.number() });

export const stockExpansionTables = {
  stockTracking: defineTable({
    variantId: v.id('productVariants'), enabledBy: v.string(), enabledAt: v.number(), lastExpiryAt: v.optional(v.number()),
  }).index('by_variantId', ['variantId']),

  stockLots: defineTable({
    variantId: v.id('productVariants'), code: v.string(), expiresAt: v.number(),
  }).index('by_variantId_and_code', ['variantId', 'code']),

  stockLotBalances: defineTable({
    branchId: v.id('branches'), variantId: v.id('productVariants'), lotId: v.id('stockLots'),
    expiresAt: v.number(), onHand: v.number(), inStock: v.boolean(),
  }).index('by_branchId_and_lotId', ['branchId', 'lotId'])
    .index('by_branchId_and_variantId_and_inStock_and_expiresAt', ['branchId', 'variantId', 'inStock', 'expiresAt']),

  stockLotMovements: defineTable({
    movementId: v.id('stockMovements'), allocations: v.array(lotAllocation),
    originalMovementId: v.optional(v.id('stockMovements')), reversed: v.optional(v.array(lotAllocation)),
  }).index('by_movementId', ['movementId']),

  stockReservations: defineTable({
    branchId: v.id('branches'), variantId: v.id('productVariants'), sourceKey: v.string(),
    quantity: v.number(), expiresAt: v.number(), allocations: v.array(lotAllocation),
    orderId: v.optional(v.id('orders')), checkout: v.optional(v.literal(true)),
    state: v.union(v.literal('active'), v.literal('released'), v.literal('consumed'), v.literal('expired')),
    actor: v.string(), createdAt: v.number(), closedAt: v.optional(v.number()), closedBy: v.optional(v.string()),
    movementId: v.optional(v.id('stockMovements')), closedReason: v.optional(v.literal('verified_count')),
  }).index('by_sourceKey', ['sourceKey'])
    .index('by_orderId_and_state_and_expiresAt', ['orderId', 'state', 'expiresAt'])
    .index('by_orderId_and_branchId_and_variantId', ['orderId', 'branchId', 'variantId'])
    .index('by_branchId_and_variantId_and_state_and_expiresAt', ['branchId', 'variantId', 'state', 'expiresAt']),

  stockTransfers: defineTable({
    originId: v.id('branches'), destinationId: v.id('branches'), sourceKey: v.string(),
    state: transferState,
    createdBy: v.string(), note: v.optional(v.string()), createdAt: v.number(),
    sentAt: v.optional(v.number()), sentBy: v.optional(v.string()),
    closedAt: v.optional(v.number()), closedBy: v.optional(v.string()), shortageReason: v.optional(v.string()),
  }).index('by_sourceKey', ['sourceKey'])
    .index('by_originId', ['originId']).index('by_destinationId', ['destinationId']),

  stockTransferLines: defineTable({
    transferId: v.id('stockTransfers'), variantId: v.id('productVariants'),
    quantity: v.number(), received: v.number(),
    dispatchMovementId: v.optional(v.id('stockMovements')),
    allocations: v.array(lotAllocation), receivedLots: v.array(lotAllocation),
  }).index('by_transferId', ['transferId']),

  stockTransferEvents: defineTable({
    transferId: v.id('stockTransfers'), operationKey: v.string(), fingerprint: v.string(),
    kind: transferEventKind,
    actor: v.string(), actorLabel: v.optional(v.string()), actingBranchId: v.optional(v.id('branches')),
    createdAt: v.number(), reason: v.optional(v.string()),
    receipts: v.array(transferEvidence), shortages: v.optional(v.array(transferEvidence)),
  }).index('by_transferId_and_operationKey', ['transferId', 'operationKey']).index('by_transferId', ['transferId']),
};
