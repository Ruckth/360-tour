import { createTranslator } from "next-intl";
import { formatMoney } from "@/components/admin/labels";
import { staffDate, staffTime } from "@/lib/staff-time";
import commerceEn from "../../../messages/commerce/en.json";
import type { CommerceCopy, ExternalMethod } from "./backend";
import type { ReturnRefusal } from "./returnable-parts";
import type { Destination } from "./returns-desk";

/** The returns desk's words, from messages/commerce/en.json (the admin is English today). */
const t = createTranslator({ locale: "en", messages: commerceEn, namespace: "Commerce" }) as unknown as CommerceCopy["t"];

/** Money, dates and words for Return items. */
export const returnsCopy: CommerceCopy & { time: (at: number) => string; when: (at: number) => string } = {
  t,
  money: (satang) => formatMoney(satang),
  date: (at) => staffDate(at),
  time: (at) => staffTime(at),
  /** A moment that may be yesterday's: date and time ("19 Nov 2026 · 21:40"). */
  when: (at) => `${staffDate(at)} · ${staffTime(at)}`,
};

const METHOD = { cash: "pay.cash", promptpay: "pay.promptPay", card: "pay.card", transfer: "pay.transfer" } as const;
export const methodName = (method: ExternalMethod) => t(METHOD[method]);

/** What to do now, shown only after the server marked the destination instructed. */
export function payoutInstruction(method: ExternalMethod, amount: number) {
  const key = { card: "returns.instructCard", cash: "returns.instructCash", transfer: "returns.instructTransfer", promptpay: "returns.instructPromptPay" }[method];
  return t(key, { amount: returnsCopy.money(amount) });
}

/**
 * One destination as staff read it: "฿700 to Card", "฿500 back to voucher GV-••••-Q9XD", "฿500 on a
 * new voucher replacing GV-••••-R8TB (90 days)" in place of an expired one, "Restore session".
 */
export function destinationText(destination: Destination) {
  const amount = destination.kind === "restore" ? "" : returnsCopy.money(destination.amount);
  if (destination.kind === "external") return t("returns.toMethod", { amount, method: methodName(destination.method) });
  if (destination.kind === "restore") return t("returns.restoreSession");
  if (destination.replacement) return destination.code ? t("returns.toNewVoucherReplacing", { amount, code: destination.code }) : t("returns.toNewVoucher", { amount });
  if (destination.goodwill) return t("returns.goodwillToVoucher", { amount, code: destination.code ?? "" });
  return destination.code ? t("returns.toVoucher", { amount, code: destination.code }) : t("returns.toVoucherUncoded", { amount });
}

/**
 * The commit button names every destination exactly (D8): "Authorize ฿700 to Card · ฿500 back to
 * voucher GV-••••-Q9XD". A session restore alone reads "Restore session"; nothing at all, "Authorize ฿0".
 */
export function authorizeLabel(list: Destination[], approve = false) {
  if (list.length === 1 && list[0].kind === "restore") return t(approve ? "returns.approveRestore" : "returns.restoreSession");
  const named = list.map(destinationText).join(" · ") || returnsCopy.money(0);
  return t(approve ? "returns.approveAuthorizeTo" : "returns.authorizeTo", { destinations: named });
}

const REFUSALS: Record<string, string> = {
  RETURN_IN_PROGRESS: "refusals.returnInProgress",
  RETURN_HANDED_OVER: "refusals.returnHandedOver",
  RETURN_OPERATOR_CHANGED: "returns.refusals.operatorChanged",
  RETURN_OPERATOR_REQUIRED: "returns.refusals.operatorChanged",
  RETURN_CHECK_PREVIOUS: "returns.refusals.checkPrevious",
  RETURN_ALREADY_PAID: "returns.refusals.alreadyPaid",
  RETURN_SELF_APPROVAL: "returns.refusals.selfApproval",
  RETURN_BOOKING_OWNED: "returns.refusals.bookingOwned",
  RETURN_APPOINTMENT_ADAPTER_REQUIRED: "returns.refusals.visitAdapter",
  RETURN_APPROVAL_PENDING: "returns.refusals.approvalPending",
  USE_RETURN_ITEMS: "returns.refusals.useReturnItems",
  RETURN_PART_LIMIT: "returns.refusals.twoParts",
  RETURN_GRANT_LIMIT: "returns.refusals.twoParts",
  RETURN_READ_LIMIT: "returns.refusals.twoParts",
  RETURN_STOCK_LIMIT: "returns.refusals.twoParts",
  RETURN_VOUCHER_LIMIT: "returns.refusals.twoParts",
  RETURN_STALE: "returns.refusals.stale",
  RETURN_MANAGER_REQUIRED: "returns.refusals.managerRequired",
  RETURN_TAKEOVER_REQUIRES_STOP: "returns.refusals.takeoverStop",
  RETURN_KEY_CONFLICT: "refusals.keyConflict",
  RETURN_CUSTODY_REQUIRED: "returns.refusals.custodyRequired",
  RETURN_INVALID_PAYOUT_TIME: "returns.refusals.payoutTime",
};

/** A refusal in one sentence: the catalog's words where it has them, else the server's own. */
export function returnRefusalText(refusal: ReturnRefusal) {
  const key = REFUSALS[refusal.code];
  return key ? t(key) : refusal.message || t("returns.couldNotSend");
}
