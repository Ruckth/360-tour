import { validate } from 'convex-helpers/validators';
import type { Doc } from '../../_generated/dataModel';
import type { CommerceHistoryRow } from './history';
import { structuredGuestFact } from '../validators';
import { maskVoucherCodes } from '../../shared/voucherCode';

type Balances = { paid: number; goodwill: number };
type CopyArgs = Record<string, string | number>;

/** A guest-safe fact: a Commerce `history.facts` message key and its arguments. The screen picks the words. */
export type HistoryFact = { key: string; args?: CopyArgs };
export type HistoryBalance =
  | { unit: 'sessions' | 'money'; before: Balances; after: Balances }
  | { unit: 'stock'; before: number; after: number };
/** One History row as a screen shows it. Show guest rows never carry `staff`. */
/** One changed checkout rule, before → after (`refundDueDays.card`, `saleSwitches.vouchers`). Staff only. */
export type SettingsChange = { field: string; before: string | number | boolean | null; after: string | number | boolean | null };
export type HistoryEntryView = {
  entryId: string;
  at: number;
  fact: HistoryFact;
  balance: HistoryBalance | null;
  before?: Doc<'commerceAdjustments'>['before'];
  after?: Doc<'commerceAdjustments'>['after'];
  staff?: { actorName: string; reason: string | null; reasonText: string | null };
  /** Settings › Checkout rules rows only: what changed. */
  changes?: SettingsChange[];
};

const UPDATED: HistoryFact = { key: 'updated' };
const total = (balances: Balances) => balances.paid + balances.goodwill;

/** A structured `{ key, args }` fact written by a ledger writer. Free text is never shown: it may hold notes or a full code. */
function storedFact(value: unknown): HistoryFact | null {
  if (!validate(structuredGuestFact, value)) return null;
  const args: CopyArgs = {};
  for (const [name, arg] of Object.entries(value.args ?? {})) {
    if (typeof arg === 'number' && Number.isFinite(arg)) args[name] = arg;
    else if (typeof arg === 'string') args[name] = maskVoucherCodes(arg);
    else return null;
  }
  return Object.keys(args).length ? { key: value.key, args } : { key: value.key };
}

function goodwillFact(before: Balances, after: Balances): HistoryFact {
  if (after.goodwill > before.goodwill) return { key: 'goodwillAdded' };
  if (after.goodwill < before.goodwill) return { key: 'goodwillRemoved' };
  return UPDATED;
}

function voucherFact(row: Doc<'voucherEntries'>): HistoryFact {
  switch (row.kind) {
    case 'issue': return { key: 'issued', args: { amount: total(row.after) } };
    case 'spend': return { key: 'spent', args: { amount: total(row.before) - total(row.after) } };
    case 'refund_credit': return { key: 'refundCredit', args: { amount: total(row.after) - total(row.before) } };
    case 'revoke': return { key: 'cancelled' };
    case 'disable': return { key: 'disabled' };
    case 'reissue': return { key: 'reissued' };
    case 'expire': return { key: 'expired' };
    case 'edit': return goodwillFact(row.before, row.after);
    case 'transfer': return { key: 'transferredIn' };
  }
}

/** Issue and use name the package or service, so they need the writer's stored fact. */
function sessionFact(row: Doc<'sessionUses'>): HistoryFact {
  switch (row.kind) {
    case 'restore':
    case 'cancel_reversed': return { key: 'restored' };
    case 'no_show': return { key: 'noShow' };
    case 'waive': return { key: 'waived' };
    case 'transfer': return { key: 'transferredIn' };
    case 'expire': return { key: 'expired' };
    case 'cancel': return { key: 'cancelled' };
    case 'edit': return goodwillFact(row.before, row.after);
    default: return UPDATED;
  }
}

function stockFact(row: Doc<'stockMovements'>): HistoryFact {
  if (row.kind === 'sale' || row.kind === 'room_bill') return { key: 'sold' };
  if (row.kind === 'taken_back') return { key: 'takenBack' };
  return { key: 'stockAdjusted' };
}

const ADJUSTMENT_FACTS: Partial<Record<Doc<'commerceAdjustments'>['kind'], string>> = {
  pause: 'paused', addGoodwill: 'goodwillAdded', removeGoodwill: 'goodwillRemoved', reissue: 'reissued',
  disable: 'disabled', transfer: 'transferredOut', publish: 'published', editCatalogue: 'published',
  adjustStock: 'stockAdjusted', takeBack: 'takenBack',
};

