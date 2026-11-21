import { ConvexError } from "convex/values";
import { createTranslator } from "next-intl";
import { staffDateTime } from "@/lib/staff-time";
import commerceEn from "../../../../messages/commerce/en.json";

/**
 * Settings › Checkout rules words, from messages/commerce/en.json (the admin is English today):
 * `t("switches.managers")`, `t("rules.days", { count: 7 })`.
 */
export const t = createTranslator({ locale: "en", messages: commerceEn, namespace: "Commerce" }) as unknown as (key: string, values?: Record<string, string | number>) => string;
export const when = (at: number) => staffDateTime(at);

/** The server's refusal code and its fields, or null for a lost answer or any other error. */
export function refusal(err: unknown): ({ code: string; message?: string } & Record<string, unknown>) | null {
  if (!(err instanceof ConvexError)) return null;
  const data: unknown = err.data;
  return data && typeof data === "object" && "code" in data && typeof data.code === "string" ? data as { code: string } : null;
}

/** One sentence for a refusal on this page. */
export function refusalText(err: unknown): string {
  const code = refusal(err)?.code;
  switch (code) {
    case "STALE_ADJUSTMENT_REVISION": return t("refusals.staleRevision");
    case "PAYMENT_ROLLOUT_PENDING": return t("cutover.rolloutPending");
    case "PAYMENTS_STILL_OPEN": return t("cutover.paymentsStillOpen");
    case "PAYMENTS_ALREADY_SWITCHED": return t("cutover.alreadySwitched");
    case "ADJUSTMENT_KEY_CONFLICT": return t("refusals.keyConflict");
    case "PAYMENT_PAUSE_REQUIRED": case "INVALID_CHECKOUT_TERMS": case "INVALID_ADJUSTMENT_REASON": case "SETTINGS_UNCHANGED":
    case "RECONCILE_NOTE_REQUIRED": case "PAY_PANEL_NOT_PAID": case "PAY_PANEL_OTHER_RECEIPT": case "PAY_PANEL_RECEIPT_USED": case "TILL_NOT_RETIREABLE":
      return refusal(err)?.message ?? t("rules.couldNotSave");
    default: return t("rules.couldNotSave");
  }
}
