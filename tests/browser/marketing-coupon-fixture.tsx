import type { Id } from "convex/_generated/dataModel";
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { CouponEditor } from "@/components/admin/marketing/CouponEditor";
import type { CampaignRow, CouponDetail, LinkRow, MarketingProperty, SaveCouponArgs } from "@/components/admin/marketing/types";
import "@/app.css";

/*
 * Marketing › Coupons › New coupon (CouponEditor) on in-memory data, the way MarketingCouponScreen
 * renders it: saving a new coupon moves to its page, and the page reads the stored coupon back.
 *   fail=save           saveCoupon throws
 *   fail=publish        setCouponStatus throws
 *   fail=link-publish   setLinkStatus throws
 *   campaigns=0         no campaigns yet
 *   theme=dark          dark app theme
 * Every mutation is recorded, in order, on document.body.dataset.calls.
 */
const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
const fail = params.get("fail");

const audit = { createdAt: 0, updatedAt: 0, updatedByEmail: "narin@auraliscove.co" };
const seedCampaigns: CampaignRow[] =
  params.get("campaigns") === "0"
    ? []
    : [{ _id: "campaign1" as Id<"marketingCampaigns">, _creationTime: 0, name: "Songkran spa week", source: "instagram", medium: "social", status: "active", ...audit, linkCount: 1, couponCount: 0, opens: 0, countsCapped: false }];
const properties = [
  { _id: "pool-id" as Id<"properties">, name: "Tideglass Pool Residence", slug: "pool-villa", status: "active", pricePerNight: 850000, currency: "THB", maxGuests: 6, directDiscountPercent: 1500 },
  { _id: "garden-id" as Id<"properties">, name: "Garden Villa", slug: "garden-villa", status: "active", pricePerNight: 420000, currency: "THB", maxGuests: 4, directDiscountPercent: 0 },
] as MarketingProperty[];

function record(name: string, args: unknown) {
  const calls = JSON.parse(document.body.dataset.calls ?? "[]");
  document.body.dataset.calls = JSON.stringify([...calls, { name, args }]);
}
const later = () => new Promise((resolve) => window.setTimeout(resolve, 30));

function Fixture() {
  const [couponId, setCouponId] = useState<string>("new");
  const [coupons, setCoupons] = useState<CouponDetail[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>(seedCampaigns);
  const detail = coupons.find((coupon) => coupon._id === couponId);
  const withLinks = detail ? { ...detail, links: links.filter((link) => link.couponId === detail._id) } : undefined;

  const actions = useMemo(
    () => ({
      saveCoupon: async (args: SaveCouponArgs) => {
        record("saveCoupon", args);
        await later();
        if (fail === "save") throw new Error("The server didn’t answer.");
        const { couponId: existing, code, campaignId, ...rules } = args;
        const id = (existing ?? `coupon${Date.now()}`) as Id<"coupons">;
        const version = { _id: `${id}-v1` as Id<"couponVersions">, _creationTime: 0, couponId: id, version: 1, createdAt: 0, createdByEmail: audit.updatedByEmail, ...rules };
        const coupon: CouponDetail = {
          _id: id, _creationTime: 0, code, campaignId, status: "draft", currentVersion: 1, used: 0, discountGranted: 0, ...audit,
          rules: version, versions: [version], links: [], redemptions: [],
        };
        setCoupons((current) => [...current.filter((item) => item._id !== id), coupon]);
        return { couponId: id, version: 1 };
      },
      setCouponStatus: async (args: { couponId: Id<"coupons">; status: CouponDetail["status"] }) => {
        record("setCouponStatus", args);
        await later();
        if (fail === "publish") throw new Error("The server didn’t answer.");
        setCoupons((current) => current.map((coupon) => (coupon._id === args.couponId ? { ...coupon, status: args.status } : coupon)));
        return null;
      },
      saveLink: async (args: Parameters<Parameters<typeof CouponEditor>[0]["actions"]["saveLink"]>[0]) => {
        record("saveLink", args);
        await later();
        const id = `link${Date.now()}` as Id<"marketingLinks">;
        const campaign = campaigns.find((item) => item._id === args.campaignId);
        setLinks((current) => [...current, { ...args, _id: id, _creationTime: 0, status: "draft", opens: 0, ...audit, campaignName: campaign?.name ?? "", shortUrlPath: `/${args.slug}` } as LinkRow]);
        return id;
      },
      setLinkStatus: async (args: { linkId: Id<"marketingLinks">; status: LinkRow["status"] }) => {
        record("setLinkStatus", args);
        await later();
        if (fail === "link-publish") throw new Error("The server didn’t answer.");
        setLinks((current) => current.map((link) => (link._id === args.linkId ? { ...link, status: args.status } : link)));
        return null;
      },
      checkSlug: async ({ slug }: { slug: string }) => (links.some((link) => link.slug === slug) ? { ok: false as const, slug, reason: "taken" as const } : { ok: true as const, slug }),
      saveCampaign: async (args: { name: string; source: string; medium: string }) => {
        record("saveCampaign", args);
        await later();
        const id = `campaign${Date.now()}` as Id<"marketingCampaigns">;
        setCampaigns((current) => [...current, { ...args, _id: id, _creationTime: 0, status: "draft", ...audit, linkCount: 0, couponCount: 0, opens: 0, countsCapped: false }]);
        return id;
      },
      testQuote: async () => {
        throw new Error("Not in this fixture");
      },
    }),
    [campaigns, links],
  );

  return (
    <main className="min-h-dvh bg-background text-foreground" data-fixture-ready="" data-page={couponId}>
      <h1 className="sr-only">Marketing coupon</h1>
      <CouponEditor
        detail={couponId === "new" ? undefined : withLinks}
        isNew={couponId === "new"}
        coupons={coupons}
        campaigns={campaigns}
        properties={properties}
        today="2026-11-12"
        listHref="/admin/marketing/coupons"
        origin="https://book.auralis.example"
        brand="Auralis Cove"
        actions={actions}
        onCreated={(id) => setCouponId(id)}
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <ConfirmProvider>
    <Fixture />
  </ConfirmProvider>,
);
