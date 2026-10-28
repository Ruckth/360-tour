"use client";

import type { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { createContext, useContext, type ReactNode } from "react";

/**
 * Everything the checkout UI reads and writes. The admin page implements it with Convex
 * (convex-backend.ts); the dev preview with in-memory fixtures (fixture-backend.ts). The shapes
 * are the Convex functions' own, so both stay in step with convex/pos.ts.
 */

type Pos = typeof api.pos;
export type Catalog = FunctionReturnType<Pos["catalog"]>;
export type BillView = NonNullable<FunctionReturnType<Pos["getBill"]>>;
export type BillLine = BillView["lines"][number];
export type OpenBill = FunctionReturnType<Pos["listOpenBills"]>[number];
export type Attachable = FunctionReturnType<Pos["listAttachable"]>[number];
export type CatalogItem = FunctionArgs<Pos["addItem"]>["item"];
export type Guest = { name: string; phone?: string; email?: string };
export type BillId = Id<"bills">;

type ActionName =
  | "openFor" | "addItem" | "attach" | "updateLine" | "overrideLinePrice" | "removeLine"
  | "setCustomer" | "holdBill" | "clearBill" | "settleBill" | "voidBill";
export type CheckoutActions = { [K in ActionName]: (args: FunctionArgs<Pos[K]>) => Promise<FunctionReturnType<Pos[K]>> };

export type CheckoutBackend = {
  useCatalog(): Catalog | undefined;
  /** undefined while loading, null when the bill doesn't exist. */
  useBill(billId: BillId | null): BillView | null | undefined;
  useOpenBills(): OpenBill[] | undefined;
  useNextWalkIn(): number | undefined;
  useGuestSearch(query: string): Guest[] | undefined;
  useAttachable(guest: Guest | null): Attachable[] | undefined;
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

/** Distinct guests among booking search results, newest first. */
export function guestsFromBookings(rows: ReadonlyArray<{ guestName: string; guestPhone: string; guestEmail?: string }>): Guest[] {
  const guests = new Map<string, Guest>();
  for (const row of rows) {
    const key = row.guestPhone.replace(/\D/g, "") || row.guestEmail?.toLowerCase() || row.guestName.trim().toLowerCase();
    if (!guests.has(key)) guests.set(key, { name: row.guestName, phone: row.guestPhone || undefined, email: row.guestEmail });
  }
  return [...guests.values()];
}

/** A key per payment attempt, reused if that attempt is retried. randomUUID needs a secure context. */
export function newAttemptKey() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
