"use client";

import { createCouponRefusalReporter, type RefusalNote } from "@/lib/booking/coupon-refusals";
import type { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import type { commerceRefusalCodes, editReasons, stockReasons } from "convex/shared/commerce/reasons";
import { lastUsableAt } from "convex/shared/commerce/validity";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { createContext, useContext, useMemo, useCallback, type ReactNode } from "react";

/**
 * Everything the checkout UI reads and writes. The admin page implements it with Convex
 * (convex-backend.ts); the dev preview with canned view states (fixture-backend.ts). The shapes
 * are the Convex functions' own, so both stay in step with convex/pos/ and convex/pos/customers.ts.
 */

type PosCommands = typeof api.pos.commands;
type Pos = { openOrderFor: typeof api.pos.commands.openOrderForLink.openOrderForLink } & typeof api.pos.orders & typeof api.pos.catalog & typeof api.pos.sourceReads & { [K in keyof PosCommands]: PosCommands[K][K & keyof PosCommands[K]] };
export type RestoreReview = FunctionReturnType<Pos["restoreCheck"]>;
export type AppointmentFee = FunctionReturnType<Pos["appointmentFees"]>[number];
export type FinancialStream = "corrections" | "audit" | "bookingRefunds" | "appointmentRefunds" | "orderRefunds";
/** A POS line refund (orderHistoryPages.orderRefunds, pos.refundLine). Its amount is integer satang. */
export type LineRefund = FunctionReturnType<typeof api.pos.orderHistoryPages.orderRefunds>["page"][number];
export type FinancialRows = { corrections: import("convex/_generated/dataModel").Doc<"orderCorrections">; audit: import("convex/_generated/dataModel").Doc<"orderAudit">; bookingRefunds: Pick<import("convex/_generated/dataModel").Doc<"bookingRefunds">, "_id" | "orderId" | "bookingId" | "amount" | "currency" | "method" | "reason" | "effectiveAt" | "recordedAt" | "recordedBy"> & Partial<Pick<import("convex/_generated/dataModel").Doc<"bookingRefunds">, "netBefore" | "netAfter" | "providerRefundId">>; appointmentRefunds: import("convex/_generated/dataModel").Doc<"appointmentRefunds">; orderRefunds: LineRefund };
type Customers = typeof api.pos.customers;
export type Catalog = FunctionReturnType<typeof api.pos.catalog.stableCatalog> & { frequent: FunctionReturnType<typeof api.pos.catalog.recentCatalogRanking> };
export type OrderView = NonNullable<FunctionReturnType<Pos["getOrder"]>>;
export type OrderHistoryRow = FunctionReturnType<Pos["orderHistory"]>["page"][number];
export type OrderLine = OrderView["lines"][number];
export type OrderPromotion = NonNullable<OrderView["promotion"]>;
export type OrderRow = FunctionReturnType<Pos["listOrders"]>["page"][number];
export type OrderFilter = FunctionArgs<Pos["listOrders"]>["filter"];
export type Attachable = FunctionReturnType<Pos["listAttachable"]>[number];
export type LinkCandidate = NonNullable<FunctionReturnType<Pos["linkCandidates"]>>[number];
export type OrderLink = OrderView["links"][number];
export type AttachLookupStatus = FunctionReturnType<Pos["attachLookupStatus"]>;
export type CatalogItem = FunctionArgs<Pos["addItem"]>["item"];
export type Customer = FunctionReturnType<Customers["searchCustomers"]>[number];
export type NewCustomer = FunctionArgs<Customers["createCustomer"]>;
export type CustomerDetail = NonNullable<FunctionReturnType<Customers["getCustomer"]>>;
export type CustomerHistoryRow = FunctionReturnType<Customers["customerHistory"]>["page"][number];
export type CustomerOrderRow = FunctionReturnType<Customers["listCustomerOrders"]>["page"][number];
export type CustomerPage<T> = { results: T[]; status: OrdersPage["status"]; loadMore: (numItems: number) => void };
export type OrderId = Id<"orders">;
export type CustomerId = Id<"customers">;
type Approvals = typeof api.pos.staffApprovals;
/** A manager-approval request, as staffApprovals.forOrder and staffApprovals.pending return it. */
export type ApprovalRequest = FunctionReturnType<Approvals["forOrder"]>[number];
/** One compact row of the manager queue (staffApprovals.pendingPage): no order or detail reads behind it. */
export type ApprovalQueueStatus = FunctionReturnType<Approvals['queueStatus']>;
export type ExpiredApprovalQueueRow = FunctionReturnType<Approvals["recentExpired"]>[number];
export type ApprovalQueueRow = FunctionReturnType<Approvals["pendingPage"]>["page"][number];
/** The one request a manager has open in Approvals (staffApprovals.detail); null when it's gone or not theirs. */
export type ApprovalDetail = NonNullable<FunctionReturnType<Approvals["detail"]>>;
export type ApprovalId = Id<"staffApprovalRequests">;
/** A requester's own request as it stands (staffApprovals.myStatus), for the Ask a manager flow of returns and edits. */
export type MyApprovalStatus = NonNullable<FunctionReturnType<Approvals["myStatus"]>>;

/** One page-at-a-time list, the same shape as Convex's usePaginatedQuery. */
export type OrdersPage = {
  results: OrderRow[];
  status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
  loadMore: (numItems: number) => void;
};

type PosAction =
  | "openOrderFor" | "addItem" | "attach" | "updateLine" | "overrideLinePrice" | "removeLine" | "updateSourceLine"
  | "discardOrder" | "restoreOrder" | "addAppointmentFee"
  | "linkCustomer" | "unlinkCustomer" | "clearOrder" | "settleOrder" | "voidOrder" | "amendOrderPayment" | "voidUnreceivedOrder"
  | "linkPaidLine" | "unlinkPaidLine" | "refundLine"
  | "applyOrderCoupon" | "removeOrderCoupon" | "recheckOrderCoupon";
type ApprovalAction = "create" | "approve" | "reject" | "cancel";
export type CheckoutActions = { [K in PosAction]: (args: FunctionArgs<Pos[K]>) => Promise<FunctionReturnType<Pos[K]>> } & {
  /** An empty order, for a cashier's first custom item that needs approval (pos.createOrder). */
  createOrder: (args: Record<string, never>) => Promise<FunctionReturnType<Pos["createOrder"]>>;
} & {
  [K in ApprovalAction as `${K}Approval`]: (args: FunctionArgs<Approvals[K]>) => Promise<FunctionReturnType<Approvals[K]>>;
} & {
  noteCouponRefusal: (args: RefusalNote) => Promise<unknown>;
  createCustomer: (args: NewCustomer) => Promise<CustomerId>;
} & { [K in "updateCustomer" | "setCustomerArchived" | "mergeCustomers" | "resumeCustomerMerge"]: (args: FunctionArgs<Customers[K]>) => Promise<FunctionReturnType<Customers[K]>> };

export type CheckoutBackend = {
  useRestoreCheck(orderId: OrderId): RestoreReview | undefined;
  useAppointmentFees(appointmentId: Id<"appointments">): AppointmentFee[] | undefined;
  useCorrectionHistory(orderId: OrderId): CustomerPage<FinancialRows["corrections"]>;
  useAuditHistory(orderId: OrderId): CustomerPage<FinancialRows["audit"]>;
  useBookingRefundHistory(orderId: OrderId): CustomerPage<FinancialRows["bookingRefunds"]>;
  useAppointmentRefundHistory(orderId: OrderId): CustomerPage<FinancialRows["appointmentRefunds"]>;
  /** POS line refunds on this receipt, newest first (orderHistoryPages.orderRefunds). */
  useOrderRefundHistory(orderId: OrderId): CustomerPage<FinancialRows["orderRefunds"]>;
  useCatalog(): Catalog | undefined;
  /** undefined while loading, null when the order doesn't exist. */
  useOrder(orderId: OrderId | null, view?: FunctionArgs<Pos["getOrder"]>["view"]): OrderView | null | undefined;
  useOrderHistory(orderId: OrderId): CustomerPage<OrderHistoryRow>;
  useOrders(filter: OrderFilter): OrdersPage;
  /** Open orders with items that this checkout actor can recall (pos.listOpenOrders). */
  useOpenOrders(): OrdersPage;
  /** undefined while loading; [] for a query under two characters. */
  useCustomerSearch(query: string): Customer[] | undefined;
  useCustomerPage(query: string, archived: boolean): CustomerPage<Customer>;
  useCustomer(customerId: CustomerId): CustomerDetail | null | undefined;
  useCustomerHistory(customerId: CustomerId): CustomerPage<CustomerHistoryRow>;
  useCustomerOrders(customerId: CustomerId): CustomerPage<CustomerOrderRow>;
  useAttachable(args: { orderId: OrderId | null; query: string }): Attachable[] | undefined;
  /** Whether this exact lookup reached its results without a capped contact/legacy scan. */
  useAttachLookupStatus(args: { orderId: OrderId | null; query: string }): AttachLookupStatus | undefined;
  /** Appointments or stays a paid row can be linked to, each with why it can't (pos.linkCandidates). undefined while loading. */
  useLinkCandidates(args: { orderId: OrderId; lineId: Id<"orderLines">; query: string }): LinkCandidate[] | null | undefined;
  useBusinessName(): string | undefined;
  /** Approval requests on this order, newest first (staffApprovals.forOrder). undefined while loading or without an order. */
  useOrderApprovals(orderId: OrderId | null): ApprovalRequest[] | undefined;
  /** Requests waiting for a manager, newest first, 20 per cursor page (staffApprovals.pendingPage); only owners and managers load it. */
  usePendingApprovals(): CustomerPage<ApprovalQueueRow>;
  useApprovalQueueStates?(rows: ApprovalQueueRow[]): Record<string, ApprovalQueueStatus | Error | undefined>;
  useExpiredApprovals?(open: boolean): ExpiredApprovalQueueRow[] | undefined;
  /** The selected request's detail (staffApprovals.detail); the panel reads one at a time. */
  useApprovalDetail(requestId: ApprovalId | null): ApprovalDetail | null | undefined;
  /** An order by its number (pos.findOrderByNumber): null when there is none or this role can't open it. */
  useFindOrder(orderNumber: number | null, receipt?: boolean): OrderId | null | undefined;
  useActions(): CheckoutActions;
  /** Products, vouchers, packages, attempts, returns and edits. Absent: every sale switch is Off (useCommerce). */
  commerce?: CommerceBackend;
  /** Return items on commerce receipts (W2B·L3). Absent: no Return items sheet anywhere. */
  returns?: ReturnsDesk;
};

const BackendContext = createContext<CheckoutBackend | null>(null);

const RefusalContext = createContext<ReturnType<typeof createCouponRefusalReporter> | null>(null);

export function CheckoutBackendProvider({ backend, children }: { backend: CheckoutBackend; children: ReactNode }) {
  const actions = backend.useActions();
  const report = useMemo(() => createCouponRefusalReporter(note => actions.noteCouponRefusal(note)), [actions]);
  return <BackendContext.Provider value={backend}><RefusalContext.Provider value={report}>{children}</RefusalContext.Provider></BackendContext.Provider>;
}

export function useCheckoutBackend(): CheckoutBackend {
  const backend = useContext(BackendContext);
  if (!backend) throw new Error("useCheckoutBackend must be used inside <CheckoutBackendProvider>.");
  return backend;
}

/** A key per payment attempt, reused if that attempt is retried. randomUUID needs a secure context. */
export function newAttemptKey() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Shared across the coupon and payment panels for the lifetime of this checkout page. */
export function useOrderCouponRefusal(orderId: OrderId) {
  const report = useContext(RefusalContext);
  return useCallback((code: string, problem: unknown) => report?.(orderId, code, problem, "pos"), [orderId, report]);
}

// ─── Commerce (Release 1, plan v27) ───────────────────────────────────────────────────────────
// Views and actions the checkout and admin screens consume for products, vouchers, packages,
// payment attempts, returns and edits. Readers and writers land wave by wave. Until a reader exists
// its view here is the contract: the fixture backend fills it and the live backend has no
// `commerce`, which reads as every sale switch Off. Stored enums come from the schema, so they
// can't drift; view-only shapes are plain. Money is integer satang, times are epoch ms, and codes
// are masked (GV-••••-Q9XD) everywhere except a gift slip. Copy: messages/commerce/<locale>.json.

type Satang = number;
type Settings = Doc<"commerceSettings">;
/** One D20 settings document, read once per quote. */
export type SaleSwitches = Settings["saleSwitches"];
/** products · vouchers · sessionPackages · mixedPackages, each switched on separately. */
export type SaleKind = keyof SaleSwitches;
/** off · managers (desk rehearsal) · everyone. Every switch defaults Off. */
export type SaleSwitch = SaleSwitches[SaleKind];
export type PaymentsMode = Settings["paymentsMode"];
export type CheckoutTerms = Pick<Settings, "preserveExpiredPackageValue" | "unusedFullRefundDays" | "refundDueDays" | "packageValidityDays" | "voucherValidityDays" | "allowSessionTransfer" | "packageSplit" | "packageVatTiming" | "pointsVatTreatment" | "pointsExpiryMonths">;

/** Read once per checkout: the switches and what this staff member may do with them now. */
export type CommerceAccess = {
  settingsRevision: number;
  switches: SaleSwitches;
  /** The switch applied to this staff member: a cashier can't sell a "managers" kind. */
  canSell: Record<SaleKind, boolean>;
  paymentsMode: PaymentsMode;
  /** "Checkout paused for update" during the payments cutover. */
  paused: boolean;
  /** This till acknowledged the new pay panel (false only mid-cutover). */
  tillReady: boolean;
  /** From the cutover's first pause on: a reopened direct panel checks its earlier instruction first. */
  cutoverStarted?: boolean;
};
/** Settings › Checkout rules (owner only to change). */
export type CheckoutRulesView = { revision: number; terms: CheckoutTerms; switches: SaleSwitches; paymentsMode: PaymentsMode; canEdit: boolean };

// Products ──────────────────────────────────────────────────────────────────────────────────────
export type CatalogueStatus = Doc<"products">["status"];
export type ProductCategory = { categoryId: Id<"productCategories">; name: string; parentId: Id<"productCategories"> | null };
/** One Shop tile, 24 per page. A simple product (one variant) adds straight from its tile. */
export type ProductTile = {
  productId: Id<"products">;
  name: string;
  /** ["Clothing", "Robes"]: at most two levels. */
  categoryPath: string[];
  photoUrl: string | null;
  minPrice: Satang;
  maxPrice: Satang;
  variantCount: number;
  simpleVariantId: Id<"productVariants"> | null;
  status: CatalogueStatus;
};
/** An in-stock button ("Sand / M · 2 left"). Other branches are information, never for sale here. */
export type VariantChoice = {
  variantId: Id<"productVariants">;
  /** "Blue / M" */
  label: string;
  optionValues: string[];
  price: Satang;
  sku: string | null;
  onHand: number;
  elsewhere: { branchName: string; onHand: number }[];
  /** Sold below the count with an item in hand: a manager should recount. */
  needsRecount: boolean;
};
/** Opening a product is the only read of its stock. */
export type ProductDetail = {
  product: ProductTile;
  revision: number;
  /** Up to three: Colour, Size… */
  options: { name: string; values: string[] }[];
  /** Only combinations that exist, at most 100. */
  variants: VariantChoice[];
};
/** "Stock says N · item in hand? Sell anyway", confirmed once per variant and quantity. */
export type InHandConfirmation = { variantId: Id<"productVariants">; quantity: number; onHandSeen: number };
/** A checked-in stay's open order posts products to its room bill (D17). */
export type RoomPostTarget = { bookingId: Id<"bookings">; roomLabel: string; guestName: string; checkedIn: boolean; noRoomCharges: boolean };
/** A posted room charge or a voided sale's units: Take back asks what came back. */
export type HandoverView = Pick<Doc<"handovers">, "kind" | "quantity" | "withGuest" | "backSellable" | "backDamaged" | "unpaid" | "paid"> & {
  handoverId: Id<"handovers">;
  lineId: Id<"orderLines">;
  label: string;
};
export type TakeBackOutcome = "sellable" | "damaged" | "staysOnBill";

// Packages and vouchers ─────────────────────────────────────────────────────────────────────────
/** Package contents as sold: sessions, a fixed product, a product chosen at sale, voucher value. */
export type PackageContent =
  | { kind: "session"; contentKey: string; units: number; services: { serviceId: Id<"services">; name: string }[] }
  | { kind: "product"; contentKey: string; units: number; variantId: Id<"productVariants">; label: string }
  | { kind: "chooseProduct"; contentKey: string; units: number; productId: Id<"products">; name: string }
  | { kind: "voucher"; contentKey: string; faceValue: Satang };
export type PackageTile = {
  packageId: Id<"packages">;
  versionId: Id<"packageVersions">;
  name: string;
  price: Satang;
  validityDays: number;
  /** Sessions only → sessionPackages; any product or voucher value → mixedPackages. */
  saleKind: Extract<SaleKind, "sessionPackages" | "mixedPackages">;
  contents: PackageContent[];
};
export type VoucherPreset = { templateId: Id<"voucherTemplates"> | null; faceValue: Satang; validityDays: number };
/** The Packages & gifts tab. */
export type PackagesAndGifts = { packages: PackageTile[]; voucherPresets: VoucherPreset[]; customRange: { min: Satang; max: Satang } };
/** Up to 8 owner-pinned items in Frequent. */
export type FrequentPin = { kind: "product"; tile: ProductTile } | { kind: "package"; tile: PackageTile };

/** Stored status plus what the screen shows: a pause and an empty balance are their own states. */
export type VoucherStatus = Doc<"vouchers">["status"] | "paused" | "usedUp";
/** A voucher as the card staff are looking at (customer, receipt, search). Paid and goodwill stay apart. */
export type VoucherCard = {
  kind: "voucher";
  voucherId: Id<"vouchers">;
  revision: number;
  maskedCode: string;
  name: string | null;
  faceValue: Satang;
  paidBalance: Satang;
  goodwillBalance: Satang;
  effectiveExpiresAt: number;
  pausedSince: number | null;
  status: VoucherStatus;
  branchName: string;
  source: Doc<"vouchers">["source"]["kind"];
  /** Package-issued value past its date keeps its unused paid value with the package (D3). */
  packageUnusedPaid: Satang | null;
  /** A return has claimed it; edits wait. */
  pendingReturn: boolean;
};
export type GrantStatus = "active" | "paused" | "expired" | "usedUp" | "cancelled";
/** One package's sessions: "Massage 5 · 3 paid + 1 goodwill · until 30 Dec". */
export type SessionGrantCard = {
  kind: "grant";
  grantId: Id<"sessionGrants">;
  revision: number;
  packageName: string;
  ownerId: CustomerId;
  ownerName: string;
  services: { serviceId: Id<"services">; name: string }[];
  paidLeft: number;
  goodwillLeft: number;
  used: number;
  total: number;
  effectiveExpiresAt: number;
  pausedSince: number | null;
  status: GrantStatus;
  /** "Expired · ฿3,240 unused": refundable, not usable. */
  unusedPaidValue: Satang;
  branchName: string;
  pendingReturn: boolean;
};
export type BenefitCard = VoucherCard | SessionGrantCard;
/** In the customer picker and on a linked customer. */
export type CustomerBenefits = { customerId: CustomerId; grants: SessionGrantCard[]; vouchers: VoucherCard[] };
/** "Use Massage 5 · 3 left". The earliest to expire comes first; Change lists the rest. */
export type CoverageOffer = { grantId: Id<"sessionGrants">; revision: number; packageName: string; left: number; effectiveExpiresAt: number };
/** A visit's attendee and offers. A null attendee asks "This is Maya Lin?" once. */
export type CoverageTarget = { appointmentId: Id<"appointments">; attendee: { customerId: CustomerId; name: string } | null; offers: CoverageOffer[] };
/** The pay panel's lookup once the full code is in. */
export type VoucherCheck =
  | { status: "valid"; voucherId: Id<"vouchers">; maskedCode: string; paidBalance: Satang; goodwillBalance: Satang; effectiveExpiresAt: number; applies: Satang; stillDue: Satang }
  | { status: "refused"; refusal: CommerceRefusal };
/** The full code, only here. Reprinting or resending never makes a new code. */
export type GiftSlip = { voucherId: Id<"vouchers">; code: string; faceValue: Satang; name: string | null; expiresAt: number; businessName: string; shareUrl: string };

// Paying (D11, D18) ─────────────────────────────────────────────────────────────────────────────
export type ExternalMethod = Doc<"paymentAttempts">["legs"][number]["method"];
export type TenderMethod = ExternalMethod | "voucher";
export type LegState = Doc<"paymentAttempts">["legs"][number]["state"];
export type AttemptStatus = Doc<"paymentAttempts">["status"];
/** One external leg. Vouchers are not legs: settlement debits them. */
export type PaymentLeg = {
  key: string;
  direction: "collect" | "giveBack";
  method: ExternalMethod;
  amount: Satang;
  state: LegState;
  tendered?: Satang;
  received: Satang | null;
  change: Satang | null;
  reference: string | null;
  /** Shown on Check previous payment: "Card ฿4,900 · 14:02". */
  instructedAt: number | null;
  /**
   * The server's word that no screen may show this part's instruction again (its outcome is unknown,
   * or it was sent before a handover): Check previous payment, whichever till holds it now.
   */
  checkPrevious?: boolean;
};
/** The one next step once the cart can be sold again; only Swap or Give back while the refusal applies. */
export type RecoveryAction =
  | { kind: "collectRest"; amount: Satang; methods: ExternalMethod[] }
  | { kind: "finishSale" }
  | { kind: "finishSwap" }
  | { kind: "giveBack"; amount: Satang }
  | { kind: "swapOrGiveBack"; reason: PayRefusal };
export type PaymentAttemptView = {
  attemptId: Id<"paymentAttempts">;
  orderId: OrderId;
  status: AttemptStatus;
  ownerRevision: number;
  /** Every other till shows "Payment in progress on Till 1 · Ploy". */
  tillLabel: string;
  staffName: string;
  mine: boolean;
  due: Satang;
  legs: PaymentLeg[];
  vouchers: { voucherId: Id<"vouchers">; maskedCode: string; paid: Satang; goodwill: Satang }[];
  /** "Money taken · sale not saved" names what changed. */
  refusal: PayRefusal | null;
  /** Handed over and not yet accepted: the till it waits for, and whether that is this till. */
  handedOverTo?: { label: string; here: boolean } | null;
  recovery: { kept: Satang; stillDue: Satang; action: RecoveryAction } | null;
  startedAt: number;
  /** The cashier's booking payment confirmation email choice, kept on the attempt across reloads and handovers. */
  notifyGuest?: boolean;
};
export type PlannedLeg = { method: ExternalMethod; amount: Satang };
export type PlannedVoucher = { voucherId: Id<"vouchers">; paid: Satang; goodwill: Satang };
/** "notTaken" and "declined" record the same thing; "unknown" keeps the part locked until checked. */
export type LegOutcome = "taken" | "declined" | "notTaken" | "unknown";
export type SettleResult = { status: "settled"; orderId: OrderId; receiptNumber?: number } | { status: "refused"; refusal: PayRefusal };

// ─── Pay desk (W2A·L3) ────────────────────────────────────────────────────────────────────────
// The attempt flow's own requests. A payment is quoted, started (which locks the order on every
// till), armed part by part before staff are told to charge, recorded, then settled. Every call is
// keyed or revision-checked, so a retry after a lost answer repeats the same step and never invites
// a second charge. Only reachable once paymentsMode is "attempts" (the owner's cutover).

/** A refusal the server words itself, for codes outside CommerceRefusal (order_changed, pay_room_first…). */
export type ServerRefusal = { code: "SERVER"; reason: string; message: string };
export type PayRefusal = CommerceRefusal | ServerRefusal;
/** One planned external part, keyed so arming and recording it can be retried. */
export type PayLegPlan = { key: string; method: ExternalMethod; amount: Satang };
/** The reviewed customers on the order (payer, package owners, visit attendees). */
export type ReviewedCustomer = { customerId: CustomerId; revision: number };
/** What staff reviewed before the first instruction; frozen by the server under a fingerprint. */
export type AttemptQuote = {
  orderId: OrderId;
  orderRevision: number;
  due: Satang;
  /** The Bangkok business date the money is received ("2026-11-19"). */
  businessDate: string;
  customers: ReviewedCustomer[];
  legs: PayLegPlan[];
  vouchers: PlannedVoucher[];
};
export type AttemptRef = { attemptId: Id<"paymentAttempts">; ownerRevision: number };
export type HandoverTills = { thisTill: string | null; tills: { tillId: string; label: string }[] };
/** The order as reviewed now, sent with every recovery step. */
export type RecoveryReview = { orderRevision: number; customers: ReviewedCustomer[]; vouchers: PlannedVoucher[] };
/** What was verified as kept, what is still due, and the one next step (D18). */
export type RecoveryPreview = {
  kept: { method: ExternalMethod; amount: Satang }[];
  /** Positive: still due. Negative: too much was taken. */
  balance: Satang;
  next: "collect" | "finish" | "giveBack" | "swapOrGiveBack";
  /** Why the cart can't be sold as it is (only with swapOrGiveBack). */
  refusal: PayRefusal | null;
};
export type RecoveryStep =
  | { action: "collectRest"; legs: PayLegPlan[] }
  | { action: "finishSale" }
  | { action: "giveBack"; leg: PayLegPlan; cancelSale?: boolean }
  | { action: "swap" };
/** An armed part: the attempt, and whether this call (not an earlier one) gave the instruction. */
export type Armed = { attempt: PaymentAttemptView; instructed: boolean };
export type PayActions = {
  /** Claims the order with the reviewed quote. Same key, same quote: the same attempt. */
  startAttempt(args: Keyed & AttemptQuote): Promise<PaymentAttemptView>;
  /** Replaces the planned (unarmed) parts; armed and taken parts never change. */
  changePlan(args: AttemptRef & { legs: PayLegPlan[] }): Promise<PaymentAttemptView>;
  /**
   * Persists the instruction before it is shown. An earlier unchecked instruction comes back
   * instead: `instructed` is true only when this call armed the part, the one case where the
   * panel may show a fresh instruction (any other answer shows Check previous payment).
   */
  armLeg(args: AttemptRef & { legKey: string; stockInHand?: boolean; stockReview?: InHandConfirmation[]; tendered?: Satang }): Promise<Armed>;
  saveCashTendered(args: AttemptRef & { legKey: string; tendered: Satang | null }): Promise<void>;
  recordLeg(args: AttemptRef & { legKey: string; direction?: PaymentLeg["direction"]; outcome: LegOutcome; received?: Satang; reference?: string }): Promise<PaymentAttemptView>;
  /** `notifyGuest`: the cashier's choice to email the booking payment confirmation, as on the direct panel. */
  settleAttempt(args: AttemptRef & { orderId: OrderId; stockInHand?: boolean; stockReview?: InHandConfirmation[]; notifyGuest?: boolean }): Promise<SettleResult>;
  /** Keeps the booking email choice on the attempt, so a reload or the till it is handed to settles with it. */
  setEmailChoice(args: AttemptRef & { notifyGuest: boolean }): Promise<void>;
  /** Releases the order when nothing was taken. */
  cancelAttempt(args: AttemptRef): Promise<null>;
  previewRecovery(args: AttemptRef & RecoveryReview): Promise<RecoveryPreview>;
  /**
   * One recovery step. Collect and finish start a keyed child attempt; give back arms its own part
   * (`instructed` only when this call armed it, as with armLeg).
   */
  recover(args: Keyed & AttemptRef & RecoveryReview & RecoveryStep): Promise<{ child: PaymentAttemptView | null; instructed: boolean }>;
  /**
   * The owner hands the payment to another admitted till (v27 Handover); it continues there once
   * that till accepts (takeOver). Instructions already shown stay locked as Check previous payment.
   */
  handOver(args: AttemptRef & { nextTillId: string }): Promise<void>;
  /** A manager takes over after checking the terminal and drawer, or the till a payment was handed to accepts it. */
  takeOver(args: { orderId: OrderId; ownerRevision: number; stoppedPreviousOperator: boolean }): Promise<PaymentAttemptView>;
  /** Pay the room first (D17): accommodation stays on this order, everything else moves to Shop & spa. */
  payRoomFirst(args: Keyed & { orderId: OrderId; orderRevision: number }): Promise<{ roomOrderId: OrderId; shopOrderId: OrderId }>;
  /**
   * The direct panel registers with the instruction it shows, so the cutover can see which panels
   * are still open; it belongs to this till and tab. Settlement closes it; anything else is a
   * manager's reconciliation. `previous`: this tab's earlier unrecorded panel for the order, which
   * the panel continues; `check` (from the cutover's first pause on): Check previous payment
   * before any instruction, recording only exactly `instruction` while `matches`. Another till or
   * tab's open panel refuses with PAY_PANEL_ELSEWHERE from the first pause on.
   */
  openDirectPanel(args: DirectPanelRequest & { instruction?: DirectInstruction }): Promise<{ previous?: DirectPanelPrevious } | null>;
  /**
   * The instruction the panel shows now (`null`: none, a split not yet covered) and its booking
   * email choice. Best effort before the cutover starts; from then on the panel shows an
   * instruction only once this resolved. A new instruction is refused while the earlier one is checked.
   */
  instructDirectPanel(args: DirectPanelRequest & { instruction?: DirectInstruction | null; notifyGuest?: boolean }): Promise<null>;
  /** Check previous payment → Not taken, outside the pause: the panel may instruct again. */
  answerDirectPanel(args: DirectPanelRequest): Promise<null>;
  /** A manager moves another till's open panel to this till and tab, after its operator stopped. */
  takeOverDirectPanel(args: { orderId: OrderId; tillId: Id<"tills">; panelKey: string; tabKey: string; stoppedPreviousOperator: boolean }): Promise<null>;
};

/** What a direct panel asks staff to collect, against the order revision and due it shows. */
export type DirectInstruction = { revision: number; due: number; tenders: { method: ExternalMethod; amount: number }[] };
export type DirectPanelRequest = { orderId: OrderId; panelKey: string; tillId?: Id<"tills">; tabKey?: string };
export type DirectPanelPrevious = DirectPanelRegistration & { tillId: Id<"tills">; openedAt: number; check: boolean; matches: boolean; instruction?: DirectInstruction & { at: number }; notifyGuest?: boolean };

/** The rollout registration a direct panel settles under. */
export type DirectPanelRegistration = { panelKey: string; tillId?: Id<"tills">; tabKey?: string };

// Returns (D8, D14) ─────────────────────────────────────────────────────────────────────────────
export type ReturnPart = Doc<"orderReturns">["parts"][number];
export type ReturnDisposition = NonNullable<Extract<ReturnPart, { kind: "line" }>["disposition"]>;
export type ReturnStatus = Doc<"orderReturns">["status"];
export type PayoutState = Doc<"orderReturns">["claims"][number]["state"];
/** Something still returnable. `part` is the request to send, at its most units. */
export type ReturnablePart = {
  partKey: string;
  label: string;
  part: ReturnPart;
  maxUnits: number;
  /** Products ask Sellable or Damaged. */
  needsDisposition: boolean;
  /** Visits already booked against these sessions, shown as a warning (D5). */
  upcomingVisits: { appointmentId: Id<"appointments">; start: number; serviceName: string }[];
};
/**
 * A visit on a commerce receipt the server can return (pos.orders.getOrder commerce.returnableVisitParts):
 * a paid visit refunds through its appointment's money adapter, a covered one restores its session (฿0).
 */
export type ReturnableVisitPart = {
  lineId: Id<"orderLines">;
  label: string;
  amount: Satang;
  appointmentId: Id<"appointments">;
  part: Extract<ReturnPart, { kind: "restoreSession" }> | Extract<ReturnPart, { kind: "line" }>;
};
/** Money to a card, cash drawer or account, with its own state; one person gives it back. */
export type ReturnClaimView = {
  key: string;
  method: ExternalMethod;
  amount: Satang;
  state: PayoutState;
  reference: string | null;
  instructedAt: number | null;
  /** Refund deadline (D20): 15 days cash or transfer, 45 card by default. */
  dueAt: number;
};
/** Back onto a voucher first (D8), or onto a new 90-day voucher when that one can't take it. */
/** A voucher credit on an open return. existingVoucher: the return said it goes back onto this voucher, even with no mask to show. */
export type VoucherCreditView = { voucherId: Id<"vouchers">; maskedCode: string; paid: Satang; goodwill: Satang; newVoucher: boolean; existingVoucher?: boolean };
/** Each part and destination with its amount, shown before anything is recorded. */
export type ReturnQuote = {
  parts: { partKey: string; label: string; units: number; amount: Satang }[];
  claims: ReturnClaimView[];
  voucherCredits: VoucherCreditView[];
  total: Satang;
  refusal: CommerceRefusal | null;
};
export type ReturnView = Omit<ReturnQuote, "refusal" | "parts"> & {
  /** A part's amount; null when the live projection doesn't split the total per part. */
  parts: (Omit<ReturnQuote["parts"][number], "amount"> & { amount: Satang | null })[];
  returnId: Id<"orderReturns">;
  orderId: OrderId;
  status: ReturnStatus;
  operatorRevision: number;
  operatorName: string;
  mine: boolean;
  approvalId: ApprovalId | null;
  createdAt: number;
};
/** Return items on a receipt: what can still go back, and the open return if there is one. */
export type Returnable = { orderId: OrderId; parts: ReturnablePart[]; open: ReturnView | null };

// Edits and history (D19) ───────────────────────────────────────────────────────────────────────
type Adjustment = Doc<"commerceAdjustments">;
type TargetTables = {
  product: "products"; variant: "productVariants"; package: "packages"; voucherTemplate: "voucherTemplates"; service: "services"; property: "properties";
  voucher: "vouchers"; grant: "sessionGrants"; stock: "stockLevels"; handover: "handovers"; order: "orders"; settings: "commerceSettings";
};
/** What an edit is about: one typed id per stored target kind. */
export type AdjustTarget = { [T in Adjustment["targetType"]]: { targetType: T; targetId: Id<TargetTables[T]> } }[Adjustment["targetType"]];
export type AdjustTargetType = AdjustTarget["targetType"];
export type AdjustKind = Adjustment["kind"];
export type EditReason = (typeof editReasons)[number];
export type StockReason = (typeof stockReasons)[number];
export type GuestConsent = NonNullable<Adjustment["consent"]>;
/** One typed input per edit kind; Take back and payment fixes keep their own commands. */
export type AdjustInput =
  | { kind: "extend"; until: number }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "addGoodwill"; units?: number; amount?: Satang }
  | { kind: "removeGoodwill"; units?: number; amount?: Satang }
  | { kind: "rename"; name: string }
  | { kind: "reissue" }
  | { kind: "disable" }
  | { kind: "transfer"; toCustomerId: CustomerId; consent: GuestConsent }
  | { kind: "addService"; serviceId: Id<"services"> }
  | { kind: "substituteService"; from: Id<"services">; to: Id<"services">; consent: GuestConsent }
  | { kind: "narrowServices"; serviceIds: Id<"services">[]; consent: GuestConsent }
  | { kind: "shorten"; until: number; consent: GuestConsent }
  | { kind: "adjustStock"; delta: number; stockReason: StockReason }
  | { kind: "moveRoomCharge"; toBookingId: Id<"bookings"> }
  | { kind: "editCatalogue"; fields: Record<string, string | number | boolean | null> }
  | { kind: "publish" }
  | { kind: "updateSettings"; terms?: Partial<CheckoutTerms>; switches?: Partial<SaleSwitches> };
