import type { FunctionArgs } from "convex/server";
import type { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import type { CampaignRow, CouponDetail, CouponRow, LinkRow, SlugCheck } from "convex/marketing";
import type { OfferResult } from "convex/lib/offers";

// The views take data and callbacks as props; MarketingScreens wires them to Convex.

export type { CampaignRow, CouponDetail, CouponRow, LinkRow, SlugCheck, OfferResult };

export type CampaignStatus = Doc<"marketingCampaigns">["status"];
export type LinkStatus = Doc<"marketingLinks">["status"];
export type CouponStatus = Doc<"coupons">["status"];
export type LinkDestination = Doc<"marketingLinks">["destination"];
export type LinkEntry = Doc<"marketingLinks">["entry"];
export type CouponVersion = Doc<"couponVersions">;
export type CouponBenefit = CouponVersion["benefit"];
export type CouponScope = CouponVersion["scope"];

/** The villa fields the marketing screens need (from `properties.adminList`). */
export type MarketingProperty = Pick<
  Doc<"properties">,
  "_id" | "slug" | "name" | "pricePerNight" | "currency" | "maxGuests" | "status" | "directDiscountPercent"
>;

type SaveCampaignArgs = FunctionArgs<typeof api.marketing.saveCampaign>;
type SaveLinkArgs = FunctionArgs<typeof api.marketing.saveLink>;
export type SaveCouponArgs = FunctionArgs<typeof api.marketing.saveCoupon>;
type TestQuoteArgs = FunctionArgs<typeof api.marketing.testQuote>;

export type MarketingActions = {
  saveCampaign: (args: SaveCampaignArgs) => Promise<Id<"marketingCampaigns">>;
  setCampaignStatus: (args: { campaignId: Id<"marketingCampaigns">; status: CampaignStatus }) => Promise<null>;
  saveLink: (args: SaveLinkArgs) => Promise<Id<"marketingLinks">>;
  setLinkStatus: (args: { linkId: Id<"marketingLinks">; status: LinkStatus }) => Promise<null>;
  saveCoupon: (args: SaveCouponArgs) => Promise<{ couponId: Id<"coupons">; version: number }>;
  setCouponStatus: (args: { couponId: Id<"coupons">; status: CouponStatus }) => Promise<null>;
  /** One-off checks, not subscriptions: the views debounce them and drop stale answers. */
  checkSlug: (args: { slug: string; linkId?: Id<"marketingLinks"> }) => Promise<SlugCheck>;
  testQuote: (args: TestQuoteArgs) => Promise<OfferResult>;
};
