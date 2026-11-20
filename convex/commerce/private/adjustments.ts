import { maskVoucherCodes } from './voucherCodes';
import { ConvexError, convexToJson, type Infer } from 'convex/values';
import { internal } from '../../_generated/api';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { staffCapabilities, type StaffActor } from '../../auth/model';
import { readBudget, reserveWrites } from '../../lib/readBudget';
import { cashierRules } from '../../settings/model';
import { editReasons, stockReasons } from '../../shared/commerce/reasons';
import { sha256 } from '../../shared/displayTokens';
import { assertSatang } from '../../shared/money';
import { APPROVAL_TTL_MS } from '../../shared/staffTypes';
import { resortTodayIso } from '../../shared/time';
import type { adjustmentEffect, adjustmentFields, adjustmentKind, adjustmentTarget } from '../validators';
import { transferHistorySourceKey } from './history';
import { bumpOrderCommerceRevision } from './orderRevision';

export type AdjustmentTarget = Infer<typeof adjustmentTarget>;
type AdjustmentKind = Infer<typeof adjustmentKind>;
type Fields = Infer<typeof adjustmentFields>;
type Effect = Infer<typeof adjustmentEffect>;
type AuditRow = Omit<Doc<'commerceAdjustments'>, '_id' | '_creationTime'>;
type Approval = Extract<Doc<'staffApprovalRequests'>, { kind: 'adjustment' }>;
type ExpectedRevision = Approval['payload']['expectedRevisions'][number];

export type AdjustmentCommand = {
  target: AdjustmentTarget;
  kind: AdjustmentKind;
  input: Fields;
  expectedRevision: number;
  relatedRevisions?: ExpectedRevision[];
  clientKey: string;
  reasonCode?: string;
  reasonText?: string;
};

export type AppliedAdjustment = {
  status: 'applied';
  adjustmentId: Id<'commerceAdjustments'>;
  revision: number;
  effects: Effect[];
};
type RequestedAdjustment = {
  status: 'approvalRequired';
  requestId: Id<'staffApprovalRequests'>;
  expiresAt: number;
};

export type AdjustmentChange = {
  before: Fields;
  after: Fields;
  paidLiabilityDelta?: number;
  goodwillFaceValueDelta?: number;
  quantityDelta?: number;
  consent?: AuditRow['consent'];
  apply: (args: {
    revisionAfter: number; recordedAt: number; sourceKey: string;
    reasonCode?: string; reasonText?: string;
  }) => Promise<Effect[]>;
};

/**
 * The owning command supplies the scope check for the primary and related targets.
 * Scope must be read-only and independent of revision freshness so authorized retries still work.
 * Prepare must be read-only. Apply writes the parent revision and any ledger effects in this transaction.
 * Use the supplied source key and reasons for the primary ledger effect and return the linked IDs,
 * the target's own ledger entry first: for a voucher or grant the helper stores the changed fields
 * on it for History; a stock movement already records its count before → after.
 * A changed part naming services, a variant or a product may carry its display `label`: staff
 * History shows the record's current name and falls back to that label once the record is gone.
 * Owners meter their own reads and reserve their own parent and ledger writes.
 */
export type AdjustmentWriter = {
  assertScope: (ctx: MutationCtx, actor: StaffActor, command: AdjustmentCommand) => Promise<void>;
  prepare: (ctx: MutationCtx, actor: StaffActor, command: AdjustmentCommand) => Promise<AdjustmentChange>;
};

const MAX_AUDIT_BYTES = 8 * 1024;
const MAX_REVISIONS = 24;
const encoder = new TextEncoder();
const keyForApproval = (id: Id<'staffApprovalRequests'>) => `approval:${id}`;
const ledgerKind: Partial<Record<AdjustmentTarget['targetType'], Effect['kind']>> = {
  voucher: 'voucherEntry', grant: 'sessionUse', stock: 'stockMovement',
};