export type AdjustRequest = { target: AdjustTarget; input: AdjustInput; expectedRevision: number; reason: EditReason | null; reasonText: string | null };
/** What this staff member can do with the edit now: Save, Ask a manager, or neither. */
export type EditPermission = "direct" | "askManager" | "ownerOnly" | "denied";
/** Before → after, shown before Save. Moves no money unless movesMoney says so. */
export type EditPreview = {
  permission: EditPermission;
  changes: { field: string; before: string | number | null; after: string | number | null }[];
  movesMoney: boolean;
  needsReason: boolean;
  needsConsent: boolean;
  upcomingVisits: { appointmentId: Id<"appointments">; start: number; serviceName: string }[];
  refusal: CommerceRefusal | null;
};
export type AdjustResult =
  | { status: "applied"; adjustmentId: Id<"commerceAdjustments">; revision: number }
  | { status: "requested"; approvalId: ApprovalId };

/** Guest-safe facts: the server stores the key and its arguments, the screen picks the words. */
type GuestFactArgs = {
  purchased: { name: string }; issued: { amount: Satang }; used: { service: string }; restored: object; noShow: object; waived: object;
  transferredIn: object; transferredOut: object; extended: { date: number }; paused: object; resumed: { date: number };
  goodwillAdded: object; goodwillRemoved: object; renamed: { name: string }; reissued: object; disabled: object; expired: object;
  cancelled: object; spent: { amount: Satang }; refundCredit: { amount: Satang }; serviceAdded: { service: string }; sold: object;
  stockAdjusted: object; roomCharge: { room: string }; takenBack: object; published: object;
  /** Settings › Checkout rules (D20); staff only, never on a guest item. */
  rulesChanged: object; paymentsSwitched: object; checkoutPaused: object; checkoutResumed: object;
  /** A change the row's writer didn't describe in guest words. */
  updated: object;
};
export type GuestFactKey = keyof GuestFactArgs;
export type GuestFact = { [K in GuestFactKey]: { key: K } & GuestFactArgs[K] }[GuestFactKey];
export type HistoryBalance =
  | { unit: "sessions" | "money"; before: { paid: number; goodwill: number }; after: { paid: number; goodwill: number } }
  | { unit: "stock"; before: number; after: number };
