import type { Id } from "convex/_generated/dataModel";
import { refundDueOn } from "convex/shared/commerce/settings";
import { addDays } from "convex/shared/dates";
import { resortMidnight, resortTodayIso } from "convex/shared/time";
import { deviceKey, serverTillId } from "./pay-desk";
import type { ApprovalId, OrderView, ReturnClaim, ReturnLotOptions, ReturnPart, ReturnPreview, ReturnRecord } from "./backend";
import type { DeskPart } from "./returnable-parts";

/*
 * Return items, the pure half: the staff's choices as returnItems parts, where the money goes, and
 * the payout states the sheet acts on. What is returnable lives in returnable-parts.ts (the receipt
 * loads that; this module loads with the sheet). The server re-checks every part and amount.
 */

/** Sellable · back to stock, Damaged · written off, or it stays with the guest (no stock change). */
export type Condition = "sellable" | "damaged" | "guest";
export type Choice = { units: number; condition: Condition | null; lotQuantities?: Partial<Record<Id<"stockLots">, number>> };
export type Choices = Record<string, Choice>;

/**
 * A part's starting choice: its most units, and no condition until staff say what came back.
 * Sessions start at one: the receipt knows what was sold, not what was used since; the server
 * refuses more than are left unused (a whole-package cancel takes every unused one by itself).
 */
export const freshChoice = (part: DeskPart): Choice => ({ units: part.kind === "sessions" ? 1 : part.maxUnits, condition: null });

/**
 * What opening Return items on a row ticks: the whole package (journey 7), or the row itself.
 * Goods inside a package still ask their condition; nothing else is preselected.
 */
export function initialChoices(parts: DeskPart[], lineId: Id<"orderLines"> | null): Choices {
  const row = parts.filter((part) => part.lineId === lineId);
  const first = row.find((part) => part.kind === "whole") ?? row[0];
  return first ? { [first.partKey]: freshChoice(first) } : {};
}

/** Contents a whole-package choice already covers; goods still choose their own condition. */
export function coveredByWhole(part: DeskPart, choices: Choices) {
  return part.kind !== "whole" && part.kind !== "goods" && Boolean(choices[`${part.lineId}:whole`]);
}

export function returnLotKey({ lineId, contentKey }: { lineId: Id<"orderLines">; contentKey?: string | null }) {
  return contentKey == null ? lineId : `${lineId}:${contentKey}`;
}

/** A single available lot or the complete remaining quantity leaves no choice of allocation. */
export function automaticReturnLots(lots: ReturnLotOptions["lots"], units: number) {
  const total = lots.reduce((sum, lot) => sum + lot.quantity, 0);
  return total >= units && (lots.length === 1 || total === units);
}

export function selectedReturnLots(lots: ReturnLotOptions["lots"], choice: Choice) {
  const automatic = automaticReturnLots(lots, choice.units);
  return lots.map(({ lotId, quantity }) => ({
    lotId, quantity: automatic ? Math.min(quantity, choice.units) : choice.lotQuantities?.[lotId] ?? 0,
  })).filter(lot => lot.quantity > 0);
}

export function confirmedReturnLots(lots: ReturnLotOptions["lots"], choice: Choice) {
  const allocations = selectedReturnLots(lots, choice);
  const limits = new Map(lots.map(lot => [lot.lotId, lot.quantity]));
  return allocations.reduce((sum, lot) => sum + lot.quantity, 0) === choice.units &&
    allocations.every(lot => Number.isSafeInteger(lot.quantity) && lot.quantity <= (limits.get(lot.lotId) ?? 0)) ? allocations : null;
}

/** The chosen parts as the server's request, or null while staff are still entering a choice. */
export function chosenParts(parts: DeskPart[], choices: Choices, lotOptions?: Map<string, ReturnLotOptions> | null): ReturnPart[] | null {
  const out: ReturnPart[] = [];
  for (const part of parts) {
    const choice = choices[part.partKey];
    if (!choice || coveredByWhole(part, choices)) continue;
    if (part.kind === "goods" && !choice.condition) return null;
    const { units } = choice;
    if (!Number.isSafeInteger(units) || units < 1 || units > part.maxUnits) return null;
    const disposition = choice.condition === "sellable" || choice.condition === "damaged" ? choice.condition : undefined;
    const options = disposition === "sellable" ? lotOptions?.get(part.partKey) : undefined;
    if (disposition === "sellable" && (lotOptions === null || options?.unavailable)) return null;
    const lotAllocations = options?.tracked ? confirmedReturnLots(options.lots, { ...choice, units }) : undefined;
    if (lotAllocations === null) return null;
    const request = part.part;
    if (request.kind === "cancelPackage" || request.kind === "restoreSession") out.push(request);
    else if (request.kind === "content") out.push({ ...request, units, ...(disposition ? { disposition } : {}), ...(lotAllocations ? { lotAllocations } : {}) });
    else if (request.kind === "line") out.push({ ...request, units, ...(disposition ? { disposition } : {}), ...(lotAllocations ? { lotAllocations } : {}) });
  }
  return out;
}

/** A goods part chosen without its condition yet. */
export const missingCondition = (parts: DeskPart[], choices: Choices) =>
  parts.find((part) => part.kind === "goods" && choices[part.partKey] && !choices[part.partKey].condition) ?? null;

// ─── Payout ──────────────────────────────────────────────────────────────────────────────────────

/** An instruction already sent (instructed) or not known (unknown): checked before anything else. */
export const awaitingCheck = (claim: ReturnClaim) => claim.state === "instructed" || claim.state === "unknown";

