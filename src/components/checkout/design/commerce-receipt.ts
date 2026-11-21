import type { Id, TableNames } from "convex/_generated/dataModel";
import type { OrderLine, OrderView } from "../backend";
import type { ReceiptCommerceFields } from "../checkout-ui";
import paid from "./coupon-paid.json";

/**
 * Two paid receipts with every Release 1 row kind and tender between them (plan v27), for the
 * preview and tests. v27 never lets an order that sells voucher value be paid with a voucher
 * (either bucket), so issuing and spending are separate sales:
 * - Issuance (#1046): Gold Wellness with its D1 split, a robe later returned, a gift voucher and a
 *   visit covered by a package session, paid by card. VAT is on the frozen bases ฿6,400 + ฿1,290,
 *   nothing on voucher value (D9).
 * - Redemption (#1047): a Hot stone massage and an oil with ฿100 goodwill credit, paid ฿1,000 by
 *   gift voucher and the rest by card. VAT is on ฿1,790: goodwill is a discount, a paid voucher is payment.
 * Amounts are written out, never calculated here.
 */

const fx = <T extends TableNames>(key: string) => `fx${key}` as Id<T>;
const PAID_AT = Date.UTC(2026, 9, 30, 7, 0);
const DAY = 86_400_000;
const ORDER = fx<"orders">("bill000046");
const REDEMPTION = fx<"orders">("bill000047");
type Snapshot = NonNullable<OrderLine["saleSnapshot"]>;
type Content = Snapshot["contents"][number];

const terms: Snapshot["terms"] = {
  preserveExpiredPackageValue: true, unusedFullRefundDays: 7, refundDueDays: { cashOrTransfer: 15, card: 45 }, packageValidityDays: 180,
  voucherValidityDays: 365, allowSessionTransfer: true, packageSplit: "voucherFaceValue", packageVatTiming: "atSale", pointsVatTreatment: "discount", pointsExpiryMonths: 12,
};
const content = (part: Omit<Content, "tenderCells" | "returnedUnits" | "returnedAmount" | "vatProfile"> & Partial<Content>): Content => ({
  tenderCells: [{ kind: "external", amount: part.paidShare }], returnedUnits: 0, returnedAmount: 0, vatProfile: "standard", ...part,
});
const snapshot = (label: string, paidShare: number, vatBase: number, extra: Partial<Snapshot> = {}): Snapshot => ({
  label, settingsRevision: 3, terms, paidShare, vatBase, tenderCells: [{ kind: "external", amount: paidShare }], returnedUnits: 0, returnedAmount: 0,
  chosenVariants: [], contents: [], goodwillDiscounts: [], ...extra,
});
const line = (key: string, fields: Partial<OrderLine> & Pick<OrderLine, "kind" | "name" | "unitPrice" | "net">, orderId = ORDER) => ({
  _id: fx<"orderLines">(key), _creationTime: PAID_AT - 60_000, orderId, createdAt: PAID_AT - 60_000, currency: "THB", qty: 1,
  catalogUnitPrice: fields.unitPrice, refundedAmountSatang: 0, remainingRefundableSatang: 0, sourceIssue: null, stayCoupon: null, ...fields,
});

const gold = line("line0gold", {
  kind: "package", name: "Gold Wellness", unitPrice: 690000, net: 690000, packageVersionId: fx<"packageVersions">("pkvgold"),
  saleSnapshot: snapshot("Gold Wellness", 690000, 640000, {
    chosenVariants: [{ contentKey: "robe", variantId: fx<"productVariants">("varsanm") }],
    contents: [
      content({ contentKey: "sessions", label: "Thai massage 60 or Hot stone 60", units: 5, paidShare: 526749, vatBase: 526749, grantId: fx<"sessionGrants">("grantgold") }),
      content({ contentKey: "robe", label: "Spa robe · Sand / M", units: 1, paidShare: 113251, vatBase: 113251, stockMovementId: fx<"stockMovements">("mov0robe") }),
      content({ contentKey: "credit", label: "Voucher value", units: 1, paidShare: 50000, vatBase: 0, vatProfile: "exempt", voucherId: fx<"vouchers">("vchgold") }),
    ],
  }),
});
const robe = line("line0robe", {
  kind: "product", name: "Spa robe · Blue / L", unitPrice: 129000, net: 129000, variantId: fx<"productVariants">("varblul"), refundedAmountSatang: 129000,
  saleSnapshot: snapshot("Spa robe · Blue / L", 129000, 129000, { returnedUnits: 1, returnedAmount: 129000 }),
});
const voucher = line("line0vch", {
  kind: "voucher", name: "Gift voucher", unitPrice: 100000, net: 100000,
  saleSnapshot: snapshot("Gift voucher", 100000, 0),
});
const covered = line("line0cover", {
  kind: "service", name: "Thai massage 60", detail: "60 min", unitPrice: 0, catalogUnitPrice: 120000, net: 0, serviceId: fx<"services">("svc000001"), appointmentId: fx<"appointments">("appt0maya"), staffName: "Ploy",
  coverage: { grantId: fx<"sessionGrants">("grantmaya"), attendeeId: fx<"customers">("cust00maya"), useId: fx<"sessionUses">("use0maya"), priceBefore: 120000 },
});
const stone = line("line0stone", {
  kind: "service", name: "Hot stone 60", detail: "60 min", unitPrice: 150000, net: 150000, serviceId: fx<"services">("svc0stone60"), staffName: "Nok",
}, REDEMPTION);
const oil = line("line0oil", {
  kind: "product", name: "Lemongrass oil · 100 ml", unitPrice: 39000, net: 29000, variantId: fx<"productVariants">("varoil100"), goodwillDiscount: 10000,
  saleSnapshot: snapshot("Lemongrass oil · 100 ml", 29000, 29000, { goodwillDiscounts: [{ voucherId: fx<"vouchers">("vchmaya"), amount: 10000 }] }),
} as Partial<OrderLine> & Pick<OrderLine, "kind" | "name" | "unitPrice" | "net">, REDEMPTION);

