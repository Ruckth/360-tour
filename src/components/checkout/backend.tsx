"use client";

import { createCouponRefusalReporter, type RefusalNote } from "@/lib/booking/coupon-refusals";
import type { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { createContext, useContext, useMemo, useCallback, type ReactNode } from "react";

/**
 * Everything the checkout UI reads and writes. The admin page implements it with Convex
 * (convex-backend.ts); the dev preview with in-memory fixtures (fixture-backend.ts). The shapes
 * are the Convex functions' own, so both stay in step with convex/pos.ts and convex/customers.ts.
 */

type Pos = typeof api.pos;
export type RestoreReview = FunctionReturnType<Pos["restoreCheck"]>;
export type AppointmentFee = FunctionReturnType<Pos["appointmentFees"]>[number];
export type FinancialStream = "corrections" | "audit" | "bookingRefunds" | "appointmentRefunds";
export type FinancialRows = { corrections: import("convex/_generated/dataModel").Doc<"billCorrections">; audit: import("convex/_generated/dataModel").Doc<"billAudit">; bookingRefunds: Pick<import("convex/_generated/dataModel").Doc<"bookingRefunds">, "_id" | "billId" | "bookingId" | "amount" | "currency" | "method" | "reason" | "effectiveAt" | "recordedAt" | "recordedBy"> & Partial<Pick<import("convex/_generated/dataModel").Doc<"bookingRefunds">, "netBefore" | "netAfter" | "providerRefundId">>; appointmentRefunds: import("convex/_generated/dataModel").Doc<"appointmentRefunds"> };
type Customers = typeof api.customers;
export type Catalog = FunctionReturnType<Pos["catalog"]>;
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
export type OrderId = Id<"bills">;
export type CustomerId = Id<"customers">;
type Approvals = typeof api.staffApprovals;
/** A manager-approval request, as staffApprovals.forOrder and staffApprovals.pending return it. */
export type ApprovalRequest = FunctionReturnType<Approvals["forOrder"]>[number];
export type ApprovalQueue = FunctionReturnType<Approvals["pending"]>;
export type ApprovalId = Id<"staffApprovalRequests">;

/** One page-at-a-time list, the same shape as Convex's usePaginatedQuery. */
export type OrdersPage = {
  results: OrderRow[];
  status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
  loadMore: (numItems: number) => void;
};

type PosAction =
  | "openOrderFor" | "addItem" | "attach" | "updateLine" | "overrideLinePrice" | "removeLine" | "updateSourceLine"
  | "discardOrder" | "restoreOrder" | "addAppointmentFee"
  | "linkCustomer" | "unlinkCustomer" | "saveOrder" | "clearOrder" | "settleOrder" | "voidOrder" | "amendOrderPayment" | "voidUnreceivedOrder"
  | "linkPaidLine" | "unlinkPaidLine"
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
  useAppointmentFees(appointmentId: Id<"serviceAppointments">): AppointmentFee[] | undefined;
  useCorrectionHistory(orderId: OrderId): CustomerPage<FinancialRows["corrections"]>;
  useAuditHistory(orderId: OrderId): CustomerPage<FinancialRows["audit"]>;
  useBookingRefundHistory(orderId: OrderId): CustomerPage<FinancialRows["bookingRefunds"]>;
  useAppointmentRefundHistory(orderId: OrderId): CustomerPage<FinancialRows["appointmentRefunds"]>;
  useCatalog(): Catalog | undefined;
  /** undefined while loading, null when the order doesn't exist. */
  useOrder(orderId: OrderId | null): OrderView | null | undefined;
  useOrderHistory(orderId: OrderId): CustomerPage<OrderHistoryRow>;
  useOrders(filter: OrderFilter): OrdersPage;
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
  useLinkCandidates(args: { orderId: OrderId; lineId: Id<"billLines">; query: string }): LinkCandidate[] | null | undefined;
  useBusinessName(): string | undefined;
  /** Approval requests on this order, newest first (staffApprovals.forOrder). undefined while loading or without an order. */
  useOrderApprovals(orderId: OrderId | null): ApprovalRequest[] | undefined;
  /** Requests waiting for a manager; only owners and managers load it. */
  usePendingApprovals(): ApprovalQueue | undefined;
  /** An order by its number (pos.findOrderByNumber): null when there is none or this role can't open it. */
  useFindOrder(orderNumber: number | null): OrderId | null | undefined;
  useActions(): CheckoutActions;
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
