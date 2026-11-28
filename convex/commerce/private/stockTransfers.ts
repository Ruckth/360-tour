import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import type { StaffActor } from '../../auth/model';
import { readBranch } from '../../branches/model';
import { MAX_TRANSFER_LINES } from '../../shared/commerce/caps';
import { sha256 } from '../../shared/displayTokens';
import { requireStockAccess } from './stockAccess';
import { allocationCounts, expansionError, stockText, stockUnits, type Allocation } from './stockAvailability';
import { readLotMovement } from './stockExpansionLedger';
import { writeStockMovement } from './stockLedger';

type TransferId = Id<'stockTransfers'>;
type TransferLineId = Id<'stockTransferLines'>;
type TransferDraftLine = { variantId: Id<'productVariants'>; quantity: number };
type TransferReceiptLine = { lineId: TransferLineId; quantity: number; allocations?: Allocation[] };
type TransferEventKind = Doc<'stockTransferEvents'>['kind'];

export async function loadTransfer(ctx: QueryCtx, transferId: TransferId) {
  const transfer = await ctx.db.get(transferId);
  if (!transfer) expansionError('STOCK_TRANSFER_NOT_FOUND', 'The stock transfer does not exist.');
  return transfer;
}

export function transferLines(ctx: QueryCtx, transferId: TransferId) {
  return ctx.db.query('stockTransferLines').withIndex('by_transferId', q => q.eq('transferId', transferId)).take(MAX_TRANSFER_LINES);
}

export async function createTransferDraft(ctx: MutationCtx, actor: StaffActor, args: {
  originId: Id<'branches'>; destinationId: Id<'branches'>; requestId: string; note?: string; lines: TransferDraftLine[];
}) {
  const access = await requireStockAccess(ctx, actor, args.originId, 'requester');
  const destination = await readBranch(ctx, args.destinationId);
  if (args.originId === args.destinationId || access.branch.state !== 'active' || destination?.state !== 'active') {
    expansionError('INVALID_TRANSFER_BRANCHES', 'Choose two different active branches.');
  }
  if (!args.lines.length || args.lines.length > MAX_TRANSFER_LINES ||
      new Set(args.lines.map(line => line.variantId)).size !== args.lines.length) {
    expansionError('INVALID_TRANSFER_LINES', 'Choose 1–12 distinct items to transfer.');
  }
  const lines = args.lines.map(line => ({ variantId: line.variantId, quantity: stockUnits(line.quantity) }));
  const note = args.note?.trim() ? stockText(args.note, 500, 'a transfer note') : undefined;
  const sourceKey = JSON.stringify([args.originId, actor.tokenIdentifier, stockText(args.requestId, 160, 'a request reference')]);
  const previous = await ctx.db.query('stockTransfers').withIndex('by_sourceKey', q => q.eq('sourceKey', sourceKey)).unique();
  if (previous) {
    const previousLines = await transferLines(ctx, previous._id);
    const quantities = new Map(previousLines.map(line => [line.variantId, line.quantity]));
    if (previous.destinationId !== args.destinationId || previous.note !== note || previousLines.length !== lines.length ||
        lines.some(line => quantities.get(line.variantId) !== line.quantity)) {
      expansionError('STOCK_KEY_CONFLICT', 'This transfer request was already used for different items.');
    }
    return previous._id;
  }
  const variants = await Promise.all(lines.map(line => ctx.db.get(line.variantId)));
  if (variants.some(variant => !variant || variant.status !== 'active')) {
    expansionError('INVALID_TRANSFER_ITEM', 'Only active variants can be added to a transfer.');
  }
  const transferId = await ctx.db.insert('stockTransfers', {
    originId: args.originId, destinationId: args.destinationId, sourceKey, state: 'draft',
    createdBy: actor.tokenIdentifier, createdAt: Date.now(), note,
  });
  for (const line of lines) {
    await ctx.db.insert('stockTransferLines', { transferId, ...line, received: 0, allocations: [], receivedLots: [] });
  }
  return transferId;
}

