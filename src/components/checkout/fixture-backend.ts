"use client";

import { useState } from "react";
import type { Id, TableNames } from "convex/_generated/dataModel";
import {
  COMMERCE_OFF,
  type AdjustTarget,
  type CheckoutActions,
  type CheckoutBackend,
  type CommerceAccess,
  type CommerceBackend,
  type CustomerPage,
  type HistoryEntry,
  type PackageTile,
  type ProductTile,
  type PaymentAttemptView,
  type ProductDetail,
  type ReturnQuote,
  type ReturnView,
  type SaleSwitches,
  type SessionGrantCard,
  type VoucherCard,
  type VoucherCheck,
} from "./backend";
import empty from "./design/empty.json";
import spa from "./design/spa.json";
import couponApplied from "./design/coupon-applied.json";
import couponPaid from "./design/coupon-paid.json";
import unscheduled from "./design/unscheduled.json";
import unscheduledPaid from "./design/unscheduled-paid.json";
import fee from "./design/fee.json";
import long from "./design/long.json";

const states = {
  empty,
  spa,
  "coupon-applied": couponApplied,
  "coupon-paid": couponPaid,
  unscheduled,
  "unscheduled-paid": unscheduledPaid,
  fee,
  long,
};
export type CheckoutDesignState = keyof typeof states;
type View = {
  catalog: ReturnType<CheckoutBackend["useCatalog"]>;
  view: ReturnType<CheckoutBackend["useOrder"]>;
  orders: ReturnType<CheckoutBackend["useOrders"]>["results"];
  attachable: ReturnType<CheckoutBackend["useAttachable"]>;
  businessName: string;
};
export const checkoutDesignStates = (Object.keys(states) as CheckoutDesignState[]).map((key) => ({
  key,
  orderId: (states[key] as unknown as View).view?.order._id ?? null,
}));
function usePage<T>(rows: T[]): CustomerPage<T> {
  const [count, setCount] = useState(20);
  return {
    results: rows.slice(0, count),
    status: rows.length > count ? "CanLoadMore" : "Exhausted",
    loadMore: (n) => setCount(count + n),
  };
}
const noWrite = async () => {
  throw new Error(
    "Choose a canned design state, or use the signed-in local checkout to change an order.",
  );
};
/** Canned presentation only. No database, money calculations, business transitions or authorization. */
export function createFixtureBackend(
  state: CheckoutDesignState = "empty",
  commerce?: CommerceDesignState,
): CheckoutBackend {
  const snapshot = states[state] as unknown as View;
  const actions: CheckoutActions = {
    noteCouponRefusal: noWrite,
    discardOrder: noWrite,
    restoreOrder: noWrite,
    addAppointmentFee: noWrite,
    openOrderFor: noWrite,
    addItem: noWrite,
    attach: noWrite,
    updateLine: noWrite,
    overrideLinePrice: noWrite,
    removeLine: noWrite,
    updateSourceLine: noWrite,
    linkCustomer: noWrite,
    unlinkCustomer: noWrite,
    clearOrder: noWrite,
    settleOrder: noWrite,
    amendOrderPayment: noWrite,
    voidUnreceivedOrder: noWrite,
    linkPaidLine: noWrite,
    unlinkPaidLine: noWrite,
    refundLine: noWrite,
    applyOrderCoupon: noWrite,
    removeOrderCoupon: noWrite,
    recheckOrderCoupon: noWrite,
    createCustomer: noWrite,
    updateCustomer: noWrite,
    setCustomerArchived: noWrite,
    mergeCustomers: noWrite,
    resumeCustomerMerge: noWrite,
    voidOrder: noWrite,
    createOrder: noWrite,
    createApproval: noWrite,
    approveApproval: noWrite,
    rejectApproval: noWrite,
    cancelApproval: noWrite,
  };
  return {
    useActions: () => actions,
    useCatalog: () => snapshot.catalog,
    useOrder: (id) => (id ? snapshot.view : null),
    useOrders: () => usePage(snapshot.orders),
    useOpenOrders: () => usePage(snapshot.orders.filter(order => order.state === "unpaid")),
    useOrderHistory: () => usePage([]),
    useCorrectionHistory: () => usePage(snapshot.view?.corrections ?? []),
    useAuditHistory: () => usePage(snapshot.view?.audit ?? []),
    useBookingRefundHistory: () => usePage([]),
    useAppointmentRefundHistory: () => usePage([]),
    useOrderRefundHistory: () => usePage([]),
    useAppointmentFees: () => [],
    useRestoreCheck: () => undefined,
    useCustomerSearch: () => [],
    useCustomerPage: () => usePage([]),
    useCustomer: () => null,
    useCustomerHistory: () => usePage([]),
    useCustomerOrders: () => usePage([]),
    useAttachable: () => snapshot.attachable,
    useAttachLookupStatus: () => ({ complete: true }),
    useLinkCandidates: () => [],
    useBusinessName: () => snapshot.businessName,
    useOrderApprovals: () => [],
    usePendingApprovals: () => usePage([]),
    useApprovalDetail: () => null,
    useFindOrder: () => null,
    ...(commerce ? { commerce: createCommerceFixture(commerce) } : {}),
  };
}

