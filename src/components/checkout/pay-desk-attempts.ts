"use client";

import type { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { MAX_TENDERS } from "convex/shared/orderMath";
import { COMMERCE_REFUSAL_MESSAGES, type CommerceRefusal, type OrderId, type PayRefusal, type PaymentAttemptView, type PaymentLeg, type RecoveryPreview } from "./backend";
import { serverTillId, tillId } from "./pay-desk";
import { claimTabKey } from "./pay-desk-tab";

export { currentTab, subscribeTab } from "./pay-desk-tab";
import { tillLoad, type AttemptActions, type AttemptCalls, type Fns } from "./pay-desk-backend";

/*
 * The attempt flow over the settle lane's commands (convex/pos/commands), loaded only once a till
 * is on the new payments (or a recovery, pause or reload screen shows): the direct checkout carries
 * none of it. The server answers refusals as values; here they become thrown CommerceRefusals, or
 * ServerRefusals with the server's own words, so the panel handles every refusal in one place.
 * Nothing here calls the direct settleOrder.
 */

type ServerAttempt = Extract<FunctionReturnType<Fns["start"]>, { status: "ready" }>["attempt"];
type ServerLeg = ServerAttempt["legs"][number];
type Refused = { status: "refused"; code: string; message: string };

const leg = (direction: PaymentLeg["direction"]) => (row: ServerLeg): PaymentLeg => ({
  key: row.key, direction, method: row.method, amount: row.amount, state: row.state,
  tendered: row.tendered, received: row.received ?? null, change: row.change ?? null, reference: row.reference ?? null, instructedAt: row.instructedAt ?? null,
  checkPrevious: row.checkPrevious,
});

/** The server's codes that have a CommerceRefusal of their own. */
const KNOWN: Record<string, (message: string) => CommerceRefusal> = {
  payment_handed_over: () => ({ code: "PAYMENT_HANDED_OVER" }),
  checkout_paused: () => ({ code: "CHECKOUT_PAUSED" }),
  payments_direct: () => ({ code: "TILL_NEEDS_RELOAD" }),
  attempt_required: () => ({ code: "TILL_NEEDS_RELOAD" }),
  payment_limit: () => ({ code: "PAYMENT_ROWS_LIMIT", max: MAX_TENDERS }),
  voucher_limit: () => ({ code: "VOUCHER_LIMIT", max: 2 }),
  payment_key_conflict: () => ({ code: "KEY_CONFLICT" }),
};

/** A stored or returned refusal in the client's terms. */
export function payRefusal({ code, message, ...rest }: { code: string; message: string }): PayRefusal {
  if (Object.hasOwn(COMMERCE_REFUSAL_MESSAGES, code)) return { code, ...rest } as CommerceRefusal;
  return KNOWN[code]?.(message) ?? { code: "SERVER", reason: code, message };
}

function refuse(result: Refused): never {
  throw new ConvexError(payRefusal(result));
}

/**
 * The till's name for staff ("Front desk iPad"), once the server sends one with the attempt; ""
 * until then, and the screen says "another till".
 */
export const tillLabelOf = (row: object) => ("tillLabel" in row && typeof row.tillLabel === "string" ? row.tillLabel : "");

/** Who holds the payment, as another till reads it: their sign-in name, else from their email. */
const ownerName = (row: { owner?: string; ownerDisplayName?: string }) => row.ownerDisplayName || staffLabel(row.owner ?? "");

export function attemptView(attempt: ServerAttempt): PaymentAttemptView {
  return {
    attemptId: attempt.attemptId, orderId: attempt.orderId, status: attempt.status, ownerRevision: attempt.ownerRevision,
    tillLabel: tillLabelOf(attempt), staffName: ownerName(attempt), mine: true, due: attempt.reviewedRequest.due,
    legs: [...attempt.legs.map(leg("collect")), ...attempt.giveBackLegs.map(leg("giveBack"))],
    vouchers: attempt.reviewedRequest.vouchers.map((voucher) => ({ ...voucher, maskedCode: "" })),
    refusal: attempt.refusal ? payRefusal(attempt.refusal) : null,
    recovery: null,
    startedAt: Math.min(...attempt.legs.map((row) => row.instructedAt ?? Infinity), Date.now()),
    notifyGuest: attempt.notifyGuest,
  };
}

/** "ploy@resort.example" → "Ploy": who is taking the payment, as the other till reads it. */
export const staffLabel = (email: string) => email ? email.split("@")[0].replace(/^./, (c) => c.toUpperCase()) : "";

const NEXT = { collect: "collect", finish: "finish", give_back: "giveBack", swap_or_give_back: "swapOrGiveBack" } as const;

/** The attempt commands, each refusal thrown in the client's terms. */
export function payActions(call: AttemptCalls): AttemptActions {
  const till = tillId;
  // Every owner command names this till and this tab; another tab of the same browser is another operator.
  const owner = async (ref: { attemptId: Id<"paymentAttempts">; ownerRevision: number }) =>
    ({ attemptId: ref.attemptId, ownerRevision: ref.ownerRevision, tillId: till(), tabKey: await claimTabKey() });
  const review = (args: { orderRevision: number; customers: { customerId: Id<"customers">; revision: number }[]; vouchers: { voucherId: Id<"vouchers">; paid: number; goodwill: number }[] }) =>
    ({ expectedRevision: args.orderRevision, customers: args.customers, vouchers: args.vouchers });
  return {
    async startAttempt({ clientKey, orderId, orderRevision, due, businessDate, customers, legs, vouchers }) {
      const result = await call.start({ orderId, tillId: till(), tabKey: await claimTabKey(), clientKey, expectedRevision: orderRevision, expectedDue: due, businessDate, customers, legs, vouchers, ...tillLoad() });
      if (result.status === "refused") refuse(result);
      if (result.status === "in_progress_elsewhere") refuse({ status: "refused", code: "in_progress_elsewhere", message: `Payment in progress on ${tillLabelOf(result) || "another till"} · ${ownerName(result)}` });
      return attemptView(result.attempt);
    },
    async changePlan({ legs, ...ref }) {
      const result = await call.change({ ...await owner(ref), legs });
      if (result.status === "refused") refuse(result);
      return attemptView(result.attempt);
    },
    async armLeg({ legKey, stockInHand, tendered, ...ref }) {
      const result = await call.arm({ ...await owner(ref), ...tillLoad(), legKey, stockInHand, tendered });
      if (result.status === "refused") refuse(result);
      if (result.status === "tendered") throw new Error("Unexpected cash tender update");
      if (result.status === "confirm_stock") {
        const [first] = result.shortages;
        throw new ConvexError({ code: "STOCK_CONFIRM_NEEDED", variantId: first.variantId, variantLabel: first.label, onHand: first.onHand, quantity: first.quantity } satisfies CommerceRefusal);
      }
      // Only "instruct" is a fresh instruction; "check_previous" means another call armed a part first.
      return { attempt: attemptView(result.attempt), instructed: result.status === "instruct" };
    },
    async saveCashTendered({ legKey, tendered, ...ref }) {
      const result = await call.arm({ ...await owner(ref), ...tillLoad(), legKey, tendered, updateTendered: true });
      if (result.status === "refused") refuse(result);
    },
    async recordLeg({ legKey, direction, outcome, received, reference, ...ref }) {
      const result = await call.record({
        ...await owner(ref), legKey, kind: direction === "giveBack" ? "give_back" : "collection",
        outcome: outcome === "notTaken" ? "declined" : outcome, received, reference,
      });
      if (result.status === "refused") refuse(result);
      return attemptView(result.attempt);
    },
    async settleAttempt({ orderId, stockInHand, notifyGuest, ...ref }) {
      const result = await call.settle({ ...await owner(ref), stockInHand, ...(notifyGuest === undefined ? {} : { notifyGuest }) });
      if (result.status === "settled") return { status: "settled", orderId, receiptNumber: result.receiptNumber };
      if (result.status === "confirm_stock") {
        const [first] = result.shortages;
        throw new ConvexError({ code: "STOCK_CONFIRM_NEEDED", variantId: first.variantId, variantLabel: first.label, onHand: first.onHand, quantity: first.quantity } satisfies CommerceRefusal);
      }
      return { status: "refused", refusal: payRefusal(result) };
    },
    async setEmailChoice({ notifyGuest, ...ref }) {
      const result = await call.emailChoice({ ...await owner(ref), notifyGuest });
      if (result.status === "refused") refuse(result);
    },
    async cancelAttempt(ref) {
      const result = await call.cancel(await owner(ref));
      if (result.status === "refused") refuse(result);
      return null;
    },
    async previewRecovery({ attemptId, ownerRevision, ...rest }): Promise<RecoveryPreview> {
      const result = await call.preview({ ...await owner({ attemptId, ownerRevision }), ...review(rest) });
      if (result.status === "refused") refuse(result);
      return { kept: result.kept.map(({ method, amount }) => ({ method, amount })), balance: result.balance, next: NEXT[result.next], refusal: result.refusal ? payRefusal(result.refusal) : null };
    },
    async recover(args) {
      const mine = await owner(args);
      const base = { ...mine, ...review(args) };
      if (args.action === "swap") {
        const result = await call.swap({ ...mine, expectedRevision: args.orderRevision });
        if (result.status === "refused") refuse(result);
        return { child: null, instructed: false };
      }
      if (args.action === "giveBack") {
        const result = await call.giveBack({ ...base, ...tillLoad(), leg: args.leg, cancelSale: args.cancelSale });
        if (result.status === "refused") refuse(result);
        return { child: null, instructed: result.status === "instruct" };
      }
      const result = await call.startRecovery({ ...base, clientKey: args.clientKey, legs: args.action === "collectRest" ? args.legs : [] });
      if (result.status === "refused") refuse(result);
      return { child: attemptView(result.attempt), instructed: false };
    },
    async handOver({ nextTillId, ...ref }) {
      const result = await call.release({ ...await owner(ref), nextTillId });
      if (result.status === "refused") refuse(result);
    },
    async takeOver({ orderId, ownerRevision, stoppedPreviousOperator }) {
      const result = await call.takeOver({ orderId, tillId: till(), tabKey: await claimTabKey(), ...tillLoad(), expectedOwnerRevision: ownerRevision, stoppedPreviousOperator });
      if (result.status === "refused") refuse(result);
      return attemptView(result.attempt);
    },
    async payRoomFirst({ clientKey, orderId, orderRevision }) {
      const result = await call.split({ orderId, expectedRevision: orderRevision, clientKey });
      if (result.status === "refused") refuse(result);
      return { roomOrderId: result.roomOrderId, shopOrderId: result.shopOrderId };
    },
  };
}

/** The resume query's answer as the panel reads it: this tab's attempt, another's, or none. */
export function attemptReading(result: FunctionReturnType<typeof api.pos.commands.resumePaymentAttempt.resumePaymentAttempt>, orderId: OrderId, activeAttemptId: Id<"paymentAttempts"> | undefined): PaymentAttemptView | null {
  if (result.status === "resume") return attemptView(result.attempt);
  if (result.status !== "in_progress_elsewhere" || !activeAttemptId) return null;
  // Handed over: nobody owns it until the chosen till accepts.
  const handedOverTo = result.owner ? null : { label: tillLabelOf(result), here: result.tillId === serverTillId() };
  return {
    attemptId: activeAttemptId, orderId, status: "collecting", ownerRevision: result.ownerRevision,
    tillLabel: tillLabelOf(result), staffName: ownerName(result), mine: false, due: 0, legs: [], vouchers: [],
    refusal: null, recovery: null, startedAt: 0, handedOverTo,
  };
}
