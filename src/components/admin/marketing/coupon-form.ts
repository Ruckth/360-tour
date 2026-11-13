import { normalizeCouponCode } from "convex/lib/offers";
import { formatMoney } from "@/components/admin/labels";
import { parseDiscount } from "@/components/checkout/discount-input";
import type { CouponDetail, CouponScope, CouponVersion, SaveCouponArgs } from "./types";

// The coupon builder's form state, its validation, and how it maps to saveCoupon.

export type CouponForm = {
  code: string;
  /** "" = no campaign. */
  campaignId: string;
  kind: "percent" | "fixed";
  value: string;
  maxSaving: string;
  scope: CouponScope;
  allVillas: boolean;
  villas: string[];
  bookFrom: string;
  bookTo: string;
  stayFrom: string;
  stayTo: string;
  minNights: string;
  minSubtotal: string;
  usageLimit: string;
  budget: string;
  terms: string;
};

type CouponRules = Omit<SaveCouponArgs, "couponId" | "code" | "campaignId">;

/** 1500 → "1,500", undefined → "": a stored whole number as form text. */
export const wholeText = (value?: number) => (value === undefined ? "" : value.toLocaleString("en-US"));

/**
 * The coupon's one discount field, read like checkout's (checkout/discount-input.ts): a trailing "%"
 * is a percent ("20%"), anything else baht ("500", "฿500", "1,500").
 */
export function discountFieldText(form: Pick<CouponForm, "kind" | "value">): string {
  if (!form.value) return "";
  return form.kind === "percent" ? `${form.value}%` : form.value;
}

/** What typing `text` in the discount field stores: the kind and the number's text, checked later by couponFormErrors. */
export function discountFromText(text: string, current: CouponForm["kind"]): Pick<CouponForm, "kind" | "value"> {
  const trimmed = text.trim();
  if (!trimmed) return { kind: current, value: "" };
  // Parsed by checkout's rules; the price cap doesn't apply to a coupon, so the line is unbounded.
  const parsed = parseDiscount(trimmed, UNBOUNDED_LINE);
  if (parsed?.ok) {
    const { type, value } = parsed.discount;
    return type === "percent" ? { kind: "percent", value: String(value) } : { kind: "fixed", value: Number.isInteger(value) ? wholeText(value) : String(value) };
  }
  // Not a discount yet ("abc", "150%"): kept as typed, so couponFormErrors can say what's wrong.
  const percent = /^(.*?)\s*%$/.exec(trimmed);
  return percent ? { kind: "percent", value: percent[1].trim() } : { kind: "fixed", value: trimmed.replace(/^฿\s*/, "") };
}
const UNBOUNDED_LINE = { unitPrice: 1_000_000_000, qty: 1 };

/**
 * "20% = ฿840–฿1,700 a night" for a percent coupon on villas, worked out with checkout's discount
 * parser on each covered villa's nightly price. Null when there's no price to work it out on.
 */
export function discountEcho(form: Pick<CouponForm, "kind" | "value" | "scope" | "allVillas" | "villas">, villas: readonly { slug: string; pricePerNight: number; status: string }[]): string | null {
  const value = parseWhole(form.value);
  if (form.kind !== "percent" || !value || Number.isNaN(value) || value > 100 || form.scope === "services") return null;
  const covered = villas.filter((villa) => (form.allVillas ? villa.status === "active" : form.villas.includes(villa.slug)));
  const amounts = covered
    .map((villa) => parseDiscount(`${value}%`, { unitPrice: villa.pricePerNight, qty: 1 }))
    .flatMap((parsed) => (parsed?.ok ? [parsed.amount] : []));
  if (!amounts.length) return null;
  const low = Math.min(...amounts);
  const high = Math.max(...amounts);
  return `${value}% = ${formatMoney(low)}${high > low ? `–${formatMoney(high)}` : ""} a night`;
}

export const EMPTY_COUPON_FORM: CouponForm = {
  code: "",
  campaignId: "",
  kind: "percent",
  value: "",
  maxSaving: "",
  scope: "accommodation",
  allVillas: true,
  villas: [],
  bookFrom: "",
  bookTo: "",
  stayFrom: "",
  stayTo: "",
  minNights: "",
  minSubtotal: "",
  usageLimit: "",
  budget: "",
  terms: "",
};

/** Builds the form from a saved coupon, or from the values just saved (code, campaign and rules). */
export function couponFormFrom(detail: { code: string; campaignId?: CouponDetail["campaignId"]; rules: CouponRules }): CouponForm {
  const rules = detail.rules;
  return {
    code: detail.code,
    campaignId: detail.campaignId ?? "",
    kind: rules.benefit.kind,
    value: rules.benefit.kind === "percent" ? String(rules.benefit.percent) : wholeText(rules.benefit.amount),
    maxSaving: wholeText(rules.maxSaving),
    scope: rules.scope,
    allVillas: !rules.propertySlugs?.length,
    villas: rules.propertySlugs ?? [],
    bookFrom: rules.bookFrom ?? "",
    bookTo: rules.bookTo ?? "",
    stayFrom: rules.stayFrom ?? "",
    stayTo: rules.stayTo ?? "",
    minNights: wholeText(rules.minNights),
    minSubtotal: wholeText(rules.minEligibleSubtotal),
    usageLimit: wholeText(rules.usageLimit),
    budget: wholeText(rules.discountBudget),
    terms: rules.terms ?? "",
  };
}