/** One row of an item's history, newest first, 20 per page. Show guest never carries `staff`. */
export type HistoryEntry = {
  entryId: string;
  at: number;
  fact: GuestFact;
  balance: HistoryBalance | null;
  staff?: { actorName: string; reason: EditReason | StockReason | null; reasonText: string | null };
  /** Staff only: the fields an edit stored (catalogue, settings, a rename), before and after. History shows what changed. */
  fields?: { before?: StoredFields; after?: StoredFields };
  /** Checkout rules rows only: each changed rule before → after (`refundDueDays.card`, `saleSwitches.vouchers`). */
  ruleChanges?: SettingsChange[];
};
export type SettingsChange = { field: string; before: string | number | boolean | null; after: string | number | boolean | null };
/** An edit's stored fields as the server sends them: values, lists, settings groups or package parts. */
export type StoredFields = Record<string, StoredValue>;
type StoredScalar = string | number | boolean | null;
type StoredValue = StoredScalar | StoredScalar[] | Record<string, unknown> | Record<string, unknown>[];
/** One part of a list such as a package's contents: its name, how many (sessions when `sessions`) and any amount. */
export type PartValue = { part: string; count: number | null; amount: number | null; sessions: boolean };
/** A changed value: a scalar or a list of them, a list part, or a size for anything bigger; undefined when absent. */
export type ChangeValue = string | number | boolean | null | (string | number | boolean | null)[] | PartValue | { items: number } | undefined;
export type FieldChange = { field: string; before: ChangeValue; after: ChangeValue };
export type HistoryAudience = "staff" | "guest";

