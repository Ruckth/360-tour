import type { Id } from "convex/_generated/dataModel";
import { createRoot } from "react-dom/client";
import { CampaignsView } from "@/components/admin/marketing/CampaignsView";
import type { CampaignRow } from "@/components/admin/marketing/types";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { CampaignSpendSection } from "@/components/admin/marketing/CampaignSpendSection";
import { CouponRefusalsCard } from "@/components/admin/marketing/CouponRefusalsCard";
import "@/app.css";

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
const empty = params.get("case") === "empty";
const campaign: CampaignRow = { _creationTime: 1, source: "facebook", medium: "paid", status: "active", createdAt: 1, updatedAt: 1, updatedByEmail: "staff@example.com", linkCount: 0, couponCount: 0, opens: 0, countsCapped: false, _id: "c1" as Id<"marketingCampaigns">, name: "November escape", budget: 10000 };
const entries = [6000, 5000, 1000].map((amount, index) => ({ id: `s${index}` as Id<"marketingSpend">, campaignId: campaign._id, amount, from: "2026-11-01", to: `2026-11-0${index + 2}`, note: `Invoice ${index + 1}` }));
function Fixture() {
  return <ConfirmProvider><main className="min-h-dvh bg-background p-4 text-foreground"><h1 className="text-xl">Marketing spend and refusals</h1>

    <div className="mt-4 max-w-sm"><h2 className="sr-only">Coupon details</h2><CouponRefusalsCard summary={{ since: "2026-10-10", total: empty ? 0 : 14, byProblem: empty ? [] : [{ problem: "expired", count: 7 }, { problem: "wrong_property", count: 3 }, { problem: "coupon_worse", count: 4 }], bySurface: empty ? [] : [{ surface: "booking", count: 8 }, { surface: "pos", count: 2 }] }} /></div>
    <CampaignsView campaigns={[campaign]} links={[]} coupons={[]} today="2026-11-09" linksHref="/links" couponHref={() => "/coupon"} actions={{ saveCampaign: async () => campaign._id, setCampaignStatus: async () => null }} spend={(selected) => <CampaignSpendSection campaign={selected} spend={empty ? [] : entries} now={Date.parse("2026-11-08T18:30:00Z")} onSave={async (draft) => { document.body.dataset.spend = JSON.stringify(draft); }} onDelete={async () => {}} />} />
  </main></ConfirmProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
