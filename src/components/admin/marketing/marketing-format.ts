import { localeLabels, type Locale } from "@/i18n/routing";
import type { StatusMeta } from "../status-tones";
import type {
  CampaignStatus,
  CouponBenefit,
  CouponRow,
  CouponScope,
  CouponStatus,
  CouponVersion,
  LinkDestination,
  LinkStatus,
  OfferResult,
  SlugCheck,
} from "./types";
import { couponProblemMessage, couponProblemTitle } from "./coupon-problems";
import { formatDay, formatRange, thb } from "./format-basics";

// Pure labels and summaries for the marketing screens. No React, so they're unit-tested.

export const CAMPAIGN_STATUS: Record<CampaignStatus, StatusMeta> = {
  draft: { label: "Draft", tone: "neutral" },
  active: { label: "Active", tone: "success" },
  paused: { label: "Paused", tone: "warning" },
  ended: { label: "Ended", tone: "muted" },
  archived: { label: "Archived", tone: "muted" },
};

export const LINK_STATUS: Record<LinkStatus, StatusMeta> = {
  draft: { label: "Draft", tone: "neutral" },
  active: { label: "Active", tone: "success" },
  paused: { label: "Paused", tone: "warning" },
  archived: { label: "Archived", tone: "muted" },
};

/** What a coupon does today: the stored status, refined by its dates and limits. */
export type CouponState = CouponStatus | "scheduled" | "sold_out" | "budget_used" | "expired";

export const COUPON_STATE: Record<CouponState, StatusMeta> = {
  draft: { label: "Draft", tone: "neutral" },
  active: { label: "Active", tone: "success" },
  scheduled: { label: "Scheduled", tone: "info" },
  sold_out: { label: "Sold out", tone: "warning" },
  budget_used: { label: "Budget used", tone: "warning" },
  expired: { label: "Expired", tone: "muted" },
  paused: { label: "Paused", tone: "warning" },
  archived: { label: "Archived", tone: "muted" },
};

export function couponState(coupon: Pick<CouponRow, "status" | "used" | "discountGranted" | "rules">, today: string): CouponState {
  if (coupon.status !== "active") return coupon.status;
  const { rules } = coupon;
  if (rules.usageLimit !== undefined && coupon.used >= rules.usageLimit) return "sold_out";
  if (rules.discountBudget !== undefined && coupon.discountGranted >= rules.discountBudget) return "budget_used";
  if (rules.bookTo && rules.bookTo < today) return "expired";
  if (rules.bookFrom && rules.bookFrom > today) return "scheduled";
  return "active";
}

/** Guests can get the offer right now (live coupon inside its dates and limits). */
export function couponIsLive(coupon: Pick<CouponRow, "status" | "used" | "discountGranted" | "rules">, today: string) {
  return couponState(coupon, today) === "active";
}

export { formatDay, formatRange, thb };

const capitalize = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);

/** "20% off" or "฿500 off" */
export function benefitLabel(benefit: CouponBenefit) {
  return benefit.kind === "percent" ? `${benefit.percent}% off` : `${thb(benefit.amount)} off`;
}

/** "Accommodation, all villas" / "Accommodation: Mossbell Garden Suite" / "Spa services" … */
export function scopeLabel(scope: CouponScope, propertySlugs: readonly string[] | undefined, villaName: (slug: string) => string) {
  const villas = propertySlugs?.length ? propertySlugs.map(villaName).join(", ") : "all villas";
  if (scope === "services") return "Spa services";
  if (scope === "accommodation") return `Accommodation, ${villas}`;
  return `Accommodation (${villas}) + spa services`;
}

type Rules = Pick<
  CouponVersion,
  "benefit" | "bookFrom" | "bookTo" | "stayFrom" | "stayTo" | "minNights" | "minEligibleSubtotal" | "maxSaving"
>;

/** "Book 1–30 Nov 2026 · stay 1 Nov–20 Dec 2026 · min 2 nights · max saving ฿3,000", or "No limits". */
export function couponRulesLine(rules: Rules) {
  const items: string[] = [];
  if (rules.bookFrom || rules.bookTo) items.push(`book ${formatRange(rules.bookFrom, rules.bookTo)}`);
  if (rules.stayFrom || rules.stayTo) items.push(`stay ${formatRange(rules.stayFrom, rules.stayTo)}`);
  if (rules.minNights) items.push(`min ${rules.minNights} ${rules.minNights === 1 ? "night" : "nights"}`);
  if (rules.minEligibleSubtotal) items.push(`min spend ${thb(rules.minEligibleSubtotal)}`);
  if (rules.benefit.kind === "percent" && rules.maxSaving) items.push(`max saving ${thb(rules.maxSaving)}`);
  return items.length ? capitalize(items.join(" · ")) : "Ongoing, no minimum";
}

/** "500 limit" style usage: "38 / 500" or "22 · no limit". */
export function usageLabel(used: number, limit?: number) {
  return limit === undefined ? `${used.toLocaleString("en-US")} · no limit` : `${used.toLocaleString("en-US")} / ${limit.toLocaleString("en-US")}`;
}