// Refusals ──────────────────────────────────────────────────────────────────────────────────────
// Every commerce command refuses with ConvexError({ code, ...args }) and writes nothing.
type RefusalArgs = {
  STALE_REVISION: { target?: AdjustTargetType };
  SALE_SWITCH_OFF: { kind: SaleKind };
  SALE_SWITCH_MANAGERS_ONLY: { kind: SaleKind };
  NEEDS_MANAGER: { action: AdjustKind | "returnItems" | "sessionWaive" };
  OWNER_ONLY: { action: AdjustKind };
  CONSENT_REQUIRED: object;
  REASON_REQUIRED: object;
  VOUCHER_NOT_FOUND: object;
  VOUCHER_EXPIRED: { maskedCode: string; expiredAt: number };
  VOUCHER_PAUSED: { maskedCode: string };
  VOUCHER_DISABLED: { maskedCode: string };
  VOUCHER_USED_UP: { maskedCode: string };
  VOUCHER_WRONG_BRANCH: { maskedCode: string; branchName: string };
  VOUCHER_NOT_ALLOWED: { reason: "sellsVoucherValue" | "roomStay" };
  VOUCHER_LIMIT: { max: number };
  PAYMENT_ROWS_LIMIT: { max: number };
  STOCK_CONFIRM_NEEDED: { variantId: Id<"productVariants">; variantLabel: string; onHand: number; quantity: number; shortages?: { variantId: Id<"productVariants">; label: string; onHand: number; quantity: number }[] };
  OTHER_BRANCH_STOCK: object;
  OVER_CAP: { cap: "variantsPerProduct" | "packageContents" | "orderRows" | "pins"; max: number };
  ITEM_ARCHIVED: { name: string };
  SESSION_UNAVAILABLE: object;
  SESSION_EXPIRED: { packageName: string; expiredAt: number };
  SESSION_PAUSED: { packageName: string };
  NO_SESSIONS_LEFT: { packageName: string };
  ATTENDEE_MISMATCH: { ownerName: string };
  PAYMENT_IN_PROGRESS: { attemptId: Id<"paymentAttempts">; tillLabel: string; staffName: string };
  PAYMENT_HANDED_OVER: object;
  CHECK_PREVIOUS_PAYMENT: { method: ExternalMethod; amount: Satang; at: number };
  CHECKOUT_PAUSED: object;
  TILL_NEEDS_RELOAD: object;
  PRICE_CHANGED: object;
  RETURN_IN_PROGRESS: { returnId: Id<"orderReturns"> };
  RETURN_HANDED_OVER: object;
  RETURN_TOO_LARGE: { visitRows: number; grants: number };
  ROOM_CHARGES_OFF: { roomLabel: string };
  STAY_NOT_CHECKED_IN: object;
  ITEM_WITH_GUEST: { handoverId: Id<"handovers"> };
  KEY_CONFLICT: object;
  RECEIPT_TOO_OLD: object;
};
export type CommerceRefusalCode = (typeof commerceRefusalCodes)[number];
export type CommerceRefusal = { [C in CommerceRefusalCode]: { code: C } & RefusalArgs[C] }[CommerceRefusalCode];

