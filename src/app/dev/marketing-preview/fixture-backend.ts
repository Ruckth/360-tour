// TEMPORARY — QA harness only, delete with this folder (see page.tsx).
// An in-memory stand-in for convex/marketing.ts so the views can be clicked through.
// The quote is a rough copy of the engine for the data.md examples, not the real thing.
import type { Id } from "convex/_generated/dataModel";
import type { CouponProblem, OfferResult } from "convex/lib/offers";
import { rulesChanged } from "@/components/admin/marketing/coupon-form";
import type { CampaignRow, CouponDetail, CouponRow, LinkRow, MarketingActions, SlugCheck } from "@/components/admin/marketing/types";
import { PROPERTIES, TODAY, type Store } from "./fixtures";

const ME = "you@auralis.example";
const RESERVED = ["admin", "api", "booking", "rooms", "experiences", "services", "chat", "privacy", "terms", "sign-in", "sign-up", "display", "dev", "en", "th", "ja", "ko", "fr", "de", "es", "ru", "it", "hi", "zh-cn"];

export function derive(store: Store) {
  const campaignName = (id: Id<"marketingCampaigns"> | undefined) => store.campaigns.find((c) => c._id === id)?.name;
  const links: LinkRow[] = store.links.map((link) => ({
    ...link,
    campaignName: campaignName(link.campaignId) ?? "—",
    couponCode: store.coupons.find((coupon) => coupon._id === link.couponId)?.code,
    shortUrlPath: `/${link.slug}`,
  }));
  const coupons: CouponRow[] = store.coupons.map((coupon) => ({
    ...coupon,
    campaignName: campaignName(coupon.campaignId),
    rules: store.versions.find((version) => version.couponId === coupon._id && version.version === coupon.currentVersion)!,
  }));
  const campaigns: CampaignRow[] = store.campaigns.map((campaign) => ({
    ...campaign,
    linkCount: store.links.filter((link) => link.campaignId === campaign._id).length,
    couponCount: store.coupons.filter((coupon) => coupon.campaignId === campaign._id).length,
    opens: store.links.filter((link) => link.campaignId === campaign._id).reduce((sum, link) => sum + link.opens, 0),
  }));
  const detail = (couponId: string): CouponDetail | null => {
    const row = coupons.find((coupon) => coupon._id === couponId);
    if (!row) return null;
    return {
      ...row,
      versions: store.versions.filter((version) => version.couponId === row._id),
      links: links.filter((link) => link.couponId === row._id),
    };
  };
  return { links, coupons, campaigns, detail };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let counter = 0;
const newId = (prefix: string) => `${prefix}_new_${++counter}`;

function quote(store: Store, code: string, propertySlug: string, checkIn: string, checkOut: string, services: { label: string; amount: number }[]): OfferResult {
  const property = PROPERTIES.find((item) => item.slug === propertySlug)!;
  const nights = Math.max(0, Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000));
  const stay = property.pricePerNight * nights;
  const serviceTotal = services.reduce((sum, line) => sum + line.amount, 0);
  const subtotal = stay + serviceTotal;
  const directDiscount = Math.round((stay * property.directDiscountPercent) / 100);
  const row = derive(store).coupons.find((coupon) => coupon.code === code.trim().toUpperCase());
  const finish = (applied: OfferResult["applied"], couponStatus: OfferResult["couponStatus"], couponDiscount: number, capped: boolean, problem?: CouponProblem): OfferResult => {
    const discount = applied === "coupon" ? couponDiscount : applied === "direct" ? directDiscount : 0;
    return { subtotal, applied, couponStatus, problem, directDiscount, couponDiscount, capped, discount, total: subtotal - discount, allocation: [] };
  };
  const fail = (problem: CouponProblem) => finish(directDiscount ? "direct" : "none", "invalid", 0, false, problem);
  if (!row) return fail({ code: "not_found" });
  const rules = row.rules;
  if (rules.bookFrom && TODAY < rules.bookFrom) return fail({ code: "not_started", startsOn: rules.bookFrom });
  if (rules.bookTo && TODAY > rules.bookTo) return fail({ code: "expired", endedOn: rules.bookTo });
  if (rules.usageLimit !== undefined && row.used >= rules.usageLimit) return fail({ code: "sold_out" });
  if (rules.discountBudget !== undefined && row.discountGranted >= rules.discountBudget) return fail({ code: "budget_used" });
  const coversStay = rules.scope !== "services";
  const coversServices = rules.scope !== "accommodation";
  if (coversStay && !coversServices && rules.propertySlugs?.length && !rules.propertySlugs.includes(propertySlug)) return fail({ code: "wrong_property" });
  const eligible = (coversStay && (!rules.propertySlugs?.length || rules.propertySlugs.includes(propertySlug)) ? stay : 0) + (coversServices ? serviceTotal : 0);
  if (!eligible) return fail({ code: "nothing_eligible" });
  if (coversStay && stay && ((rules.stayFrom && checkIn < rules.stayFrom) || (rules.stayTo && checkOut > rules.stayTo)))
    return fail({ code: "stay_outside_dates", stayFrom: rules.stayFrom, stayTo: rules.stayTo });
  if (coversStay && rules.minNights && nights < rules.minNights) return fail({ code: "min_nights", minNights: rules.minNights, missingNights: rules.minNights - nights });
  if (rules.minEligibleSubtotal && eligible < rules.minEligibleSubtotal)
    return fail({ code: "min_subtotal", minEligibleSubtotal: rules.minEligibleSubtotal, eligibleSubtotal: eligible });
  let amount = rules.benefit.kind === "percent" ? Math.round((eligible * rules.benefit.percent) / 100) : Math.min(rules.benefit.amount, eligible);
  let capped = false;
  if (rules.benefit.kind === "percent" && rules.maxSaving && amount > rules.maxSaving) {
    amount = rules.maxSaving;
    capped = true;
  }
  if (amount > directDiscount) return finish("coupon", "applied", amount, capped);
  return finish(directDiscount ? "direct" : "none", "coupon_worse", amount, capped);
}