export async function sendStockTransfer(ctx: MutationCtx, actor: StaffActor, id: TransferId) {
  const transfer = await loadTransfer(ctx, id);
  const origin = await requireStockAccess(ctx, actor, transfer.originId, 'buyer');
  if (transfer.sentAt !== undefined) return id;
  if (transfer.state !== 'draft') expansionError('TRANSFER_NOT_DRAFT', 'Only a draft transfer can be sent.');
  const destination = await readBranch(ctx, transfer.destinationId);
  if (origin.branch.state !== 'active' || destination?.state !== 'active') {
    expansionError('INVALID_TRANSFER_BRANCHES', 'Both branches must be active to dispatch this transfer.');
  }
  for (const line of await transferLines(ctx, id)) {
    const { movementId } = await writeStockMovement(ctx, {
      branchId: transfer.originId, variantId: line.variantId, delta: -line.quantity, kind: 'transfer_out',
      sourceKey: `transfer:${id}:out:${line._id}`, sourceId: id, actor: actor.tokenIdentifier,
    });
    const lotMovement = await readLotMovement(ctx, movementId);
    await ctx.db.patch(line._id, { dispatchMovementId: movementId, allocations: lotMovement?.allocations ?? [] });
  }
  await ctx.db.patch(id, { state: 'inTransit', sentAt: Date.now(), sentBy: actor.tokenIdentifier });
  return id;
}

async function transferEvent(ctx: QueryCtx, transferId: TransferId, requestId: string, kind: TransferEventKind, payload: unknown) {
  const operationKey = stockText(requestId, 160, 'a request reference');
  const fingerprint = await sha256(JSON.stringify([kind, payload]));
  const existing = await ctx.db.query('stockTransferEvents').withIndex('by_transferId_and_operationKey',
    q => q.eq('transferId', transferId).eq('operationKey', operationKey)).unique();
  if (existing && existing.fingerprint !== fingerprint) {
    expansionError('STOCK_KEY_CONFLICT', 'This transfer request was already used for a different action.');
  }
  return { operationKey, fingerprint, existing };
}

function receiveLots(expected: Doc<'stockTransferLines'>, input: TransferReceiptLine) {
  const allocations = input.allocations ?? [];
  if (expected.allocations.length === 0 && allocations.length === 0) return expected.receivedLots;
  const sent = allocationCounts(expected.allocations);
  const received = allocationCounts(expected.receivedLots);
  const selected = new Set<Allocation['lotId']>();
  if (allocations.length > expected.allocations.length ||
      allocations.reduce((sum, line) => sum + stockUnits(line.quantity), 0) !== input.quantity) {
    expansionError('TRANSFER_LOT_MISMATCH', 'Confirm the shipped lot and quantity for every received unit.');
  }
  for (const { lotId, quantity } of allocations) {
    const total = (received.get(lotId) ?? 0) + quantity;
    if (selected.has(lotId) || total > (sent.get(lotId) ?? 0)) {
      expansionError('TRANSFER_LOT_MISMATCH', 'The received lot or quantity exceeds the dispatch.');
    }
    selected.add(lotId);
    received.set(lotId, total);
  }
  return Array.from(received, ([lotId, quantity]) => ({ lotId, quantity }));
}