/** Every refusal code and its message under Commerce.refusals. */
export const COMMERCE_REFUSAL_MESSAGES = {
  STALE_REVISION: "staleRevision",
  SALE_SWITCH_OFF: "saleSwitchOff",
  SALE_SWITCH_MANAGERS_ONLY: "saleSwitchManagersOnly",
  NEEDS_MANAGER: "needsManager",
  OWNER_ONLY: "ownerOnly",
  CONSENT_REQUIRED: "consentRequired",
  REASON_REQUIRED: "reasonRequired",
  VOUCHER_NOT_FOUND: "voucherNotFound",
  VOUCHER_EXPIRED: "voucherExpired",
  VOUCHER_PAUSED: "voucherPaused",
  VOUCHER_DISABLED: "voucherDisabled",
  VOUCHER_USED_UP: "voucherUsedUp",
  VOUCHER_WRONG_BRANCH: "voucherWrongBranch",
  VOUCHER_NOT_ALLOWED: "voucherNotAllowed",
  VOUCHER_LIMIT: "voucherLimit",
  PAYMENT_ROWS_LIMIT: "paymentRowsLimit",
  STOCK_CONFIRM_NEEDED: "stockConfirmNeeded",
  OTHER_BRANCH_STOCK: "otherBranchStock",
  OVER_CAP: "overCap",
  ITEM_ARCHIVED: "itemArchived",
  SESSION_UNAVAILABLE: "sessionUnavailable",
  SESSION_EXPIRED: "sessionExpired",
  SESSION_PAUSED: "sessionPaused",
  NO_SESSIONS_LEFT: "noSessionsLeft",
  ATTENDEE_MISMATCH: "attendeeMismatch",
  PAYMENT_IN_PROGRESS: "paymentInProgress",
  PAYMENT_HANDED_OVER: "paymentHandedOver",
  CHECK_PREVIOUS_PAYMENT: "checkPreviousPayment",
  CHECKOUT_PAUSED: "checkoutPaused",
  TILL_NEEDS_RELOAD: "tillNeedsReload",
  PRICE_CHANGED: "priceChanged",
  RETURN_IN_PROGRESS: "returnInProgress",
  RETURN_HANDED_OVER: "returnHandedOver",
  RETURN_TOO_LARGE: "returnTooLarge",
  ROOM_CHARGES_OFF: "roomChargesOff",
  STAY_NOT_CHECKED_IN: "stayNotCheckedIn",
  ITEM_WITH_GUEST: "itemWithGuest",
  KEY_CONFLICT: "keyConflict",
  RECEIPT_TOO_OLD: "receiptTooOld",
} as const satisfies Record<CommerceRefusalCode, string>;

