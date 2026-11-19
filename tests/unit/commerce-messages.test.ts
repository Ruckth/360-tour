import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import type { Id } from "convex/_generated/dataModel";
import {
  COMMERCE_REFUSAL_MESSAGES,
  guestFactText,
  refusalText,
  type CommerceCopy,
  type CommerceRefusal,
  type CommerceRefusalCode,
  type EditReason,
  type GuestFact,
  type GuestFactKey,
  type SaleKind,
  type SaleSwitch,
  type StockReason,
} from "@/components/checkout/backend";
import { locales } from "@/i18n/routing";

/**
 * Commerce copy lives in messages/commerce/<locale>.json, beside messages/display/, so public pages
 * don't ship checkout strings. These tests hold it to the same bar as the public catalogs: every
 * key in every locale, the same ICU arguments, real translations, and a message for every refusal.
 */

type Messages = { [key: string]: string | Messages };
const read = (locale: string) => JSON.parse(readFileSync(join(process.cwd(), "messages", "commerce", `${locale}.json`), "utf8")) as Messages;
const flatten = (value: Messages, prefix = ""): [string, string][] =>
  Object.entries(value).flatMap(([key, child]) => (typeof child === "string" ? [[`${prefix}${key}`, child]] : flatten(child, `${prefix}${key}.`)));
const catalogs = Object.fromEntries(locales.map((locale) => [locale, Object.fromEntries(flatten(read(locale)))])) as Record<string, Record<string, string>>;
const english = catalogs.en;

/** Argument names in an ICU message, including those nested in plural and select branches. */
function argumentNames(message: string): string[] {
  const names = new Set<string>();
  let i = 0;
  const parse = (depthEnd: boolean) => {
    while (i < message.length) {
      const ch = message[i];
      if (ch === "'" && (message[i + 1] === "{" || message[i + 1] === "}")) {
        i = message.indexOf("'", i + 1) + 1;
      } else if (ch === "{") {
        i++;
        const match = /^\s*([\w]+)\s*(?:,\s*(\w+)\s*)?/.exec(message.slice(i))!;
        names.add(match[1]);
        i += match[0].length;
        if (match[2] === "plural" || match[2] === "select" || match[2] === "selectordinal") {
          i++; // the comma before the branches
          while (message[i] !== "}") {
            const selector = /^\s*(=?[\w]+)\s*\{/.exec(message.slice(i))!;
            i += selector[0].length;
            parse(true);
            while (/\s/.test(message[i])) i++;
          }
        } else if (match[2]) {
          i = message.indexOf("}", i);
        }
        i++; // the closing brace
      } else if (ch === "}" && depthEnd) {
        i++;
        return;
      } else {
        i++;
      }
    }
  };
  parse(false);
  return [...names].sort();
}

/** A value for every argument any commerce message uses. */
const sample = { amount: "฿600", rest: "฿600", price: "฿1,290", count: 3, max: 2, cash: 15, card: 45, here: 0, there: 3, before: "3", after: "2", paid: 3, goodwill: 1, spent: "฿300", left: "฿200", min: "฿100", name: "Maya Lin", product: "Spa robe", service: "Thai massage 60", variant: "Blue / M", option: "Size", branch: "Beach spa", room: "12", guest: "Maya Lin", till: "Till 1", staff: "Ploy", method: "Card", time: "14:02", date: "30 Dec 2026", code: "GV-••••-Q9XD", kind: "Products", label: "Spa robe", reason: "Voucher used up", expected: 3, current: 4, what: "extend", target: "Massage 5" };

/** Loanwords these languages use as is at a till: Spa, Shop, Stock, Code, Name, PromptPay. */
const LOANWORDS = /^Commerce\.(tabs\.(spa|shop)|vouchers\.giftSlipCode|edits\.name|admin\.stock|approvals\.targets\.stock|history\.stockBeforeAfter|pay\.promptPay)$/;
/** Same text as English is fine only where the message is nothing but arguments and symbols. */
const symbolsOnly = (message: string) => message.replace(/\{[^}]*\}/g, "").replace(/[\s·→–×:()]/g, "") === "";

