/** Purchase request lifecycle: Draft → Awaiting approval → Approved | Needs changes | Declined; Closed and Deleted are terminal. */
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import type { StaffActor } from '../../auth/model';
import { reserveWrites } from '../../lib/readBudget';
import type { PurchasingResult, RequestStatus } from '../purchasingTables';
import {
  actorOf, draftChanges, expectRevision, fail, isoDate, lineCount, newReference, purchasingAccess, quantity, readItem,
  readRequestLines, reason, recordEvent, requireActiveItems, runOnce, text, uniqueBy, type Actor,
} from './purchasingCore';

type Line = { variantId: Id<'productVariants'>; quantity: number };

export type SaveRequestArgs = {
  branchId: Id<'branches'>; requestId?: Id<'purchaseRequests'>; expectedRevision?: number;
  needBy?: string; note?: string; lines: Line[]; operationKey: string;
};

/** Any stored request, including a logically deleted one, so callers can authorize and replay before checking state. */
async function loadRequest(ctx: MutationCtx, requestId: Id<'purchaseRequests'>) {
  const request = await ctx.db.get(requestId);
  if (!request) fail('REQUEST_NOT_FOUND', 'This request no longer exists.');
  return request;
}

function requireLive(request: Doc<'purchaseRequests'>) {
  if (request.status === 'deleted') fail('REQUEST_NOT_FOUND', 'This request no longer exists.');
}

async function setStatus(ctx: MutationCtx, request: Doc<'purchaseRequests'>, status: RequestStatus, patch: Partial<Doc<'purchaseRequests'>> = {}) {
  const lines = await readRequestLines(ctx, request._id);
  reserveWrites(ctx, lines.length + 1);
  for (const line of lines) await ctx.db.patch(line._id, { requestStatus: status });
  const revision = request.revision + 1;
  await ctx.db.patch(request._id, { ...patch, status, revision, updatedAt: Date.now() });
  return { lines, revision };
}

const result = (request: Doc<'purchaseRequests'>, revision: number): PurchasingResult =>
  ({ id: request._id, reference: request.reference, revision });

export async function saveRequestDraft(ctx: MutationCtx, staff: StaffActor, args: SaveRequestArgs) {
  await purchasingAccess(ctx, staff, args.branchId, 'requester');
  const actor = actorOf(staff);
  const { operationKey, ...payload } = args;
  return runOnce(ctx, actor, args.branchId, 'request.save', operationKey, payload, async () => {
    lineCount(args.lines, 'request lines');
    uniqueBy(args.lines, line => line.variantId, 'Each item can appear once per request.');
    const needBy = isoDate(args.needBy, 'Need-by date');
    const note = text(args.note, 'Note', 'note');
    const reads = await Promise.all(args.lines.map(line => {
      quantity(line.quantity, 'Requested quantity');
      return readItem(ctx, line.variantId);
    }));
    const now = Date.now();
    let request: Doc<'purchaseRequests'>;
    let changes: ReturnType<typeof draftChanges> | undefined;
    if (args.requestId) {
      request = await loadRequest(ctx, args.requestId);
      requireLive(request);
      if (request.branchId !== args.branchId) fail('REQUEST_NOT_FOUND', 'This request belongs to another branch.');
      if (request.requesterKey !== actor.actorKey) fail('STOCK_FORBIDDEN', 'Only the requester can edit this request.');
      if (request.status !== 'draft' && request.status !== 'needs_changes') fail('REQUEST_LOCKED', 'Withdraw the request before editing it.');
      expectRevision(request.revision, args.expectedRevision ?? -1, 'request');
      const old = await readRequestLines(ctx, request._id);
      changes = draftChanges(
        { before: { needBy: request.needBy, note: request.note }, after: { needBy, note } },
        { before: old.map(line => ({ variantId: line.variantId, item: line.item, quantity: line.quantity })),
          after: args.lines.map((line, i) => ({ variantId: line.variantId, item: reads[i].item, quantity: line.quantity })) },
      );
      reserveWrites(ctx, old.length + 1);
      for (const line of old) await ctx.db.delete(line._id);
      await ctx.db.patch(request._id, { needBy, note, lineCount: args.lines.length, revision: request.revision + 1, updatedAt: now });
      request = { ...request, revision: request.revision + 1 };
    } else {
      const reference = await newReference(ctx, 'purchaseRequests', 'PR', now);
      reserveWrites(ctx, 1);
      const id = await ctx.db.insert('purchaseRequests', {
        branchId: args.branchId, reference, status: 'draft', requesterKey: actor.actorKey, requesterLabel: actor.actorLabel,
        needBy, note, lineCount: args.lines.length, revision: 1, createdAt: now, updatedAt: now,
      });
      request = (await ctx.db.get(id))!;
    }
    reserveWrites(ctx, args.lines.length);
    for (const [sort, line] of args.lines.entries()) {
      await ctx.db.insert('purchaseRequestLines', {
        requestId: request._id, branchId: request.branchId, requesterKey: request.requesterKey,
        variantId: line.variantId, item: reads[sort].item, quantity: line.quantity,
        approvedQuantity: 0, committedQuantity: 0, requestStatus: request.status, sort,
      });
    }
    await recordEvent(ctx, actor, {
      entity: 'request', entityId: request._id, branchId: request.branchId, action: args.requestId ? 'edited' : 'created',
      ...(changes?.length ? { changes } : {}),
    });
    return result(request, request.revision);
  });
}