/** The server's commerce refusal, or null for any other error, including a lost answer. */
export function commerceRefusal(err: unknown): CommerceRefusal | null {
  const data = err && typeof err === "object" && "data" in err ? (err as { data?: unknown }).data : undefined;
  const code = data && typeof data === "object" ? (data as { code?: unknown }).code : undefined;
  return typeof code === "string" && Object.hasOwn(COMMERCE_REFUSAL_MESSAGES, code) ? (data as CommerceRefusal) : null;
}

/** A translator scoped to the "Commerce" namespace, plus the page's money and date formatting. */
export type CommerceCopy = {
  t: (key: string, values?: Record<string, string | number>) => string;
  /** Whether the catalog has this key; without it, optional words fall back to plain ones. */
  has?: (key: string) => boolean;
  money: (satang: Satang) => string;
  date: (at: number) => string;
};
const METHOD_KEYS = { cash: "pay.cash", promptpay: "pay.promptPay", card: "pay.card", transfer: "pay.transfer" } as const satisfies Record<ExternalMethod, string>;

/** A refusal as one sentence in the page's language. */
export function refusalText(refusal: CommerceRefusal, { t, money, date }: CommerceCopy): string {
  const key = `refusals.${COMMERCE_REFUSAL_MESSAGES[refusal.code]}`;
  switch (refusal.code) {
    case "SALE_SWITCH_OFF":
    case "SALE_SWITCH_MANAGERS_ONLY":
      return t(key, { kind: t(`kinds.${refusal.kind}`) });
    case "VOUCHER_EXPIRED":
      return t(key, { code: refusal.maskedCode, date: date(refusal.expiredAt) });
    case "VOUCHER_PAUSED":
    case "VOUCHER_DISABLED":
    case "VOUCHER_USED_UP":
      return t(key, { code: refusal.maskedCode });
    case "VOUCHER_WRONG_BRANCH":
      return t(key, { code: refusal.maskedCode, branch: refusal.branchName });
    case "VOUCHER_LIMIT":
    case "PAYMENT_ROWS_LIMIT":
    case "OVER_CAP":
      return t(key, { max: refusal.max });
    case "STOCK_CONFIRM_NEEDED":
      return t(key, { count: refusal.onHand, variant: refusal.variantLabel });
    case "ITEM_ARCHIVED":
      return t(key, { name: refusal.name });
    case "SESSION_EXPIRED":
      return t(key, { name: refusal.packageName, date: date(refusal.expiredAt) });
    case "SESSION_PAUSED":
    case "NO_SESSIONS_LEFT":
      return t(key, { name: refusal.packageName });
    case "ATTENDEE_MISMATCH":
      return t(key, { name: refusal.ownerName });
    case "PAYMENT_IN_PROGRESS":
      return t(key, { till: refusal.tillLabel, staff: refusal.staffName });
    case "CHECK_PREVIOUS_PAYMENT":
      return t(key, { method: t(METHOD_KEYS[refusal.method]), amount: money(refusal.amount) });
    case "ROOM_CHARGES_OFF":
      return t(key, { room: refusal.roomLabel });
    default:
      return t(key);
  }
}

