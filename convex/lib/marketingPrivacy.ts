import type { MarketingRole } from './marketingAccess';

/** Marketing read access alone does not include guest identity or partner contact details. */
export function canReadMarketingPersonalData(access: { role: MarketingRole | 'admin' | null }) {
  return access.role === 'admin' || access.role === 'manager' || access.role === 'finance';
}

export function withoutContactEmail<T extends { contactEmail?: string }>(row: T): T {
  const result = { ...row };
  delete result.contactEmail;
  return result;
}

/** Decision reasons are unrestricted finance text, so they may contain personal details. */
export function withMarketingReasonPrivacy<T extends { reason?: string }>(row: T, fullDetail: boolean): Omit<T, 'reason'> & { reason?: string | null; reasonHidden?: boolean } {
  return fullDetail ? row : { ...row, reason: null, reasonHidden: row.reason !== undefined };
}

// Campaign/affiliate notes and spend notes are free text too. Coupon and link snapshots
// currently contain only business fields; apply the same boundary to nested history values.
const personalHistoryFields = new Set([
  'contactEmail', 'email', 'phone', 'guestName', 'guestEmail', 'guestPhone',
  'customerName', 'customerSnapshot', 'confirmationCode', 'visitorKey', 'visitorId',
  'createdByEmail', 'updatedByEmail', 'note', 'notes', 'terms', 'reason'
]);
export function redactMarketingHistoryValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactMarketingHistoryValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !personalHistoryFields.has(key))
    .map(([key, child]) => [key, redactMarketingHistoryValue(child)]));
}
