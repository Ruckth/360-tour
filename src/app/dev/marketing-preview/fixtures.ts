// TEMPORARY — QA harness only, delete with this folder (see page.tsx).
// Sample data from docs/previews/marketing/kit/data.md, shaped like the Convex rows.
import type { Id } from "convex/_generated/dataModel";
import type { CampaignRow, CouponRow, CouponVersion, LinkRow, MarketingProperty } from "@/components/admin/marketing/types";

export const TODAY = "2026-11-07";
export const ORIGIN = "https://book.auralis.example";
export const BRAND = "Auralis Cove Retreat";

const at = (iso: string) => Date.parse(`${iso}T09:00:00+07:00`);
const PLOY = "ploy@auralis.example";
const NAT = "nat@auralis.example";

type CampaignDoc = Omit<CampaignRow, "linkCount" | "couponCount" | "opens">;
type LinkDoc = Omit<LinkRow, "campaignName" | "couponCode" | "shortUrlPath">;
type CouponDoc = Omit<CouponRow, "rules" | "campaignName">;

export type Store = {
  campaigns: CampaignDoc[];
  links: LinkDoc[];
  coupons: CouponDoc[];
  versions: CouponVersion[];
};

const cid = (key: string) => `campaign_${key}` as Id<"marketingCampaigns">;
const kid = (key: string) => `coupon_${key}` as Id<"coupons">;

function campaign(key: string, name: string, source: string, medium: string, status: CampaignDoc["status"], extra: Partial<CampaignDoc> = {}): CampaignDoc {
  return { _id: cid(key), _creationTime: at("2026-10-01"), name, source, medium, status, createdAt: at("2026-10-01"), updatedAt: at("2026-10-01"), updatedByEmail: PLOY, ...extra };
}

function link(
  slug: string,
  name: string,
  campaignKey: string,
  status: LinkDoc["status"],
  opens: number,
  extra: Partial<LinkDoc> = {},
): LinkDoc {
  return {
    _id: `link_${slug.replace("/", "_")}` as Id<"marketingLinks">,
    _creationTime: at("2026-10-02"),
    slug,
    name,
    campaignId: cid(campaignKey),
    destination: { kind: "booking" },
    entry: "link",
    status,
    opens,
    createdAt: at("2026-10-02"),
    updatedAt: at("2026-10-02"),
    updatedByEmail: PLOY,
    ...extra,
  };
}

function coupon(
  key: string,
  code: string,
  status: CouponDoc["status"],
  used: number,
  discountGranted: number,
  rules: Omit<CouponVersion, "_id" | "_creationTime" | "couponId" | "version" | "createdAt" | "createdByEmail">,
  extra: Partial<CouponDoc> = {},
): [CouponDoc, CouponVersion] {
  const created = at(rules.bookFrom ?? "2026-10-01") - 86_400_000 * 3;
  return [
    { _id: kid(key), _creationTime: created, code, status, currentVersion: 1, used, discountGranted, createdAt: created, updatedAt: created, updatedByEmail: PLOY, ...extra },
    { _id: `version_${key}_1` as Id<"couponVersions">, _creationTime: created, couponId: kid(key), version: 1, createdAt: created, createdByEmail: extra.updatedByEmail ?? PLOY, ...rules },
  ];
}

export const PROPERTIES: MarketingProperty[] = [
  { _id: "property_tideglass" as Id<"properties">, slug: "tideglass-pool-residence", name: "Tideglass Pool Residence", pricePerNight: 8500, currency: "THB", maxGuests: 4, status: "active", directDiscountPercent: 15 },
  { _id: "property_mossbell" as Id<"properties">, slug: "mossbell-garden-suite", name: "Mossbell Garden Suite", pricePerNight: 4500, currency: "THB", maxGuests: 2, status: "active", directDiscountPercent: 15 },
  { _id: "property_canopy" as Id<"properties">, slug: "canopy-halo-loft", name: "Canopy Halo Loft", pricePerNight: 12000, currency: "THB", maxGuests: 6, status: "active", directDiscountPercent: 15 },
];