function refuse(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

function assertKnownReasonCode({ target, reasonCode }: AdjustmentCommand) {
  const reasons = target.targetType === 'stock' ? stockReasons : editReasons;
  if (reasonCode && !reasons.some(reason => reason === reasonCode)) {
    refuse('INVALID_ADJUSTMENT_REASON', 'Choose a valid reason for this edit.');
  }
}

async function measured<T>(ctx: MutationCtx, read: () => Promise<T>) {
  const budget = readBudget(ctx);
  budget.range();
  budget.assert();
  const row = await read();
  if (row !== null) budget.document(row);
  budget.assert();
  return row;
}

function maskFields(fields: Fields): Fields {
  const mask = (key: string, value: Fields[string]): Fields[string] => {
    if (typeof value === 'string') {
      if (/^(?:active|new|old|previous|replacement)?(?:voucher)?code$/i.test(key)) {
        const suffix = value.replace(/[^a-z0-9]/gi, '').slice(-4);
        return suffix.length === 4 ? `GV-••••-${suffix}` : '••••';
      }
      return maskVoucherCodes(value);
    }
    if (Array.isArray(value)) return value.map(item => mask(key, item)) as Fields[string];
    if (value !== null && typeof value === 'object') return maskFields(value) as Fields[string];
    return value;
  };
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, mask(key, value)]));
}

function validateCommand(command: AdjustmentCommand) {
  const { target, clientKey, expectedRevision, relatedRevisions = [] } = command;
  const reasonCode = command.reasonCode?.trim();
  const reasonText = command.reasonText?.trim();
  if (!clientKey.trim() || clientKey.length > 128 || clientKey.startsWith('approval:') || clientKey.startsWith('catalogue:')) {
    refuse('INVALID_ADJUSTMENT_KEY', 'Enter a valid edit request key.');
  }
  if ((command.reasonText?.length ?? 0) > 500 || (reasonCode?.length ?? 0) > 500) {
    refuse('INVALID_ADJUSTMENT_REASON', 'The reason must be at most 500 characters.');
  }
  const requiresReason = ['voucher', 'grant', 'stock', 'handover', 'order', 'settings'].includes(target.targetType);
  if ((requiresReason && !reasonCode) || (reasonCode?.toLowerCase() === 'other' && !reasonText)) {
    refuse('INVALID_ADJUSTMENT_REASON', 'Choose a reason and describe it when selecting Other.');
  }

  const revisions = [{ target, revision: expectedRevision }, ...relatedRevisions];
  if (revisions.length > MAX_REVISIONS || new Set(revisions.map(row => row.target.targetId)).size !== revisions.length ||
    revisions.some(row => !Number.isSafeInteger(row.revision) || row.revision < 0 || row.revision === Number.MAX_SAFE_INTEGER)) {
    refuse('INVALID_ADJUSTMENT_REVISION', 'Enter a valid revision for each edited record.');
  }
  const normalized = {
    target, kind: command.kind, input: command.input, clientKey,
    expectedRevision,
    relatedRevisions: [...relatedRevisions].sort((a, b) => a.target.targetId.localeCompare(b.target.targetId)),
    ...(reasonCode ? { reasonCode } : {}),
    ...(reasonText ? { reasonText } : {}),
  };
  const serialized = JSON.stringify(convexToJson(normalized));
  if (encoder.encode(serialized).length > MAX_AUDIT_BYTES) refuse('ADJUSTMENT_TOO_LARGE', 'The edit exceeds 8 KiB.');
  return { command: normalized, serialized };
}