describe("commerce messages", () => {
  it("reads argument names through plural branches", () => {
    expect(argumentNames("Extend {count, plural, one {# month for {name}} other {# months}}")).toEqual(["count", "name"]);
    expect(argumentNames("Продлить на {count, plural, one {# месяц} few {# месяца} many {# месяцев} other {# месяца}}")).toEqual(["count"]);
    expect(argumentNames("'{literal}' {amount}")).toEqual(["amount"]);
  });

  it("has every key in all 11 locales", () => {
    expect(Object.keys(catalogs)).toHaveLength(11);
    for (const locale of locales) expect(Object.keys(catalogs[locale]).sort(), locale).toEqual(Object.keys(english).sort());
  });

  it("keeps the same ICU argument names in every locale", () => {
    for (const locale of locales) {
      for (const [key, message] of Object.entries(english)) {
        expect(argumentNames(catalogs[locale][key]), `${locale}:${key}`).toEqual(argumentNames(message));
      }
    }
  });

  it("formats every message in its own locale without a missing argument", () => {
    for (const locale of locales) {
      const t = createTranslator({ locale, messages: read(locale), namespace: "Commerce", onError: (error) => { throw error; } });
      for (const key of Object.keys(english)) {
        const text = (t as unknown as (key: string, values: object) => string)(key.slice("Commerce.".length), sample);
        expect(text, `${locale}:${key}`).not.toMatch(/[{}]/);
      }
    }
  });

  it("translates every message, leaving only argument-only ones and brand names as in English", () => {
    for (const locale of locales.filter((locale) => locale !== "en")) {
      const untranslated = Object.entries(english).filter(
        ([key, message]) => catalogs[locale][key] === message && !symbolsOnly(message) && !LOANWORDS.test(key),
      );
      expect(untranslated.map(([key]) => key), locale).toEqual([]);
    }
  });

  it("uses the plan's words on the buttons verbatim in English and Thai", () => {
    const buttons: [string, string, string][] = [
      ["useSession", "Use session", "ใช้สิทธิ์ 1 ครั้ง"],
      ["soldOutHere", "Sold out here", "หมดที่สาขานี้"],
      ["giftVoucher", "Gift voucher", "บัตรกำนัล"],
      ["giftSlip", "Gift slip", "ใบบัตรกำนัล"],
      ["returnItems", "Return items", "คืนสินค้า / คืนเงิน"],
      ["moneyTakenSaleNotSaved", "Money taken · sale not saved", "รับเงินแล้ว · ยังไม่บันทึกการขาย"],
      ["confirmCashReceived", "Confirm · {amount} cash received", "ยืนยัน · รับเงินสด {amount} แล้ว"],
      ["postToRoom", "Post to room {room}", "ลงบิลห้อง {room}"],
      ["moneyGivenBackRecord", "Money given back · Record", "คืนเงินแล้ว · บันทึก"],
      ["editHistory", "Edit · History", "แก้ไข · ประวัติ"],
      ["askManager", "Ask a manager", "ขออนุมัติผู้จัดการ"],
      ["showGuest", "Show guest", "ให้ลูกค้าดู"],
      ["editFutureSales", "Edit future sales", "แก้ไขสำหรับการขายต่อไป"],
      ["printChangeSlip", "Print change slip", "พิมพ์ใบแจ้งการเปลี่ยนแปลง"],
    ];
    for (const [key, en, th] of buttons) {
      expect(english[`Commerce.buttons.${key}`]).toBe(en);
      expect(catalogs.th[`Commerce.buttons.${key}`]).toBe(th);
    }
    expect(english["Commerce.buttons.publishFutureSales"]).toBe("Publish for future sales");
  });

  it("names every sale kind, switch state, edit reason and stock reason", () => {
    const kinds: Record<SaleKind, true> = { products: true, vouchers: true, sessionPackages: true, mixedPackages: true };
    const switches: Record<SaleSwitch, true> = { off: true, managers: true, everyone: true };
    const reasons: Record<EditReason, true> = { healthPause: true, serviceRecovery: true, spellingCorrection: true, lostCode: true, guestRequest: true, staffMistake: true, priceChange: true, other: true };
    const stock: Record<StockReason, true> = { received: true, recount: true, damaged: true, theft: true, lost: true, returnedToStock: true };
    for (const key of Object.keys(kinds)) expect(english[`Commerce.kinds.${key}`]).toBeTruthy();
    for (const key of Object.keys(switches)) expect(english[`Commerce.switches.${key}`]).toBeTruthy();
    for (const key of Object.keys(reasons)) expect(english[`Commerce.edits.reasons.${key}`]).toBeTruthy();
    for (const key of Object.keys(stock)) expect(english[`Commerce.edits.stockReasons.${key}`]).toBeTruthy();
  });
});

