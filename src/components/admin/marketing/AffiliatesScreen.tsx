"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { CreditRow } from "convex/marketingAffiliates";
import { useState, useSyncExternalStore } from "react";
import { AffiliatesView, CreditList, CreditReview } from "./AffiliatesView";
import { useMarketingAccess } from "./MarketingAccess";

const noSubscribe = () => () => {};

export function AffiliatesScreen() {
  const origin = useSyncExternalStore(
    noSubscribe,
    () => window.location.origin,
    () => "",
  );
  const { capabilities } = useMarketingAccess();
  const [partner, setPartner] = useState("all");
  const [state, setState] = useState("all");
  const [opened, setOpened] = useState<CreditRow | null>(null);
  const partners = useQuery(api.marketingAffiliates.listAffiliates, {});
  const campaigns = useQuery(api.marketing.listCampaigns, {});
  const coupons = useQuery(api.marketing.listCoupons, {});
  const properties = useQuery(api.marketing.catalog, {});
  const credits = useQuery(api.marketingAffiliates.listCredits, {
    affiliateId:
      partner === "all" ? undefined : (partner as Id<"marketingAffiliates">),
    state: state === "all" ? undefined : (state as CreditRow["state"]),
  });
  const detail = useQuery(
    api.marketingAffiliates.getCredit,
    opened ? { creditId: opened._id } : "skip",
  );
  const save = useMutation(api.marketingAffiliates.saveAffiliate);
  const status = useMutation(api.marketingAffiliates.setAffiliateStatus);
  const coupon = useMutation(api.marketingAffiliates.assignCoupon);
  const review = useMutation(api.marketingAffiliates.reviewCredit);
  const refresh = useMutation(api.marketingAffiliates.refreshCredit);
  return (
    <AffiliatesView
      origin={origin}
      partners={partners?.rows}
      partial={partners?.partial ?? false}
      campaigns={campaigns}
      coupons={coupons}
      properties={properties}
      canManage={capabilities.partners}
      actions={{ save, status, coupon }}
      selectedPartner={partner}
      onSelectPartner={setPartner}
    >
      <CreditList
        credits={credits?.rows}
        partial={credits?.partial ?? false}
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
    </AffiliatesView>
  );
}