async function assertRevisions(ctx: MutationCtx, command: AdjustmentCommand) {
  const orderIds = new Set<Id<'orders'>>();
  const handoverIds: Id<'handovers'>[] = [];
  for (const { target, revision } of [{ target: command.target, revision: command.expectedRevision }, ...(command.relatedRevisions ?? [])]) {
    const row = await measured(ctx, () => ctx.db.get(target.targetId));
    if (!row) refuse('ADJUSTMENT_TARGET_MISSING', 'The edited record no longer exists.');
    const current = command.kind === 'amendPayment' && 'orderNumber' in row
      ? row.correctionRevision ?? 0
      : 'revision' in row ? row.revision ?? 0 : 0;
    if (current !== revision) throw new ConvexError({
      code: 'STALE_ADJUSTMENT_REVISION', message: 'This record changed. Review the edit again.',
      targetType: target.targetType, targetId: target.targetId, expectedRevision: revision, currentRevision: current,
    });
    if ('pendingReturnId' in row && row.pendingReturnId) {
      refuse('ADJUSTMENT_RETURN_PENDING', 'Finish the open return before editing this record.');
    }
    if ('orderNumber' in row) orderIds.add(row._id);
    if ('effectiveExpiresAt' in row) orderIds.add(row.source.orderId);
    if ('grantServiceIds' in row) orderIds.add(row.orderId);
    if ('withGuest' in row) {
      handoverIds.push(row._id);
      orderIds.add(row.orderId);
      if (row.successorOrderId) orderIds.add(row.successorOrderId);
    }
  }
  return { orderIds, handoverIds };
}

type CashierRule = 'benefitEdit' | 'sessionWaive' | 'paymentFix';
async function approvalRules(ctx: MutationCtx) {
  // The settings helper reads at most one row, including when it returns defaults.
  return await measured(ctx, () => cashierRules(ctx));
}

/** Shared rule decision for benefit writers, including D14 no-show waivers. */
export async function cashierAdjustmentRoute(ctx: MutationCtx, actor: StaffActor, rule: CashierRule) {
  if (!actor.capabilities.checkout || !actor.role) refuse('ADJUSTMENT_FORBIDDEN', 'Staff access is required.');
  return actor.role === 'cashier' && (await approvalRules(ctx))[rule] !== 'cashier' ? 'approval' : 'direct';
}

function adjustmentPermission(actor: StaffActor, { target, kind, input }: AdjustmentCommand): 'direct' | 'approval' | CashierRule {
  if (!actor.capabilities.checkout || !actor.role) refuse('ADJUSTMENT_FORBIDDEN', 'Staff access is required.');
  if (target.targetType === 'settings' && kind === 'updateSettings' && Object.keys(input).length === 1 &&
      (typeof input.paused === 'boolean' || input.paymentsMode === 'attempts')) {
    if (!actor.capabilities.approve) {
      refuse('ADJUSTMENT_FORBIDDEN', 'This payment rollout edit requires a manager.');
    }
    return 'direct';
  }
  if (target.targetType === 'settings' || kind === 'updateSettings' || kind === 'shorten' || kind === 'narrowServices') {
    if (actor.role !== 'owner') refuse('ADJUSTMENT_FORBIDDEN', 'This edit requires the owner.');
    return 'direct';
  }
  if (actor.role !== 'cashier') return 'direct';
  if (target.targetType === 'voucher' && kind === 'rename') return 'direct';
  if (target.targetType === 'order' && kind === 'amendPayment') return 'paymentFix';
  if (target.targetType === 'voucher' || target.targetType === 'grant') {
    if (kind === 'extend' || kind === 'pause' || kind === 'resume') return 'benefitEdit';
    if (kind === 'addGoodwill') return 'approval';
  }
  refuse('ADJUSTMENT_FORBIDDEN', 'This edit requires a manager.');
}