/** A history row's plain-language fact, the same words for staff and for Show guest. */
export function guestFactText(fact: GuestFact, { t, money, date }: CommerceCopy): string {
  const key = `history.facts.${fact.key}`;
  switch (fact.key) {
    case "purchased":
    case "renamed":
      return t(key, { name: fact.name });
    case "issued":
    case "spent":
    case "refundCredit":
      return t(key, { amount: money(fact.amount) });
    case "used":
    case "serviceAdded":
      return t(key, { service: fact.service });
    case "extended":
    case "resumed":
      // A benefit's stored end is exclusive: say the last day it can be used.
      return t(key, { date: date(lastUsableAt(fact.date)) });
    case "roomCharge":
      return t(key, { room: fact.room });
    default:
      return t(key);
  }
}

/** Everything commerce screens read. undefined while loading, null where nothing exists. */
export type CommerceBackend = {
  useAccess(): CommerceAccess | undefined;
  useCheckoutRules(): CheckoutRulesView | undefined;
  useCategories(): ProductCategory[] | undefined;
  /** 24 tiles per page; stock isn't read here. */
  useShop(args: { categoryId: Id<"productCategories"> | null; query: string }): CustomerPage<ProductTile>;
  useProduct(productId: Id<"products"> | null): ProductDetail | null | undefined;
  usePackagesAndGifts(): PackagesAndGifts | undefined;
  useFrequentPins(): FrequentPin[] | undefined;
  useRoomPostTarget(orderId: OrderId | null): RoomPostTarget | null | undefined;
  useHandovers(orderId: OrderId | null): HandoverView[] | undefined;
  useCustomerBenefits(customerId: CustomerId | null): CustomerBenefits | null | undefined;
  useCoverage(appointmentId: Id<"appointments"> | null): CoverageTarget | null | undefined;
  /** null until the full code is in. */
  useVoucherCheck(args: { orderId: OrderId; code: string } | null): VoucherCheck | null | undefined;
  useGiftSlip(voucherId: Id<"vouchers"> | null): GiftSlip | null | undefined;
  /**
   * The order's live attempt; null when it has none. Pass the order's active attempt id: another
   * till's attempt is known only by it ("Payment in progress on Till 1 · Ploy").
   */
  usePaymentAttempt(orderId: OrderId | null, activeAttemptId?: Id<"paymentAttempts">): PaymentAttemptView | null | undefined;
  /** Whether payments can reach the server now: the browser is online and the live connection is up. */
  useConnected(): boolean;
  /** The other admitted tills a payment can be handed over to, and this till's label; read only while `wanted`. */
  useHandoverTills(wanted: boolean): HandoverTills | undefined;
  useReturnable(orderId: OrderId | null): Returnable | null | undefined;
  useReturnQuote(args: { orderId: OrderId; parts: ReturnPart[] } | null): ReturnQuote | null | undefined;
  useBenefitCard(target: Extract<AdjustTarget, { targetType: "voucher" | "grant" }> | null): BenefitCard | null | undefined;
  useHistory(target: AdjustTarget | null, audience: HistoryAudience): CustomerPage<HistoryEntry>;
  useEditPreview(request: AdjustRequest | null): EditPreview | null | undefined;
  /** The requester's own return or edit request; null when it isn't theirs or doesn't exist. */
  useMyApproval(requestId: ApprovalId | null): MyApprovalStatus | null | undefined;
  useActions(): CommerceActions;
};