// ─── Commerce design states ───────────────────────────────────────────────────────────────────
// Canned views for every Release 1 kind, typed against backend.tsx. Amounts are the plan's own
// examples (v27), written out, never calculated here. Without a commerce state the backend has no
// `commerce`, exactly as today's checkout.

const fx = <T extends TableNames>(key: string) => `fx${key}` as Id<T>;
const baht = (amount: number) => Math.round(amount * 100);
const NOW = Date.UTC(2026, 10, 19, 7, 0);
const DAY = 86_400_000;
const MAYA = fx<"customers">("cust00maya");

const OFF: SaleSwitches = { products: "off", vouchers: "off", sessionPackages: "off", mixedPackages: "off" };
const REHEARSAL: SaleSwitches = { products: "managers", vouchers: "managers", sessionPackages: "off", mixedPackages: "off" };
const ALL_ON: SaleSwitches = { products: "everyone", vouchers: "everyone", sessionPackages: "everyone", mixedPackages: "everyone" };
const access = (switches: SaleSwitches, role: "manager" | "cashier"): CommerceAccess => ({
  settingsRevision: switches === OFF ? 0 : 3,
  switches,
  canSell: {
    products: switches.products === "everyone" || (switches.products === "managers" && role === "manager"),
    vouchers: switches.vouchers === "everyone" || (switches.vouchers === "managers" && role === "manager"),
    sessionPackages: switches.sessionPackages === "everyone" || (switches.sessionPackages === "managers" && role === "manager"),
    mixedPackages: switches.mixedPackages === "everyone" || (switches.mixedPackages === "managers" && role === "manager"),
  },
  paymentsMode: switches === OFF ? "direct" : "attempts",
  paused: false,
  tillReady: true,
});