async function requesterGrant(ctx: MutationCtx, token: string) {
  return await measured(ctx, () => ctx.db.query('staffGrants').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', token)).unique());
}

async function findApplied(ctx: MutationCtx, requesterKey: string, clientKey: string) {
  return await measured(ctx, () => ctx.db.query('commerceAdjustments')
    .withIndex('by_requesterKey_and_clientKey', q => q.eq('requesterKey', requesterKey).eq('clientKey', clientKey)).unique());
}

async function findRequest(ctx: MutationCtx, requester: string, clientKey: string) {
  const request = await measured(ctx, () => ctx.db.query('staffApprovalRequests')
    .withIndex('by_kind_and_requesterTokenIdentifier_and_payload_clientKey', q =>
      q.eq('kind', 'adjustment').eq('requesterTokenIdentifier', requester).eq('payload.clientKey', clientKey)).unique());
  return request?.kind === 'adjustment' ? request : null;
}

function checkReplay(stored: string, fingerprint: string) {
  if (stored !== fingerprint) refuse('ADJUSTMENT_KEY_CONFLICT', 'This request key was used for a different edit.');
}

function applied(row: Doc<'commerceAdjustments'>): AppliedAdjustment {
  return { status: 'applied', adjustmentId: row._id, revision: row.revisionAfter, effects: row.effects ?? [] };
}

function requestResult(request: Approval): RequestedAdjustment {
  return { status: 'approvalRequired', requestId: request._id, expiresAt: request.expiresAt };
}

async function applyChange(
  ctx: MutationCtx, actor: Pick<StaffActor, 'tokenIdentifier' | 'email'>, command: AdjustmentCommand,
  change: AdjustmentChange, requesterKey: string, fingerprint: string, ownership: Awaited<ReturnType<typeof assertRevisions>>,
  approvalId?: Approval['_id'],
): Promise<AppliedAdjustment> {
  const { target, kind } = command;
  const recordedAt = Date.now();
  const revisionAfter = command.expectedRevision + 1;
  if (kind === 'shorten' || kind === 'narrowServices' || kind === 'transfer' || kind === 'substituteService') {
    if (!change.consent?.evidence.trim() || !Number.isFinite(change.consent.recordedAt) || change.consent.recordedAt > recordedAt) {
      refuse('ADJUSTMENT_CONSENT_REQUIRED', 'Record the guest’s agreement before making this edit.');
    }
  }
  const clientKey = approvalId ? keyForApproval(approvalId) : command.clientKey;
  const audit: AuditRow = {
    ...target, kind, before: maskFields(change.before), after: maskFields(change.after),
    revisionBefore: command.expectedRevision, revisionAfter,
    paidLiabilityDelta: assertSatang(change.paidLiabilityDelta ?? 0),
    goodwillFaceValueDelta: assertSatang(change.goodwillFaceValueDelta ?? 0),
    quantityDelta: change.quantityDelta ?? 0,
    ...(command.reasonCode ? { reasonCode: maskVoucherCodes(command.reasonCode) } : {}),
    ...(command.reasonText ? { reasonText: maskVoucherCodes(command.reasonText) } : {}),
    ...(approvalId ? { approvalId } : {}),
    ...(change.consent ? { consent: { ...change.consent, evidence: maskVoucherCodes(change.consent.evidence) } } : {}),
    actor: actor.tokenIdentifier, actorLabel: actor.email,
    requesterKey, clientKey, fingerprint, recordedAt, businessDate: resortTodayIso(recordedAt),
  };
  if (!Number.isSafeInteger(audit.quantityDelta)) refuse('INVALID_ADJUSTMENT_QUANTITY', 'The quantity change must be a whole number.');
  assertAuditSize(audit);
  const sourceKey = kind === 'transfer' && (target.targetType === 'grant' || target.targetType === 'voucher')
    ? transferHistorySourceKey(target, revisionAfter)
    : approvalId ? clientKey : `adjustment:${await sha256(JSON.stringify([requesterKey, clientKey]))}`;
  reserveWrites(ctx, 1);
  const effects = await change.apply({
    revisionAfter, recordedAt, sourceKey, reasonCode: audit.reasonCode, reasonText: audit.reasonText,
  });
  const requiredEffect = ledgerKind[target.targetType];
  const primary = requiredEffect && effects.find(effect => effect.kind === requiredEffect);
  if (requiredEffect && !primary) {
    throw new Error(`The ${target.targetType} adjustment did not write its ledger entry`);
  }
  if (kind === 'moveRoomCharge') {
    for (const handoverId of ownership.handoverIds) {
      const row = await measured(ctx, () => ctx.db.get(handoverId));
      if (row) {
        ownership.orderIds.add(row.orderId);
        if (row.successorOrderId) ownership.orderIds.add(row.successorOrderId);
      }
    }
  }
  await bumpOrderCommerceRevision(ctx, ownership.orderIds);
  const row = { ...audit, ...(effects.length ? { effects } : {}) };
  assertAuditSize(row);
  const adjustmentId = await ctx.db.insert('commerceAdjustments', row);
  // A stock movement is its own History row (its count before → after); only benefit ledgers keep the fields.
  if (primary && primary.kind !== 'stockMovement') await recordLedgerChanges(ctx, target, primary, adjustmentId, audit);
  return { status: 'applied', adjustmentId, revision: revisionAfter, effects };
}

type CatalogueTarget = Extract<AdjustmentTarget, { targetType: 'service' | 'property' }>;

export function catalogueRevision(target: CatalogueTarget, record: { revision?: number }, expectedRevision?: number) {
  const currentRevision = record.revision ?? 0;
  if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
    throw new ConvexError({
      code: 'STALE_ADJUSTMENT_REVISION', message: 'This record changed. Review the edit again.',
      ...target, expectedRevision, currentRevision,
    });
  }
  return currentRevision;
}