export function sampleStore(): Store {
  const coupons = [
    coupon("f1", "DCNT-F1-20", "active", 38, 66450, {
      benefit: { kind: "percent", percent: 20 },
      scope: "accommodation",
      bookFrom: "2026-11-01",
      bookTo: "2026-11-30",
      stayFrom: "2026-11-01",
      stayTo: "2026-12-20",
      minNights: 2,
      maxSaving: 3000,
      usageLimit: 500,
      discountBudget: 80000,
      terms: "Book by 30 Nov 2026 · Stay 1 Nov–20 Dec 2026 · Min 2 nights · Max saving ฿3,000 · One code per booking",
    }, { campaignId: cid("fb-nov") }),
    coupon("l10", "DCNT-L-10", "active", 22, 9800, { benefit: { kind: "percent", percent: 10 }, scope: "accommodation_and_services" }, { campaignId: cid("line") }),
    coupon("spa500", "DCNT-SPA-500", "active", 14, 7000, {
      benefit: { kind: "fixed", amount: 500 },
      scope: "services",
      bookFrom: "2026-11-01",
      bookTo: "2026-12-31",
      stayFrom: "2026-11-01",
      stayTo: "2026-12-31",
      minEligibleSubtotal: 1500,
    }, { campaignId: cid("spa") }),
    coupon("anna10", "DCNT-ANNA-10", "active", 7, 6300, { benefit: { kind: "percent", percent: 10 }, scope: "accommodation", usageLimit: 200 }, { campaignId: cid("anna") }),
    coupon("flash30", "DCNT-FLASH-30", "active", 20, 48000, { benefit: { kind: "percent", percent: 30 }, scope: "accommodation", bookFrom: "2026-11-06", bookTo: "2026-11-06", usageLimit: 20 }, { campaignId: cid("fb-always") }),
    coupon("sk25", "DCNT-SK-25", "active", 112, 201600, { benefit: { kind: "percent", percent: 25 }, scope: "accommodation", bookFrom: "2026-04-01", bookTo: "2026-04-20", usageLimit: 300 }, { campaignId: cid("songkran") }),
  ];
  return {
    campaigns: [
      campaign("fb-always", "Facebook · Always on", "facebook", "social", "active"),
      campaign("fb-nov", "Facebook · November escape", "facebook", "paid_social", "active", { startsOn: "2026-11-01", endsOn: "2026-11-30", budget: 45000, notes: "Pinned post from 1 Nov. Boost runs until 15 Nov." }),
      campaign("ig", "Instagram · Always on", "instagram", "social", "active"),
      campaign("maps", "Google Maps · Profile", "google", "organic", "active"),
      campaign("line", "LINE · Rich menu", "line", "messaging", "active"),
      campaign("island", "Island Guide", "islandguide", "referral", "active"),
      campaign("gads", "Google Ads · Brand search", "google", "cpc", "draft", { startsOn: "2026-11-15", updatedByEmail: NAT }),
      campaign("spa", "Spa week", "print", "qr", "active", { startsOn: "2026-11-01", endsOn: "2026-12-31", budget: 1200 }),
      campaign("anna", "Affiliate · Anna Travel", "anna", "affiliate", "active"),
      campaign("songkran", "Songkran 2026", "facebook", "paid_social", "ended", { startsOn: "2026-04-01", endsOn: "2026-04-20", budget: 30000 }),
    ],
    links: [
      link("f", "Facebook page", "fb-always", "active", 1240, { placement: "Page button" }),
      link("f1", "Facebook · November post", "fb-nov", "active", 860, { couponId: kid("f1"), placement: "Pinned post", updatedByEmail: NAT }),
      link("a1", "Ads 1 · November escape", "fb-nov", "active", 2310, { couponId: kid("f1"), placement: "Meta ads" }),
      link("a2", "Ads 2 · Brand search", "gads", "draft", 0, { updatedByEmail: NAT }),
      link("m", "Google Maps", "maps", "active", 1920, { destination: { kind: "home" } }),
      link("ig", "Instagram bio", "ig", "active", 1105),
      link("w1", "Website 1 · Island Guide", "island", "active", 340),
      link("l", "LINE rich menu", "line", "active", 780, { couponId: kid("l10"), destination: { kind: "chat" } }),
      link("r/anna", "Anna Travel", "anna", "active", 210, { couponId: kid("anna10") }),
      link("q1", "Poster QR · Lamai café", "spa", "active", 95, { couponId: kid("spa500"), entry: "qr", destination: { kind: "experiences" }, placement: "Lamai café poster" }),
      link("sk", "Songkran 2026", "songkran", "paused", 0, { couponId: kid("sk25") }),
    ],
    coupons: coupons.map(([doc]) => doc),
    versions: coupons.map(([, version]) => version),
  };
}

export function emptyStore(): Store {
  return { campaigns: [], links: [], coupons: [], versions: [] };
}
