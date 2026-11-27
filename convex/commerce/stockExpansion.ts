import { paginationOptsValidator, paginationResultValidator } from 'convex/server';
import { v } from 'convex/values';
import type { Doc } from '../_generated/dataModel';
import { sha256 } from '../shared/displayTokens';
import { internalMutation, staffMutation, staffQuery } from '../auth/model';
import { lotAllocation, lotReceipt, transferEvidence, transferEventKind, transferState } from './stockExpansionTables';
import { requireStockAccess } from './private/stockAccess';
import { expansionError, expansionRead, physicalLots, readsTracking, stockAvailability, stockText, stockUnits } from './private/stockAvailability';
import { invalidateLotExpiry, readLotMovement } from './private/stockExpansionLedger';
import { readStockLevel, writeStockMovement } from './private/stockLedger';
import { STOCK_LINE_LIMIT, stockPage } from './private/stockOperations';
import { expireStockReservation, reserveCheckoutHolds } from './private/stockReservations';
import {
  closeStockTransfer, createTransferDraft, loadTransfer, receiveStockTransfer, sendStockTransfer, transferLines,
} from './private/stockTransfers';

const scope = { branchId: v.id('branches'), variantId: v.id('productVariants') };
const transferId = v.id('stockTransfers');
const lotChange = v.union(
  v.object({ kind: v.literal('add'), lot: lotReceipt }),
  v.object({ kind: v.literal('remove'), lotId: v.id('stockLots') }),
);

const transferSummaryFields = {
  _id: transferId, originId: v.id('branches'), destinationId: v.id('branches'), state: transferState,
  createdAt: v.number(), sentAt: v.optional(v.number()), closedAt: v.optional(v.number()),
};
const transferEventView = v.object({
  _id: v.id('stockTransferEvents'), kind: transferEventKind, actor: v.string(), actingBranchId: v.optional(v.id('branches')),
  createdAt: v.number(), reason: v.optional(v.string()), receipts: v.array(transferEvidence),
  shortages: v.optional(v.array(transferEvidence)),
});

function transferSummary(transfer: Doc<'stockTransfers'>) {
  const { _id, originId, destinationId, state, createdAt, sentAt, closedAt } = transfer;
  return { _id, originId, destinationId, state, createdAt, sentAt, closedAt };
}

function eventView(event: Doc<'stockTransferEvents'>) {
  const { _id, kind, actorLabel, actingBranchId, createdAt, reason, receipts, shortages } = event;
  return { _id, kind, actor: actorLabel ?? 'Stock staff', actingBranchId, createdAt, reason, receipts, shortages };
}

export const createTransfer = staffMutation({
  capability: 'checkout',
  scope: 'selectedBranch',
  args: {
    originId: v.id('branches'), destinationId: v.id('branches'), requestId: v.string(),
    note: v.optional(v.string()), lines: v.array(v.object({ variantId: v.id('productVariants'), quantity: v.number() })),
  },
  handler: (ctx, args) => createTransferDraft(ctx, ctx.staff, args),
});

export const sendTransfer = staffMutation({
  capability: 'checkout',
  scope: 'selectedBranch',
  args: { transferId },
  handler: (ctx, args) => sendStockTransfer(ctx, ctx.staff, args.transferId),
});

export const receiveTransfer = staffMutation({
  capability: 'checkout',
  scope: 'selectedBranch',
  args: {
    transferId, requestId: v.string(),
    lines: v.array(v.object({
      lineId: v.id('stockTransferLines'), quantity: v.number(), allocations: v.optional(v.array(lotAllocation)),
    })),
  },
  handler: (ctx, args) => receiveStockTransfer(ctx, ctx.staff, args.transferId, args.requestId, args.lines),
});

export const closeTransferShort = staffMutation({
  capability: 'checkout',
  scope: 'selectedBranch',
  args: { transferId, requestId: v.string(), reason: v.string(), branchId: v.optional(v.id('branches')) },
  handler: (ctx, args) => closeStockTransfer(ctx, ctx.staff, args.transferId, args.requestId, 'short', args.reason, args.branchId),
});

export const cancelTransfer = staffMutation({
  capability: 'checkout',
  scope: 'selectedBranch',
  args: { transferId, requestId: v.string() },
  handler: (ctx, args) => closeStockTransfer(ctx, ctx.staff, args.transferId, args.requestId, 'cancel'),
});