/** Keep catalogue saves compatible with old callers and large pre-existing field values. */
export async function catalogueFields<Patch extends { [K in keyof Patch]: Fields[string] | undefined }>(
  record: { [K in keyof Patch]?: Fields[string] }, patch: Patch,
): Promise<Pick<AdjustmentChange, 'before' | 'after'>> {
  const before: Fields = {};
  const after: Fields = {};
  const sizes = [];
  for (const field of Object.keys(patch) as (keyof Patch & string)[]) {
    const previous = record[field] ?? null;
    const next = patch[field] ?? null;
    const oldJson = JSON.stringify(convexToJson(previous));
    const newJson = JSON.stringify(convexToJson(next));
    if (oldJson === newJson) continue;
    before[field] = previous;
    after[field] = next;
    sizes.push({ field, oldJson, newJson, bytes: encoder.encode(oldJson + newJson).length });
  }
  // Leave room for audit metadata and reasons. Large values retain a fingerprint of each side.
  const size = () => encoder.encode(JSON.stringify(convexToJson([maskFields(before), maskFields(after)]))).length;
  for (const { field, oldJson, newJson } of sizes.sort((a, b) => b.bytes - a.bytes)) {
    if (size() <= 5500) break;
    before[field] = { sha256: await sha256(oldJson), bytes: encoder.encode(oldJson).length };
    after[field] = { sha256: await sha256(newJson), bytes: encoder.encode(newJson).length };
  }
  return { before, after };
}

/** Old admin forms have no client key. A target revision uniquely identifies each accepted save. */
export async function recordCatalogueEdit(
  ctx: MutationCtx, actorLabel: string, target: CatalogueTarget, revision: number, change: AdjustmentChange,
) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) refuse('ADJUSTMENT_FORBIDDEN', 'Staff access is required.');
  const actor = { tokenIdentifier: identity.tokenIdentifier, email: actorLabel };
  const clientKey = `catalogue:${target.targetId}:${revision + 1}`;
  const fingerprint = await sha256(JSON.stringify(convexToJson([target, revision, change.before, change.after])));
  await applyChange(ctx, actor, {
    target, kind: 'editCatalogue', input: {}, expectedRevision: revision, clientKey,
  }, change, actor.tokenIdentifier, fingerprint, { orderIds: new Set(), handoverIds: [] });
}

/**
 * Staff History reads one stream per item (D19), so the voucher's or grant's own ledger entry keeps
 * what the edit changed (masked, labelled) and its adjustment. The writer never has to remember it.
 */