const base = paid.view;
export const COMMERCE_RECEIPT_ID = ORDER;
export const COMMERCE_REDEMPTION_ID = REDEMPTION;

/** The issuance receipt as getOrder returns it with W1·L1's commerce projection: voucher value sold, paid by card only. */
export const commerceReceipt = {
  ...base,
  order: {
    ...base.order, _id: ORDER, orderNumber: 1046, title: "Order #1046", receiptNumber: 145, itemCount: 4, total: 919000, due: 0,
    vatVersion: 2, returnedTotal: 129000, promotion: undefined, settleKey: "design-commerce", paidAt: PAID_AT, paymentEffectiveAt: PAID_AT, createdAt: PAID_AT - 120_000, updatedAt: PAID_AT,
  },
  receiptCustomer: { name: "Maya Lin" },
  customer: null,
  promotion: null,
  refundedAmountSatang: 129000,
  lines: [gold, robe, voucher, covered],
  payments: [{ _id: "fxpay000046", _creationTime: PAID_AT, orderId: ORDER, method: "card", amount: 919000, idempotencyKey: "design-commerce", createdBy: "preview@example.com", createdAt: PAID_AT, effectiveAt: PAID_AT }],
  voucherPayments: [],
  totals: { subtotal: 919000, discount: 0, coupon: 0, goodwillDiscount: 0, total: 919000, vat: 50308, deposit: 0, due: 919000 },
  paymentRecord: { ...base.paymentRecord, effectiveAt: PAID_AT, tenders: [{ method: "card", amount: 919000 }] },
  audit: [],
  commerce: {
    returnedAmountSatang: 129000,
    issuedBenefits: [
      { lineId: gold._id, contentKey: "sessions", issuedExpiresAt: PAID_AT + 180 * DAY, editHistory: { targetType: "grant", targetId: fx<"sessionGrants">("grantgold") } },
      { lineId: gold._id, contentKey: "credit", issuedExpiresAt: PAID_AT + 180 * DAY, codeMask: "GV-••••-H3LN", editHistory: { targetType: "voucher", targetId: fx<"vouchers">("vchgold") } },
      { lineId: voucher._id, contentKey: "voucher", issuedExpiresAt: PAID_AT + 365 * DAY, codeMask: "GV-••••-Q9XD", editHistory: { targetType: "voucher", targetId: fx<"vouchers">("vchsold") } },
    ],
    handovers: [],
    editHistory: { targetType: "order", targetId: ORDER },
  },
} as unknown as OrderView & ReceiptCommerceFields;

/** The redemption receipt: no voucher value sold, ฿100 goodwill credit as a discount and ฿1,000 of voucher spend beside the card. */
export const commerceRedemptionReceipt = {
  ...base,
  order: {
    ...base.order, _id: REDEMPTION, orderNumber: 1047, title: "Order #1047", receiptNumber: 146, itemCount: 2, total: 179000, due: 0,
    vatVersion: 2, returnedTotal: 0, promotion: undefined, settleKey: "design-redemption", paidAt: PAID_AT + 30 * 60_000, paymentEffectiveAt: PAID_AT + 30 * 60_000, createdAt: PAID_AT + 20 * 60_000, updatedAt: PAID_AT + 30 * 60_000,
  },
  receiptCustomer: { name: "Maya Lin" },
  customer: null,
  promotion: null,
  refundedAmountSatang: 0,
  lines: [stone, oil],
  payments: [{ _id: "fxpay000048", _creationTime: PAID_AT, orderId: REDEMPTION, method: "card", amount: 79000, idempotencyKey: "design-redemption", createdBy: "preview@example.com", createdAt: PAID_AT, effectiveAt: PAID_AT }],
  voucherPayments: [{ _id: "fxpay000049", amount: 100000, voucherId: fx<"vouchers">("vchgift7pax"), codeMask: "GV-••••-7PAX" }],
  totals: { subtotal: 189000, discount: 10000, coupon: 0, goodwillDiscount: 10000, total: 179000, vat: 11710, deposit: 0, due: 179000 },
  paymentRecord: { ...base.paymentRecord, effectiveAt: PAID_AT + 30 * 60_000, tenders: [{ method: "card", amount: 79000 }] },
  audit: [],
  commerce: { returnedAmountSatang: 0, issuedBenefits: [], handovers: [], editHistory: { targetType: "order", targetId: REDEMPTION } },
} as unknown as OrderView & ReceiptCommerceFields;
