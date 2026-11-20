import { createTranslator } from "next-intl";
import { formatMoney } from "@/components/admin/labels";
import { staffDate, staffTime } from "@/lib/staff-time";
import commerceEn from "../../../messages/commerce/en.json";
import { refusalText, type CommerceCopy, type ExternalMethod, type PayRefusal } from "./backend";

/** The pay desk's words, from messages/commerce/en.json (the admin is English today). */
const t = createTranslator({ locale: "en", messages: commerceEn, namespace: "Commerce" }) as unknown as CommerceCopy["t"];

/** Money, dates and words for the pay desk. */
export const payCopy: CommerceCopy & { time: (at: number) => string } = {
  t,
  money: (satang) => formatMoney(satang),
  date: (at) => staffDate(at),
  time: (at) => staffTime(at),
};

const METHOD = { cash: "pay.cash", promptpay: "pay.promptPay", card: "pay.card", transfer: "pay.transfer" } as const;
export const methodName = (method: ExternalMethod) => t(METHOD[method]);

/** A refusal in one sentence: the catalog's words, or the server's own. */
export const payRefusalText = (refusal: PayRefusal) => (refusal.code === "SERVER" ? refusal.message : refusalText(refusal, payCopy));

/** The instruction shown the moment a part is armed (v27 Legs). */
export function instruction(method: ExternalMethod, amount: number, direction: "collect" | "giveBack" = "collect") {
  const value = { amount: payCopy.money(amount) };
  if (direction === "giveBack") return t(method === "cash" ? "pay.giveBackCash" : method === "card" ? "pay.refundTerminal" : "pay.returnTransfer", value);
  return t({ cash: "pay.collectCash", card: "pay.chargeTerminal", promptpay: "pay.requestPromptPay", transfer: "pay.requestTransfer" }[method], value);
}
