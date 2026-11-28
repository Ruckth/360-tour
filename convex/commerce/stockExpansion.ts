import { internal } from '../_generated/api';
import { reserveWrites } from '../lib/readBudget';
import { appendRecordHistory } from '../settings/model';
import { paginationOptsValidator, paginationResultValidator } from 'convex/server';
import { v } from 'convex/values';
import { MAX_TRANSFER_LINES } from '../shared/commerce/caps';
import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { sha256 } from '../shared/displayTokens';
import { canReadCheckoutOrder, internalMutation, staffMutation, staffQuery } from '../auth/model';
import { lotAllocation, lotConversionBranch, lotReceipt, transferEvidence, transferEventKind, transferState } from './stockExpansionTables';
import { requireStockAccess } from './private/stockAccess';
import { activeReservations, allocateStockLots, expansionError, expansionRead, maxActiveLots, physicalLots, readBinPositions, readsTracking, stockAvailability, stockText, stockUnits } from './private/stockAvailability';
import { invalidateLotExpiry, legacyUnattributedLotCode, readLotMovement } from './private/stockExpansionLedger';
import { readStockLevel, writeStockMovement } from './private/stockLedger';
import { STOCK_LINE_LIMIT, stockPage } from './private/stockOperations';
import { expireStockReservation, reserveCheckoutHolds } from './private/stockReservations';
import {
  closeStockTransfer, createTransferDraft, editTransferDraft, loadTransfer, receiveStockTransfer, sendStockTransfer, transferLines,
} from './private/stockTransfers';

const scope = { branchId: v.id('branches'), variantId: v.id('productVariants') };
const transferId = v.id('stockTransfers');
const lotChange = v.union(
  v.object({ kind: v.literal('add'), lot: lotReceipt }),
  v.object({ kind: v.literal('remove'), lotId: v.id('stockLots') }),
);

const transferSummaryFields = {
  _id: transferId, originId: v.id('branches'), destinationId: v.id('branches'), state: transferState,
  reference: v.string(), revision: v.number(), createdAt: v.number(), sentAt: v.optional(v.number()), closedAt: v.optional(v.number()),
};
const transferEventView = v.object({
  _id: v.id('stockTransferEvents'), kind: transferEventKind, actor: v.string(), actingBranchId: v.optional(v.id('branches')),
  createdAt: v.number(), reason: v.optional(v.string()), receipts: v.array(transferEvidence),
  shortages: v.optional(v.array(transferEvidence)),
});