/** Actions over a mutable store; `update` re-renders the harness. `failing` makes every write throw. */
export function fixtureActions(get: () => Store, update: (next: Store) => void, failing: () => boolean): MarketingActions {
  const guard = async () => {
    await wait(350);
    if (failing()) throw new Error("The server didn’t answer. Try again.");
  };
  const now = () => Date.now();
  return {
    async saveCampaign({ campaignId, ...fields }) {
      await guard();
      const store = get();
      if (campaignId) {
        update({ ...store, campaigns: store.campaigns.map((c) => (c._id === campaignId ? { ...c, ...fields, updatedAt: now(), updatedByEmail: ME } : c)) });
        return campaignId;
      }
      const _id = newId("campaign") as Id<"marketingCampaigns">;
      update({ ...store, campaigns: [{ _id, _creationTime: now(), status: "draft", createdAt: now(), updatedAt: now(), updatedByEmail: ME, ...fields }, ...store.campaigns] });
      return _id;
    },
    async setCampaignStatus({ campaignId, status }) {
      await guard();
      const store = get();
      update({ ...store, campaigns: store.campaigns.map((c) => (c._id === campaignId ? { ...c, status, updatedAt: now() } : c)) });
      return null;
    },
    async saveLink({ linkId, ...fields }) {
      await guard();
      const store = get();
      if (store.links.some((link) => link.slug === fields.slug && link._id !== linkId)) throw new Error(`/${fields.slug} is already used.`);
      if (linkId) {
        update({ ...store, links: store.links.map((link) => (link._id === linkId ? { ...link, ...fields, updatedAt: now(), updatedByEmail: ME } : link)) });
        return linkId;
      }
      const _id = newId("link") as Id<"marketingLinks">;
      update({ ...store, links: [{ _id, _creationTime: now(), status: "draft", opens: 0, createdAt: now(), updatedAt: now(), updatedByEmail: ME, ...fields }, ...store.links] });
      return _id;
    },
    async setLinkStatus({ linkId, status }) {
      await guard();
      const store = get();
      update({ ...store, links: store.links.map((link) => (link._id === linkId ? { ...link, status, updatedAt: now() } : link)) });
      return null;
    },
    async saveCoupon({ couponId, code, campaignId, ...rules }) {
      await guard();
      const store = get();
      if (store.coupons.some((coupon) => coupon.code === code && coupon._id !== couponId)) throw new Error(`${code} is already used by another coupon.`);
      const existing = store.coupons.find((coupon) => coupon._id === couponId);
      const id = existing?._id ?? (newId("coupon") as Id<"coupons">);
      const current = existing ? store.versions.find((v) => v.couponId === id && v.version === existing.currentVersion) : undefined;
      const changed = !current || rulesChanged(rules, current);
      const version = changed ? (existing?.currentVersion ?? 0) + 1 : existing!.currentVersion;
      const versions = changed
        ? [...store.versions, { _id: `version_${id}_${version}` as Id<"couponVersions">, _creationTime: now(), couponId: id, version, createdAt: now(), createdByEmail: ME, ...rules }]
        : store.versions;
      const doc = existing
        ? { ...existing, code, campaignId, currentVersion: version, updatedAt: now(), updatedByEmail: ME }
        : { _id: id, _creationTime: now(), code, campaignId, status: "draft" as const, currentVersion: 1, used: 0, discountGranted: 0, createdAt: now(), updatedAt: now(), updatedByEmail: ME };
      update({ ...store, versions, coupons: existing ? store.coupons.map((coupon) => (coupon._id === id ? doc : coupon)) : [doc, ...store.coupons] });
      return { couponId: id, version };
    },
    async setCouponStatus({ couponId, status }) {
      await guard();
      const store = get();
      update({ ...store, coupons: store.coupons.map((coupon) => (coupon._id === couponId ? { ...coupon, status, updatedAt: now() } : coupon)) });
      return null;
    },
    async checkSlug({ slug, linkId }): Promise<SlugCheck> {
      await wait(250);
      if (!slug) return { ok: false, slug, reason: "empty" };
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?$/.test(slug)) return { ok: false, slug, reason: "invalid" };
      if (RESERVED.includes(slug.split("/")[0])) return { ok: false, slug, reason: "reserved" };
      if (get().links.some((link) => link.slug === slug && link._id !== linkId)) return { ok: false, slug, reason: "taken" };
      return { ok: true, slug };
    },
    async testQuote({ code, propertySlug, checkIn, checkOut, services }) {
      await wait(300);
      if (failing()) throw new Error("The server didn’t answer. Try again.");
      return quote(get(), code, propertySlug, checkIn, checkOut, services ?? []);
    },
  };
}

