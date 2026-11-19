import type { Id, TableNames } from "convex/_generated/dataModel";
import type { OrderLine, OrderView } from "../backend";
import type { ReceiptCommerceFields } from "../checkout-ui";
import paid from "./coupon-paid.json";

/**
 * A paid receipt with every Release 1 row kind and tender (plan v27), for the preview and tests:
 * Gold Wellness with its D1 split, a robe later returned, a gift voucher, a visit covered by a
 * package session, an oil with ฿100 goodwill credit, and a ฿2,000 voucher spend beside the card.
 * Amounts are the plan's own, written out, never calculated here. VAT is on the frozen bases
 * (vatVersion 2): ฿6,400 + ฿1,290 + ฿290, nothing on voucher value (D9).
 */

const fx = <T extends TableNames>(key: string) => `fx${key}` as Id<T>;
const PAID_AT = Date.UTC(2026, 10, 19, 7, 41);
const DAY = 86_400_000;
const ORDER = fx<"orders">("bill000046");
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
const line = (key: string, fields: Partial<OrderLine> & Pick<OrderLine, "kind" | "name" | "unitPrice" | "net">) => ({
  _id: fx<"orderLines">(key), _creationTime: PAID_AT - 60_000, orderId: ORDER, createdAt: PAID_AT - 60_000, currency: "THB", qty: 1,
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
const oil = line("line0oil", {
  kind: "product", name: "Lemongrass oil · 100 ml", unitPrice: 39000, net: 29000, variantId: fx<"productVariants">("varoil100"), goodwillDiscount: 10000,
  saleSnapshot: snapshot("Lemongrass oil · 100 ml", 29000, 29000, { goodwillDiscounts: [{ voucherId: fx<"vouchers">("vchmaya"), amount: 10000 }] }),
} as Partial<OrderLine> & Pick<OrderLine, "kind" | "name" | "unitPrice" | "net">);

const base = paid.view;
export const COMMERCE_RECEIPT_ID = ORDER;

/** The receipt as getOrder returns it once W1·L1's commerce projection is in. */
export const commerceReceipt = {
  ...base,
  order: {
    ...base.order, _id: ORDER, orderNumber: 1046, title: "Order #1046", receiptNumber: 145, itemCount: 5, total: 948000, due: 0,
    vatVersion: 2, returnedTotal: 129000, promotion: undefined, settleKey: "design-commerce", paidAt: PAID_AT, paymentEffectiveAt: PAID_AT, createdAt: PAID_AT - 120_000, updatedAt: PAID_AT,
  },
  receiptCustomer: { name: "Maya Lin" },
  customer: null,
  promotion: null,
  refundedAmountSatang: 129000,
  lines: [gold, robe, voucher, covered, oil],
  payments: [{ _id: "fxpay000046", _creationTime: PAID_AT, orderId: ORDER, method: "card", amount: 748000, idempotencyKey: "design-commerce", createdBy: "preview@example.com", createdAt: PAID_AT, effectiveAt: PAID_AT }],
  voucherPayments: [{ _id: "fxpay000047", amount: 200000, voucherId: fx<"vouchers">("vchmaya"), codeMask: "GV-••••-7PAX" }],
  totals: { subtotal: 958000, discount: 10000, coupon: 0, goodwillDiscount: 10000, total: 948000, vat: 52206, deposit: 0, due: 948000 },
  paymentRecord: { ...base.paymentRecord, effectiveAt: PAID_AT, tenders: [{ method: "card", amount: 748000 }] },
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