const robe: ProductTile = { productId: fx<"products">("prod0robe"), name: "Spa robe", categoryPath: ["Clothing", "Robes"], photoUrl: null, minPrice: baht(1290), maxPrice: baht(1290), variantCount: 7, simpleVariantId: null, status: "active" };
const oil: ProductTile = { productId: fx<"products">("prod00oil"), name: "Lemongrass oil", categoryPath: ["Oils"], photoUrl: null, minPrice: baht(390), maxPrice: baht(790), variantCount: 2, simpleVariantId: null, status: "active" };
const tote: ProductTile = { productId: fx<"products">("prod0tote"), name: "Beach tote", categoryPath: ["Bags"], photoUrl: null, minPrice: baht(350), maxPrice: baht(350), variantCount: 1, simpleVariantId: fx<"productVariants">("var0tote"), status: "active" };
const robeVariant = (code: string, label: string, onHand: number, elsewhere = 0) => ({
  variantId: fx<"productVariants">(`var${code}`), label, optionValues: label.split(" / "), price: baht(1290), sku: `ROBE-${code.toUpperCase()}`,
  onHand, elsewhere: elsewhere ? [{ branchName: "Beach spa", onHand: elsewhere }] : [], needsRecount: false,
});
const products: Record<string, ProductDetail> = {
  [robe.productId]: {
    product: robe, revision: 4,
    options: [{ name: "Colour", values: ["Blue", "White", "Sand"] }, { name: "Size", values: ["S", "M", "L"] }],
    // White / S doesn't exist; Blue / M is sold out here and in stock at another branch (journey 1).
    variants: [robeVariant("blus", "Blue / S", 2), robeVariant("blum", "Blue / M", 0, 3), robeVariant("blul", "Blue / L", 4), robeVariant("whim", "White / M", 1), robeVariant("whil", "White / L", 3), robeVariant("sans", "Sand / S", 1), robeVariant("sanm", "Sand / M", 2)],
  },
  [oil.productId]: {
    product: oil, revision: 1, options: [{ name: "Volume", values: ["100 ml", "250 ml"] }],
    variants: [
      { variantId: fx<"productVariants">("varoil100"), label: "100 ml", optionValues: ["100 ml"], price: baht(390), sku: "OIL-LG-100", onHand: -1, elsewhere: [], needsRecount: true },
      { variantId: fx<"productVariants">("varoil250"), label: "250 ml", optionValues: ["250 ml"], price: baht(790), sku: "OIL-LG-250", onHand: 6, elsewhere: [], needsRecount: false },
    ],
  },
  [tote.productId]: {
    product: tote, revision: 1, options: [],
    variants: [{ variantId: fx<"productVariants">("var0tote"), label: "Beach tote", optionValues: [], price: baht(350), sku: "TOTE-01", onHand: 12, elsewhere: [], needsRecount: false }],
  },
};
const thai60 = { serviceId: fx<"services">("svc0thai60"), name: "Thai massage 60" };
const hotStone60 = { serviceId: fx<"services">("svc0stone60"), name: "Hot stone 60" };
const massage5: PackageTile = {
  packageId: fx<"packages">("pkgmassage5"), versionId: fx<"packageVersions">("pkvmassage5"), name: "Massage 5", price: baht(5400), validityDays: 180, saleKind: "sessionPackages",
  contents: [{ kind: "session", contentKey: "sessions", units: 5, services: [thai60] }],
};
const goldWellness: PackageTile = {
  packageId: fx<"packages">("pkggold"), versionId: fx<"packageVersions">("pkvgold"), name: "Gold Wellness", price: baht(6900), validityDays: 180, saleKind: "mixedPackages",
  contents: [
    { kind: "session", contentKey: "sessions", units: 5, services: [thai60, hotStone60] },
    { kind: "chooseProduct", contentKey: "robe", units: 1, productId: robe.productId, name: "Spa robe" },
    { kind: "voucher", contentKey: "credit", faceValue: baht(500) },
  ],
};
const giftSet: PackageTile = {
  packageId: fx<"packages">("pkggiftset"), versionId: fx<"packageVersions">("pkvgiftset"), name: "Spa care gift set", price: baht(1250), validityDays: 365, saleKind: "mixedPackages",
  contents: [
    { kind: "product", contentKey: "oil", units: 1, variantId: fx<"productVariants">("varoil100"), label: "Lemongrass oil 100 ml" },
    { kind: "product", contentKey: "scrub", units: 1, variantId: fx<"productVariants">("varscrub"), label: "Coconut body scrub" },
    { kind: "voucher", contentKey: "credit", faceValue: baht(500) },
  ],
};

