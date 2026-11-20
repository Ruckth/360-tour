import { v } from 'convex/values';
import { commerceCopyArgs } from '../shared/commerce/reasons';
import { adjustmentKind, adjustmentTarget, adjustmentFields, commerceTerms, vatProfile } from '../shared/commerce/validators';
import { storedRefundMethod, tenderMethod } from '../shared/financeValidators';
import { LINE_KINDS } from '../shared/orderMath';

export const orderLineKind = v.union(...LINE_KINDS.map(kind => v.literal(kind)));

export const voucherMethod = v.literal('voucher');
export const orderTenderMethod = v.union(tenderMethod, voucherMethod);
export const orderRefundMethod = v.union(storedRefundMethod, voucherMethod);
const voucherTender = { method: voucherMethod, voucherId: v.id('vouchers') };

export const orderPaymentTenderFields = [
  { method: tenderMethod },
  voucherTender,
] as const;
export const orderRefundTenderFields = [
  { method: storedRefundMethod },
  voucherTender,
] as const;

export const orderLineCoverage = v.object({
  grantId: v.id('sessionGrants'),
  attendeeId: v.id('customers'),
  useId: v.optional(v.id('sessionUses')),
  priceBefore: v.number(),
});

export const saleTenderCell = v.union(
  v.object({ kind: v.literal('external'), amount: v.number() }),
  v.object({ kind: v.literal('voucher'), voucherId: v.id('vouchers'), amount: v.number() }),
);
const saleAllocationFields = {
  paidShare: v.number(),
  vatBase: v.number(),
  tenderCells: v.array(saleTenderCell),
  returnedUnits: v.number(),
  returnedAmount: v.number(),
};
export const chosenVariant = v.object({ contentKey: v.string(), variantId: v.id('productVariants') });
export const orderLineSaleSnapshot = v.object({
  label: v.string(),
  settingsRevision: v.number(),
  terms: commerceTerms,
  ...saleAllocationFields,
  chosenVariants: v.array(chosenVariant),
  contents: v.array(v.object({
    contentKey: v.string(),
    label: v.string(),
    units: v.number(),
    ...saleAllocationFields,
    vatProfile,
    goodwillShare: v.optional(v.number()),
    stockMovementId: v.optional(v.id('stockMovements')),
    grantId: v.optional(v.id('sessionGrants')),
    voucherId: v.optional(v.id('vouchers')),
  })),
  goodwillDiscounts: v.array(v.object({ voucherId: v.id('vouchers'), amount: v.number() })),
});

export const paymentAttemptRefusal = v.object({
  code: v.string(), message: v.string(), args: v.optional(commerceCopyArgs),
});

export const paymentAttemptStatus = v.union(
  v.literal('collecting'), v.literal('settled'), v.literal('refused'), v.literal('recovering'),
  v.literal('resolved'), v.literal('cancelled'),
);
export const paymentLegState = v.union(
  v.literal('planned'), v.literal('instructed'), v.literal('taken'), v.literal('declined'), v.literal('unknown'),
);
export const paymentExternalLeg = v.object({
  key: v.string(),
  method: tenderMethod,
  amount: v.number(),
  state: paymentLegState,
  tendered: v.optional(v.number()), received: v.optional(v.number()),
  change: v.optional(v.number()),
  reference: v.optional(v.string()),
  instructedAt: v.optional(v.number()),
  instructedTillId: v.optional(v.string()),
  instructedTab: v.optional(v.string()),
  /** The attempt's owner revision when this part was instructed. A handover moves past it for good. */
  instructedOwnerRevision: v.optional(v.number()),
});
export const reviewedVoucher = v.object({ voucherId: v.id('vouchers'), paid: v.number(), goodwill: v.number() });
const returnVoucherDestination = v.union(
  v.object({ kind: v.literal('newVoucher') }),
  v.object({ kind: v.literal('existingVoucher'), voucherId: v.id('vouchers'), codeMask: v.union(v.string(), v.null()) }),
);
export const returnVoucherCredit = v.object({ ...reviewedVoucher.fields, destination: v.optional(returnVoucherDestination) });
export const paymentAttemptReview = v.object({
  revision: v.number(),
  due: v.number(),
  customers: v.array(v.object({ customerId: v.id('customers'), revision: v.number() })),
  vouchers: v.array(reviewedVoucher),
  businessDate: v.string(),
  settingsRevision: v.number(),
});