/** A fixture id; refusals carry ids the screen passes back, never shows. */
const id = (value: string) => value as Id<"orderReturns"> as never;
/** One refusal per code. Adding a code without a sample here fails to compile. */
const refusals: { [C in CommerceRefusalCode]: Extract<CommerceRefusal, { code: C }> } = {
  STALE_REVISION: { code: "STALE_REVISION", target: "voucher" },
  SALE_SWITCH_OFF: { code: "SALE_SWITCH_OFF", kind: "vouchers" },
  SALE_SWITCH_MANAGERS_ONLY: { code: "SALE_SWITCH_MANAGERS_ONLY", kind: "products" },
  NEEDS_MANAGER: { code: "NEEDS_MANAGER", action: "extend" },
  OWNER_ONLY: { code: "OWNER_ONLY", action: "shorten" },
  CONSENT_REQUIRED: { code: "CONSENT_REQUIRED" },
  REASON_REQUIRED: { code: "REASON_REQUIRED" },
  VOUCHER_NOT_FOUND: { code: "VOUCHER_NOT_FOUND" },
  VOUCHER_EXPIRED: { code: "VOUCHER_EXPIRED", maskedCode: "GV-••••-Q9XD", expiredAt: 0 },
  VOUCHER_PAUSED: { code: "VOUCHER_PAUSED", maskedCode: "GV-••••-Q9XD" },
  VOUCHER_DISABLED: { code: "VOUCHER_DISABLED", maskedCode: "GV-••••-Q9XD" },
  VOUCHER_USED_UP: { code: "VOUCHER_USED_UP", maskedCode: "GV-••••-Q9XD" },
  VOUCHER_WRONG_BRANCH: { code: "VOUCHER_WRONG_BRANCH", maskedCode: "GV-••••-Q9XD", branchName: "Beach spa" },
  VOUCHER_NOT_ALLOWED: { code: "VOUCHER_NOT_ALLOWED", reason: "roomStay" },
  VOUCHER_LIMIT: { code: "VOUCHER_LIMIT", max: 2 },
  PAYMENT_ROWS_LIMIT: { code: "PAYMENT_ROWS_LIMIT", max: 3 },
  STOCK_CONFIRM_NEEDED: { code: "STOCK_CONFIRM_NEEDED", variantId: id("fxvar"), variantLabel: "Blue / M", onHand: 0, quantity: 1 },
  OTHER_BRANCH_STOCK: { code: "OTHER_BRANCH_STOCK" },
  OVER_CAP: { code: "OVER_CAP", cap: "packageContents", max: 20 },
  ITEM_ARCHIVED: { code: "ITEM_ARCHIVED", name: "Spa robe" },
  SESSION_UNAVAILABLE: { code: "SESSION_UNAVAILABLE" },
  SESSION_EXPIRED: { code: "SESSION_EXPIRED", packageName: "Massage 5", expiredAt: 0 },
  SESSION_PAUSED: { code: "SESSION_PAUSED", packageName: "Massage 5" },
  NO_SESSIONS_LEFT: { code: "NO_SESSIONS_LEFT", packageName: "Massage 5" },
  ATTENDEE_MISMATCH: { code: "ATTENDEE_MISMATCH", ownerName: "Maya Lin" },
  PAYMENT_IN_PROGRESS: { code: "PAYMENT_IN_PROGRESS", attemptId: id("fxatt"), tillLabel: "Till 1", staffName: "Ploy" },
  PAYMENT_HANDED_OVER: { code: "PAYMENT_HANDED_OVER" },
  CHECK_PREVIOUS_PAYMENT: { code: "CHECK_PREVIOUS_PAYMENT", method: "card", amount: 490000, at: 0 },
  CHECKOUT_PAUSED: { code: "CHECKOUT_PAUSED" },
  TILL_NEEDS_RELOAD: { code: "TILL_NEEDS_RELOAD" },
  PRICE_CHANGED: { code: "PRICE_CHANGED" },
  RETURN_IN_PROGRESS: { code: "RETURN_IN_PROGRESS", returnId: id("fxret") },
  RETURN_HANDED_OVER: { code: "RETURN_HANDED_OVER" },
  RETURN_TOO_LARGE: { code: "RETURN_TOO_LARGE", visitRows: 6, grants: 3 },
  ROOM_CHARGES_OFF: { code: "ROOM_CHARGES_OFF", roomLabel: "12" },
  STAY_NOT_CHECKED_IN: { code: "STAY_NOT_CHECKED_IN" },
  ITEM_WITH_GUEST: { code: "ITEM_WITH_GUEST", handoverId: id("fxhnd") },
  KEY_CONFLICT: { code: "KEY_CONFLICT" },
  RECEIPT_TOO_OLD: { code: "RECEIPT_TOO_OLD" },
};
const facts: { [K in GuestFactKey]: Extract<GuestFact, { key: K }> } = {
  purchased: { key: "purchased", name: "Massage 5" }, issued: { key: "issued", amount: 100000 }, used: { key: "used", service: "Thai massage 60" },
  restored: { key: "restored" }, noShow: { key: "noShow" }, waived: { key: "waived" }, transferredIn: { key: "transferredIn" }, transferredOut: { key: "transferredOut" },
  extended: { key: "extended", date: 0 }, paused: { key: "paused" }, resumed: { key: "resumed", date: 0 }, goodwillAdded: { key: "goodwillAdded" },
  goodwillRemoved: { key: "goodwillRemoved" }, renamed: { key: "renamed", name: "Mia Tanaka" }, reissued: { key: "reissued" }, disabled: { key: "disabled" },
  expired: { key: "expired" }, cancelled: { key: "cancelled" }, spent: { key: "spent", amount: 60000 }, refundCredit: { key: "refundCredit", amount: 50000 },
  serviceAdded: { key: "serviceAdded", service: "Hot stone 60" }, sold: { key: "sold" }, stockAdjusted: { key: "stockAdjusted" }, roomCharge: { key: "roomCharge", room: "12" },
  takenBack: { key: "takenBack" }, published: { key: "published" },
};
const copyFor = (locale: string): CommerceCopy => {
  const t = createTranslator({ locale, messages: read(locale), namespace: "Commerce", onError: (error) => { throw error; } });
  return { t: t as unknown as CommerceCopy["t"], money: (satang) => `฿${(satang / 100).toFixed(2)}`, date: () => "30 Dec 2026" };
};

