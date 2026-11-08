"use client";

import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useRouter } from "next/navigation";
import { useMemo, useSyncExternalStore } from "react";
import { useNow } from "@/lib/staff-bookings";
import { adminMarketingPath } from "../admin-routes";
import { CampaignsView } from "./CampaignsView";
import { CouponEditor } from "./CouponEditor";
import { CouponsView } from "./CouponsView";
import { LinksView } from "./LinksView";
import { bangkokToday } from "./marketing-format";
import type { MarketingActions } from "./types";

// The admin pages: Convex queries and mutations wired into the prop-driven views.

const couponPath = (couponId: Id<"coupons"> | "new") => `${adminMarketingPath("coupons")}/${couponId}`;

function useMarketingActions(): MarketingActions {
  const convex = useConvex();
  const saveCampaign = useMutation(api.marketing.saveCampaign);
  const setCampaignStatus = useMutation(api.marketing.setCampaignStatus);
  const saveLink = useMutation(api.marketing.saveLink);
  const setLinkStatus = useMutation(api.marketing.setLinkStatus);
  const saveCoupon = useMutation(api.marketing.saveCoupon);
  const setCouponStatus = useMutation(api.marketing.setCouponStatus);
  return useMemo(
    () => ({
      saveCampaign,
      setCampaignStatus,
      saveLink,
      setLinkStatus,
      saveCoupon,
      setCouponStatus,
      // One-off reads: the slug field and the quote panel ask on demand instead of subscribing.
      checkSlug: (args) => convex.query(api.marketing.checkSlug, args),
      testQuote: (args) => convex.query(api.marketing.testQuote, args),
    }),
    [convex, saveCampaign, setCampaignStatus, saveLink, setLinkStatus, saveCoupon, setCouponStatus],
  );
}

/** Today in Asia/Bangkok, refreshed every minute. */
function useToday() {
  return bangkokToday(useNow());
}

const noSubscribe = () => () => {};

/** Short links live on the site the admin is served from. Empty during server render. */
function useOrigin() {
  return useSyncExternalStore(
    noSubscribe,
    () => window.location.origin,
    () => "",
  );
}

export function MarketingLinksScreen() {
  const links = useQuery(api.marketing.listLinks, {});
  const campaigns = useQuery(api.marketing.listCampaigns, {});
  const coupons = useQuery(api.marketing.listCoupons, {});
  const properties = useQuery(api.properties.adminList, {});
  const profile = useQuery(api.settings.publicProfile, {});
  return (
    <LinksView
      links={links}
      campaigns={campaigns}
      coupons={coupons}
      properties={properties}
      origin={useOrigin()}
      brand={profile?.businessName ?? ""}
      today={useToday()}
      campaignsHref={adminMarketingPath("campaigns")}
      actions={useMarketingActions()}
    />
  );
}

export function MarketingCampaignsScreen() {
  const campaigns = useQuery(api.marketing.listCampaigns, {});
  const links = useQuery(api.marketing.listLinks, {});
  const coupons = useQuery(api.marketing.listCoupons, {});
  return (
    <CampaignsView
      campaigns={campaigns}
      links={links}
      coupons={coupons}
      today={useToday()}
      linksHref={adminMarketingPath("links")}
      couponHref={couponPath}
      actions={useMarketingActions()}
    />
  );
}

export function MarketingCouponsScreen() {
  const coupons = useQuery(api.marketing.listCoupons, {});
  const campaigns = useQuery(api.marketing.listCampaigns, {});
  const properties = useQuery(api.properties.adminList, {});
  return (
    <CouponsView
      coupons={coupons}
      campaigns={campaigns}
      properties={properties}
      today={useToday()}
      couponHref={couponPath}
      newCouponHref={couponPath("new")}
    />
  );
}

/** `couponId` is "new" for the builder. */
export function MarketingCouponScreen({ couponId }: { couponId: string }) {
  const router = useRouter();
  const isNew = couponId === "new";
  // getCoupon takes the raw route param and returns null for ids that don't resolve, so typos show "Coupon not found".
  const detail = useQuery(api.marketing.getCoupon, isNew ? "skip" : { couponId });
  const coupons = useQuery(api.marketing.listCoupons, {});
  const campaigns = useQuery(api.marketing.listCampaigns, {});
  const properties = useQuery(api.properties.adminList, {});
  return (
    <CouponEditor
      detail={detail}
      isNew={isNew}
      coupons={coupons}
      campaigns={campaigns}
      properties={properties}
      today={useToday()}
      listHref={adminMarketingPath("coupons")}
      actions={useMarketingActions()}
      onCreated={(id) => router.replace(couponPath(id))}
    />
  );
}