const mayaGrant = (status: SessionGrantCard["status"]): SessionGrantCard => ({
  kind: "grant", grantId: fx<"sessionGrants">("grantmaya"), revision: 6, packageName: "Massage 5", ownerId: MAYA, ownerName: "Maya Lin",
  services: [thai60], paidLeft: 3, goodwillLeft: status === "expired" ? 0 : 1, used: 2, total: 5,
  effectiveExpiresAt: status === "expired" ? NOW - 2 * DAY : NOW + 41 * DAY, pausedSince: null, status,
  unusedPaidValue: baht(3240), branchName: "Main spa", pendingReturn: false,
});
const mayaVoucher = (status: VoucherCard["status"]): VoucherCard => ({
  kind: "voucher", voucherId: fx<"vouchers">("vchmaya"), revision: 2, maskedCode: "GV-••••-Q9XD", name: "Maya Lin", faceValue: baht(2000),
  paidBalance: baht(2000), goodwillBalance: 0, effectiveExpiresAt: NOW + 300 * DAY, pausedSince: status === "paused" ? NOW - 3 * DAY : null,
  status, branchName: "Main spa", source: "sale", packageUnusedPaid: null, pendingReturn: false,
});
const voucherChecks: Record<string, VoucherCheck> = {
  "GV-7K2M-Q9XD": { status: "valid", voucherId: fx<"vouchers">("vchmaya"), maskedCode: "GV-••••-Q9XD", paidBalance: baht(2000), goodwillBalance: 0, effectiveExpiresAt: NOW + 300 * DAY, applies: baht(2000), stillDue: baht(600) },
  "GV-OLD1-2345": { status: "refused", refusal: { code: "VOUCHER_EXPIRED", maskedCode: "GV-••••-2345", expiredAt: NOW - 10 * DAY } },
};
const ORDER = fx<"orders">("bill000011");
const settledAttempt: PaymentAttemptView = {
  attemptId: fx<"paymentAttempts">("att00001"), orderId: ORDER, status: "settled", ownerRevision: 1, tillLabel: "Till 1", staffName: "Ploy", mine: true, due: baht(2600),
  legs: [{ key: "cash", direction: "collect", method: "cash", amount: baht(600), state: "taken", received: baht(1000), change: baht(400), reference: null, instructedAt: NOW - 60_000 }],
  vouchers: [{ voucherId: fx<"vouchers">("vchmaya"), maskedCode: "GV-••••-Q9XD", paid: baht(2000), goodwill: 0 }],
  refusal: null, recovery: null, startedAt: NOW - 90_000,
};
const otherTill: PaymentAttemptView = {
  ...settledAttempt, status: "collecting", tillLabel: "Till 2", staffName: "Nok", mine: false, ownerRevision: 2,
  legs: [{ key: "card", direction: "collect", method: "card", amount: baht(2600), state: "instructed", received: null, change: null, reference: null, instructedAt: NOW - 30_000 }],
  vouchers: [],
};
// D18's example: ฿2,000 voucher + ฿600 cash taken, then the voucher was spent at another till.
const refusedAttempt: PaymentAttemptView = {
  ...settledAttempt, status: "refused",
  refusal: { code: "VOUCHER_USED_UP", maskedCode: "GV-••••-Q9XD" },
  recovery: { kept: baht(600), stillDue: baht(2000), action: { kind: "collectRest", amount: baht(2000), methods: ["cash", "promptpay", "card", "transfer"] } },
};
// Journey 7: Gold Wellness cancelled after two massages, robe brought back.
const goldParts: ReturnQuote["parts"] = [
  { partKey: "sessions", label: "Gold Wellness · 3 unused sessions", units: 3, amount: baht(3160.49) },
  { partKey: "robe", label: "Spa robe · Sand / M", units: 1, amount: baht(1132.51) },
  { partKey: "credit", label: "Unused voucher value", units: 1, amount: baht(500) },
];
const openReturn: ReturnView = {
  returnId: fx<"orderReturns">("ret00001"), orderId: ORDER, status: "authorized", operatorRevision: 1, operatorName: "Ploy", mine: true, approvalId: null, createdAt: NOW - 5 * 60_000,
  parts: goldParts,
  claims: [{ key: "card", method: "card", amount: baht(4793), state: "instructed", reference: null, instructedAt: NOW - 4 * 60_000, dueAt: NOW + 45 * DAY }],
  voucherCredits: [],
  total: baht(4793),
};
/** A package's sessions (a grant): units before and after, paid and goodwill apart. */
const grantHistory = (packageName: string): HistoryEntry[] => [
  { entryId: "h4", at: NOW - DAY, fact: { key: "extended", date: NOW + 41 * DAY }, balance: null, staff: { actorName: "Ploy", reason: "healthPause", reasonText: null } },
  { entryId: "h3", at: NOW - 2 * DAY, fact: { key: "goodwillAdded" }, balance: { unit: "sessions", before: { paid: 3, goodwill: 0 }, after: { paid: 3, goodwill: 1 } }, staff: { actorName: "Ploy", reason: "serviceRecovery", reasonText: null } },
  { entryId: "h2", at: NOW - 3 * DAY, fact: { key: "used", service: "Thai massage 60" }, balance: { unit: "sessions", before: { paid: 4, goodwill: 0 }, after: { paid: 3, goodwill: 0 } }, staff: { actorName: "Nok", reason: null, reasonText: null } },
  { entryId: "h1", at: NOW - 20 * DAY, fact: { key: "purchased", name: packageName }, balance: { unit: "sessions", before: { paid: 0, goodwill: 0 }, after: { paid: 5, goodwill: 0 } }, staff: { actorName: "Nok", reason: null, reasonText: null } },
];
/**
 * A voucher's own ledger (v27 Vouchers): its money balance from issue, each spend, and goodwill
 * credit kept apart from paid value. A standalone voucher also has its name fixed once.
 */