/**
 * The one instruction this screen was handed by a successful authorize or arm answer: that
 * destination, sent at that moment, under that operator revision. A takeover, a release and a
 * reclaim, a retry and re-arm on another tab, or a reload each change one of these, so the
 * instruction becomes "Check previous refund" and never invites a second payout.
 */
export type FreshInstruction = { key: string; instructedAt: number | null; operatorRevision: number };
export function freshInstruction(answer: { operatorRevision: number; instruction?: Pick<ReturnClaim, "key" | "instructedAt"> | null }): FreshInstruction | null {
  const { instruction } = answer;
  return instruction ? { key: instruction.key, instructedAt: instruction.instructedAt ?? null, operatorRevision: answer.operatorRevision } : null;
}
const isFresh = (record: Pick<ReturnRecord, "operatorRevision">, claim: ReturnClaim, fresh: FreshInstruction | null) =>
  Boolean(fresh) && claim.state === "instructed" && claim.key === fresh!.key &&
  (claim.instructedAt ?? null) === fresh!.instructedAt && record.operatorRevision === fresh!.operatorRevision;

/**
 * Which destination may show a fresh "do it now" instruction: only the one this screen was just
 * handed (freshInstruction). Any other instructed or unknown claim is "Check previous refund".
 */
export function payoutStep(record: Pick<ReturnRecord, "claims" | "status" | "operatorRevision">, fresh: FreshInstruction | null) {
  if (record.status !== "authorized") return { kind: "closed" as const };
  const check = record.claims.find(awaitingCheck);
  if (check) return isFresh(record, check, fresh)
    ? { kind: "instruction" as const, claim: check }
    : { kind: "check" as const, claim: check };
  const failed = record.claims.find((claim) => claim.state === "failed");
  if (failed) return { kind: "failed" as const, claim: failed };
  const owed = record.claims.find((claim) => claim.state === "owed");
  return owed ? { kind: "owed" as const, claim: owed } : { kind: "closed" as const };
}

/**
 * Every destination a return names, in the order money moves (D8): the card, cash or account
 * first, then each voucher's paid and goodwill value. A session put back is no money but is named.
 */
export type Destination =
  | { kind: "external"; method: NonNullable<ReturnPreview["external"]>["method"]; amount: number }
  | { kind: "voucher"; voucherId: string; amount: number; code: string | null; goodwill: boolean; replacement?: boolean }
  | { kind: "restore" };
export function destinations(preview: Pick<ReturnPreview, "external" | "voucherCredits"> & { rows?: ReturnPreview["rows"] }, codes?: ReadonlyMap<string, string>): Destination[] {
  const out: Destination[] = [];
  if (preview.external?.amount) out.push({ kind: "external", method: preview.external.method, amount: preview.external.amount });
  for (const credit of preview.voucherCredits) {
    const code = ("maskedCode" in credit && typeof credit.maskedCode === "string" && credit.maskedCode) || codes?.get(credit.voucherId) || null;
    // An expired or disabled voucher can't take money back: the server issues a new one instead (D8).
    if (credit.paid && credit.destination?.kind === "newVoucher") {
      // Named by the voucher it replaces, so two equal replacements can be told apart.
      out.push({ kind: "voucher", voucherId: credit.voucherId, amount: credit.paid, code, goodwill: false, replacement: true });
    } else if (credit.paid) out.push({ kind: "voucher", voucherId: credit.voucherId, amount: credit.paid, code, goodwill: false });
    if (credit.goodwill) out.push({ kind: "voucher", voucherId: credit.voucherId, amount: credit.goodwill, code, goodwill: true });
  }
  if (preview.rows?.some((row) => row.parts.some((part) => part.kind === "restore"))) out.push({ kind: "restore" });
  return out;
}

/**
 * When the card, cash or transfer refund in a quote falls due (D20), by the same rule the server
 * stores on authorize: each returned row's sale-time terms, the shortest wins, counted from today.
 */
export function quoteDueAt(view: Pick<OrderView, "lines">, preview: Pick<ReturnPreview, "external" | "rows">, now = Date.now()) {
  if (!preview.external?.amount) return null;
  const terms = preview.rows.filter((row) => row.amount > 0).flatMap((row) => {
    const days = view.lines.find((line) => line._id === row.lineId)?.saleSnapshot?.terms.refundDueDays;
    return days ? [days] : [];
  });
  if (!terms.length) return null;
  const refundDays = { card: Math.min(...terms.map((days) => days.card)), other: Math.min(...terms.map((days) => days.cashOrTransfer)) };
  return resortMidnight(addDays(refundDueOn(resortTodayIso(now), preview.external.method, { refundDays }), 1)) - 1;
}

/** Cancel gives everything back; only while nothing was paid and nothing waits on a check. */
export const canCancel = (record: Pick<ReturnRecord, "claims" | "status">) =>
  record.status === "authorized" && !record.claims.some((claim) => claim.state === "given" || awaitingCheck(claim));

// ─── Till and request memory ─────────────────────────────────────────────────────────────────────

const memory = new Map<string, string>();
function stored(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return memory.get(key) ?? null; }
}
function store(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    if (value === null) memory.delete(key);
    else memory.set(key, value);
  }
}
/**
 * The pay desk's till for this device, so one device is one till for payments and returns. Before
 * the cutover admits the device, its own device key: never a placeholder every unadmitted device shares.
 */
export const returnsTillId = (): string => serverTillId() ?? `device:${deviceKey()}`;

const requestKey = (orderId: string) => `checkout.returnRequest.${orderId}`;
/** A cashier's waiting request on this receipt, so a reload still shows it. */
export const rememberedRequest = (orderId: string) => stored(requestKey(orderId)) as ApprovalId | null;
export const rememberRequest = (orderId: string, requestId: ApprovalId | null) => store(requestKey(orderId), requestId);