type Transition = {
  requestId: Id<'purchaseRequests'>; expectedRevision: number; operationKey: string; reason?: string;
};

/** Load, authorize at the request's branch and replay-guard one transition. */
async function transition(
  ctx: MutationCtx, staff: StaffActor, args: Transition, action: string,
  permission: 'requester' | 'approver' | 'lead',
  apply: (request: Doc<'purchaseRequests'>, actor: Actor) => Promise<number>,
  extra: Record<string, unknown> = {},
) {
  const request = await loadRequest(ctx, args.requestId);
  await purchasingAccess(ctx, staff, request.branchId, permission);
  const actor = actorOf(staff);
  const { operationKey, ...payload } = args;
  return runOnce(ctx, actor, request.branchId, `request.${action}`, operationKey, { ...payload, ...extra }, async () => {
    requireLive(request);
    expectRevision(request.revision, args.expectedRevision, 'request');
    const revision = await apply(request, actor);
    return result(request, revision);
  });
}

function requireOwn(request: Doc<'purchaseRequests'>, actor: Actor) {
  if (request.requesterKey !== actor.actorKey) fail('STOCK_FORBIDDEN', 'Only the requester can change this request.');
}

function requireStatus(request: Doc<'purchaseRequests'>, ...statuses: RequestStatus[]) {
  if (!statuses.includes(request.status)) fail('REQUEST_STATE', 'This request can no longer take that action.', { status: request.status });
}

export function submitRequest(ctx: MutationCtx, staff: StaffActor, args: Transition) {
  return transition(ctx, staff, args, 'submit', 'requester', async (request, actor) => {
    requireOwn(request, actor);
    requireStatus(request, 'draft', 'needs_changes');
    const lines = await readRequestLines(ctx, request._id);
    if (!lines.length) fail('NO_LINES', 'Add at least one item before submitting.');
    await requireActiveItems(ctx, lines.map(line => line.variantId));
    const { revision } = await setStatus(ctx, request, 'awaiting_approval', { submittedAt: Date.now() });
    await recordEvent(ctx, actor, { entity: 'request', entityId: request._id, branchId: request.branchId,
      action: request.status === 'needs_changes' ? 'resubmitted' : 'submitted' });
    return revision;
  });
}

export function withdrawRequest(ctx: MutationCtx, staff: StaffActor, args: Transition) {
  return transition(ctx, staff, args, 'withdraw', 'requester', async (request, actor) => {
    requireOwn(request, actor);
    requireStatus(request, 'awaiting_approval');
    const { revision } = await setStatus(ctx, request, 'draft');
    await recordEvent(ctx, actor, { entity: 'request', entityId: request._id, branchId: request.branchId, action: 'withdrawn' });
    return revision;
  });
}

