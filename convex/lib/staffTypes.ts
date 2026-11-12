import { v, type Infer } from 'convex/values';
import { correctedTender, storedRefundMethod } from './financeValidators';

/** Public contract shared by schema, Team and checkout. No server imports. */
export const staffRole = v.union(v.literal('manager'), v.literal('cashier'));
export const actionPermission = v.union(v.literal('manager'), v.literal('cashier'));
export const cashierRulesFields = {
  discountLimitPercent: v.number(),
  voidPaidSale: actionPermission,
  customPrice: actionPermission,
  paymentFix: actionPermission,
  refund: v.optional(actionPermission),
};
export const cashierRulesValidator = v.object(cashierRulesFields);
export type CashierRules = Infer<typeof cashierRulesValidator> & { revision: number; refund: 'manager' | 'cashier' };
export type CashierAction = 'voidPaidSale' | 'customPrice' | 'paymentFix' | 'refund';
export const DEFAULT_CASHIER_RULES: CashierRules = {
  revision: 0, discountLimitPercent: 10,
  voidPaidSale: 'manager', customPrice: 'manager', paymentFix: 'manager', refund: 'manager',
};
export const STAFF_INVITATION_TTL_MS = 14 * 86_400_000;
export const APPROVAL_TTL_MS = 5 * 60_000;
export const lineDiscountValidator = v.object({ type: v.union(v.literal('amount'), v.literal('percent')), value: v.number() });
export const amendedCustomerValidator = v.object({ customerId: v.union(v.null(), v.id('customers')), expectedCustomerRevision: v.optional(v.number()) });

export const billRefundFields = {
  lineId: v.id('billLines'), amount: v.number(), currency: v.string(), method: storedRefundMethod, idempotencyKey: v.string(),
};

/** Payloads are immutable. Order IDs, non-refund reasons and correction keys come from the request. */
export const approvalPayload = v.union(
  v.object({ kind: v.literal('refund'), lineId: v.id('billLines'), amountSatang: v.number(), currency: v.string(), method: storedRefundMethod, idempotencyKey: v.string(), reason: v.string() }),
  v.object({ kind: v.literal('discount'), lineId: v.id('billLines'), discount: lineDiscountValidator }),
  v.object({ kind: v.literal('customPrice'), action: v.literal('overrideLinePrice'), lineId: v.id('billLines'), price: v.union(v.number(), v.null()), note: v.string() }),
  v.object({ kind: v.literal('customPrice'), action: v.literal('addCustomItem'), name: v.string(), price: v.number() }),
  v.object({ kind: v.literal('customPrice'), action: v.literal('updateSourceLine'), lineId: v.id('billLines') }),
  v.object({ kind: v.literal('customPrice'), action: v.literal('attachSource'), bookingId: v.optional(v.id('bookings')), appointmentId: v.optional(v.id('serviceAppointments')) }),
  v.object({ kind: v.literal('voidPaidSale') }),
  v.object({ kind: v.literal('paymentFix'), action: v.literal('amendOrderPayment'), tenders: v.optional(v.array(correctedTender)), effectiveAt: v.optional(v.number()), customer: v.optional(amendedCustomerValidator) }),
  v.object({ kind: v.literal('paymentFix'), action: v.literal('voidUnreceivedOrder') }),
  v.object({ kind: v.literal('paymentFix'), action: v.literal('linkPaidLine'), lineId: v.id('billLines'), appointmentId: v.optional(v.id('serviceAppointments')), bookingId: v.optional(v.id('bookings')), expectedTargetRevision: v.number(), notifyGuest: v.optional(v.boolean()) }),
  v.object({ kind: v.literal('paymentFix'), action: v.literal('unlinkPaidLine'), linkId: v.id('billLineLinks') }),
);
export type ApprovalPayload = Infer<typeof approvalPayload>;
export const approvalStatus = v.union(v.literal('pending'), v.literal('applied'), v.literal('rejected'), v.literal('cancelled'), v.literal('expired'), v.literal('stale'));

/** Retain the pre-fix stored shape so existing documents remain valid; new requests use approvalPayload. */
export const storedApprovalPayload = v.union(approvalPayload, v.object({ kind: v.literal('refund'), ...billRefundFields }));
export function approvalPayloadView(payload: Infer<typeof storedApprovalPayload>, reason: string): ApprovalPayload {
  if (payload.kind === 'refund' && 'amount' in payload) {
    const { amount, ...fields } = payload;
    return { ...fields, amountSatang: amount, reason };
  }
  return payload;
}
