// @vitest-environment happy-dom
import { act, createElement, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Id } from "convex/_generated/dataModel";
import { marketingCapabilities } from 'convex/shared/marketingAccess';
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { MarketingAccessGate, MarketingAccessProvider, useMarketingAccess, type MarketingAccess, type MarketingRole } from "@/components/admin/marketing/MarketingAccess";
import { MarketingAccessScreen } from "@/components/admin/marketing/MarketingAccessScreen";
import { CampaignsView } from "@/components/admin/marketing/CampaignsView";
import { LinkEditor } from "@/components/admin/marketing/LinkEditor";
import { LinksView } from "@/components/admin/marketing/LinksView";
import { CouponEditor } from "@/components/admin/marketing/CouponEditor";
import { CouponsView } from "@/components/admin/marketing/CouponsView";
import { CampaignSpendSection } from "@/components/admin/marketing/CampaignSpendSection";
import { SpendDialog } from "@/components/admin/marketing/SpendDialog";
import { MarketingSectionNav } from "@/components/admin/marketing/MarketingSectionNav";
import type { CampaignRow, CouponDetail, LinkRow, MarketingActions } from "@/components/admin/marketing/types";

const mocked = vi.hoisted(() => ({ auth: { isLoading: false, isAuthenticated: true }, access: undefined as MarketingAccess | undefined, grants: [] as unknown[], mutate: vi.fn(), query: vi.fn(), childMount: vi.fn(), childUnmount: vi.fn(), routerPush: vi.fn() }));
vi.mock("convex/react", () => ({
  useConvexAuth: () => mocked.auth,
  useMutation: () => mocked.mutate,
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const name = getFunctionName(ref); mocked.query(name, args);
    return args === "skip" ? undefined : name === "marketing/access:current" ? mocked.access : name === "marketing/access:listGrants" ? mocked.grants : undefined;
  },
}));
vi.mock("@clerk/nextjs", () => ({ SignInButton: ({ children }: { children: ReactNode }) => children }));
vi.mock("next/navigation", () => ({ useSelectedLayoutSegment: () => "dashboard", useRouter: () => ({ push: mocked.routerPush, replace: vi.fn() }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const access = (role: MarketingRole | null): MarketingAccess => ({ email: "person@example.com", role, capabilities: marketingCapabilities(role), pendingInvitation: null });
const render = async (node: ReactNode, role?: MarketingRole) => act(async () => root.render(createElement(ConfirmProvider, null, role ? createElement(MarketingAccessProvider, { value: access(role) }, node) : node)));
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent?.trim() === text);
const click = async (node: HTMLElement | undefined) => { expect(node).toBeDefined(); await act(async () => node!.click()); };
const type = async (node: HTMLInputElement, value: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); });
beforeEach(() => { mocked.auth = { isLoading: false, isAuthenticated: true }; mocked.access = undefined; mocked.grants = []; mocked.query.mockClear(); mocked.routerPush.mockClear(); mocked.mutate.mockReset().mockResolvedValue(null); mocked.childMount.mockClear(); mocked.childUnmount.mockClear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ""; });
function ProtectedChild() {
  const current = useMarketingAccess();
  useEffect(() => { mocked.childMount(); return () => mocked.childUnmount(); }, []);
  return createElement("p", null, `Protected ${current.role}`);
}
const gated = () => createElement(MarketingAccessGate, null, createElement(ProtectedChild));

it("keeps children unmounted while checking, signed out, denied and awaiting invitation activation", async () => {
  await render(gated()); expect(document.body.textContent).toContain("Checking Marketing access");
  mocked.auth.isAuthenticated = false;
  await render(gated()); expect(button("Sign in")).toBeDefined(); expect(mocked.query).toHaveBeenLastCalledWith("marketing/access:current", "skip");
  mocked.auth.isAuthenticated = true; mocked.access = access(null);
  await render(gated()); expect(document.body.textContent).toContain("Marketing access required");
  mocked.access = { ...access(null), pendingInvitation: { role: "viewer" } };
  await render(gated()); expect(button("Activate Marketing access")).toBeDefined(); expect(mocked.childMount).not.toHaveBeenCalled();
  mocked.mutate.mockRejectedValueOnce(new Error("Invitation changed"));
  await click(button("Activate Marketing access")); expect(document.querySelector('[role="alert"]')?.textContent).toContain("Invitation changed"); expect(button("Activate Marketing access")!.disabled).toBe(false);
  await click(button("Activate Marketing access")); expect(mocked.mutate).toHaveBeenLastCalledWith({});
  mocked.access = access("viewer"); await render(gated()); expect(document.body.textContent).toContain("Protected viewer"); expect(mocked.childMount).toHaveBeenCalledOnce();
  mocked.access = access(null); await render(gated()); expect(mocked.childUnmount).toHaveBeenCalledOnce(); expect(document.body.textContent).not.toContain("Protected viewer");
});

const campaign: CampaignRow = { _id: "campaign" as Id<"marketingCampaigns">, _creationTime: 0, name: "Campaign", source: "print", medium: "qr", status: "draft", createdAt: 0, updatedAt: 0, updatedByEmail: "admin@example.com", linkCount: 0, couponCount: 0, opens: 0, countsCapped: false };
const campaignActions = { saveCampaign: vi.fn<(args: { budget?: number }) => Promise<Id<"marketingCampaigns">>>().mockResolvedValue("campaign" as Id<"marketingCampaigns">), setCampaignStatus: vi.fn().mockResolvedValue(null) };
const campaigns = (status: CampaignRow["status"] = "draft") => createElement(CampaignsView, { campaigns: [{ ...campaign, status }], links: [], coupons: [], today: "2026-11-09", linksHref: "/l", couponHref: () => "/c", actions: campaignActions });

it("lets marketers save drafts without budget or publishing controls and inspect live campaigns read-only", async () => {
  campaignActions.saveCampaign.mockClear();
  await render(campaigns(), "marketer"); await click(button("Campaign"));
  expect(button("Start")).toBeUndefined(); expect(button("Save changes")).toBeDefined();
  expect(document.querySelector<HTMLInputElement>('input[placeholder="Not set"]')!.disabled).toBe(true);
  await click(button("Save changes")); expect(campaignActions.saveCampaign).toHaveBeenCalledOnce(); expect(campaignActions.saveCampaign.mock.calls[0][0]).not.toHaveProperty("budget");
  await render(campaigns("active"), "marketer"); await click(button("Campaign"));
  expect(button("Save changes")).toBeUndefined(); expect(button("Pause")).toBeUndefined(); expect(document.querySelector('[role="dialog"]')?.textContent).toContain("edit drafts only");
});

it.each(["viewer", "finance"] as const)("lets %s inspect campaigns and hides all draft creation controls", async role => {
  await render(campaigns(), role); expect(button("New campaign")).toBeUndefined(); await click(button("Campaign")); expect(button("Save changes")).toBeUndefined(); expect(button("Start")).toBeUndefined();
  await render(createElement(LinksView, { links: [], campaigns: [], coupons: [], properties: [], origin: "https://example.com", brand: "Resort", today: "2026-11-09", campaignsHref: "/c", actions: { saveLink: vi.fn(), setLinkStatus: vi.fn(), checkSlug: vi.fn() } }), role); expect(button("New link")).toBeUndefined(); expect(document.body.textContent).toContain("No short links yet");
  await render(createElement(CouponsView, { coupons: [], campaigns: [], properties: [], today: "2026-11-09", couponHref: () => "/c", newCouponHref: "/c/new" }), role); expect(document.querySelector('a[href="/c/new"]')).toBeNull();
  await render(createElement(CouponEditor, { isNew: true, coupons: [], campaigns: [], properties: [], today: "2026-11-09", listHref: "/c", onCreated() {}, actions: { saveCoupon: vi.fn(), setCouponStatus: vi.fn(), testQuote: vi.fn() } }), role); expect(button("Create coupon")).toBeUndefined(); expect(document.body.textContent).toContain("requires draft access");
});

it.each(["viewer", "marketer", "finance", "manager"] as const)("shows spend editing only to permitted roles (%s)", async role => {
  const onSave = vi.fn();
  await render(createElement(CampaignSpendSection, { campaign, spend: [], onSave, onDelete: vi.fn() }), role);
  expect(!!button("Add spend")).toBe(role === "finance" || role === "manager");
  await render(createElement(SpendDialog, { open: true, onOpenChange() {}, campaigns: [{ id: campaign._id, name: campaign.name }], onSave }), role);
  expect(!!document.querySelector('[role="dialog"]')).toBe(role === "finance" || role === "manager");
});

it("hides Access navigation and avoids the grants query for role-only users", async () => {
  await render(createElement(MarketingSectionNav, null, createElement(MarketingAccessScreen)), "manager");
  expect(document.querySelector('a[href="/admin/marketing/access"]')).toBeNull(); expect(document.querySelector('a[href="/admin/marketing/affiliates"]')).not.toBeNull(); expect(mocked.query.mock.calls.some(call => call[0] === "marketing/access:listGrants")).toBe(false);
});

it("creates invitations without sending messages and displays mutation errors", async () => {
  await render(createElement(MarketingAccessScreen), "admin");
  await type(document.querySelector<HTMLInputElement>("#marketing-invite-email")!, "friend@example.com");
  mocked.mutate.mockRejectedValueOnce(new Error("Could not save role"));
  await click(button("Create invitation")); expect(document.querySelector('[role="alert"]')?.textContent).toContain("Could not save role");
  await click(button("Create invitation")); expect(mocked.mutate).toHaveBeenLastCalledWith({ email: "friend@example.com", role: "viewer" }); expect(document.body.textContent).toContain("No email is sent");
});


it.each([
  { role: "marketer", status: "draft", editable: true },
  { role: "marketer", status: "active", editable: false },
  { role: "viewer", status: "draft", editable: false },
  { role: "finance", status: "active", editable: false },
] as const)("gives $role the appropriate $status coupon controls and a read-only usage ledger", async ({ role, status, editable }) => {
  const couponId = "coupon" as Id<"coupons">;
  const rules: CouponDetail["rules"] = { _id: "version" as Id<"couponVersions">, _creationTime: 0, couponId, version: 1, benefit: { kind: "fixed", amount: 50000 }, scope: "services", createdAt: 0, createdByEmail: "admin@example.com" };
  const detail: CouponDetail = { _id: couponId, _creationTime: 0, code: "SERVICE500", status, currentVersion: 1, used: 1, discountGranted: 50000, createdAt: 0, updatedAt: 0, updatedByEmail: "admin@example.com", rules, versions: [rules], links: [], redemptions: [{ _id: "redemption" as Id<"couponRedemptions">, _creationTime: 0, couponId, couponVersion: 1, code: "SERVICE500", state: "consumed", discount: 50000, createdAt: 0, updatedAt: 0, order: { orderId: "order" as Id<"orders">, title: "Order #1", receiptNumber: "R-000001", customerName: "Guest" } }] };
  await render(createElement(CouponEditor, { detail, isNew: false, coupons: [detail], campaigns: [], properties: [], today: "2026-11-09", listHref: "/c", onCreated() {}, actions: { saveCoupon: vi.fn(), setCouponStatus: vi.fn(), testQuote: vi.fn() } }), role);
  expect(!!button("Save")).toBe(editable);
  expect(button("Publish")).toBeUndefined(); expect(button("Pause")).toBeUndefined();
  expect(document.querySelector('a[href^="/admin/receipt/"]')).toBeNull();
  expect(document.body.textContent).toContain("Order #1");
});


const partnerLink: LinkRow = { _id: "partner-link" as Id<"marketingLinks">, _creationTime: 0, slug: "r/anna", name: "Anna", campaignId: campaign._id, affiliateId: "anna" as Id<"marketingAffiliates">, destination: { kind: "home" }, entry: "link", status: "active", opens: 0, createdAt: 0, updatedAt: 0, updatedByEmail: "admin@example.com", campaignName: campaign.name, shortUrlPath: "/r/anna" };
it("routes canonical partner links to Affiliates and retains copy and QR actions", async () => {
  const saveLink = vi.fn<MarketingActions["saveLink"]>();
  await render(createElement(LinksView, { links: [partnerLink], campaigns: [campaign], coupons: [], properties: [], origin: "https://example.com", brand: "Resort", today: "2026-11-09", campaignsHref: "/c", actions: { saveLink, setLinkStatus: vi.fn(), checkSlug: vi.fn() } }), "manager");
  expect(document.querySelector('a[href="/admin/marketing/affiliates"]')?.textContent).toBe("Manage partner");
  expect(document.querySelector('[aria-label="QR offer card for /r/anna"]')).not.toBeNull();
  await click(button("Anna")); expect(mocked.routerPush).toHaveBeenCalledWith("/admin/marketing/affiliates"); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(saveLink).not.toHaveBeenCalled();
});
it("preserves an affiliate alias association when a manager saves details", async () => {
  const alias: LinkRow = { ...partnerLink, slug: "anna-extra", shortUrlPath: "/anna-extra", status: "draft" };
  const saveLink = vi.fn<MarketingActions["saveLink"]>().mockResolvedValue(alias._id);
  await render(createElement(LinkEditor, { link: alias, links: [alias], campaigns: [campaign], coupons: [], properties: [], origin: "https://example.com", today: "2026-11-09", campaignsHref: "/c", actions: { saveLink, checkSlug: vi.fn() }, onDone() {}, onCancel() {}, onDuplicate() {} }), "manager");
  await click(button("Save changes")); expect(saveLink).toHaveBeenCalledWith(expect.objectContaining({ linkId: alias._id, affiliateId: alias.affiliateId }));
});
it("copies a partner alias as an explicit ordinary draft for marketers", async () => {
  const saveLink = vi.fn<MarketingActions["saveLink"]>().mockResolvedValue("copy" as Id<"marketingLinks">);
  const checkSlug = vi.fn<MarketingActions["checkSlug"]>().mockResolvedValue({ ok: true, slug: "anna-copy" });
  await render(createElement(LinkEditor, { preset: { from: partnerLink }, links: [partnerLink], campaigns: [campaign], coupons: [], properties: [], origin: "https://example.com", today: "2026-11-09", campaignsHref: "/c", actions: { saveLink, checkSlug }, onDone() {}, onCancel() {}, onDuplicate() {} }), "marketer");
  expect(document.body.textContent).toContain("partner association is not copied");
  await type(document.querySelector<HTMLInputElement>('input[placeholder="f2"]')!, "anna-copy");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)); });
  await click(button("Create link")); expect(saveLink).toHaveBeenCalledOnce(); expect(saveLink.mock.calls[0][0]).not.toHaveProperty("affiliateId");
});


it("shows expired invitations and lets administrators refresh them", async () => {
  mocked.grants = [{ _id: "invite", email: "friend@example.com", role: "viewer", expiresAt: 0, expired: true }];
  await render(createElement(MarketingAccessScreen), "admin");
  expect(document.body.textContent).toContain("Expired");
  await click(button("Renew invitation"));
  expect(mocked.mutate).toHaveBeenLastCalledWith({ email: "friend@example.com", role: "viewer" });
  mocked.grants = [{ _id: "invite", email: "friend@example.com", role: "viewer", tokenIdentifier: "friend", expiresAt: null, expired: false }];
  await render(createElement(MarketingAccessScreen), "admin");
  expect(document.body.textContent).toContain("Access activated");
  expect(button("Renew invitation")).toBeUndefined();
});
