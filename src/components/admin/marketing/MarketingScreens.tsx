"use client";

import { useConvex, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useMemo, useState, useSyncExternalStore, type ComponentProps } from "react";
import { useNow } from "@/lib/staff-bookings";
import { adminMarketingPath } from "../admin-routes";
import { HistoryDisclosure, RecordHistoryPanel } from "../RecordHistoryPanel";
import { CampaignSpendSection } from "./CampaignSpendSection";
import { CampaignEditor, CampaignsView } from "./CampaignsView";
import { CouponEditor } from "./CouponEditor";
import { CouponRefusalsCard } from "./CouponRefusalsCard";
import { CouponsView } from "./CouponsView";
import { useRouter, useSearchParams } from "@/platform/navigation";
import { LinksView, readLinkFilters, writeLinkFilters } from "./LinksView";
import { bangkokToday, campaignPage } from "./marketing-format";
import type { CampaignRow, CampaignTab, MarketingActions } from "./types";

// The admin pages: Convex queries and mutations wired into the prop-driven views.

const couponPath = (couponId: Id<"coupons"> | "new") => `${adminMarketingPath("coupons")}/${couponId}`;

/** Closed until opened, so an editor doesn't subscribe to history nobody reads. */
function History({ entityType, entityId, title }: { entityType: string; entityId: string; title: string }) {
  return (
    <HistoryDisclosure>
      <RecordHistoryPanel entityType={entityType} entityId={entityId} title={title} />
    </HistoryDisclosure>
  );
}
const campaignHistory = (id: string) => <History entityType="marketingCampaign" entityId={id} title="Campaign history" />;
const linkHistory = (id: string) => <History entityType="marketingLink" entityId={id} title="Link history" />;
const couponHistory = (id: string) => <History entityType="coupon" entityId={id} title="Coupon history" />;

function CampaignSpend({ campaign }: { campaign: CampaignRow }) {
  const spend = useQuery(api.marketing.report.listSpend, { campaignId: campaign._id });
  const saveSpend = useMutation(api.marketing.report.saveSpend);
  const deleteSpend = useMutation(api.marketing.report.deleteSpend);
  return (
    <CampaignSpendSection
      campaign={campaign}
      spend={spend}
      onSave={async (draft) => {
        await saveSpend(draft);
      }}
      onDelete={async (id) => {
        await deleteSpend({ id });
      }}
    />
  );
}
const campaignSpend = (campaign: CampaignRow) => <CampaignSpend campaign={campaign} />;

const REFUSAL_DAYS = 30;
function CouponRefusals({ couponId }: { couponId: Id<"coupons"> }) {
  const summary = useQuery(api.marketing.report.couponRefusals, { couponId, days: REFUSAL_DAYS });
  return <CouponRefusalsCard summary={summary} days={REFUSAL_DAYS} />;
}
const couponRefusals = (couponId: Id<"coupons">) => <CouponRefusals couponId={couponId} />;

