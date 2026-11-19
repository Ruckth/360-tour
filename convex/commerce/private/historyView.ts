import type { Doc } from '../../_generated/dataModel';
import type { CommerceHistoryRow } from './history';

type Balances = { paid: number; goodwill: number };
type CopyArgs = Record<string, string | number>;

/** A guest-safe fact: a Commerce `history.facts` message key and its arguments. The screen picks the words. */
export type HistoryFact = { key: string; args?: CopyArgs };
export type HistoryBalance =
  | { unit: 'sessions' | 'money'; before: Balances; after: Balances }
  | { unit: 'stock'; before: number; after: number };
/** One History row as a screen shows it. Show guest rows never carry `staff`. */
export type HistoryEntryView = {
  entryId: string;
  at: number;
  fact: HistoryFact;
  balance: HistoryBalance | null;
  staff?: { actorName: string; reason: string | null; reasonText: string | null };
};

const UPDATED: HistoryFact = { key: 'updated' };
const total = (balances: Balances) => balances.paid + balances.goodwill;

/** A structured `{ key, args }` fact written by a ledger writer. Free text is never shown: it may hold notes or a full code. */
function storedFact(value: unknown): HistoryFact | null {
  if (typeof value !== 'object' || value === null || !('key' in value) || typeof value.key !== 'string') return null;
  const args = 'args' in value && typeof value.args === 'object' && value.args !== null ? value.args as CopyArgs : null;
  return args ? { key: value.key, args } : { key: value.key };
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
  const after = row.after as Record<string, unknown>;
  const date = [after.expiresAt, after.effectiveExpiresAt].find(value => typeof value === 'number');
  if ((row.kind === 'extend' || row.kind === 'resume') && typeof date === 'number') {
    return { key: row.kind === 'extend' ? 'extended' : 'resumed', args: { date } };
  }
  if (row.kind === 'rename' && typeof after.name === 'string') return { key: 'renamed', args: { name: after.name } };
  const key = ADJUSTMENT_FACTS[row.kind];
  return key ? { key } : UPDATED;
}

/** The fact Show guest may see for a voucher or grant ledger row. The transfer-in row opens the new owner's history. */
export function guestHistoryFact(row: Doc<'voucherEntries'> | Doc<'sessionUses'>, transferIn: boolean): HistoryFact {
  if (transferIn) return { key: 'transferredIn' };
  return storedFact(row.guestFact) ?? ('voucherId' in row ? voucherFact(row) : sessionFact(row));
}

/** A row of one item's history for staff: its fact, balance before and after, and who did it and why. */
export function staffHistoryEntry(row: CommerceHistoryRow): HistoryEntryView {
  if ('targetType' in row) {
    return {
      entryId: row._id, at: row.recordedAt, fact: adjustmentFact(row), balance: null,
      staff: { actorName: row.actorLabel, reason: row.reasonCode ?? null, reasonText: row.reasonText ?? null },
    };
  }
  if ('voucherId' in row || 'grantId' in row) {
    return {
      entryId: row._id, at: row.createdAt, fact: guestHistoryFact(row, false),
      balance: { unit: 'voucherId' in row ? 'money' : 'sessions', before: row.before, after: row.after },
      staff: { actorName: row.actor, reason: null, reasonText: null },
    };
  }
  return {
    entryId: row._id, at: row.createdAt, fact: stockFact(row),
    balance: { unit: 'stock', before: row.before, after: row.after },
    staff: { actorName: row.actor, reason: row.reason ?? null, reasonText: null },
  };
}
