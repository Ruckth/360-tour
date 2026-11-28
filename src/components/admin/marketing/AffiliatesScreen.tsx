"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { CreditRow } from 'convex/shared/marketingAffiliateTypes';
import { useState, useSyncExternalStore } from "react";
import { AffiliatesView, CreditList, CreditReview } from "./AffiliatesView";
import { useSearchParams } from "@/platform/navigation";
import { useMarketingAccess } from "./MarketingAccess";

const noSubscribe = () => () => {};

export function AffiliatesScreen() {
  const origin = useSyncExternalStore(
    noSubscribe,
    () => window.location.origin,
    () => "",
  );
  const { capabilities } = useMarketingAccess();
  const requestedPartner = useSearchParams().get("partner");
  const [selection, setSelection] = useState<{ requested: string | null; id: string }>();
  const [state, setState] = useState(capabilities.reviewCredits ? "pending" : "all");
  const [opened, setOpened] = useState<CreditRow | null>(null);
  const partners = useQuery(api.marketing.affiliates.listAffiliates, {});
  const selected = selection?.requested === requestedPartner ? selection.id : requestedPartner;
  const focusedPartner = partners?.rows.find((row) => row._id === requestedPartner);
  const partner = partners?.rows.find((row) => row._id === selected)?._id ?? "all";
  const setPartner = (id: string) => setSelection({ requested: requestedPartner, id });
  const campaigns = useQuery(api.marketing.queries.listCampaignOptions, {});
  const coupons = useQuery(api.marketing.queries.listCoupons, {});
  const properties = useQuery(api.marketing.queries.catalog, {});
  const credits = useQuery(api.marketing.affiliates.listCredits, {
    affiliateId:
      partner === "all" ? undefined : (partner as Id<"marketingAffiliates">),
    state: state === "all" ? undefined : (state as CreditRow["state"]),
  });
  const detail = useQuery(
    api.marketing.affiliates.getCredit,
    opened ? { creditId: opened._id } : "skip",
  );
  const save = useMutation(api.marketing.commands.saveAffiliate.saveAffiliate);
  const status = useMutation(api.marketing.commands.setAffiliateStatus.setAffiliateStatus);
  const coupon = useMutation(api.marketing.commands.assignCoupon.assignCoupon);
  const review = useMutation(api.marketing.commands.reviewCredit.reviewCredit);
  const refresh = useMutation(api.marketing.commands.refreshCredit.refreshCredit);
  const saveCampaign = useMutation(api.marketing.commands.saveCampaign.saveCampaign);
  return (
    <AffiliatesView
      origin={origin}
      partners={partners?.rows}
      partial={partners?.partial ?? false}
      campaigns={campaigns}
      coupons={coupons}
      properties={properties}
      canManage={capabilities.partners}
      actions={{ save, status, coupon, saveCampaign: capabilities.draft ? saveCampaign : undefined }}
      focusedPartner={focusedPartner?._id}
      missingPartner={Boolean(requestedPartner && partners && !focusedPartner)}
      selectedPartner={partner}
      onSelectPartner={setPartner}
    >
      {(partnerFilter) => <>
      <CreditList
        partnerFilter={partnerFilter}
        credits={credits?.rows}
        partial={credits?.partial ?? false}
        partnerName={partners?.rows.find((row) => row._id === partner)?.name ?? "All partners"}
        state={state}
        onState={setState}
        onOpen={setOpened}
      />
      {opened && (
        <CreditReview
          key={opened._id}
          detail={detail}
          canReview={capabilities.reviewCredits}
          onReview={review}
          onRefresh={(creditId) => refresh({ creditId })}
          onClose={() => setOpened(null)}
        />
      )}
      </>}
    </AffiliatesView>
  );
}