type Keyed = { clientKey: string };
/** Writers. Each refuses with a CommerceRefusal and writes nothing; the same clientKey and payload replays. */
export type CommerceActions = {
  addProduct(args: Keyed & { orderId: OrderId; variantId: Id<"productVariants">; quantity: number; inHand?: InHandConfirmation }): Promise<{ lineId: Id<"orderLines"> }>;
  postToRoom(args: Keyed & { orderId: OrderId; variantId: Id<"productVariants">; quantity: number; inHand?: InHandConfirmation }): Promise<{ lineId: Id<"orderLines">; handoverId: Id<"handovers"> }>;
  takeBack(args: Keyed & { handoverId: Id<"handovers">; contentKey: string | null; units: number; outcome: TakeBackOutcome }): Promise<{ handoverId: Id<"handovers"> }>;
  addPackage(args: Keyed & { orderId: OrderId; versionId: Id<"packageVersions">; ownerId: CustomerId | null; choices: { contentKey: string; variantId: Id<"productVariants"> }[]; inHand?: InHandConfirmation[] }): Promise<{ lineId: Id<"orderLines"> }>;
  addVoucher(args: Keyed & { orderId: OrderId; faceValue: Satang; templateId: Id<"voucherTemplates"> | null; name: string | null }): Promise<{ lineId: Id<"orderLines"> }>;
  /** Use session on a visit or service row (named so it isn't mistaken for a React hook). */
  applySession(args: Keyed & { orderId: OrderId; appointmentId: Id<"appointments"> | null; lineId: Id<"orderLines"> | null; grantId: Id<"sessionGrants">; expectedRevision: number }): Promise<{ lineId: Id<"orderLines"> }>;
  confirmAttendee(args: { appointmentId: Id<"appointments">; customerId: CustomerId }): Promise<null>;
  authorizeReturn(args: Keyed & { orderId: OrderId; parts: ReturnPart[]; reason: string }): Promise<{ status: "authorized" | "completed"; returnId: Id<"orderReturns"> } | { status: "requested"; approvalId: ApprovalId }>;
  recordPayout(args: Keyed & { returnId: Id<"orderReturns">; claimKey: string; operatorRevision: number; outcome: "given" | "failed" | "unknown"; reference?: string; method?: ExternalMethod }): Promise<ReturnView>;
  cancelReturn(args: Keyed & { returnId: Id<"orderReturns">; operatorRevision: number }): Promise<ReturnView>;
  adjust(args: Keyed & AdjustRequest): Promise<AdjustResult>;
} & PayActions;

const off: CommerceAccess = {
  settingsRevision: 0,
  switches: { products: "off", vouchers: "off", sessionPackages: "off", mixedPackages: "off" },
  canSell: { products: false, vouchers: false, sessionPackages: false, mixedPackages: false },
  paymentsMode: "direct",
  paused: false,
  tillReady: true,
};
const emptyPage: CustomerPage<never> = { results: [], status: "Exhausted", loadMore: () => {} };
const notOnSale = async (): Promise<never> => {
  throw new Error("Commerce isn't switched on in this checkout.");
};
const offActions: CommerceActions = {
  addProduct: notOnSale, postToRoom: notOnSale, takeBack: notOnSale, addPackage: notOnSale, addVoucher: notOnSale,
  applySession: notOnSale, confirmAttendee: notOnSale, authorizeReturn: notOnSale, recordPayout: notOnSale,
  cancelReturn: notOnSale, adjust: notOnSale,
  startAttempt: notOnSale, changePlan: notOnSale, armLeg: notOnSale, saveCashTendered: notOnSale, recordLeg: notOnSale, settleAttempt: notOnSale,
  cancelAttempt: notOnSale, previewRecovery: notOnSale, recover: notOnSale, handOver: notOnSale, takeOver: notOnSale, payRoomFirst: notOnSale, setEmailChoice: notOnSale,
  // Without a cutover there is nothing to register.
  openDirectPanel: async () => null,
  instructDirectPanel: async () => null,
  answerDirectPanel: async () => null,
  takeOverDirectPanel: notOnSale,
};
/** A backend without commerce: every switch Off, nothing sold, nothing to show. */
export const COMMERCE_OFF: CommerceBackend = {
  useAccess: () => off,
  useCheckoutRules: () => undefined,
  useCategories: () => [],
  useShop: () => emptyPage,
  useProduct: () => null,
  usePackagesAndGifts: () => ({ packages: [], voucherPresets: [], customRange: { min: 0, max: 0 } }),
  useFrequentPins: () => [],
  useRoomPostTarget: () => null,
  useHandovers: () => [],
  useCustomerBenefits: () => null,
  useCoverage: () => null,
  useVoucherCheck: () => null,
  useGiftSlip: () => null,
  usePaymentAttempt: () => null,
  useConnected: () => true,
  useHandoverTills: () => ({ thisTill: null, tills: [] }),
  useReturnable: () => null,
  useReturnQuote: () => null,
  useBenefitCard: () => null,
  useHistory: () => emptyPage,
  useEditPreview: () => null,
  useMyApproval: () => null,
  useActions: () => offActions,
};

/** The checkout's commerce readers and writers, or COMMERCE_OFF when the backend has none yet. */
export function useCommerce(): CommerceBackend {
  return useCheckoutBackend().commerce ?? COMMERCE_OFF;
}

// ─── Returns desk (W2B·L3) ─────────────────────────────────────────────────────────────────────
// The Return items sheet over api.pos.commands.returnItems, in the server's own shapes. A return is
// claimed by one operator at one till: authorize (or a manager's approval) reserves everything and
// creates one claim per payout destination; each destination is armed on the server before its
// instruction shows, then recorded as given, failed or unknown. Only a successful arm or the first
// authorize answer carries a fresh instruction; an instructed or unknown claim seen on any later
// read means "Check previous refund". Server refusals are ConvexError({ code, message, ... }).

type ReturnFns = typeof api.pos.commands.returnItems;
type ReturnCommand = "preview" | "authorize" | "askManager" | "decideApproval" | "claim" | "arm" | "recordPayout" | "retry" | "cancel" | "release";
/** What a return request names: the receipt as reviewed, the till, the reason and the parts. */
export type ReturnRequestArgs = FunctionArgs<ReturnFns["preview"]>;
export type ReturnPreview = FunctionReturnType<ReturnFns["preview"]>;
export type ReturnLotsLookup = FunctionArgs<ReturnFns["lots"]>;
export type ReturnLotOptions = FunctionReturnType<ReturnFns["lots"]>[number];
/** The open (or just finished) return as its operator or a manager reads it. */
export type ReturnRecord = NonNullable<FunctionReturnType<ReturnFns["get"]>>;
export type ReturnClaim = ReturnRecord["claims"][number];
/** A cashier's request as they see it (staffApprovals.myStatus). */
export type ReturnRequestStatus = NonNullable<FunctionReturnType<typeof api.pos.staffApprovals.myStatus>>;
/** A pending return request in the managers' queue (staffApprovals.pendingPage). */
export type ReturnQueueRow = Extract<FunctionReturnType<typeof api.pos.staffApprovals.pendingPage>["page"][number], { kind: "returnItems" }>;
export type ReturnsDeskActions = { [K in ReturnCommand]: (args: FunctionArgs<ReturnFns[K]>) => Promise<FunctionReturnType<ReturnFns[K]>> };
/**
 * Which return to read: the receipt's open return for this staff member at this till (or the given
 * return), or, `completed`, its latest completed return that issued replacement vouchers.
 */
export type ReturnLookup = { orderId: OrderId; returnId: Id<"orderReturns"> | null; tillId: string } | { orderId: OrderId; completed: true };
/** pos.commands.returnItems.get's arguments for a lookup. */
export const returnArgs = (args: ReturnLookup) => "completed" in args
  ? { orderId: args.orderId, completed: true }
  : { orderId: args.orderId, tillId: args.tillId, ...(args.returnId ? { returnId: args.returnId } : {}) };
export type ReturnsDesk = {
  /** The return a lookup names (ReturnLookup). undefined while loading, null when there is none. */
  useReturn(args: ReturnLookup | null): ReturnRecord | null | undefined;
  useLots(args: ReturnLotsLookup | null): ReturnLotOptions[] | Error | undefined;
  /** The signed-in cashier's own request; null when it isn't theirs. */
  useRequestStatus(requestId: ApprovalId | null): ReturnRequestStatus | null | undefined;
  /** Pending return requests for approvers, newest first. [] when this staff member can't approve. */
  useActions(): ReturnsDeskActions;
};

/** The returns desk, or null where the backend has none (canned previews). */
export function useReturnsDesk(): ReturnsDesk | null {
  return useCheckoutBackend().returns ?? null;
}
