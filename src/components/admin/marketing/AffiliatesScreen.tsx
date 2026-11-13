"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { CreditRow } from 'convex/shared/marketingAffiliateTypes';
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
  const partners = useQuery(api.marketing.affiliates.listAffiliates, {});
  const campaigns = useQuery(api.marketing.queries.listCampaigns, {});
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