/** "1,500" / "" → 1500 / undefined; anything that isn't a whole number (or is too big to store) → NaN. */
export function parseWhole(value: string): number | undefined {
  const cleaned = value.replace(/[,\s฿%]/g, "");
  if (!cleaned) return undefined;
  const parsed = /^\d+$/.test(cleaned) ? Number(cleaned) : Number.NaN;
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

const num = (value: string) => {
  const parsed = parseWhole(value);
  return parsed === undefined || Number.isNaN(parsed) ? undefined : parsed;
};

export function couponRulesFrom(form: CouponForm): CouponRules {
  const value = num(form.value) ?? 0;
  const hasVillas = form.scope !== "services";
  return {
    benefit: form.kind === "percent" ? { kind: "percent", percent: value } : { kind: "fixed", amount: value },
    scope: form.scope,
    propertySlugs: hasVillas && !form.allVillas && form.villas.length ? [...form.villas].sort() : undefined,
    bookFrom: form.bookFrom || undefined,
    bookTo: form.bookTo || undefined,
    stayFrom: form.stayFrom || undefined,
    stayTo: form.stayTo || undefined,
    minNights: hasVillas ? num(form.minNights) : undefined,
    minEligibleSubtotal: num(form.minSubtotal),
    maxSaving: form.kind === "percent" ? num(form.maxSaving) : undefined,
    usageLimit: num(form.usageLimit),
    discountBudget: num(form.budget),
    terms: form.terms.trim() || undefined,
  };
}

/**
 * What saving the form would store: the normalised code, campaign and rules. Two forms with the same
 * key save the same coupon, so "1500" and "1,500", villa order or a trailing space aren't edits.
 */
export function couponFormKey(form: CouponForm): string {
  const rules = couponRulesFrom(form);
  const canonical = Object.fromEntries(Object.entries(rules).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)));
  // Text that doesn't parse is dropped from the rules, so keep it in the key: typing "abc" is still an edit.
  const unparsed = (["value", "maxSaving", "minNights", "minSubtotal", "usageLimit", "budget"] as const)
    .filter((key) => Number.isNaN(parseWhole(form[key])))
    .map((key) => [key, form[key]]);
  return JSON.stringify({ code: normalizeCouponCode(form.code), campaignId: form.campaignId, rules: canonical, unparsed });
}

const RULE_KEYS = [
  "scope",
  "bookFrom",
  "bookTo",
  "stayFrom",
  "stayTo",
  "minNights",
  "minEligibleSubtotal",
  "maxSaving",
  "usageLimit",
  "discountBudget",
  "terms",
] as const satisfies readonly (keyof CouponRules & keyof CouponVersion)[];

/** True when saving would write a new immutable version (any rule differs from the current one). */
export function rulesChanged(next: CouponRules, current: CouponVersion): boolean {
  const benefit = next.benefit;
  const old = current.benefit;
  if (benefit.kind !== old.kind) return true;
  if (benefit.kind === "percent" && old.kind === "percent" && benefit.percent !== old.percent) return true;
  if (benefit.kind === "fixed" && old.kind === "fixed" && benefit.amount !== old.amount) return true;
  const slugs = (list?: readonly string[]) => (list?.length ? [...list].sort().join(",") : "");
  if (slugs(next.propertySlugs) !== slugs(current.propertySlugs)) return true;
  return RULE_KEYS.some((key) => (next[key] ?? undefined) !== (current[key] ?? undefined));
}

export type CouponFormErrors = Partial<Record<"code" | "value" | "maxSaving" | "villas" | "bookTo" | "stayTo" | "minNights" | "minSubtotal" | "usageLimit" | "budget", string>>;

export function couponFormErrors(form: CouponForm, { takenCodes, used = 0 }: { takenCodes: readonly string[]; used?: number }): CouponFormErrors {
  const errors: CouponFormErrors = {};
  const code = normalizeCouponCode(form.code);
  if (!code) errors.code = "Enter a code";
  // Same format as saveCoupon (^[A-Z0-9-]{3,32}$), plus no leading, trailing or doubled dashes.
  else if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(code)) errors.code = "Use letters, numbers and dashes";
  else if (code.length < 3) errors.code = "Use at least 3 characters";
  else if (code.length > 32) errors.code = "Keep it to 32 characters";
  else if (takenCodes.includes(code)) errors.code = `${code} is already used by another coupon`;

  const value = parseWhole(form.value);
  if (value === undefined || value === 0) errors.value = "Set the discount";
  else if (Number.isNaN(value)) errors.value = "Use a whole number";
  else if (form.kind === "percent" && value > 100) errors.value = "A percentage can’t be over 100";

  // Optional limits are positive whole numbers; empty means none (the backend rejects 0).
  const whole: [keyof CouponFormErrors, string, string][] = [
    ["maxSaving", form.kind === "percent" ? form.maxSaving : "", "Leave empty for no limit"],
    ["minNights", form.scope !== "services" ? form.minNights : "", "Leave empty for no minimum"],
    ["minSubtotal", form.minSubtotal, "Leave empty for no minimum"],
    ["usageLimit", form.usageLimit, "Leave empty for no limit"],
    ["budget", form.budget, "Leave empty for no limit"],
  ];
  for (const [key, raw, zero] of whole) {
    const parsed = parseWhole(raw);
    if (Number.isNaN(parsed)) errors[key] = "Use a whole number";
    else if (parsed === 0) errors[key] = zero;
  }
  const limit = parseWhole(form.usageLimit);
  if (!errors.usageLimit && limit !== undefined && limit < used) errors.usageLimit = `It’s been used ${used} times, so the limit can’t be lower`;

  if (form.scope !== "services" && !form.allVillas && form.villas.length === 0) errors.villas = "Choose at least one villa";
  if (form.bookFrom && form.bookTo && form.bookTo < form.bookFrom) errors.bookTo = "Close on or after the opening date";
  if (form.stayFrom && form.stayTo && form.stayTo < form.stayFrom) errors.stayTo = "End on or after the start date";
  return errors;
}
