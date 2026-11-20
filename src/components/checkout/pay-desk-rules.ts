import { MAX_TENDERS } from "convex/shared/orderMath";
import { resortIsoDate } from "@/lib/staff-bookings";
import type { ExternalMethod, OrderView, PaymentAttemptView, PaymentLeg, ReviewedCustomer } from "./backend";

/*
 * The attempt flow's rules, kept out of the components so they can be read and tested on their
 * own, and out of pay-desk.ts so the direct checkout never loads them. The server is the authority
 * for every one of them; these only decide what the screen offers.
 */

/** The Bangkok business date for a payment received now. */
export const todayBusinessDate = () => resortIsoDate(Date.now());

/** The reviewed customers: today only the payer. Package owners and attendees join with their waves. */
export function reviewedCustomers(view: OrderView): ReviewedCustomer[] {
  const customer = view.customer;
  return customer && "revision" in customer && !("mergedInto" in customer && customer.mergedInto)
    ? [{ customerId: customer._id, revision: customer.revision ?? 0 }]
    : [];
}

export const isUnchecked = (leg: PaymentLeg) => leg.state === "instructed" || leg.state === "unknown";
export const collected = (legs: readonly PaymentLeg[]) => legs.filter((leg) => leg.direction === "collect");

/**
 * The one thing the panel shows for an attempt. `armedHere` holds the parts this panel instance
 * armed itself: only those show a fresh instruction. Any other instructed part (after a reload,
 * another device, a takeover) shows Check previous payment until staff record what happened.
 */
export type DeskStep =
  | { kind: "elsewhere" }
  | { kind: "recovery" }
  | { kind: "instruct"; leg: PaymentLeg }
  | { kind: "checkPrevious"; leg: PaymentLeg }
  | { kind: "settle" }
  | { kind: "plan" };

export function deskStep(attempt: PaymentAttemptView, armedHere: ReadonlySet<string>): DeskStep {
  if (!attempt.mine) return { kind: "elsewhere" };
  const unchecked = attempt.legs.find(isUnchecked);
  if (unchecked) return unchecked.state === "instructed" && armedHere.has(unchecked.key) ? { kind: "instruct", leg: unchecked } : { kind: "checkPrevious", leg: unchecked };
  if (attempt.status === "refused") return { kind: "recovery" };
  const parts = collected(attempt.legs);
  if (attempt.status === "recovering") {
    // A recovery child settles what the chain kept plus its own parts, all of which must be taken.
    return parts.every((leg) => leg.state === "taken") ? { kind: "settle" } : { kind: "plan" };
  }
  const taken = parts.filter((leg) => leg.state === "taken").reduce((sum, leg) => sum + leg.amount, 0);
  const vouchers = attempt.vouchers.reduce((sum, voucher) => sum + voucher.paid + voucher.goodwill, 0);
  return taken + vouchers === attempt.due && !parts.some((leg) => leg.state === "planned") ? { kind: "settle" } : { kind: "plan" };
}

/**
 * Methods that keep the receipt within three payment rows (vouchers included): methods already
 * kept can always take more; a new method needs a free row.
 */
export function methodsWithinRows(kept: readonly { method: ExternalMethod }[], vouchers: number, all: readonly ExternalMethod[]) {
  const used = new Set(kept.map((tender) => tender.method));
  return all.filter((method) => used.has(method) || used.size + vouchers < MAX_TENDERS);
}

/**
 * What the next part may charge: the reviewed due less vouchers and taken parts. A recovery
 * child's amount was fixed by the server's balance, so a part declined there is retried as it was.
 */
export function stillToCharge(attempt: PaymentAttemptView | null, due: number) {
  if (!attempt) return due;
  const parts = collected(attempt.legs);
  if (attempt.status === "recovering") return parts.filter((leg) => leg.state === "declined").at(-1)?.amount ?? 0;
  const vouchers = attempt.vouchers.reduce((sum, voucher) => sum + voucher.paid + voucher.goodwill, 0);
  return attempt.due - vouchers - parts.filter((leg) => leg.state === "taken").reduce((sum, leg) => sum + leg.amount, 0);
}
