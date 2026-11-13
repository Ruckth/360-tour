import { v } from "convex/values";
export const affiliateState = v.union(
  v.literal("active"),
  v.literal("paused"),
  v.literal("archived"),
);
export const creditState = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("reversed"),
);
export const affiliateCandidate = v.object({
  affiliateId: v.id("marketingAffiliates"),
  name: v.string(),
  slug: v.string(),
  origin: v.union(v.literal("link"), v.literal("coupon")),
  eligible: v.boolean(),
  reason: v.optional(v.string()),
  contactEmail: v.optional(v.string()),

  evidence: v.optional(v.union(v.literal("recorded_session"), v.literal("claimed_slug"))),
  linkId: v.optional(v.id("marketingLinks")),
  couponId: v.optional(v.id("coupons")),
});
export const affiliateSnapshot = v.object({
  capturedAt: v.number(),
  candidates: v.array(affiliateCandidate),
  affiliateId: v.optional(v.id("marketingAffiliates")),
  flags: v.array(v.string()),
});
export const marketingRole = v.union(
  v.literal("manager"),
  v.literal("marketer"),
  v.literal("finance"),
  v.literal("viewer"),
);