/** Delete a draft, or discard a request sent back for changes (with a reason). History keeps who and when. */
export function deleteRequest(ctx: MutationCtx, staff: StaffActor, args: Transition) {
  return transition(ctx, staff, args, 'delete', 'requester', async (request, actor) => {
    requireOwn(request, actor);
    requireStatus(request, 'draft', 'needs_changes');
    const why = request.status === 'needs_changes' ? reason(args.reason) : text(args.reason, 'Reason', 'reason');
    const { revision } = await setStatus(ctx, request, 'deleted', why ? { lastReason: why } : {});
    await recordEvent(ctx, actor, { entity: 'request', entityId: request._id, branchId: request.branchId,
      action: request.status === 'draft' ? 'deleted' : 'discarded', reason: why });
    return revision;
  });
}

export type ApproveArgs = Transition & { lines?: { lineId: Id<'purchaseRequestLines'>; approvedQuantity: number }[] };

/** A different designated approver approves; self-approval is blocked even for staff holding both grants. */
export function approveRequest(ctx: MutationCtx, staff: StaffActor, args: ApproveArgs) {
  return transition(ctx, staff, args, 'approve', 'approver', async (request, actor) => {
    if (request.requesterKey === actor.actorKey) fail('SELF_APPROVAL', 'Ask another approver to approve your own request.');
    requireStatus(request, 'awaiting_approval');
    const lines = await readRequestLines(ctx, request._id);
    await requireActiveItems(ctx, lines.map(line => line.variantId));
    const overrides = new Map((args.lines ?? []).map(line => [line.lineId, line.approvedQuantity]));
    for (const id of overrides.keys()) if (!lines.some(line => line._id === id)) fail('REQUEST_LINE_NOT_FOUND', 'A line is not on this request.');
    let total = 0;
    reserveWrites(ctx, lines.length);
    for (const line of lines) {
      const approvedQuantity = overrides.get(line._id) ?? line.quantity;
      quantity(approvedQuantity, 'Approved quantity', 0);
      if (approvedQuantity > line.quantity) fail('INVALID_QUANTITY', 'Approve at most the requested quantity.');
      total += approvedQuantity;
      await ctx.db.patch(line._id, { approvedQuantity });
    }
    if (total === 0) fail('INVALID_QUANTITY', 'Approve at least one unit, or decline the request.');
    const { revision } = await setStatus(ctx, request, 'approved', {
      decidedByKey: actor.actorKey, decidedByLabel: actor.actorLabel, decidedAt: Date.now(),
    });
    await recordEvent(ctx, actor, { entity: 'request', entityId: request._id, branchId: request.branchId, action: 'approved' });
    return revision;
  });
}

function decide(action: 'send_back' | 'decline', status: RequestStatus) {
  return (ctx: MutationCtx, staff: StaffActor, args: Transition) =>
    transition(ctx, staff, args, action, 'approver', async (request, actor) => {
      if (request.requesterKey === actor.actorKey) fail('SELF_APPROVAL', 'Ask another approver to decide on your own request.');
      requireStatus(request, 'awaiting_approval');
      const why = reason(args.reason);
      const { revision } = await setStatus(ctx, request, status, {
        lastReason: why, decidedByKey: actor.actorKey, decidedByLabel: actor.actorLabel, decidedAt: Date.now(),
      });
      await recordEvent(ctx, actor, { entity: 'request', entityId: request._id, branchId: request.branchId, action, reason: why });
      return revision;
    });
}
export const sendBackRequest = decide('send_back', 'needs_changes');
export const declineRequest = decide('decline', 'declined');

/** Stock lead closes uncommitted demand. Linked orders keep their committed quantities. */
export function closeRequest(ctx: MutationCtx, staff: StaffActor, args: Transition) {
  return transition(ctx, staff, args, 'close', 'lead', async (request, actor) => {
    requireStatus(request, 'approved');
    const why = reason(args.reason);
    const { revision } = await setStatus(ctx, request, 'closed', { lastReason: why });
    await recordEvent(ctx, actor, { entity: 'request', entityId: request._id, branchId: request.branchId, action: 'closed', reason: why });
    return revision;
  });
}
