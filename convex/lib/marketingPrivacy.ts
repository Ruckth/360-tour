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