export const orderReturnStatus = v.union(v.literal('authorized'), v.literal('completed'), v.literal('cancelled'));
export const returnClaimState = v.union(
  v.literal('owed'), v.literal('instructed'), v.literal('given'), v.literal('failed'),
  v.literal('unknown'), v.literal('cancelled'),
);
export const returnDisposition = v.union(v.literal('sellable'), v.literal('damaged'));
export const returnPart = v.union(
  v.object({ kind: v.literal('line'), lineId: v.id('orderLines'), units: v.number(), disposition: v.optional(returnDisposition) }),
  v.object({ kind: v.literal('content'), lineId: v.id('orderLines'), contentKey: v.string(), units: v.number(), disposition: v.optional(returnDisposition) }),
  v.object({ kind: v.literal('cancelPackage'), lineId: v.id('orderLines') }),
  v.object({ kind: v.literal('restoreSession'), lineId: v.id('orderLines'), useId: v.id('sessionUses') }),
);
export const returnClaim = v.object({
  key: v.string(), method: tenderMethod, amount: v.number(), operator: v.string(),
  state: returnClaimState, instructionId: v.optional(v.string()), reference: v.optional(v.string()), instructedAt: v.optional(v.number()),
  dueAt: v.number(),
});
export const returnSourceOwner = v.union(
  v.object({ kind: v.literal('pos') }),
  v.object({ kind: v.literal('appointment'), appointmentId: v.id('appointments') }),
);
export const returnEffect = v.union(
  v.object({ kind: v.literal('session'), grantId: v.id('sessionGrants'), useId: v.id('sessionUses') }),
  v.object({ kind: v.literal('voucher'), voucherId: v.id('vouchers'), entryId: v.id('voucherEntries') }),
  v.object({ kind: v.literal('handover'), handoverId: v.id('handovers'), contentKey: v.optional(v.string()), units: v.number() }),
  v.object({ kind: v.literal('stock'), movementId: v.id('stockMovements') }),
  v.object({ kind: v.literal('appointment'), appointmentId: v.id('appointments'), amount: v.number() }),
);
export const returnItemsApprovalPayload = v.object({
  kind: v.literal('returnItems'), parts: v.array(returnPart), idempotencyKey: v.string(),
});

export const checkoutApprovalKind = v.union(
  v.literal('discount'), v.literal('customPrice'), v.literal('voidPaidSale'), v.literal('paymentFix'), v.literal('refund'),
);

export const adjustmentApprovalPayload = v.object({
  kind: v.literal('adjustment'),
  target: adjustmentTarget,
  adjustmentKind,
  input: adjustmentFields,
  expectedRevisions: v.array(v.object({ target: adjustmentTarget, revision: v.number() })),
  payloadFingerprint: v.string(),
  requester: v.string(),
  clientKey: v.string(),
  reasonCode: v.optional(v.string()),
});


// Published no-login response contracts. Fields are selected by each owning endpoint.
export const displaysClaimLinkResult = v.union(v.object({
"ok": v.literal(true),
"token": v.string(),
}), v.object({
"ok": v.literal(false),
"code": v.literal("LINK_INVALID"),
}));

export const displaysStartPairingResult = v.union(v.object({
"status": v.literal("active"),
}), v.object({
"status": v.literal("pending"),
"token": v.string(),
"code": v.string(),
"expiresAt": v.number(),
}));

export const displaysReleaseDisplayResult = v.null();

export const displaysCurrentResult = v.union(v.object({
"state": v.literal("unpaired"),
}), v.object({
"state": v.literal("pending"),
"code": v.string(),
}), v.object({
"state": v.literal("idle"),
"businessName": v.string(),
}), v.object({
"businessName": v.string(),
"customerFirstName": v.union(v.null(), v.string()),
"orderNumber": v.union(v.null(), v.number()),
"currency": v.string(),
"state": v.literal("order"),
"lines": v.array(v.object({
"name": v.string(),
"detail": v.union(v.null(), v.string()),
"qty": v.number(),
"unitPrice": v.number(),
"price": v.number(),
"discount": v.number(),
"couponDiscount": v.number(),
"total": v.number(),
"deposit": v.number(),
})),
"subtotal": v.number(),
"discount": v.number(),
"coupon": v.union(v.null(), v.object({
"code": v.string(),
"saving": v.number(),
})),
"deposit": v.number(),
"total": v.number(),
"vat": v.number(),
"due": v.number(),
"activeAt": v.number(),
"goodwillDiscount": v.optional(v.number()),
}), v.object({
"businessName": v.string(),
"customerFirstName": v.union(v.null(), v.string()),
"orderNumber": v.union(v.null(), v.number()),
"currency": v.string(),
"state": v.literal("paid"),
"total": v.number(),
"vat": v.number(),
"amountPaid": v.number(),
"receiptNumber": v.union(v.null(), v.number()),
"paidAt": v.number(),
"goodwillDiscount": v.optional(v.number()),
"voucherCodeMasks": v.optional(v.array(v.string())),
"coupon": v.union(v.null(), v.object({
"code": v.string(),
"saving": v.number(),
})),
}));

export const displaysHeartbeatResult = v.null();
