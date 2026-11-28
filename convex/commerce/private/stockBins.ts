import { omit } from 'convex-helpers';
import type { Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import type { StaffActor } from '../../auth/model';
import { requireStockAccess } from './stockAccess';
import { activeReservations, maxBinPositions, physicalLots, readBinPositions, readsTracking, type StockScope } from './stockAvailability';
import { readStockLevel, stockError, stockQuantity, stockRead, stockText } from './stockLedger';

const MAX_STOCK_BINS = 32;

type Relocation = StockScope & {
  from: Id<'stockBins'> | null; to: Id<'stockBins'> | null;
  lotId?: Id<'stockLots'>; quantity: number; requestKey: string;
};

function branchBins(ctx: QueryCtx, branchId: Id<'branches'>) {
  return stockRead(ctx, () => ctx.db.query('stockBins')
    .withIndex('by_branchId_and_normalizedName', q => q.eq('branchId', branchId)).take(MAX_STOCK_BINS));
}

export async function readBinBalances(ctx: QueryCtx, actor: StaffActor, { branchId, variantId }: StockScope) {
  const access = await requireStockAccess(ctx, actor, branchId, 'read');
  const [bins, positions, stock, recent, tracking] = await Promise.all([
    branchBins(ctx, branchId), readBinPositions(ctx, { branchId, variantId }), readStockLevel(ctx, branchId, variantId),
    stockRead(ctx, () => ctx.db.query('stockBinRelocations').withIndex('by_branchId_and_variantId',
      q => q.eq('branchId', branchId).eq('variantId', variantId)).order('desc').take(10)),
    readsTracking(ctx, variantId),
  ]);
  const onHand = stock?.onHand ?? 0;
  const physical = tracking ? await physicalLots(ctx, { branchId, variantId }) : [];
  const lotIds = new Set([...physical.map(lot => lot.lotId), ...recent.flatMap(move => move.lotId ? [move.lotId] : [])]);
  const lotCodes = new Map(await Promise.all([...lotIds].map(async id => [id, (await ctx.db.get(id))?.code ?? ''] as const)));
  const lots = physical.map(lot => {
    const assigned = positions.filter(position => position.lotId === lot.lotId);
    return {
      id: lot.lotId, code: lotCodes.get(lot.lotId) ?? '',
      unassigned: lot.onHand - assigned.reduce((sum, position) => sum + position.quantity, 0),
      bins: assigned.map(position => ({ id: position.binId, quantity: position.quantity })),
    };
  });
  return {
    tracking: Boolean(tracking), lots,
    onHand, canManage: access.lead && access.branch.state === 'active',
    unassigned: onHand - positions.reduce((total, row) => total + row.quantity, 0),
    bins: bins.map(bin => ({ id: bin._id, name: bin.name, quantity: positions.reduce((sum, row) => sum + (row.binId === bin._id ? row.quantity : 0), 0) })),
    recent: recent.map(move => ({
      ...omit(move, ['actorTokenIdentifier']), lotCode: move.lotId ? lotCodes.get(move.lotId) : undefined,
    })),
  };
}

export async function createStockBin(ctx: MutationCtx, actor: StaffActor, { branchId, name: input }: { branchId: Id<'branches'>; name: string }) {
  const { branch } = await requireStockAccess(ctx, actor, branchId, 'lead');
  if (branch.state !== 'active') stockError('STOCK_BRANCH_INACTIVE', 'Choose an active branch.');
  const name = stockText(input, 'Bin name', 60, true)!;
  const normalizedName = name.normalize('NFKC').toLowerCase();
  const bins = await branchBins(ctx, branchId);
  const existing = bins.find(bin => bin.normalizedName === normalizedName);
  if (existing) return existing._id;
  if (normalizedName === 'unassigned') stockError('STOCK_BIN_NAME', 'Unassigned is reserved for branch stock without a bin.');
  if (bins.length >= MAX_STOCK_BINS) stockError('STOCK_BIN_LIMIT', 'This branch has reached its bin limit.');
  return ctx.db.insert('stockBins', { branchId, name, normalizedName });
}

export async function relocateStockBetweenBins(ctx: MutationCtx, actor: StaffActor, { branchId, variantId, from, to, lotId, quantity, requestKey }: Relocation) {
  const { branch } = await requireStockAccess(ctx, actor, branchId, 'lead');
  stockQuantity(quantity, 'Relocation quantity', 1);
  const key = stockText(requestKey, 'Relocation key', 100, true)!;
  const prior = await stockRead(ctx, () => ctx.db.query('stockBinRelocations').withIndex('by_branchId_and_requestKey',
    q => q.eq('branchId', branchId).eq('requestKey', key)).unique());
  if (prior) {
    const sameActor = prior.actorTokenIdentifier !== undefined
      ? prior.actorTokenIdentifier === actor.tokenIdentifier : prior.actor === actor.email;
    if (prior.variantId !== variantId || prior.from !== from || prior.to !== to || prior.lotId !== lotId || prior.quantity !== quantity || !sameActor) {
      stockError('STOCK_KEY_CONFLICT', 'This relocation key was already used for a different action.');
    }
    return prior._id;
  }
  if (branch.state !== 'active') stockError('STOCK_BRANCH_INACTIVE', 'Choose an active branch.');
  if (from === to) stockError('STOCK_BIN_LOCATION', 'Choose two different locations.');
  for (const id of [from, to]) {
    if (id && (await ctx.db.get(id))?.branchId !== branchId) stockError('STOCK_BIN_LOCATION', 'Choose bins in this branch.');
  }
  const scope = { branchId, variantId };
  const [stock, positions, tracking] = await Promise.all([
    readStockLevel(ctx, branchId, variantId), readBinPositions(ctx, scope), readsTracking(ctx, variantId),
  ]);
  if (!stock) stockError('STOCK_BIN_SHORTAGE', 'This item has no branch stock.');
  if (Boolean(lotId) !== Boolean(tracking)) stockError('STOCK_BIN_LOT', 'Choose the physical lot for tracked stock.');
  const lotBalance = lotId && await ctx.db.query('stockLotBalances').withIndex('by_branchId_and_lotId',
    q => q.eq('branchId', branchId).eq('lotId', lotId)).unique();
  if (lotId && (!lotBalance || lotBalance.variantId !== variantId)) {
    stockError('STOCK_BIN_LOT', 'Choose a lot for this item at this branch.');
  }
  const matching = positions.filter(row => row.lotId === lotId);
  const onHand = lotBalance ? lotBalance.onHand : stock.onHand;
  const unassigned = onHand - matching.reduce((total, row) => total + row.quantity, 0);
  const source = matching.find(row => row.binId === from);
  const destination = matching.find(row => row.binId === to);
  const fromBefore = from ? source?.quantity ?? 0 : unassigned;
  const toBefore = to ? destination?.quantity ?? 0 : unassigned;
  if (fromBefore < quantity) stockError('STOCK_BIN_SHORTAGE', 'The source location has fewer units.');
  const fromAfter = fromBefore - quantity;
  if (!from) {
    const holds = await activeReservations(ctx, { branchId, variantId }, Date.now());
    const held = holds.reduce((total, hold) => total + (lotId
      ? hold.allocations.find(allocation => allocation.lotId === lotId)?.quantity ?? 0
      : hold.quantity), 0);
    if (fromAfter < held) {
      stockError('STOCK_RESERVED', 'Some Unassigned units are held for an order.');
    }
  }
  const toAfter = stockQuantity(toBefore + quantity, 'Destination balance');
  if (source) {
    if (fromAfter) await ctx.db.patch(source._id, { quantity: fromAfter });
    else await ctx.db.delete(source._id);
  }
  if (destination) await ctx.db.patch(destination._id, { quantity: toAfter });
  else if (to) {
    if (positions.length >= maxBinPositions && (!source || fromAfter > 0)) {
      stockError('STOCK_BIN_LIMIT', 'This item has too many bin positions.');
    }
    await ctx.db.insert('stockBinPositions', { branchId, variantId, binId: to, lotId, quantity: toAfter });
  }
  return ctx.db.insert('stockBinRelocations', {
    branchId, variantId, requestKey: key, from, to, lotId, quantity, fromBefore, fromAfter, toBefore, toAfter,
    actor: actor.email, actorTokenIdentifier: actor.tokenIdentifier, createdAt: Date.now(),
  });
}