function transferSummary(transfer: Doc<'stockTransfers'>) {
  const { _id, originId, destinationId, state, createdAt, sentAt, closedAt } = transfer;
  return { _id, originId, destinationId, state, createdAt, sentAt, closedAt,
    reference: 'TR-' + _id.slice(-10).toUpperCase(), revision: transfer.revision ?? 0 };
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

export const editTransfer = staffMutation({
  capability: 'checkout',
  scope: 'selectedBranch',
  args: {
    transferId, revision: v.number(), destinationId: v.id('branches'), note: v.optional(v.string()),
    lines: v.array(v.object({ variantId: v.id('productVariants'), quantity: v.number() })),
  },
  handler: (ctx, args) => editTransferDraft(ctx, ctx.staff, args.transferId, args.revision, args),
});

export const sendTransfer = staffMutation({
  capability: 'checkout',
  scope: 'selectedBranch',
  args: { transferId, revision: v.number() },
  handler: (ctx, args) => sendStockTransfer(ctx, ctx.staff, args.transferId, args.revision),
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
  args: {
    transferId, requestId: v.string(), reason: v.string(), branchId: v.optional(v.id('branches')),
    reviewed: v.array(v.object({ lineId: v.id('stockTransferLines'), quantity: v.number() })),
  },
  handler: (ctx, args) => closeStockTransfer(ctx, ctx.staff, args.transferId, args.requestId, 'short', args.reason, args.branchId, args.reviewed),
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
  args: { branchId: v.id('branches'), direction: v.union(v.literal('origin'), v.literal('destination')), state: v.optional(transferState), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object({ ...transferSummaryFields, otherBranch: v.string() })),
  handler: async (ctx, args) => {
    await requireStockAccess(ctx, ctx.staff, args.branchId, 'read');
    const query = ctx.db.query('stockTransfers');
    const state = args.state;
    const range = args.direction === 'origin'
      ? state ? query.withIndex('by_originId_and_state', q => q.eq('originId', args.branchId).eq('state', state))
        : query.withIndex('by_originId', q => q.eq('originId', args.branchId))
      : state ? query.withIndex('by_destinationId_and_state', q => q.eq('destinationId', args.branchId).eq('state', state))
        : query.withIndex('by_destinationId', q => q.eq('destinationId', args.branchId));
    const page = await range
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
  args: { branchId: v.id('branches'), transferId: v.string() },
  returns: v.union(v.null(), v.object({
    transfer: v.object({ ...transferSummaryFields, note: v.optional(v.string()), shortageReason: v.optional(v.string()) }),
    origin: v.optional(v.string()), destination: v.optional(v.string()),
    permissions: v.object({ send: v.boolean(), cancel: v.boolean(), receive: v.boolean(), closeShort: v.boolean() }),
    lines: v.array(v.object({
      _id: v.id('stockTransferLines'), variantId: v.id('productVariants'), quantity: v.number(), received: v.number(),
      dispatchMovementId: v.optional(v.id('stockMovements')), label: v.optional(v.string()), productName: v.optional(v.string()),
      sku: v.optional(v.string()), onHand: v.optional(v.number()), sellable: v.optional(v.number()), lots: v.array(v.object({
        lotId: v.id('stockLots'), quantity: v.number(), code: v.optional(v.string()), expiresAt: v.optional(v.number()), received: v.number(),
      })),
    })),
  })),
  handler: async (ctx, args) => {
    const access = await requireStockAccess(ctx, ctx.staff, args.branchId, 'read');
    const id = ctx.db.normalizeId('stockTransfers', args.transferId);
    const transfer = id ? await ctx.db.get(id) : null;
    if (!transfer || transfer.originId !== args.branchId && transfer.destinationId !== args.branchId) return null;
    const [lines, origin, destination] = await Promise.all([
      transferLines(ctx, transfer._id), ctx.db.get(transfer.originId), ctx.db.get(transfer.destinationId),
    ]);
    const lotIds = new Set(lines.flatMap(line => line.allocations.map(lot => lot.lotId)));
    const lots = new Map(await Promise.all(Array.from(lotIds, async id => [id, await ctx.db.get(id)] as const)));
    return {
      transfer: { ...transferSummary(transfer), note: transfer.note, shortageReason: transfer.shortageReason },
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
        const scope = { branchId: transfer.originId, variantId: line.variantId };
        const onHand = transfer.state === 'draft' && args.branchId === transfer.originId
          ? (await readStockLevel(ctx, scope.branchId, scope.variantId))?.onHand ?? 0 : undefined;
        const sellable = onHand === undefined ? undefined : (await stockAvailability(ctx, scope, onHand)).sellable;
        return {
          onHand, sellable,
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

export const transferAvailability = staffQuery({
  capability: 'checkout',
  scope: 'selectedBranch',
  args: { branchId: scope.branchId, variantIds: v.array(scope.variantId) },
  returns: v.array(v.object({ variantId: scope.variantId, onHand: v.number(), sellable: v.number() })),
  handler: async (ctx, { branchId, variantIds }) => {
    await requireStockAccess(ctx, ctx.staff, branchId, 'read');
    if (variantIds.length > MAX_TRANSFER_LINES) expansionError('INVALID_TRANSFER_LINES', 'Choose at most 12 items.');
    return Promise.all([...new Set(variantIds)].map(async variantId => {
      const onHand = (await readStockLevel(ctx, branchId, variantId))?.onHand ?? 0;
      const { sellable } = await stockAvailability(ctx, { branchId, variantId }, onHand);
      return { variantId, onHand, sellable };
    }));
  },
});

async function lotEnablement(ctx: QueryCtx, variantId: Doc<'productVariants'>['_id']) {
  const [variant, historicalMovement, levels] = await Promise.all([
    ctx.db.get(variantId),
    ctx.db.query('stockMovements').withIndex('by_variantId_and_createdAt', q => q.eq('variantId', variantId)).first(),
    ctx.db.query('stockLevels').withIndex('by_variantId_and_branchId', q => q.eq('variantId', variantId)).take(101),
  ]);
  if (!variant || variant.status !== 'active') return { reason: 'Choose an active item to enable lot tracking.', canConvert: false };
  if (levels.length > 100) return { reason: 'The item has too many branch balances for direct enablement.', canConvert: false };
  if (historicalMovement || levels.some(row => row.onHand !== 0)) {
    return { reason: 'This item has stock or movement history and requires a reconciled conversion.', canConvert: true };
  }
  return undefined;
}

export const enableLotTracking = staffMutation({
  capability: 'checkout',
  scope: 'selectedBranch',
  args: scope,
  handler: async (ctx, args) => {
    await requireStockAccess(ctx, ctx.staff, args.branchId, 'lead');
    if (!ctx.staff.companyScope) expansionError('STOCK_FORBIDDEN', 'Company stock access is required to enable tracking across branches.');
    const config = await readsTracking(ctx, args.variantId);
    if (config) {
      const variant = await ctx.db.get(args.variantId);
      if (variant && !variant.lotTracked) await ctx.db.patch(variant._id, { lotTracked: true });
      return config._id;
    }
    const blocker = await lotEnablement(ctx, args.variantId);
    if (blocker) expansionError('STOCK_LOT_ONBOARDING_REQUIRED', blocker.reason);
    await ctx.db.patch(args.variantId, { lotTracked: true });
    return ctx.db.insert('stockTracking', {
      variantId: args.variantId, enabledBy: ctx.staff.tokenIdentifier, enabledAt: Date.now(),
    });
  },
});

const conversionLimit = 12;
const conversionScope = { ...scope, requestId: v.string(), branches: v.array(lotConversionBranch) };

export const lotConversionBalances = staffQuery({
  capability: 'checkout',
  scope: 'selectedBranch',
  args: scope,
  handler: async (ctx, args) => {
    await requireStockAccess(ctx, ctx.staff, args.branchId, 'lead');
    if (!ctx.staff.companyScope) expansionError('STOCK_FORBIDDEN', 'Company stock access is required for conversion.');
    const levels = await ctx.db.query('stockLevels').withIndex('by_variantId_and_branchId', q => q.eq('variantId', args.variantId)).take(101);
    const occupied = levels.filter(level => level.onHand !== 0);
    if (levels.length > 100 || occupied.length > conversionLimit) {
      return { blocker: 'This item exceeds the bounded conversion size.', branches: [] };
    }
    if (occupied.some(level => level.onHand < 0)) return { blocker: 'Reconcile negative branch balances first.', branches: [] };
    const branches = await Promise.all(occupied.map(async level => ({
      branchId: level.branchId, name: (await ctx.db.get(level.branchId))?.name ?? 'Branch', onHand: level.onHand, revision: level.revision,
    })));
    return { blocker: undefined, branches };
  },
});

export const convertLotTracking = staffMutation({
  capability: 'checkout',
  scope: 'selectedBranch',
  args: conversionScope,
  handler: async (ctx, args) => {
    await requireStockAccess(ctx, ctx.staff, args.branchId, 'lead');
    if (!ctx.staff.companyScope) expansionError('STOCK_FORBIDDEN', 'Company stock access is required for conversion.');
    if (args.branches.length > conversionLimit || args.branches.reduce((sum, branch) => sum + branch.lots.length, 0) > maxActiveLots) {
      expansionError('STOCK_LOT_CONVERSION_LIMIT', 'This conversion is limited to 12 branches and 100 lot positions.');
    }
    const requestId = stockText(args.requestId, 160, 'a request reference');
    const branches = args.branches.map(branch => ({
      branchId: branch.branchId, expectedRevision: branch.expectedRevision,
      lots: branch.lots.map(lot => ({
        code: stockText(lot.code, 80, 'a lot code'), expiresAt: lot.expiresAt, quantity: stockUnits(lot.quantity),
      })).sort((a, b) => a.code.localeCompare(b.code)),
    })).sort((a, b) => a.branchId.localeCompare(b.branchId));
    const fingerprint = await sha256(JSON.stringify(branches));
    const tracking = await readsTracking(ctx, args.variantId);
    const previous = tracking?.conversion;
    if (previous?.requestId === requestId && previous.fromBranchId === args.branchId && tracking?.enabledBy === ctx.staff.tokenIdentifier) {
      if (previous.fingerprint !== fingerprint) expansionError('STOCK_KEY_CONFLICT', 'This conversion reference was already used for different stock.');
      return tracking._id;
    }
    const [variant, levels] = await Promise.all([
      ctx.db.get(args.variantId),
      ctx.db.query('stockLevels').withIndex('by_variantId_and_branchId', q => q.eq('variantId', args.variantId)).take(101),
    ]);
    if (!variant || variant.status !== 'active' || tracking) expansionError('STOCK_LOT_CONVERSION_STATE', 'Choose an active untracked item.');
    if (levels.length > 100) expansionError('STOCK_LOT_CONVERSION_LIMIT', 'This item has too many branch balances to convert.');
    const now = Date.now();
    const input = new Map(branches.map(row => [row.branchId, row]));
    const occupied = levels.filter(level => level.onHand !== 0);
    if (input.size !== args.branches.length || input.size !== occupied.length) {
      expansionError('STOCK_LOT_CONVERSION_CHANGED', 'Review the current stock at every branch before converting.');
    }
    let heldRows = 0;
    const seenLots = new Map<string, { lotId: Id<'stockLots'>; expiresAt: number }>();
    for (const level of occupied) {
      if ((await readBinPositions(ctx, level)).length) {
        expansionError('STOCK_LOT_CONVERSION_CHANGED', 'Move bin stock to Unassigned before converting this item to lot tracking.');
      }
      const reviewed = input.get(level.branchId);
      if (!reviewed || reviewed.expectedRevision !== level.revision) {
        expansionError('STOCK_LOT_CONVERSION_CHANGED', 'Stock activity changed a reviewed branch balance. Recount the lots before enabling tracking.');
      }
      const { lots } = reviewed;
      if (lots.reduce((sum, lot) => sum + lot.quantity, 0) !== level.onHand) {
        expansionError('STOCK_LOT_CONVERSION_CHANGED', 'The lot quantities must equal on-hand stock at each branch.');
      }
      const codes = new Set<string>();
      const positions = [];
      for (const lot of lots) {
        const { code } = lot;
        if (code === legacyUnattributedLotCode || codes.has(code) || !Number.isSafeInteger(lot.expiresAt) || lot.expiresAt <= 1) {
          expansionError('STOCK_LOT_CONVERSION_LOT', 'Enter distinct lot codes and valid expiry dates for each branch.');
        }
        codes.add(code);
        let definition = seenLots.get(code);
        if (!definition) {
          const existing = await ctx.db.query('stockLots').withIndex('by_variantId_and_code',
            q => q.eq('variantId', args.variantId).eq('code', code)).unique();
          reserveWrites(ctx, 1);
          const lotId = existing?._id ?? await ctx.db.insert('stockLots', { variantId: args.variantId, code, expiresAt: lot.expiresAt });
          definition = { lotId, expiresAt: existing?.expiresAt ?? lot.expiresAt };
          seenLots.set(code, definition);
          if (!existing && lot.expiresAt > now) await ctx.scheduler.runAt(lot.expiresAt, internal.commerce.stockExpansion.notifyLotExpiry, { lotId });
        }
        if (definition.expiresAt !== lot.expiresAt) expansionError('LOT_EXPIRY_CONFLICT', 'Use the same expiry for each shared lot code.');
        reserveWrites(ctx, 1);
        await ctx.db.insert('stockLotBalances', {
          branchId: level.branchId, variantId: args.variantId, ...definition, onHand: lot.quantity, inStock: true, revision: 1,
        });
        positions.push({ ...definition, available: lot.quantity });
      }
      positions.sort((a, b) => a.expiresAt - b.expiresAt);
      const active = await activeReservations(ctx, level, now);
      heldRows += active.length;
      if (heldRows > 100) expansionError('STOCK_LOT_CONVERSION_LIMIT', 'This item has too many active holds to convert in one operation.');
      for (const hold of active.sort((a, b) => b.expiresAt - a.expiresAt)) {
        const allocations = allocateStockLots(positions, hold.quantity, hold.expiresAt);
        for (const allocation of allocations) {
          const position = positions.find(row => row.lotId === allocation.lotId)!;
          position.available -= allocation.quantity;
        }
        reserveWrites(ctx, 1);
        await ctx.db.patch(hold._id, { allocations });
      }
    }
    reserveWrites(ctx, 3);
    await ctx.db.patch(variant._id, { lotTracked: true });
    const trackingId = await ctx.db.insert('stockTracking', {
      variantId: variant._id, enabledBy: ctx.staff.tokenIdentifier, enabledAt: now, convertedAt: now,
      conversion: { fromBranchId: args.branchId, requestId, fingerprint },
    });
    await appendRecordHistory(ctx, {
      entityType: 'stockTracking', entityId: trackingId, actor: ctx.staff.email, kind: 'converted',
      after: { variantId: variant._id, reviewedFrom: args.branchId, branches },
    });
    return trackingId;
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
    tracking: v.boolean(), sellable: v.number(), held: v.number(), assigned: v.number(), expired: v.number(), onHand: v.number(), canAdjust: v.boolean(), canEnable: v.boolean(), canConvert: v.boolean(), enableBlocker: v.optional(v.string()),
    lots: v.array(v.object({
      lotId: v.id('stockLots'), code: v.optional(v.string()), expiresAt: v.number(), onHand: v.number(), available: v.number(), reserved: v.number(), assigned: v.number(), expired: v.boolean(), revision: v.number(),
    })),
  }),
  handler: async (ctx, args) => {
    const access = await requireStockAccess(ctx, ctx.staff, args.branchId, 'read');
    const onHand = (await readStockLevel(ctx, args.branchId, args.variantId))?.onHand ?? 0;
    const now = Date.now();
    const { lots, sellable, held, assigned, tracking } = await stockAvailability(ctx, args, onHand, now);
    const mayEnable = ctx.staff.companyScope && access.lead && !tracking;
    const blocker = mayEnable ? await lotEnablement(ctx, args.variantId) : undefined;
    return {
      tracking, sellable, held, assigned, onHand, canAdjust: access.lead,
      expired: lots.reduce((sum, row) => sum + (row.expiresAt <= now ? row.available : 0), 0),
      canEnable: mayEnable && !blocker, canConvert: blocker?.canConvert ?? false, enableBlocker: blocker?.reason,
      lots: await Promise.all(lots.map(async row => ({
        lotId: row.lotId, code: (await ctx.db.get(row.lotId))?.code, expiresAt: row.expiresAt,
        onHand: row.onHand, available: row.expiresAt > now ? row.available : 0,
        reserved: row.reserved, assigned: row.assigned, expired: row.expiresAt <= now, revision: row.revision ?? 0,
      }))),
    };
  },
});

export const findCountLot = staffQuery({
  capability: 'checkout',
  scope: 'selectedBranch',
  args: { ...scope, code: v.string() },
  handler: async (ctx, args) => {
    await requireStockAccess(ctx, ctx.staff, args.branchId, 'lead');
    const code = args.code.trim();
    if (!code || code.length > 80) return null;
    const lot = await ctx.db.query('stockLots').withIndex('by_variantId_and_code',
      q => q.eq('variantId', args.variantId).eq('code', code)).unique();
    if (!lot) return null;
    const row = await ctx.db.query('stockLotBalances').withIndex('by_branchId_and_lotId',
      q => q.eq('branchId', args.branchId).eq('lotId', lot._id)).unique();
    if (!row) return null;
    return { lotId: lot._id, code: lot.code, expiresAt: lot.expiresAt, onHand: row.onHand, revision: row.revision ?? 0 };
  },
});

export const branchExpiry = staffQuery({
  capability: 'checkout',
  scope: 'selectedBranch',
  args: {
    branchId: scope.branchId, paginationOpts: paginationOptsValidator,
    window: v.optional(v.union(v.literal('due'), v.literal('expired'), v.literal('week'), v.literal('month'))),
  },
  handler: async (ctx, args) => {
    await requireStockAccess(ctx, ctx.staff, args.branchId, 'read');
    const now = Date.now();
    const end = now + (args.window === 'expired' ? 0 : args.window === 'week' ? 7 : 30) * 24 * 60 * 60 * 1000;
    const upcomingOnly = args.window === 'week' || args.window === 'month';
    const page = await ctx.db.query('stockLotBalances').withIndex('by_branchId_and_inStock_and_expiresAt', q => {
      const range = q.eq('branchId', args.branchId).eq('inStock', true);
      return upcomingOnly ? range.gt('expiresAt', now).lte('expiresAt', end) : range.lte('expiresAt', end);
    }).paginate(stockPage(args.paginationOpts));
    return { ...page, page: await Promise.all(page.page.map(async (row) => {
      const [lot, item] = await Promise.all([ctx.db.get(row.lotId), ctx.db.get(row.variantId)]);
      return { _id: row._id, variantId: row.variantId, name: item?.productName, label: item?.label, sku: item?.sku,
        code: lot?.code, expiresAt: row.expiresAt, onHand: row.onHand, expired: row.expiresAt <= now };
    })) };
  },
});

export const branchReservations = staffQuery({
  capability: 'checkout',
  scope: 'selectedBranch',
  args: { branchId: scope.branchId, paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireStockAccess(ctx, ctx.staff, args.branchId, 'read');
    const page = await ctx.db.query('stockReservations').withIndex('by_branchId_and_state_and_expiresAt',
      q => q.eq('branchId', args.branchId).eq('state', 'active').gt('expiresAt', Date.now()))
      .paginate(stockPage(args.paginationOpts));
    return { ...page, page: await Promise.all(page.page.map(async (row) => {
      const [item, order] = await Promise.all([ctx.db.get(row.variantId), row.orderId ? ctx.db.get(row.orderId) : null]);
      return { _id: row._id, variantId: row.variantId, name: item?.productName, label: item?.label, sku: item?.sku,
        quantity: row.quantity, expiresAt: row.expiresAt, checkout: row.checkout === true,
        orderId: order && canReadCheckoutOrder(ctx.staff, order) ? order._id : undefined };

    })) };
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

function openCountSession(ctx: QueryCtx, branchId: Id<'branches'>, variantId: Id<'productVariants'>, actor: string) {
  return ctx.db.query('stockLotCountSessions').withIndex('by_branchId_and_variantId_and_actor_and_state',
    q => q.eq('branchId', branchId).eq('variantId', variantId).eq('actor', actor).eq('state', 'open')).unique();
}

export const readLotCountSession = staffQuery({
  capability: 'checkout',
  scope: 'selectedBranch',
  args: scope,
  handler: async (ctx, args) => {
    await requireStockAccess(ctx, ctx.staff, args.branchId, 'lead');
    const session = await openCountSession(ctx, args.branchId, args.variantId, ctx.staff.tokenIdentifier);
    if (!session) return null;
    const current = await physicalLots(ctx, args);
    const snapshot = new Map(session.lots.map(lot => [lot.lotId, lot]));
    for (const lot of current) {
      if (!snapshot.has(lot.lotId)) snapshot.set(lot.lotId, { lotId: lot.lotId });
    }
    const lots = await Promise.all([...snapshot.values()].map(async (lot) => {
      const [definition, position] = await Promise.all([
        ctx.db.get(lot.lotId),
        ctx.db.query('stockLotBalances').withIndex('by_branchId_and_lotId',
          q => q.eq('branchId', args.branchId).eq('lotId', lot.lotId)).unique(),
      ]);
      return { lotId: lot.lotId, code: definition?.code ?? lot.lotId, expiresAt: definition?.expiresAt ?? 0, onHand: position?.onHand ?? 0,
        revision: position?.revision ?? 0, counted: !!lot.movementId && lot.reviewedRevision === (position?.revision ?? 0) };
    }));
    return { _id: session._id, lots };
  },
});

export const startLotCountSession = staffMutation({
  capability: 'checkout',
  scope: 'selectedBranch',
  args: scope,
  handler: async (ctx, args) => {
    await requireStockAccess(ctx, ctx.staff, args.branchId, 'lead');
    const actor = ctx.staff.tokenIdentifier;
    const existing = await openCountSession(ctx, args.branchId, args.variantId, actor);
    if (existing) return existing._id;
    if (!await readsTracking(ctx, args.variantId)) expansionError('STOCK_LOT_TRACKING_REQUIRED', 'Enable lot tracking first.');
    const lots = (await physicalLots(ctx, args)).map(({ lotId }) => ({ lotId }));
    if (!lots.length) expansionError('STOCK_LOT_SESSION_EMPTY', 'There are no active lots to count.');
    return ctx.db.insert('stockLotCountSessions', { ...args, actor, state: 'open', startedAt: Date.now(), lots });
  },
});

export const finishLotCountSession = staffMutation({
  capability: 'checkout',
  scope: 'selectedBranch',
  args: { ...scope, sessionId: v.id('stockLotCountSessions') },
  handler: async (ctx, args) => {
    await requireStockAccess(ctx, ctx.staff, args.branchId, 'lead');
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.branchId !== args.branchId || session.variantId !== args.variantId || session.actor !== ctx.staff.tokenIdentifier) {
      expansionError('STOCK_LOT_SESSION_CHANGED', 'The count session is unavailable.');
    }
    if (session.state === 'complete') return session._id;
    const counts = new Map(session.lots.map(lot => [lot.lotId, lot]));
    const current = await physicalLots(ctx, args);
    if (current.some(lot => !counts.has(lot.lotId))) expansionError('STOCK_LOT_SESSION_PENDING', 'Count every pending lot before completing this session.');
    for (const lot of session.lots) {
      const position = await ctx.db.query('stockLotBalances').withIndex('by_branchId_and_lotId',
        q => q.eq('branchId', args.branchId).eq('lotId', lot.lotId)).unique();
      if (!lot.movementId || lot.reviewedRevision !== (position?.revision ?? 0)) {
        expansionError('STOCK_LOT_SESSION_PENDING', 'Count every pending or changed lot before completing this session.');
      }
    }
    await ctx.db.patch(session._id, { state: 'complete', completedAt: Date.now() });
    return session._id;
  },
});

export const countLot = staffMutation({
  capability: 'checkout',
  scope: 'selectedBranch',
  args: { ...scope, lotId: v.id('stockLots'), sessionId: v.optional(v.id('stockLotCountSessions')), expectedRevision: v.number(), expectedOnHand: v.number(), quantity: v.number(), requestId: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    await requireStockAccess(ctx, ctx.staff, args.branchId, 'lead');
    const quantity = args.quantity === 0 ? 0 : stockUnits(args.quantity);
    const expected = args.expectedOnHand === 0 ? 0 : stockUnits(args.expectedOnHand);
    const reason = stockText(args.reason, 500, 'a count reason');
    const requestId = stockText(args.requestId, 160, 'a request reference');
    const sourceKey = await lotOperationKey('count', ctx.staff.tokenIdentifier, args.branchId, requestId);
    const delta = quantity - expected;
    const previous = await ctx.db.query('stockMovements').withIndex('by_sourceKey', q => q.eq('sourceKey', sourceKey)).unique();
    const session = args.sessionId ? await ctx.db.get(args.sessionId) : null;
    if (args.sessionId && (!session || session.branchId !== args.branchId || session.variantId !== args.variantId ||
        session.actor !== ctx.staff.tokenIdentifier || (!previous && session.state !== 'open'))) {
      expansionError('STOCK_LOT_SESSION_CHANGED', 'Reopen the active lot count session.');
    }
    if (!previous) {
      const lot = await ctx.db.get(args.lotId);
      const position = await ctx.db.query('stockLotBalances').withIndex('by_branchId_and_lotId',
        q => q.eq('branchId', args.branchId).eq('lotId', args.lotId)).unique();
      if (lot?.variantId !== args.variantId || !await readsTracking(ctx, args.variantId)) {
        expansionError('INVALID_STOCK_LOT', 'Choose a tracked lot for this item.');
      }
      if ((position?.onHand ?? 0) !== expected || (position?.revision ?? 0) !== args.expectedRevision) expansionError('STOCK_COUNT_CHANGED', 'The lot balance changed. Count it again.');
    }
    const result = await writeStockMovement(ctx, {
      branchId: args.branchId, variantId: args.variantId, kind: 'count', delta,
      sourceKey, actor: ctx.staff.tokenIdentifier, actorLabel: ctx.staff.email, reason, reasonCode: 'verified_lot_count',
      sourceRef: JSON.stringify([args.lotId, expected, quantity, args.expectedRevision,
        ...(args.sessionId ? [args.sessionId] : [])]),
      lotAllocations: delta ? [{ lotId: args.lotId, quantity: Math.abs(delta) }] : undefined,
    });
    if (session && !previous) {
      const position = await ctx.db.query('stockLotBalances').withIndex('by_branchId_and_lotId',
        q => q.eq('branchId', args.branchId).eq('lotId', args.lotId)).unique();
      const lots = session.lots.filter(lot => lot.lotId !== args.lotId);
      if (lots.length >= maxActiveLots) expansionError('STOCK_LOT_LIMIT', 'The count session has reached its lot limit.');
      await ctx.db.patch(session._id, { lots: [...lots, {
        lotId: args.lotId, reviewedRevision: position?.revision ?? 0, movementId: result.movementId,
      }] });
    }
    return result;
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
    legKey: v.string(), expiresAt: v.number(), lines: v.array(v.object({ variantId: v.id('productVariants'), quantity: v.number(),
      lotAllocations: v.optional(v.array(v.object({ lotId: v.id('stockLots'), quantity: v.number() }))), })), actor: v.string(),
  },
  handler: reserveCheckoutHolds,
});
