"use client";

import type { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { createContext, useContext, type ReactNode } from "react";

/**
 * Everything the checkout UI reads and writes. The admin page implements it with Convex
 * (convex-backend.ts); the dev preview with in-memory fixtures (fixture-backend.ts). The shapes
 * are the Convex functions' own, so both stay in step with convex/pos.ts and convex/customers.ts.
 */

type Pos = typeof api.pos;
type Customers = typeof api.customers;
export type Catalog = FunctionReturnType<Pos["catalog"]>;
export type OrderView = NonNullable<FunctionReturnType<Pos["getOrder"]>>;
export type OrderLine = OrderView["lines"][number];
export type OrderRow = FunctionReturnType<Pos["listOrders"]>["page"][number];
export type OrderFilter = FunctionArgs<Pos["listOrders"]>["filter"];
export type Attachable = FunctionReturnType<Pos["listAttachable"]>[number];
export type AttachLookupStatus = FunctionReturnType<Pos["attachLookupStatus"]>;
export type CatalogItem = FunctionArgs<Pos["addItem"]>["item"];
export type Customer = FunctionReturnType<Customers["searchCustomers"]>[number];
export type NewCustomer = FunctionArgs<Customers["createCustomer"]>;
export type OrderId = Id<"bills">;
export type CustomerId = Id<"customers">;

/** One page-at-a-time list, the same shape as Convex's usePaginatedQuery. */
export type OrdersPage = {
  results: OrderRow[];
  status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
  loadMore: (numItems: number) => void;
};

type PosAction =
  | "openOrderFor" | "addItem" | "attach" | "updateLine" | "overrideLinePrice" | "removeLine" | "updateSourceLine"
  | "linkCustomer" | "unlinkCustomer" | "saveOrder" | "clearOrder" | "settleOrder" | "voidOrder";
export type CheckoutActions = { [K in PosAction]: (args: FunctionArgs<Pos[K]>) => Promise<FunctionReturnType<Pos[K]>> } & {
  createCustomer: (args: NewCustomer) => Promise<CustomerId>;
};

export type CheckoutBackend = {
  useCatalog(): Catalog | undefined;
  /** undefined while loading, null when the order doesn't exist. */
  useOrder(orderId: OrderId | null): OrderView | null | undefined;
  useOrders(filter: OrderFilter): OrdersPage;
  /** undefined while loading; [] for a query under two characters. */
  useCustomerSearch(query: string): Customer[] | undefined;
  useAttachable(args: { orderId: OrderId | null; query: string }): Attachable[] | undefined;
  /** Whether phone and email search reaches every unpaid appointment yet (false only mid-rollout). */
  useAttachLookupStatus(): AttachLookupStatus | undefined;
  useBusinessName(): string | undefined;
  useActions(): CheckoutActions;
};

const BackendContext = createContext<CheckoutBackend | null>(null);

export function CheckoutBackendProvider({ backend, children }: { backend: CheckoutBackend; children: ReactNode }) {
  return <BackendContext.Provider value={backend}>{children}</BackendContext.Provider>;
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