function useMarketingActions(): MarketingActions {
  const convex = useConvex();
  const saveCampaign = useMutation(api.marketing.commands.saveCampaign.saveCampaign);
  const setCampaignStatus = useMutation(api.marketing.commands.setCampaignStatus.setCampaignStatus);
  const saveLink = useMutation(api.marketing.commands.saveLink.saveLink);
  const setLinkStatus = useMutation(api.marketing.commands.setLinkStatus.setLinkStatus);
  const saveCoupon = useMutation(api.marketing.commands.saveCoupon.saveCoupon);
  const setCouponStatus = useMutation(api.marketing.commands.setCouponStatus.setCouponStatus);
  return useMemo(
    () => ({
      saveCampaign,
      setCampaignStatus,
      saveLink,
      setLinkStatus,
      saveCoupon,
      setCouponStatus,
      // One-off reads: the slug field and the quote panel ask on demand instead of subscribing.
      checkSlug: (args) => convex.query(api.marketing.queries.checkSlug, args),
      testQuote: (args) => convex.query(api.marketing.queries.testQuote, args),
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
  const router = useRouter();
  const filters = readLinkFilters(useSearchParams());
  const links = useQuery(api.marketing.queries.listLinks, {});
  const campaigns = useQuery(api.marketing.queries.listCampaignOptions, { projection: "attribution" });
  const coupons = useQuery(api.marketing.queries.listCoupons, {});
  const properties = useQuery(api.marketing.queries.catalog, {});
  const profile = useQuery(api.settings.settings.publicProfile, {});
  return (
    <LinksView
      filters={filters}
      onFiltersChange={(next) => {
        const params = writeLinkFilters(next).toString();
        router.replace(adminMarketingPath("links") + (params ? "?" + params : ""), { scroll: false });
      }}
      links={links}
      campaigns={campaigns}
      coupons={coupons}
      properties={properties}
      origin={useOrigin()}
      brand={profile?.businessName ?? ""}
      today={useToday()}
      campaignsHref={adminMarketingPath("campaigns")}
      actions={useMarketingActions()}
      history={linkHistory}
    />
  );
}

function LiveCampaignEditor({ refreshCampaign, ...props }: ComponentProps<typeof CampaignEditor> & { refreshCampaign: boolean }) {
  const campaignId = props.campaign?._id;
  const rows = useQuery(api.marketing.queries.listCampaigns, campaignId && refreshCampaign ? { campaignIds: [campaignId] } : "skip");
  // These previews are only used by a saved campaign's editor.
  const links = useQuery(api.marketing.queries.listLinks, campaignId ? { campaignId } : "skip");
  const coupons = useQuery(api.marketing.queries.listCampaignCoupons, campaignId ? { campaignId } : "skip");
  return <CampaignEditor {...props} campaign={rows?.[0] ?? props.campaign} links={links} coupons={coupons} />;
}

export function MarketingCampaignsScreen() {
  const [tab, setTab] = useState<CampaignTab>("all");
  const [query, setQuery] = useState("");
  const [requestedPage, setPage] = useState(0);
  const options = useQuery(api.marketing.queries.listCampaignOptions, { projection: "search" });
  const { page, pageCount, campaignIds } = campaignPage(options ?? [], tab, query, requestedPage);
  const campaigns = useQuery(api.marketing.queries.listCampaigns, campaignIds.length ? { campaignIds } : "skip");
  return (
    <CampaignsView
      campaigns={campaignIds.length ? campaigns : []}
      listing={{
        options,
        tab,
        query,
        setTab: (next) => { setTab(next); setPage(0); },
        setQuery: (next) => { setQuery(next); setPage(0); },
        page,
        pageCount,
        setPage,
      }}
      editor={LiveCampaignEditor}
      today={useToday()}
      linksHref={adminMarketingPath("links")}
      couponHref={couponPath}
      actions={useMarketingActions()}
      history={campaignHistory}
      spend={campaignSpend}
    />
  );
}

export function MarketingCouponsScreen() {
  const coupons = useQuery(api.marketing.queries.listCoupons, {});
  const campaigns = useQuery(api.marketing.queries.listCampaignOptions, {});
  const properties = useQuery(api.marketing.queries.catalog, {});
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
  const [quoteOpened, setQuoteOpened] = useState(false);
  const services = usePaginatedQuery(api.marketing.queries.listQuoteServices, isNew && !quoteOpened ? "skip" : {}, { initialNumItems: 20 });
  // getCoupon takes the raw route param and returns null for ids that don't resolve, so typos show "Coupon not found".
  const detail = useQuery(api.marketing.queries.getCoupon, isNew ? "skip" : { couponId });
  const coupons = useQuery(api.marketing.queries.listCoupons, {});
  const campaigns = useQuery(api.marketing.queries.listCampaignOptions, {});
  const properties = useQuery(api.marketing.queries.catalog, {});
  const profile = useQuery(api.settings.settings.publicProfile, {});
  return (
    <CouponEditor
      detail={detail}
      onQuoteOpen={() => setQuoteOpened(true)}
      serviceCatalog={{
        choices: services.results,
        loading: services.isLoading,
        loadMore: services.status === "CanLoadMore" ? () => services.loadMore(20) : undefined,
      }}
      isNew={isNew}
      coupons={coupons}
      campaigns={campaigns}
      properties={properties}
      today={useToday()}
      listHref={adminMarketingPath("coupons")}
      origin={useOrigin()}
      brand={profile?.businessName ?? ""}
      actions={useMarketingActions()}
      onCreated={(id) => router.replace(couponPath(id))}
      history={couponHistory}
      refusals={couponRefusals}
    />
  );
}
