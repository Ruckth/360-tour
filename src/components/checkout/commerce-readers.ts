import type { api } from "convex/_generated/api";
import { editReasons, stockReasons } from "convex/shared/commerce/reasons";
import type { FunctionReturnType } from "convex/server";
import { maskVoucherCodes } from "@/components/display/voucher-mask";
import { COMMERCE_REFUSAL_MESSAGES, type CommerceRefusal, type EditReason, type GuestFact, type GuestFactKey, type HistoryEntry, type PaymentAttemptView, type PaymentLeg, type Returnable, type StockReason } from "./backend";

/**
 * The live backend's commerce reads, turned into the views commerce screens draw. Pure, so the
 * shapes are tested without a Convex client (convex-backend.ts calls these). Checkout loads this
 * with its first screen, so code only a lazy sheet needs lives beside that sheet instead:
 * history-changes.ts (History) and approval-readers.ts (an item's approval request).
 */

type HistoryRow =
  | FunctionReturnType<typeof api.commerce.history.staffPage>["page"][number]
  | FunctionReturnType<typeof api.commerce.history.guestPage>["page"][number];

/** The arguments each fact's words need. A fact without them reads as a plain "Updated". */
const FACT_ARGS: { [K in GuestFactKey]: Record<string, "string" | "number"> } = {
  purchased: { name: "string" }, issued: { amount: "number" }, used: { service: "string" }, restored: {}, noShow: {}, waived: {},
  transferredIn: {}, transferredOut: {}, extended: { date: "number" }, paused: {}, resumed: { date: "number" },
  goodwillAdded: {}, goodwillRemoved: {}, renamed: { name: "string" }, reissued: {}, disabled: {}, expired: {},
  cancelled: {}, spent: { amount: "number" }, refundCredit: { amount: "number" }, serviceAdded: { service: "string" }, sold: {},
  stockAdjusted: {}, roomCharge: { room: "string" }, takenBack: {}, published: {}, updated: {},
};
const EDIT_REASONS = new Set<string>(editReasons);
const STOCK_REASONS = new Set<string>(stockReasons);

function guestFact({ key, args = {} }: HistoryRow["fact"]): GuestFact {
  const needs = Object.hasOwn(FACT_ARGS, key) ? FACT_ARGS[key as GuestFactKey] : null;
  if (!needs || !Object.entries(needs).every(([name, type]) => typeof args[name] === type)) return { key: "updated" };
  return { ...args, key } as GuestFact;
}

/**
 * One History row from commerce/history.staffPage or guestPage. Show guest rows never carry `staff`
 * or fields. What the fields changed is worked out by the History sheet (history-changes.ts), on demand.
 */
export function historyEntry(row: HistoryRow): HistoryEntry {
  const entry: HistoryEntry = { entryId: row.entryId, at: row.at, fact: guestFact(row.fact), balance: row.balance };
  if (!("staff" in row) || !row.staff) return entry;
  const { actorName, reason, reasonText } = row.staff;
  const known = reason !== null && (EDIT_REASONS.has(reason) || STOCK_REASONS.has(reason)) ? (reason as EditReason | StockReason) : null;
  const fields = "before" in row || "after" in row ? { before: row.before, after: row.after } : null;
  return { ...entry, staff: { actorName, reason: known, reasonText }, ...(fields ? { fields } : {}) };
}

// ─── Receipt status (getOrder's paymentAttempt and activeReturn) ────────────────────────────────

type OrderRead = NonNullable<FunctionReturnType<typeof api.pos.orders.getOrder>>;
type StoredAttempt = NonNullable<OrderRead["paymentAttempt"]>;
type StoredLeg = StoredAttempt["legs"][number];
/** Fields a later backend may add to the projection; today staff are named by token only, which never reaches the screen. */
type AttemptExtras = { tillLabel?: string; staffName?: string; mine?: boolean; createdAt?: number };