async function recordLedgerChanges(
  ctx: MutationCtx, target: AdjustmentTarget, effect: Effect, adjustmentId: Id<'commerceAdjustments'>, audit: AuditRow,
) {
  const fields = { adjustmentId, changes: { before: audit.before, after: audit.after } };
  const entry = effect.kind === 'voucherEntry' ? await measured(ctx, () => ctx.db.get(effect.id))
    : effect.kind === 'sessionUse' ? await measured(ctx, () => ctx.db.get(effect.id)) : null;
  const own = entry && ('voucherId' in entry ? entry.voucherId : entry.grantId) === target.targetId;
  if (!entry || !own) throw new Error(`The ${target.targetType} adjustment's first ledger entry is not its own`);
  if (encoder.encode(JSON.stringify(convexToJson({ ...entry, ...fields }))).length > MAX_AUDIT_BYTES) {
    refuse('ADJUSTMENT_TOO_LARGE', 'The change history exceeds 8 KiB.');
  }
  reserveWrites(ctx, 1);
  await ctx.db.patch(entry._id, fields);
}

function assertAuditSize(row: AuditRow) {
  // Include Convex's system fields in the row size allowance.
  if (encoder.encode(JSON.stringify(convexToJson(row))).length > MAX_AUDIT_BYTES - 128) {
    refuse('ADJUSTMENT_TOO_LARGE', 'The change history exceeds 8 KiB.');
  }
}

/** Authorize and apply an edit, or persist a target-scoped manager request for the same edit. */
export async function adjust(
  ctx: MutationCtx, actor: StaffActor, input: AdjustmentCommand, writer: AdjustmentWriter,
): Promise<AppliedAdjustment | RequestedAdjustment> {
  const { command, serialized } = validateCommand(input);
  const permission = adjustmentPermission(actor, command);
  await writer.assertScope(ctx, actor, command);
  const rules = permission === 'direct' ? undefined : await approvalRules(ctx);
  const direct = permission === 'direct' || (permission !== 'approval' && rules?.[permission] === 'cashier');
  const requester = actor.tokenIdentifier;
  const fingerprint = await sha256(serialized);

  const previous = await findApplied(ctx, requester, command.clientKey);
  if (previous) {
    if (!direct) refuse('ADJUSTMENT_FORBIDDEN', 'This edit now requires a manager.');
    checkReplay(previous.fingerprint, fingerprint);
    return applied(previous);
  }
  const request = await findRequest(ctx, requester, command.clientKey);
  if (request) {
    checkReplay(request.payload.payloadFingerprint, fingerprint);
    return requestResult(request);
  }
  // New reasons are checked after replay so recorded edits keep their original receipt.
  assertKnownReasonCode(command);
  const ownership = await assertRevisions(ctx, command);
  const change = await writer.prepare(ctx, actor, command);
  if (direct) return await applyChange(ctx, actor, command, change, requester, fingerprint, ownership);

  const grant = await requesterGrant(ctx, requester);
  if (grant?.role !== 'cashier' || !rules) refuse('ADJUSTMENT_FORBIDDEN', 'Cashier access changed.');
  if (maskVoucherCodes(command.reasonText ?? '') !== (command.reasonText ?? '') ||
    maskVoucherCodes(command.reasonCode ?? '') !== (command.reasonCode ?? '') ||
    JSON.stringify(convexToJson(command.input)) !== JSON.stringify(convexToJson(maskFields(command.input)))) {
    refuse('INVALID_ADJUSTMENT_INPUT', 'Remove codes from the approval request.');
  }
  const createdAt = Date.now();
  const expiresAt = createdAt + APPROVAL_TTL_MS;
  reserveWrites(ctx, 1);
  const requestId = await ctx.db.insert('staffApprovalRequests', {
    kind: 'adjustment', status: 'pending', createdAt, expiresAt,
    reason: command.reasonText ?? '',
    requesterEmail: actor.email, requesterTokenIdentifier: requester,
    requesterAccessFingerprint: await sha256(JSON.stringify(convexToJson(grant))),
    rulesRevision: rules.revision, rulesFingerprint: await sha256(JSON.stringify(convexToJson(rules))),
    payload: {
      kind: 'adjustment', target: command.target, adjustmentKind: command.kind, input: command.input,
      expectedRevisions: [{ target: command.target, revision: command.expectedRevision }, ...command.relatedRevisions],
      payloadFingerprint: fingerprint, requester, clientKey: command.clientKey,
      ...(command.reasonCode ? { reasonCode: command.reasonCode } : {}),
    },
  });
  await ctx.scheduler.runAfter(APPROVAL_TTL_MS, internal.pos.staffApprovals.expire, { requestId });
  return { status: 'approvalRequired', requestId, expiresAt };
}