function adjustmentFact(row: Doc<'commerceAdjustments'>): HistoryFact {
  const { after } = row;
  const date = [after.expiresAt, after.effectiveExpiresAt].find(value => typeof value === 'number');
  if ((row.kind === 'extend' || row.kind === 'resume') && typeof date === 'number') {
    return { key: row.kind === 'extend' ? 'extended' : 'resumed', args: { date } };
  }
  if (row.kind === 'rename' && typeof after.name === 'string') return { key: 'renamed', args: { name: maskVoucherCodes(after.name) } };
  const key = ADJUSTMENT_FACTS[row.kind];
  return key ? { key } : UPDATED;
}

/** The D20 rules and sale switches a settings row may change; the cutover's own bookkeeping isn't listed. */
const SETTINGS_FIELDS = new Set([
  'preserveExpiredPackageValue', 'unusedFullRefundDays', 'refundDueDays', 'packageValidityDays', 'voucherValidityDays',
  'allowSessionTransfer', 'packageSplit', 'packageVatTiming', 'pointsVatTreatment', 'pointsExpiryMonths', 'saleSwitches',
]);
type Scalar = SettingsChange['before'];
const scalar = (value: unknown): Scalar =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : null;
const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Before → after per rule, one level deep for refund deadlines and sale switches. */
function settingsChanges(row: Doc<'commerceAdjustments'>): SettingsChange[] {
  const before = record(row.before), after = record(row.after);
  const changes: SettingsChange[] = [];
  // In the page's own order, whatever order the row stored them in.
  for (const field of SETTINGS_FIELDS) {
    if (!(field in after)) continue;
    const was = before[field], now = after[field];
    if (typeof now === 'object' && now !== null) {
      const previous = record(was);
      for (const [part, value] of Object.entries(record(now))) {
        if (previous[part] !== value) changes.push({ field: `${field}.${part}`, before: scalar(previous[part]), after: scalar(value) });
      }
    } else if (was !== now) {
      changes.push({ field, before: scalar(was), after: scalar(now) });
    }
  }
  return changes;
}

/** Switching payments, pausing or resuming checkout, or a change to the rules (D20). */
function settingsFact(row: Doc<'commerceAdjustments'>): HistoryFact {
  const after = record(row.after);
  if (after.paymentsMode === 'attempts') return { key: 'paymentsSwitched' };
  // The first pause also records when the cutover started (cutoverStartedAt): bookkeeping, not a separate change.
  if ('cutover' in after && Object.keys(after).every(field => field === 'cutover' || field === 'cutoverStartedAt')) {
    return { key: after.cutover ? 'checkoutPaused' : 'checkoutResumed' };
  }
  return Object.keys(after).some(field => SETTINGS_FIELDS.has(field)) ? { key: 'rulesChanged' } : UPDATED;
}

/** The fact Show guest may see for a voucher or grant ledger row. The transfer-in row opens the new owner's history. */
export function guestHistoryFact(row: Doc<'voucherEntries'> | Doc<'sessionUses'>, transferIn: boolean): HistoryFact {
  if (transferIn) return { key: 'transferredIn' };
  return storedFact(row.guestFact) ?? ('voucherId' in row ? voucherFact(row) : sessionFact(row));
}

/**
 * A row of one item's history for staff: its fact, balance before and after, and who did it and why.
 * A voucher or grant edit's own ledger row also carries the fields it changed (a rename's old name).
 */
export function staffHistoryEntry(row: CommerceHistoryRow): HistoryEntryView {
  if ('targetType' in row) {
    const staff = { actorName: row.actorLabel, reason: row.reasonCode ?? null, reasonText: row.reasonText ?? null };
    const common = { entryId: row._id, at: row.recordedAt, balance: null, before: row.before, after: row.after, staff };
    if (row.targetType === 'settings') return { ...common, fact: settingsFact(row), changes: settingsChanges(row) };
    return { ...common, fact: adjustmentFact(row) };
  }
  if ('voucherId' in row || 'grantId' in row) {
    return {
      entryId: row._id, at: row.createdAt, fact: guestHistoryFact(row, false),
      balance: { unit: 'voucherId' in row ? 'money' : 'sessions', before: row.before, after: row.after },
      ...(row.changes ? { before: row.changes.before, after: row.changes.after } : {}),
      staff: { actorName: row.actor, reason: row.reasonCode ?? null, reasonText: row.reasonText ?? null },
    };
  }
  return {
    entryId: row._id, at: row.createdAt, fact: stockFact(row),
    balance: { unit: 'stock', before: row.before, after: row.after },
    staff: { actorName: row.actor, reason: row.reason ?? null, reasonText: null },
  };
}
