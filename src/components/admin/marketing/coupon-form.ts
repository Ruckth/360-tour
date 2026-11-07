import { normalizeCouponCode } from "convex/lib/offers";
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

export type CouponRules = Omit<SaveCouponArgs, "couponId" | "code" | "campaignId">;

const text = (value?: number) => (value === undefined ? "" : value.toLocaleString("en-US"));

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

export function couponFormFrom(detail: Pick<CouponDetail, "code" | "campaignId" | "rules">): CouponForm {
  const rules = detail.rules;
  return {
    code: detail.code,
    campaignId: detail.campaignId ?? "",
    kind: rules.benefit.kind,
    value: rules.benefit.kind === "percent" ? String(rules.benefit.percent) : text(rules.benefit.amount),
    maxSaving: text(rules.maxSaving),
    scope: rules.scope,
    allVillas: !rules.propertySlugs?.length,
    villas: rules.propertySlugs ?? [],
    bookFrom: rules.bookFrom ?? "",
    bookTo: rules.bookTo ?? "",
    stayFrom: rules.stayFrom ?? "",
    stayTo: rules.stayTo ?? "",
    minNights: text(rules.minNights),
    minSubtotal: text(rules.minEligibleSubtotal),
    usageLimit: text(rules.usageLimit),
    budget: text(rules.discountBudget),
    terms: rules.terms ?? "",
  };
}

/** "1,500" / "" → 1500 / undefined; anything that isn't a whole number → NaN. */
export function parseWhole(value: string): number | undefined {
  const cleaned = value.replace(/[,\s฿%]/g, "");
  if (!cleaned) return undefined;
  return /^\d+$/.test(cleaned) ? Number(cleaned) : Number.NaN;
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
  else if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(code)) errors.code = "Use letters, numbers and dashes";
  else if (code.length > 32) errors.code = "Keep it to 32 characters";
  else if (takenCodes.includes(code)) errors.code = `${code} is already used by another coupon`;

  const value = parseWhole(form.value);
  if (value === undefined || value === 0) errors.value = "Set the discount";
  else if (Number.isNaN(value)) errors.value = "Use a whole number";
  else if (form.kind === "percent" && value > 100) errors.value = "A percentage can’t be over 100";

  const whole: [keyof CouponFormErrors, string][] = [
    ["maxSaving", form.kind === "percent" ? form.maxSaving : ""],
    ["minNights", form.scope !== "services" ? form.minNights : ""],
    ["minSubtotal", form.minSubtotal],
    ["usageLimit", form.usageLimit],
    ["budget", form.budget],
  ];
  for (const [key, raw] of whole) if (Number.isNaN(parseWhole(raw))) errors[key] = "Use a whole number";
  if (!errors.minNights && parseWhole(form.minNights) === 0 && form.scope !== "services") errors.minNights = "Leave empty for no minimum";
  const limit = parseWhole(form.usageLimit);
  if (!errors.usageLimit && limit !== undefined && limit < used) errors.usageLimit = `It’s been used ${used} times, so the limit can’t be lower`;

  if (form.scope !== "services" && !form.allVillas && form.villas.length === 0) errors.villas = "Choose at least one villa";
  if (form.bookFrom && form.bookTo && form.bookTo < form.bookFrom) errors.bookTo = "Close on or after the opening date";
  if (form.stayFrom && form.stayTo && form.stayTo < form.stayFrom) errors.stayTo = "End on or after the start date";
  return errors;
}