/** Customer terms generated from the rules, used when the coupon has none of its own. */
export function generatedTerms(rules: Rules & Pick<CouponVersion, "scope" | "usageLimit">) {
  const items: string[] = [];
  if (rules.bookTo) items.push(`Book by ${formatDay(rules.bookTo)}`);
  else if (rules.bookFrom) items.push(`Book from ${formatDay(rules.bookFrom)}`);
  if (rules.stayFrom || rules.stayTo) items.push(`${rules.scope === "services" ? "Valid" : "Stay"} ${formatRange(rules.stayFrom, rules.stayTo)}`);
  if (rules.minNights) items.push(`Min ${rules.minNights} ${rules.minNights === 1 ? "night" : "nights"}`);
  if (rules.minEligibleSubtotal) items.push(`Min spend ${thb(rules.minEligibleSubtotal)}`);
  if (rules.benefit.kind === "percent" && rules.maxSaving) items.push(`Max saving ${thb(rules.maxSaving)}`);
  if (rules.scope === "services") items.push("Spa services only, extras excluded");
  if (rules.usageLimit) items.push("While codes last");
  items.push(rules.scope === "accommodation" ? "One code per booking" : "One code per booking or sale");
  return items.join(" · ");
}

/** Short lines for the QR offer card. */
export function offerHeadline(benefit: CouponBenefit, scope: CouponScope) {
  const head = benefit.kind === "percent" ? `Save ${benefit.percent}%` : `${thb(benefit.amount)} off`;
  const sub =
    scope === "accommodation"
      ? "on villa stays booked direct"
      : scope === "services"
        ? "on spa treatments"
        : "on villas and spa treatments";
  return { head, sub };
}

export function offerExpiry(rules: Pick<CouponVersion, "bookTo" | "stayTo" | "scope">) {
  if (rules.bookTo) return `Book by ${formatDay(rules.bookTo)}`;
  if (rules.stayTo && rules.scope === "services") return `Valid until ${formatDay(rules.stayTo)}`;
  return "Ongoing offer";
}

export const DESTINATION_KINDS = ["home", "booking", "villa", "experiences", "chat"] as const satisfies readonly LinkDestination["kind"][];

export const DESTINATION_LABELS: Record<LinkDestination["kind"], { label: string; hint: string }> = {
  home: { label: "Home", hint: "The front page" },
  booking: { label: "Booking", hint: "Dates and villas" },
  villa: { label: "A villa", hint: "Villa page with the 360 tour" },
  experiences: { label: "Experiences", hint: "Spa and activities" },
  chat: { label: "Chat", hint: "The AI concierge" },
};

export function destinationLabel(destination: LinkDestination, villaName: (slug: string) => string) {
  if (destination.kind === "villa") return `${villaName(destination.propertySlug)} · villa page`;
  if (destination.kind === "booking" && destination.propertySlug) return `Booking · ${villaName(destination.propertySlug)}`;
  return DESTINATION_LABELS[destination.kind].label;
}

/** Language a link opens in: "Guest’s language" when unset. */
export function localeLabel(locale?: string) {
  if (!locale) return "Guest’s language";
  return localeLabels[locale as Locale] ?? locale;
}

/** "https://book.auralis.example" + "/f1" → full URL; host part for display. */
export function shortUrl(origin: string, path: string) {
  const base = origin.replace(/\/+$/, "");
  const full = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  return { full, display: full.replace(/^https?:\/\//, "") };
}

/** What the slug field types into: lower-case, no leading slash or spaces. */
export function normalizeSlugInput(raw: string) {
  return raw.trimStart().toLowerCase().replace(/^\/+/, "").replace(/\s+/g, "-");
}

/** The message under the slug field, or null while it's fine. `takenBy` names the link that owns it. */
export function slugCheckMessage(check: SlugCheck, takenBy?: string): string | null {
  if (check.ok) return null;
  switch (check.reason) {
    case "empty":
      return "Enter a short link";
    case "invalid":
      return "Use lower-case letters, numbers and dashes";
    case "reserved":
      return "Reserved by the site";
    case "taken":
      return takenBy ? `Already used by ${takenBy}` : "Already used by another link";
  }
}

export type QuoteVerdict = { tone: "success" | "warning" | "info" | "neutral"; title: string; detail: string };

/** Which offer wins in a test quote, and why, in one short sentence each. */
export function quoteVerdict(result: OfferResult): QuoteVerdict {
  if (result.applied === "coupon" && result.discount > result.couponDiscount) {
    return {
      tone: "success",
      title: "Both apply",
      detail: `The code saves ${thb(result.couponDiscount)} on services. The direct offer still saves ${thb(result.directDiscount)} on the stay.`,
    };
  }
  if (result.applied === "coupon") {
    const more = result.couponDiscount - result.directDiscount;
    return {
      tone: "success",
      title: "Coupon wins",
      detail:
        result.directDiscount > 0
          ? `It saves ${thb(more)} more than the direct offer, so it replaces it.`
          : `The guest saves ${thb(result.discount)}.`,
    };
  }
  if (result.couponStatus === "coupon_worse") {
    return {
      tone: "info",
      title: "Direct offer wins",
      detail: `${thb(result.directDiscount)} direct vs ${thb(result.couponDiscount)} with the code${result.capped ? " (capped)" : ""}. The code isn’t used.`,
    };
  }
  if (result.couponStatus === "invalid" && result.problem) {
    const keeps = result.directDiscount > 0 ? ` The guest keeps the direct offer: ${thb(result.total)}.` : " No discount applies.";
    return { tone: "warning", title: couponProblemTitle(result.problem), detail: `${couponProblemMessage(result.problem)}.${keeps}` };
  }
  if (result.applied === "direct") {
    return { tone: "info", title: "Direct offer applies", detail: `The guest saves ${thb(result.directDiscount)}.` };
  }
  return { tone: "neutral", title: "No discount", detail: "Neither the direct offer nor the code applies to this quote." };
}
