import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { Id } from "convex/_generated/dataModel";
import type { AffiliateRow, CreditRow } from 'convex/shared/marketingAffiliateTypes';
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import {
  AffiliatesView,
  CreditList,
  CreditReview,
  type CreditDetail,
} from "@/components/admin/marketing/AffiliatesView";
import type { CampaignRow } from "@/components/admin/marketing/types";
import "@/app.css";
const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle(
  "dark",
  params.get("theme") === "dark",
);
const viewer = params.get("role") === "viewer";
const campaign: CampaignRow = {
  _id: "campaign1" as Id<"marketingCampaigns">,
  _creationTime: 0,
  name: "Partner referrals",
  source: "partner",
  medium: "affiliate",
  status: "active",
  createdAt: 0,
  updatedAt: 0,
  updatedByEmail: "admin@example.com",
  linkCount: 0,
  couponCount: 0,
  opens: 0,
  countsCapped: false,
};
const partner: AffiliateRow = {
  _id: "anna" as Id<"marketingAffiliates">,
  _creationTime: 0,
  name: "Anna",
  slug: "anna",
  campaignId: campaign._id,
  status: "active",
  createdAt: 0,
  updatedAt: 0,
  updatedByEmail: "admin@example.com",
  canonicalPath: "/r/anna",
  linkStatus: "active",
  campaignName: campaign.name,
  coupons: [],
  summary: {
    pending: 1,
    approved: 0,
    rejected: 0,
    reversed: 0,
    approvedNet: 0,
    partial: false,
  },
};
const credit: CreditRow = {
  _id: "credit1" as Id<"affiliateCredits">,
  _creationTime: 0,
  sourceKey: "order:one",
  state: "pending",
  affiliateId: partner._id,
  eligible: true,
  eligibleNet: 70000,
  approvedNet: 0,
  revision: 4,
  createdAt: 0,
  updatedAt: 0,
  label: "Guest",
  ref: "Order #1",
  affiliateName: "Anna",
  snapshot: { capturedAt: 0, candidates: [], flags: ["affiliate_conflict"] },
  candidates: [
    {
      affiliateId: partner._id,
      name: "Anna",
      slug: "anna",
      origin: "link",
      eligible: true,
    },
    {
      affiliateId: "ben" as Id<"marketingAffiliates">,
      name: "Ben",
      slug: "ben",
      origin: "coupon",
      eligible: true,
    },
  ],
  flags: ["affiliate_conflict"],
};
function Fixture() {
  const [partners, setPartners] = useState([partner]);
  const [selected, setSelected] = useState("all");
  const [state, setState] = useState("all");
  const [row, setRow] = useState(credit);
  const [opened, setOpened] = useState(false);
  const detail: CreditDetail = {
    credit: row,
    partial: false,
    history: [
      {
        _id: "h1" as Id<"affiliateCreditChanges">,
        _creationTime: 0,
        creditId: row._id,
        revision: row.revision,
        actor: "finance@example.com",
        kind: row.state === "approved" ? "reviewed" : "created",
        state: row.state,
        eligibleNet: row.eligibleNet,
        approvedNet: row.approvedNet,
        recordedAt: 0,
      },
    ],
  };
  return (
    <ConfirmProvider>
      <main className="min-h-dvh bg-background text-foreground">
        <h1 className="sr-only">Marketing affiliates</h1>
        <AffiliatesView
          partners={partners}
          partial={false}
          campaigns={[campaign]}
          coupons={[]}
          properties={[]}
          origin="https://example.com"
          canManage={!viewer}
          selectedPartner={selected}
          onSelectPartner={setSelected}
          actions={{
            save: async (args) => {
              document.body.dataset.saved = JSON.stringify(args);
              setPartners((current) => [
                ...current,
                {
                  ...partner,
                  ...args,
                  _id: "new-partner" as Id<"marketingAffiliates">,
                  status: "paused",
                  canonicalPath: `/r/${args.slug}`,
                  linkStatus: "draft",
                },
              ]);
            },
            status: async (args) => {
              setPartners((current) =>
                current.map((p) =>
                  p._id === args.affiliateId
                    ? { ...p, status: args.status, linkStatus: args.status }
                    : p,
                ),
              );
            },
            coupon: async () => null,
          }}
        >
          <CreditList
            credits={[row]}
            partial={false}
            state={state}
            onState={setState}
            onOpen={() => setOpened(true)}
          />
          {opened && (
            <CreditReview
              detail={detail}
              canReview={!viewer}
              onClose={() => setOpened(false)}
              onRefresh={async () => null}
              onReview={async (args) => {
                document.body.dataset.reviewed = JSON.stringify(args);
                setRow((current) => ({
                  ...current,
                  state: args.decision,
                  revision: current.revision + 1,
                  reason: args.reason,
                  approvedNet:
                    args.decision === "approved" ? current.eligibleNet : 0,
                }));
              }}
            />
          )}
        </AffiliatesView>
      </main>
    </ConfirmProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