describe("commerce refusals and history facts", () => {
  it("has a message for every refusal code in every locale, with every argument filled", () => {
    expect(Object.keys(refusals).sort()).toEqual(Object.keys(COMMERCE_REFUSAL_MESSAGES).sort());
    for (const locale of locales) {
      const copy = copyFor(locale);
      for (const refusal of Object.values(refusals)) {
        expect(english[`Commerce.refusals.${COMMERCE_REFUSAL_MESSAGES[refusal.code]}`], refusal.code).toBeTruthy();
        expect(refusalText(refusal, copy), `${locale}:${refusal.code}`).not.toMatch(/[{}]|Commerce\./);
      }
    }
    expect(refusalText(refusals.VOUCHER_EXPIRED, copyFor("en"))).toBe("Voucher GV-••••-Q9XD expired on 30 Dec 2026.");
    expect(refusalText(refusals.SALE_SWITCH_OFF, copyFor("en"))).toBe("Gift vouchers aren't on sale yet. The owner turns them on in Settings › Checkout rules.");
    expect(refusalText(refusals.CHECK_PREVIOUS_PAYMENT, copyFor("th"))).toBe("ตรวจการชำระบัตร ฿4900.00 ครั้งก่อนให้เรียบร้อยก่อน");
  });

  it("words every history fact in every locale", () => {
    for (const locale of locales) {
      const copy = copyFor(locale);
      for (const fact of Object.values(facts)) expect(guestFactText(fact, copy), `${locale}:${fact.key}`).not.toMatch(/[{}]|Commerce\./);
    }
    expect(guestFactText(facts.used, copyFor("en"))).toBe("Thai massage 60 visit");
    expect(guestFactText(facts.extended, copyFor("th"))).toBe("ขยายเวลาถึง 30 Dec 2026");
  });
});