type InactiveApproval = { status: Exclude<Approval['status'], 'applied' | 'pending'> };

/** Approve and apply atomically using the same writer used to prepare the request. */
export async function executeApprovedAdjustment(
  ctx: MutationCtx, actor: StaffActor, requestId: Approval['_id'], writer: AdjustmentWriter,
): Promise<AppliedAdjustment | InactiveApproval> {
  if (!actor.capabilities.approve || (actor.role !== 'owner' && actor.role !== 'manager')) {
    refuse('ADJUSTMENT_FORBIDDEN', 'Manager access is required to approve an edit.');
  }
  const request = await measured(ctx, () => ctx.db.get(requestId));
  if (!request || request.kind !== 'adjustment') refuse('ADJUSTMENT_REQUEST_MISSING', 'Edit request not found.');
  const { payload } = request;
  if (payload.requester !== request.requesterTokenIdentifier) throw new Error('Invalid adjustment requester');
  if (request.requesterTokenIdentifier === actor.tokenIdentifier || request.requesterEmail === actor.email) {
    refuse('ADJUSTMENT_SELF_APPROVAL', 'You cannot approve your own request.');
  }
  const [primary, ...relatedRevisions] = payload.expectedRevisions;
  if (!primary || primary.target.targetType !== payload.target.targetType || primary.target.targetId !== payload.target.targetId) {
    throw new Error('Invalid target revision in adjustment request');
  }
  const { command, serialized } = validateCommand({
    target: payload.target, kind: payload.adjustmentKind, input: payload.input,
    expectedRevision: primary.revision, relatedRevisions, clientKey: payload.clientKey,
    reasonCode: payload.reasonCode, reasonText: request.reason,
  });
  adjustmentPermission(actor, command);
  await writer.assertScope(ctx, actor, command);
  const fingerprint = await sha256(serialized);
  checkReplay(payload.payloadFingerprint, fingerprint);
  const requesterKey = request.requesterTokenIdentifier;
  if (request.status === 'applied') {
    const previous = await findApplied(ctx, requesterKey, keyForApproval(request._id));
    if (!previous) throw new Error('Applied request is missing its adjustment');
    return applied(previous);
  }
  if (request.status !== 'pending') return { status: request.status };
  if (Date.now() >= request.expiresAt) {
    reserveWrites(ctx, 1);
    await ctx.db.patch(request._id, { status: 'expired', resolvedAt: Date.now() });
    return { status: 'expired' };
  }

  const [rules, grant] = await Promise.all([approvalRules(ctx), requesterGrant(ctx, requesterKey)]);
  if (grant?.role !== 'cashier' || await sha256(JSON.stringify(convexToJson(grant))) !== request.requesterAccessFingerprint ||
    rules.revision !== request.rulesRevision || await sha256(JSON.stringify(convexToJson(rules))) !== request.rulesFingerprint) {
    reserveWrites(ctx, 1);
    await ctx.db.patch(request._id, { status: 'stale', resolvedAt: Date.now() });
    return { status: 'stale' };
  }
  const requester: StaffActor = {
    role: 'cashier', capabilities: staffCapabilities('cashier'), pendingInvitation: null,
    email: request.requesterEmail, tokenIdentifier: requesterKey,
  };
  adjustmentPermission(requester, command);
  await writer.assertScope(ctx, requester, command);
  assertKnownReasonCode(command);
  const ownership = await assertRevisions(ctx, command);
  const change = await writer.prepare(ctx, actor, command);
  const result = await applyChange(ctx, actor, command, change, requesterKey, fingerprint, ownership, request._id);
  reserveWrites(ctx, 1);
  await ctx.db.patch(request._id, {
    status: 'applied', resolvedAt: Date.now(), approverEmail: actor.email, approverTokenIdentifier: actor.tokenIdentifier,
  });
  return result;
}