const voucherHistory = (face: number, standalone: boolean): HistoryEntry[] => [
  { entryId: "v4", at: NOW - DAY, fact: { key: "goodwillAdded" }, balance: { unit: "money", before: { paid: face / 2, goodwill: 0 }, after: { paid: face / 2, goodwill: baht(100) } }, staff: { actorName: "Ploy", reason: "serviceRecovery", reasonText: null } },
  { entryId: "v3", at: NOW - 3 * DAY, fact: { key: "spent", amount: face / 2 }, balance: { unit: "money", before: { paid: face, goodwill: 0 }, after: { paid: face / 2, goodwill: 0 } }, staff: { actorName: "Nok", reason: null, reasonText: null } },
  ...(standalone ? [{ entryId: "v2", at: NOW - 19 * DAY, fact: { key: "renamed", name: "Mia Tanaka" }, balance: null, staff: { actorName: "Nok", reason: "spellingCorrection", reasonText: null } } satisfies HistoryEntry] : []),
  { entryId: "v1", at: NOW - 20 * DAY, fact: { key: "issued", amount: face }, balance: { unit: "money", before: { paid: 0, goodwill: 0 }, after: { paid: face, goodwill: 0 } }, staff: { actorName: "Nok", reason: null, reasonText: null } },
];
/** Each History target has its own stream: a package's grant reads sessions, a voucher reads money. */
const historyFor = (target: AdjustTarget): HistoryEntry[] => {
  if (target.targetType === "grant") return grantHistory(target.targetId === fx<"sessionGrants">("grantgold") ? "Gold Wellness" : "Massage 5");
  // Gold Wellness's ฿500 voucher value; Maya's ฿2,000 gift voucher; the gift voucher sold on the receipt.
  if (target.targetType === "voucher") {
    if (target.targetId === fx<"vouchers">("vchgold")) return voucherHistory(baht(500), false);
    return voucherHistory(target.targetId === fx<"vouchers">("vchmaya") ? baht(2000) : baht(1000), true);
  }
  return [];
};

type CommerceScenario = { switches: SaleSwitches; role: "manager" | "cashier"; attempt: PaymentAttemptView | null; returnOpen: boolean; grant: SessionGrantCard["status"]; voucher: VoucherCard["status"] };
const commerceStates = {
  /** Every kind has something sold and readable, every switch Off: what PR 1 ships. */
  dark: { switches: OFF, role: "cashier", attempt: settledAttempt, returnOpen: false, grant: "active", voucher: "active" },
  /** Products and vouchers for managers only, during a desk rehearsal. */
  rehearsal: { switches: REHEARSAL, role: "manager", attempt: null, returnOpen: false, grant: "active", voucher: "active" },
  /** Everything on, for everyone. */
  live: { switches: ALL_ON, role: "cashier", attempt: null, returnOpen: false, grant: "active", voucher: "active" },
  /** Another till is taking this order's payment. */
  "payment-in-progress": { switches: ALL_ON, role: "cashier", attempt: otherTill, returnOpen: false, grant: "active", voucher: "active" },
  /** Money taken · sale not saved, with Collect the rest. */
  "sale-not-saved": { switches: ALL_ON, role: "cashier", attempt: refusedAttempt, returnOpen: false, grant: "active", voucher: "active" },
  /** A return authorized, waiting for Money given back. */
  "return-open": { switches: ALL_ON, role: "manager", attempt: settledAttempt, returnOpen: true, grant: "active", voucher: "active" },
  /** An expired package with unused paid value, and a paused voucher. */
  "expired-and-paused": { switches: ALL_ON, role: "manager", attempt: null, returnOpen: false, grant: "expired", voucher: "paused" },
} satisfies Record<string, CommerceScenario>;
export type CommerceDesignState = keyof typeof commerceStates;
export const commerceDesignStates = Object.keys(commerceStates) as CommerceDesignState[];

