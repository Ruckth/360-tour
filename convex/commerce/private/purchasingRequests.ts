/** Purchase request lifecycle: Draft → Awaiting approval → Approved | Needs changes | Declined; Closed and Deleted are terminal. */
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import type { StaffActor } from '../../auth/model';
import { reserveWrites } from '../../lib/readBudget';
import type { PurchasingResult, RequestStatus } from '../purchasingTables';
import {
  actorOf, draftChanges, expectRevision, fail, futureIsoDate, HISTORY_MAX_CHANGES, itemActive, itemLabel, lineCount, newReference, purchasingAccess,
  quantity, readItem, readRequestLines, reason, recordEvent, referenceCode, requireActiveItems, runOnce, text, uniqueBy, type Actor,
} from './purchasingCore';
import { otherApproverCount } from './stockAccess';

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

/** No need-by date sorts after every dated request in the approval queue. */
export const NO_NEED_BY = '9999-12-31';
const ITEM_SUMMARY_SIZE = 3;

async function setStatus(ctx: MutationCtx, request: Doc<'purchaseRequests'>, status: RequestStatus, patch: Partial<Doc<'purchaseRequests'>> = {}) {
  const lines = await readRequestLines(ctx, request._id);
  reserveWrites(ctx, lines.length + 1);
  for (const line of lines) await ctx.db.patch(line._id, { requestStatus: status });
  const revision = request.revision + 1;
  await ctx.db.patch(request._id, {
    needBySort: request.needBy ?? NO_NEED_BY,
    // A fresh approval has nothing committed yet; other statuses never show Fully ordered.
    fullyOrdered: status === 'approved' ? false : undefined,
    ...patch, status, revision, updatedAt: Date.now(),
  });
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
    const note = text(args.note, 'Note', 'note');
    const reads = await Promise.all(args.lines.map(line => {
      quantity(line.quantity, 'Requested quantity');
      return readItem(ctx, line.variantId);
    }));
    const itemSummary = reads.slice(0, ITEM_SUMMARY_SIZE).map(read => read.item.productName);
    const now = Date.now();
    let request: Doc<'purchaseRequests'>;
    let changes: ReturnType<typeof draftChanges> | undefined;
    let needBy: string | undefined;
    if (args.requestId) {
      request = await loadRequest(ctx, args.requestId);
      requireLive(request);
      needBy = futureIsoDate(args.needBy, 'Need-by date', request.needBy, now);
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
      await ctx.db.patch(request._id, {
        needBy, note, itemSummary, needBySort: needBy ?? NO_NEED_BY, lineCount: args.lines.length, revision: request.revision + 1, updatedAt: now,
      });
      request = { ...request, revision: request.revision + 1 };
    } else {
      needBy = futureIsoDate(args.needBy, 'Need-by date', undefined, now);
      const reference = await newReference(ctx, 'purchaseRequests', 'PR', now);
      reserveWrites(ctx, 1);
      const id = await ctx.db.insert('purchaseRequests', {
        branchId: args.branchId, reference, referenceCode: referenceCode(reference), status: 'draft',
        requesterKey: actor.actorKey, requesterLabel: actor.actorLabel,
        needBy, note, itemSummary, needBySort: needBy ?? NO_NEED_BY, lineCount: args.lines.length, revision: 1, createdAt: now, updatedAt: now,
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
  apply: (request: Doc<'purchaseRequests'>, actor: Actor) => Promise<number | { revision: number; warning?: string }>,
  extra: Record<string, unknown> = {},
) {
  const request = await loadRequest(ctx, args.requestId);
  await purchasingAccess(ctx, staff, request.branchId, permission);
  const actor = actorOf(staff);
  const { operationKey, ...payload } = args;
  return runOnce(ctx, actor, request.branchId, `request.${action}`, operationKey, { ...payload, ...extra }, async () => {
    requireLive(request);
    expectRevision(request.revision, args.expectedRevision, 'request');
    const applied = await apply(request, actor);
    if (typeof applied === 'number') return result(request, applied);
    return { ...result(request, applied.revision), ...(applied.warning ? { warning: applied.warning } : {}) };
  });
}

/** The single-approver warning: nobody else at the branch can approve this requester's request. */
export async function approverWarning(ctx: QueryCtx, staff: StaffActor, branchId: Id<'branches'>) {
  const grantId = staff.grantId ?? (await ctx.db.query('staffGrants')
    .withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', staff.tokenIdentifier)).unique())?._id;
  if (await otherApproverCount(ctx, branchId, grantId) > 0) return undefined;
  const branch = await ctx.db.get(branchId);
  return `No other approver at ${branch?.name ?? 'this branch'} — ask the owner to assign a stock approver in Branch stock access.`;
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
    // Submission still goes through; self-approval stays blocked, so the requester is told who is missing.
    return { revision, warning: await approverWarning(ctx, staff, request.branchId) };
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
    const decided: { field: string; before: number; after: number }[] = [];
    for (const line of lines) {
      const approvedQuantity = overrides.get(line._id) ?? line.quantity;
      quantity(approvedQuantity, 'Approved quantity', 0);
      if (approvedQuantity > line.quantity) fail('INVALID_QUANTITY', 'Approve at most the requested quantity.');
      total += approvedQuantity;
      decided.push({ field: `lines[${itemLabel(line.item)}].approved`, before: line.quantity, after: approvedQuantity });
      await ctx.db.patch(line._id, { approvedQuantity });
    }
    if (total === 0) fail('INVALID_QUANTITY', 'Approve at least one unit, or decline the request.');
    const { revision } = await setStatus(ctx, request, 'approved', {
      decidedByKey: actor.actorKey, decidedByLabel: actor.actorLabel, decidedAt: Date.now(),
    });
    // The decision records requested → approved per line; reduced lines first so they survive the history bound.
    decided.sort((a, b) => Number(b.after !== b.before) - Number(a.after !== a.before));
    const kept = decided.length > HISTORY_MAX_CHANGES ? decided.slice(0, HISTORY_MAX_CHANGES - 1) : decided;
    const changes = [...kept, ...(kept.length < decided.length ? [{ field: 'changes.omitted', before: null, after: decided.length - kept.length }] : [])];
    await recordEvent(ctx, actor, { entity: 'request', entityId: request._id, branchId: request.branchId, action: 'approved', changes });
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

export type CopyRequestArgs = { requestId: Id<'purchaseRequests'>; operationKey: string };

/**
 * Copy a declined, closed or sent-back request into a new draft for the same requester. Archived items are left out
 * (`skipped`); the original stays untouched and both histories link the other reference.
 */
export async function copyRequest(ctx: MutationCtx, staff: StaffActor, args: CopyRequestArgs) {
  const source = await loadRequest(ctx, args.requestId);
  await purchasingAccess(ctx, staff, source.branchId, 'requester');
  const actor = actorOf(staff);
  const { operationKey, ...payload } = args;
  return runOnce(ctx, actor, source.branchId, 'request.copy', operationKey, payload, async (): Promise<PurchasingResult> => {
    requireLive(source);
    requireOwn(source, actor);
    requireStatus(source, 'declined', 'closed', 'needs_changes');
    const old = await readRequestLines(ctx, source._id);
    const reads = await Promise.all(old.map(line => readItem(ctx, line.variantId).catch(() => null)));
    const kept = old.flatMap((line, i) => {
      const read = reads[i];
      return read && itemActive(read) ? [{ line, item: read.item }] : [];
    });
    if (!kept.length) fail('NO_LINES', 'Every item on this request is archived. Start a new request instead.');
    const now = Date.now();
    const reference = await newReference(ctx, 'purchaseRequests', 'PR', now);
    reserveWrites(ctx, 1 + kept.length);
    const id = await ctx.db.insert('purchaseRequests', {
      branchId: source.branchId, reference, referenceCode: referenceCode(reference), status: 'draft',
      requesterKey: actor.actorKey, requesterLabel: actor.actorLabel, note: source.note,
      itemSummary: kept.slice(0, ITEM_SUMMARY_SIZE).map(row => row.item.productName), needBySort: NO_NEED_BY,
      lineCount: kept.length, revision: 1, copiedFromId: source._id, copiedFromReference: source.reference, createdAt: now, updatedAt: now,
    });
    for (const [sort, { line, item }] of kept.entries()) {
      await ctx.db.insert('purchaseRequestLines', {
        requestId: id, branchId: source.branchId, requesterKey: actor.actorKey, variantId: line.variantId, item,
        quantity: line.quantity, approvedQuantity: 0, committedQuantity: 0, requestStatus: 'draft', sort,
      });
    }
    const skipped = old.length - kept.length;
    await recordEvent(ctx, actor, {
      entity: 'request', entityId: id, branchId: source.branchId, action: 'copied', relatedId: source._id,
      changes: [{ field: 'copiedFrom', before: null, after: source.reference }, ...(skipped ? [{ field: 'skippedArchived', before: null, after: skipped }] : [])],
    });
    await recordEvent(ctx, actor, {
      entity: 'request', entityId: source._id, branchId: source.branchId, action: 'copied_to', relatedId: id,
      changes: [{ field: 'copiedTo', before: null, after: reference }],
    });
    return { id, reference, revision: 1, ...(skipped ? { skipped } : {}) };
  });
}