export const listTransfers = staffQuery({
  capability: 'checkout',
  scope: 'selectedBranch',
  args: { branchId: v.id('branches'), direction: v.union(v.literal('origin'), v.literal('destination')), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object({ ...transferSummaryFields, otherBranch: v.string() })),
  handler: async (ctx, args) => {
    await requireStockAccess(ctx, ctx.staff, args.branchId, 'read');
    const query = ctx.db.query('stockTransfers');
    const page = await (args.direction === 'origin'
      ? query.withIndex('by_originId', q => q.eq('originId', args.branchId))
      : query.withIndex('by_destinationId', q => q.eq('destinationId', args.branchId)))
      .order('desc').paginate(stockPage(args.paginationOpts));
    return { ...page, page: await Promise.all(page.page.map(async transfer => ({
      ...transferSummary(transfer),
      otherBranch: (await ctx.db.get(args.direction === 'origin' ? transfer.destinationId : transfer.originId))?.name ?? '',
    }))) };
  },
});

export const transferDetail = staffQuery({
  capability: 'checkout',
  scope: 'selectedBranch',
  args: { branchId: v.id('branches'), transferId },
  returns: v.object({
    transfer: v.object({ ...transferSummaryFields, note: v.optional(v.string()), shortageReason: v.optional(v.string()) }),
    events: v.array(transferEventView), origin: v.optional(v.string()), destination: v.optional(v.string()),
    permissions: v.object({ send: v.boolean(), cancel: v.boolean(), receive: v.boolean(), closeShort: v.boolean() }),
    lines: v.array(v.object({
      _id: v.id('stockTransferLines'), variantId: v.id('productVariants'), quantity: v.number(), received: v.number(),
      dispatchMovementId: v.optional(v.id('stockMovements')), label: v.optional(v.string()), productName: v.optional(v.string()),
      sku: v.optional(v.string()), lots: v.array(v.object({
        lotId: v.id('stockLots'), quantity: v.number(), code: v.optional(v.string()), expiresAt: v.optional(v.number()), received: v.number(),
      })),
    })),
  }),
  handler: async (ctx, args) => {
    const access = await requireStockAccess(ctx, ctx.staff, args.branchId, 'read');
    const transfer = await loadTransfer(ctx, args.transferId);
    if (transfer.originId !== args.branchId && transfer.destinationId !== args.branchId) {
      expansionError('STOCK_TRANSFER_NOT_FOUND', 'The branch is not part of this stock transfer.');
    }
    const [lines, events, origin, destination] = await Promise.all([
      transferLines(ctx, transfer._id),
      ctx.db.query('stockTransferEvents').withIndex('by_transferId', q => q.eq('transferId', transfer._id))
        .order('desc').take(25),
      ctx.db.get(transfer.originId), ctx.db.get(transfer.destinationId),
    ]);
    const lotIds = new Set(lines.flatMap(line => line.allocations.map(lot => lot.lotId)));
    const lots = new Map(await Promise.all(Array.from(lotIds, async id => [id, await ctx.db.get(id)] as const)));
    return {
      transfer: { ...transferSummary(transfer), note: transfer.note, shortageReason: transfer.shortageReason },
      events: events.map(eventView),
      origin: origin?.name, destination: destination?.name,
      permissions: {
        send: args.branchId === transfer.originId && access.buyer,
        cancel: args.branchId === transfer.originId && access.requester,
        receive: args.branchId === transfer.destinationId && destination?.state === 'active' && access.receiver,
        closeShort: args.branchId === (destination?.state === 'active' ? transfer.destinationId : transfer.originId) && access.lead,
      },
      lines: await Promise.all(lines.map(async line => {
        const variant = await ctx.db.get(line.variantId);
        const receivedLots = new Map(line.receivedLots.map(lot => [lot.lotId, lot.quantity]));
        return {
          _id: line._id, variantId: line.variantId, quantity: line.quantity, received: line.received,
          dispatchMovementId: line.dispatchMovementId, label: variant?.label, productName: variant?.productName, sku: variant?.sku,
          lots: line.allocations.map(lot => ({
            ...lot, code: lots.get(lot.lotId)?.code, expiresAt: lots.get(lot.lotId)?.expiresAt,
            received: receivedLots.get(lot.lotId) ?? 0,
          })),
        };
      })),
    };
  },
});