/** A stored refusal as the screens word it; null for a code this screen doesn't know. */
function storedRefusal(refusal: StoredAttempt["refusal"]): CommerceRefusal | null {
  if (!refusal || !Object.hasOwn(COMMERCE_REFUSAL_MESSAGES, refusal.code)) return null;
  return { ...(refusal.args ?? {}), code: refusal.code } as CommerceRefusal;
}

const legView = (direction: PaymentLeg["direction"]) => (leg: StoredLeg): PaymentLeg => ({
  key: leg.key, direction, method: leg.method, amount: leg.amount, state: leg.state,
  received: leg.received ?? null, change: leg.change ?? null, reference: leg.reference ?? null, instructedAt: leg.instructedAt ?? null,
});

/** The receipt's payment attempt card from getOrder's projection; null when the order never had one. */
export function receiptAttempt(view: OrderRead): PaymentAttemptView | null {
  const attempt = view.paymentAttempt;
  if (!attempt) return null;
  const extras = attempt as StoredAttempt & AttemptExtras;
  return {
    attemptId: attempt._id, orderId: view.order._id, status: attempt.status, ownerRevision: attempt.ownerRevision,
    tillLabel: extras.tillLabel ?? "", staffName: extras.staffName ?? "", mine: extras.mine ?? false, due: attempt.due,
    legs: [...attempt.legs.map(legView("collect")), ...(attempt.resolution?.giveBackLegs ?? []).map(legView("giveBack"))],
    // Voucher legs aren't in the projection yet; the receipt's voucher rows name what was spent.
    vouchers: [],
    refusal: storedRefusal(attempt.refusal),
    recovery: null,
    startedAt: extras.createdAt ?? attempt.updatedAt,
  };
}

/**
 * The receipt's open return from getOrder's projection: each part named from its row (codes
 * masked), each claim with its state and due date, and voucher credits by their receipt masks.
 * A part's amount shows only when it is the whole return; nothing is recalculated here.
 */
export function receiptReturnable(view: OrderRead): Returnable {
  const open = view.activeReturn;
  if (!open || open.status !== "authorized") return { orderId: view.order._id, parts: [], open: null };
  const lines = new Map(view.lines.map((line) => [line._id as string, line]));
  const masks = new Map((view.voucherPayments ?? []).map((tender) => [tender.voucherId as string, tender.codeMask]));
  const total = open.claims.reduce((sum, claim) => sum + claim.amount, 0) + open.voucherCredits.reduce((sum, credit) => sum + credit.paid + credit.goodwill, 0);
  return {
    orderId: view.order._id,
    parts: [],
    open: {
      returnId: open._id, orderId: view.order._id, status: open.status, operatorRevision: open.operatorRevision,
      operatorName: "", mine: false, approvalId: open.approvalId ?? null, createdAt: open.createdAt, total,
      parts: open.parts.map((part, index) => {
        const line = lines.get(part.lineId);
        const content = part.kind === "content" ? line?.saleSnapshot?.contents.find((item) => item.contentKey === part.contentKey) : undefined;
        return {
          partKey: `${index}:${part.kind}:${part.lineId}`,
          label: maskVoucherCodes([line?.name, content?.label].filter(Boolean).join(" · ")),
          units: "units" in part ? part.units : 1,
          amount: open.parts.length === 1 ? total : null,
        };
      }),
      claims: open.claims.map((claim) => ({
        key: claim.key, method: claim.method, amount: claim.amount, state: claim.state,
        reference: claim.reference ?? null, instructedAt: claim.instructedAt ?? null, dueAt: claim.dueAt,
      })),
      voucherCredits: open.voucherCredits.map((credit) => {
        // Where it goes: back onto a voucher the guest holds (its mask may be unknown), or a new 90-day one.
        const { destination } = credit;
        const existing = destination?.kind === "existingVoucher" ? destination : null;
        return {
          voucherId: credit.voucherId, paid: credit.paid, goodwill: credit.goodwill,
          maskedCode: maskVoucherCodes(existing?.codeMask ?? masks.get(credit.voucherId) ?? ""),
          newVoucher: destination?.kind === "newVoucher",
          ...(existing ? { existingVoucher: true } : {}),
        };
      }),
    },
  };
}