export async function receiveStockTransfer(ctx: MutationCtx, actor: StaffActor, id: TransferId, requestId: string, inputs: TransferReceiptLine[]) {
  const transfer = await loadTransfer(ctx, id);
  const { branch } = await requireStockAccess(ctx, actor, transfer.destinationId, 'receiver');
  if (branch.state !== 'active') expansionError('INVALID_TRANSFER_BRANCHES', 'The destination must be active to receive stock.');
  if (!inputs.length || inputs.length > MAX_TRANSFER_LINES || new Set(inputs.map(line => line.lineId)).size !== inputs.length) {
    expansionError('INVALID_TRANSFER_LINES', 'Choose 1–12 distinct transfer lines to receive.');
  }
  const payload = inputs.map(line => [
    line.lineId, line.quantity, (line.allocations ?? []).map(lot => [lot.lotId, lot.quantity]).sort(),
  ]).sort();
  const { existing, ...event } = await transferEvent(ctx, id, requestId, 'receive', payload);
  if (existing) return existing._id;
  if (transfer.state !== 'inTransit') expansionError('TRANSFER_NOT_IN_TRANSIT', 'Only an in-transit transfer can be received.');
  const lines = await transferLines(ctx, id);
  const byId = new Map(lines.map(line => [line._id, line]));
  const receipts: Doc<'stockTransferEvents'>['receipts'] = [];
  const operationHash = await sha256(event.operationKey);
  for (const input of inputs) {
    const line = byId.get(input.lineId);
    const quantity = stockUnits(input.quantity);
    if (!line || quantity > line.quantity - line.received) {
      expansionError('TRANSFER_QUANTITY_EXCEEDED', 'The receipt exceeds the quantity still in transit.');
    }
    const receivedLots = receiveLots(line, input);
    const { movementId } = await writeStockMovement(ctx, {
      branchId: transfer.destinationId, variantId: line.variantId, delta: quantity, kind: 'transfer_in',
      sourceKey: `transfer:${id}:in:${operationHash}:${line._id}`, sourceId: id, actor: actor.tokenIdentifier,
      lotAllocations: input.allocations,
    });
    line.received += quantity;
    await ctx.db.patch(line._id, { received: line.received, receivedLots });
    receipts.push({ lineId: line._id, movementId, quantity, allocations: input.allocations ?? [] });
  }
  const now = Date.now();
  if (lines.every(line => line.received === line.quantity)) {
    await ctx.db.patch(id, { state: 'received', closedAt: now, closedBy: actor.tokenIdentifier });
  }
  return ctx.db.insert('stockTransferEvents', { transferId: id, kind: 'receive', actor: actor.tokenIdentifier, actorLabel: actor.email, actingBranchId: transfer.destinationId, createdAt: now, receipts, ...event });
}

export async function closeStockTransfer(
  ctx: MutationCtx, actor: StaffActor, id: TransferId, requestId: string, kind: 'short' | 'cancel', inputReason?: string, requestedBranchId?: Id<'branches'>,
) {
  const transfer = await loadTransfer(ctx, id);
  const actingBranchId = kind === 'cancel' ? transfer.originId : requestedBranchId ?? transfer.destinationId;
  if (kind === 'short') {
    const destination = await readBranch(ctx, transfer.destinationId);
    const closureBranchId = destination?.state === 'active' ? transfer.destinationId : transfer.originId;
    if (actingBranchId !== closureBranchId) {
      expansionError('TRANSFER_CLOSURE_BRANCH', 'Close the transfer from the branch responsible for its shortage.');
    }
  }
  await requireStockAccess(ctx, actor, actingBranchId, kind === 'short' ? 'lead' : 'requester');
  const reason = kind === 'short' ? stockText(inputReason ?? '', 500, 'a shortage reason') : undefined;
  const { existing, ...event } = await transferEvent(ctx, id, requestId, kind, reason ?? null);
  if (existing) return existing._id;
  if (transfer.state !== (kind === 'short' ? 'inTransit' : 'draft')) {
    expansionError('INVALID_TRANSFER_STATE', 'The transfer is already closed or has changed state.');
  }
  const shortages: Doc<'stockTransferEvents'>['receipts'] = [];
  if (kind === 'short') {
    for (const line of await transferLines(ctx, id)) {
      const quantity = line.quantity - line.received;
      if (!quantity) continue;
      const received = allocationCounts(line.receivedLots);
      const allocations = line.allocations.map(lot => ({ lotId: lot.lotId, quantity: lot.quantity - (received.get(lot.lotId) ?? 0) }))
        .filter(lot => lot.quantity > 0);
      const { movementId } = await writeStockMovement(ctx, {
        branchId: actingBranchId, variantId: line.variantId, delta: 0, kind: 'transfer_short',
        actor: actor.tokenIdentifier, actorLabel: actor.email, reason, sourceId: id, sourceRef: id,
        sourceKey: `transfer:${id}:short:${line._id}`, originalMovementId: line.dispatchMovementId,
      });
      shortages.push({ lineId: line._id, quantity, movementId, allocations });
    }
  }
  const now = Date.now();
  await ctx.db.patch(id, {
    state: kind === 'short' ? 'short' : 'cancelled', closedAt: now, closedBy: actor.tokenIdentifier, shortageReason: reason,
  });
  return ctx.db.insert('stockTransferEvents', {
    transferId: id, kind, reason, ...event, actor: actor.tokenIdentifier, actorLabel: actor.email, actingBranchId, createdAt: now, receipts: [], shortages,
  });
}