export const transferEvents = staffQuery({
  capability: 'checkout',
  scope: 'selectedBranch',
  args: { branchId: v.id('branches'), transferId, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(transferEventView),
  handler: async (ctx, args) => {
    await requireStockAccess(ctx, ctx.staff, args.branchId, 'read');
    const transfer = await loadTransfer(ctx, args.transferId);
    if (transfer.originId !== args.branchId && transfer.destinationId !== args.branchId) {
      expansionError('STOCK_TRANSFER_NOT_FOUND', 'The branch is not part of this stock transfer.');
    }
    const page = await ctx.db.query('stockTransferEvents').withIndex('by_transferId', q => q.eq('transferId', transfer._id))
      .order('desc').paginate(stockPage(args.paginationOpts));
    return { ...page, page: page.page.map(eventView) };
  },
});

export const enableLotTracking = staffMutation({
  capability: 'checkout',
  scope: 'selectedBranch',
  args: scope,
  handler: async (ctx, args) => {
    await requireStockAccess(ctx, ctx.staff, args.branchId, 'lead');
    if (!ctx.staff.companyScope) expansionError('STOCK_FORBIDDEN', 'Company stock access is required to enable tracking across branches.');
    const [config, variant, historicalMovement, levels] = await Promise.all([
      readsTracking(ctx, args.variantId), ctx.db.get(args.variantId),
      ctx.db.query('stockMovements').withIndex('by_variantId_and_createdAt', q => q.eq('variantId', args.variantId)).first(),
      ctx.db.query('stockLevels').withIndex('by_variantId_and_branchId', q => q.eq('variantId', args.variantId)).take(101),
    ]);
    if (config) {
      if (variant && !variant.lotTracked) await ctx.db.patch(variant._id, { lotTracked: true });
      return config._id;
    }
    if (!variant || variant.status === 'archived' || historicalMovement || levels.length > 100 || levels.some(row => row.onHand !== 0)) {
      expansionError('STOCK_LOT_ONBOARDING_REQUIRED', 'Enable lot tracking before the item has stock or movement history.');
    }
    await ctx.db.patch(variant._id, { lotTracked: true });
    return ctx.db.insert('stockTracking', {
      variantId: args.variantId, enabledBy: ctx.staff.tokenIdentifier, enabledAt: Date.now(),
    });
  },
});

export const trackedItems = staffQuery({
  capability: 'checkout',
  scope: 'selectedBranch',
  args: { branchId: scope.branchId, variantIds: v.array(scope.variantId) },
  returns: v.array(scope.variantId),
  handler: async (ctx, { branchId, variantIds }) => {
    await requireStockAccess(ctx, ctx.staff, branchId, 'read');
    if (variantIds.length > STOCK_LINE_LIMIT) expansionError('INVALID_STOCK_LINES', 'Choose at most 50 different stock items.');
    const variants = await Promise.all([...new Set(variantIds)].map(variantId => expansionRead(ctx, () => ctx.db.get(variantId))));
    return variants.flatMap(variant => variant?.lotTracked ? [variant._id] : []);
  },
});

export const lotBalances = staffQuery({
  capability: 'checkout',
  scope: 'selectedBranch',
  args: scope,
  returns: v.object({
    tracking: v.boolean(), sellable: v.number(), held: v.number(), onHand: v.number(), canAdjust: v.boolean(), canEnable: v.boolean(),
    lots: v.array(v.object({
      lotId: v.id('stockLots'), code: v.optional(v.string()), expiresAt: v.number(), onHand: v.number(), available: v.number(),
    })),
  }),
  handler: async (ctx, args) => {
    const access = await requireStockAccess(ctx, ctx.staff, args.branchId, 'read');
    const onHand = (await readStockLevel(ctx, args.branchId, args.variantId))?.onHand ?? 0;
    const { lots, sellable, held, tracking } = await stockAvailability(ctx, args, onHand);
    return {
      tracking, sellable, held, onHand, canAdjust: access.lead,
      canEnable: ctx.staff.companyScope && access.lead,
      lots: await Promise.all(lots.map(async row => ({
        lotId: row.lotId, code: (await ctx.db.get(row.lotId))?.code, expiresAt: row.expiresAt,
        onHand: row.onHand, available: row.expiresAt > Date.now() ? row.available : 0,
      }))),
    };
  },
});

export const adjustLot = staffMutation({
  capability: 'checkout',
  scope: 'selectedBranch',
  args: { ...scope, requestId: v.string(), reason: v.string(), quantity: v.number(), change: lotChange },
  handler: async (ctx, args) => {
    await requireStockAccess(ctx, ctx.staff, args.branchId, 'lead');
    const quantity = stockUnits(args.quantity);
    const reason = stockText(args.reason, 500, 'an adjustment reason');
    const requestId = stockText(args.requestId, 160, 'a request reference');
    const { change } = args;
    return writeStockMovement(ctx, {
      branchId: args.branchId, variantId: args.variantId, kind: 'lot_adjustment',
      delta: change.kind === 'add' ? quantity : -quantity,
      sourceKey: await lotOperationKey('adjust', ctx.staff.tokenIdentifier, args.branchId, requestId), actor: ctx.staff.tokenIdentifier, reason,
      lotReceipt: change.kind === 'add' ? change.lot : undefined,
      lotAllocations: change.kind === 'remove' ? [{ lotId: change.lotId, quantity }] : undefined,
    });
  },
});

async function lotOperationKey(kind: string, actor: string, branchId: string, requestId: string) {
  return 'lot-' + kind + ':' + await sha256(JSON.stringify([actor, branchId, requestId]));
}

export const countLot = staffMutation({
  capability: 'checkout',
  scope: 'selectedBranch',
  args: { ...scope, lotId: v.id('stockLots'), expectedOnHand: v.number(), quantity: v.number(), requestId: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    await requireStockAccess(ctx, ctx.staff, args.branchId, 'lead');
    const quantity = args.quantity === 0 ? 0 : stockUnits(args.quantity);
    const expected = args.expectedOnHand === 0 ? 0 : stockUnits(args.expectedOnHand);
    const reason = stockText(args.reason, 500, 'a count reason');
    const requestId = stockText(args.requestId, 160, 'a request reference');
    const sourceKey = await lotOperationKey('count', ctx.staff.tokenIdentifier, args.branchId, requestId);
    const delta = quantity - expected;
    const previous = await ctx.db.query('stockMovements').withIndex('by_sourceKey', q => q.eq('sourceKey', sourceKey)).unique();
    if (!previous) {
      const lot = await ctx.db.get(args.lotId);
      const position = (await physicalLots(ctx, args)).find(row => row.lotId === args.lotId);
      if (lot?.variantId !== args.variantId || !await readsTracking(ctx, args.variantId)) {
        expansionError('INVALID_STOCK_LOT', 'Choose a tracked lot for this item.');
      }
      if ((position?.onHand ?? 0) !== expected) expansionError('STOCK_COUNT_CHANGED', 'The lot balance changed. Count it again.');
    }
    return writeStockMovement(ctx, {
      branchId: args.branchId, variantId: args.variantId, kind: 'count', delta,
      sourceKey, actor: ctx.staff.tokenIdentifier, actorLabel: ctx.staff.email, reason, reasonCode: 'verified_lot_count',
      sourceRef: JSON.stringify([args.lotId, expected, quantity]),
      lotAllocations: delta ? [{ lotId: args.lotId, quantity: Math.abs(delta) }] : undefined,
    });
  },
});

export const movementLots = staffQuery({
  capability: 'checkout',
  scope: 'selectedBranch',
  args: { branchId: v.id('branches'), movementId: v.id('stockMovements') },
  returns: v.union(v.null(), v.object({
    allocations: v.array(v.object({ lotId: v.id('stockLots'), quantity: v.number(), code: v.optional(v.string()), expiresAt: v.optional(v.number()) })),
    originalMovementId: v.optional(v.id('stockMovements')), reversed: v.optional(v.array(lotAllocation)),
  })),
  handler: async (ctx, args) => {
    await requireStockAccess(ctx, ctx.staff, args.branchId, 'read');
    const movement = await ctx.db.get(args.movementId);
    if (!movement || movement.branchId !== args.branchId) {
      expansionError('STOCK_MOVEMENT_NOT_FOUND', 'The movement was not found in this branch.');
    }
    const evidence = await readLotMovement(ctx, args.movementId);
    if (!evidence) return null;
    const allocations = await Promise.all(evidence.allocations.map(async line => {
      const lot = await ctx.db.get(line.lotId);
      return { ...line, code: lot?.code, expiresAt: lot?.expiresAt };
    }));
    return { allocations, originalMovementId: evidence.originalMovementId, reversed: evidence.reversed };
  },
});

export const expireReservation = internalMutation({
  args: { reservationId: v.id('stockReservations') },
  handler: (ctx, args) => expireStockReservation(ctx, args.reservationId),
});

export const notifyLotExpiry = internalMutation({
  args: { lotId: v.id('stockLots') },
  handler: (ctx, args) => invalidateLotExpiry(ctx, args.lotId),
});

export const reserveCheckout = internalMutation({
  args: {
    orderId: v.id('orders'), branchId: v.id('branches'), attemptId: v.id('paymentAttempts'),
    legKey: v.string(), lines: v.array(v.object({ variantId: v.id('productVariants'), quantity: v.number() })), actor: v.string(),
  },
  handler: reserveCheckoutHolds,
});