/** Canned commerce reads for one design state. Writers refuse, as the rest of the fixture does. */
export function createCommerceFixture(state: CommerceDesignState): CommerceBackend {
  const scenario: CommerceScenario = commerceStates[state];
  const grant = mayaGrant(scenario.grant);
  const voucher = mayaVoucher(scenario.voucher);
  const tiles = [robe, oil, tote];
  return {
    ...COMMERCE_OFF,
    useAccess: () => access(scenario.switches, scenario.role),
    useCheckoutRules: () => ({
      revision: 3, switches: scenario.switches, paymentsMode: scenario.switches === OFF ? "direct" : "attempts", canEdit: scenario.role === "manager",
      terms: {
        preserveExpiredPackageValue: true, unusedFullRefundDays: 7, refundDueDays: { cashOrTransfer: 15, card: 45 }, packageValidityDays: 180, voucherValidityDays: 365,
        allowSessionTransfer: true, packageSplit: "voucherFaceValue", packageVatTiming: "atSale", pointsVatTreatment: "discount", pointsExpiryMonths: 12,
      },
    }),
    useCategories: () => [
      { categoryId: fx<"productCategories">("catcloth"), name: "Clothing", parentId: null },
      { categoryId: fx<"productCategories">("catrobes"), name: "Robes", parentId: fx<"productCategories">("catcloth") },
      { categoryId: fx<"productCategories">("catoils"), name: "Oils", parentId: null },
      { categoryId: fx<"productCategories">("catbags"), name: "Bags", parentId: null },
    ],
    useShop: ({ query }) => usePage(tiles.filter((tile) => tile.name.toLowerCase().includes(query.trim().toLowerCase()))),
    useProduct: (productId) => (productId ? products[productId] ?? null : null),
    usePackagesAndGifts: () => ({
      packages: [massage5, goldWellness, giftSet],
      voucherPresets: [500, 1000, 2000].map((amount) => ({ templateId: null, faceValue: baht(amount), validityDays: 365 })),
      customRange: { min: baht(100), max: baht(20000) },
    }),
    useFrequentPins: () => [{ kind: "package", tile: goldWellness }, { kind: "product", tile: robe }],
    useRoomPostTarget: (orderId) => (orderId ? { bookingId: fx<"bookings">("bkg0room12"), roomLabel: "12", guestName: "Maya Lin", checkedIn: true, noRoomCharges: false } : null),
    useHandovers: () => [{ handoverId: fx<"handovers">("hnd0tote"), lineId: fx<"orderLines">("line0tote"), label: "Beach tote", kind: "room_bill", quantity: 1, withGuest: 1, backSellable: 0, backDamaged: 0, unpaid: 1, paid: 0 }],
    useCustomerBenefits: (customerId) => (customerId ? { customerId, grants: [grant], vouchers: [voucher] } : null),
    useCoverage: (appointmentId) => appointmentId ? {
      appointmentId, attendee: { customerId: MAYA, name: "Maya Lin" },
      offers: grant.status === "active" ? [{ grantId: grant.grantId, revision: grant.revision, packageName: grant.packageName, left: grant.paidLeft + grant.goodwillLeft, effectiveExpiresAt: grant.effectiveExpiresAt }] : [],
    } : null,
    useVoucherCheck: (args) => (args ? voucherChecks[args.code.trim().toUpperCase()] ?? { status: "refused", refusal: { code: "VOUCHER_NOT_FOUND" } } : null),
    useGiftSlip: (voucherId) => voucherId ? { voucherId, code: "GV-7K2M-Q9XD", faceValue: baht(1000), name: "Mia Tanaka", expiresAt: NOW + 365 * DAY, businessName: "Auralis Cove Retreat", shareUrl: "https://example.com/gift/fx" } : null,
    usePaymentAttempt: (orderId) => (orderId ? scenario.attempt : null),
    useReturnable: (orderId) => orderId ? {
      orderId,
      open: scenario.returnOpen ? openReturn : null,
      parts: scenario.returnOpen ? [] : [
        { partKey: "gold", label: "Gold Wellness · whole package", part: { kind: "cancelPackage", lineId: fx<"orderLines">("line0gold") }, maxUnits: 1, needsDisposition: false, upcomingVisits: [{ appointmentId: fx<"appointments">("appt0maya"), start: NOW + 2 * DAY, serviceName: "Thai massage 60" }] },
        { partKey: "robe", label: "Spa robe · Sand / M", part: { kind: "content", lineId: fx<"orderLines">("line0gold"), contentKey: "robe", units: 1 }, maxUnits: 1, needsDisposition: true, upcomingVisits: [] },
      ],
    } : null,
    useReturnQuote: (args) => (args ? { parts: goldParts, claims: [{ ...openReturn.claims[0], state: "owed", instructedAt: null }], voucherCredits: [], total: baht(4793), refusal: null } : null),
    useBenefitCard: (target) => (!target ? null : target.targetType === "grant" ? grant : voucher),
    useHistory: (target, audience) => usePage(!target ? [] : audience === "guest" ? historyFor(target).map(({ entryId, at, fact, balance }) => ({ entryId, at, fact, balance })) : historyFor(target)),
    useEditPreview: (request) => request ? {
      permission: scenario.role === "manager" ? "direct" : "askManager",
      changes: [{ field: "effectiveExpiresAt", before: NOW + 11 * DAY, after: NOW + 41 * DAY }],
      movesMoney: false, needsReason: true, needsConsent: false, upcomingVisits: [], refusal: null,
    } : null,
  };
}
