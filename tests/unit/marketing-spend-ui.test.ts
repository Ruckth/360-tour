// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConvexError } from "convex/values";
import type { Id } from "convex/_generated/dataModel";
import { COUPON_REFUSAL_PROBLEMS, type CouponRefusalSummary, type ReportSpend } from "convex/lib/marketingReport";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { CampaignSpendSection } from "@/components/admin/marketing/CampaignSpendSection";
import { CampaignsView } from "@/components/admin/marketing/CampaignsView";
import { CouponRefusalsCard, REFUSAL_LABELS, refusalRows } from "@/components/admin/marketing/CouponRefusalsCard";
import { SpendDialog, type SpendDialogProps } from "@/components/admin/marketing/SpendDialog";
import { thb } from "@/components/admin/marketing/marketing-format";
import type { CampaignRow } from "@/components/admin/marketing/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: { children: ReactNode; href: string }) => createElement("a", { href, ...props }, children) }));

// 8 Nov 2026, noon in Bangkok.
const NOW = Date.parse("2026-11-08T05:00:00Z");
const c1 = "c1" as Id<"marketingCampaigns">;
const c2 = "c2" as Id<"marketingCampaigns">;
const entry = (id: string, from: string, to: string, amount: number, note?: string): ReportSpend => ({ id: id as Id<"marketingSpend">, campaignId: c1, amount, from, to, note });
const october = entry("s1", "2026-10-08", "2026-10-31", 27000, "Meta ads · October invoice");
const november = entry("s2", "2026-11-01", "2026-11-06", 18000);

let root: Root;
const render = (node: ReactNode) => act(async () => root.render(createElement(ConfirmProvider, null, node)));
const text = () => document.body.textContent ?? "";
const button = (label: string) => [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === label);
const click = (el: Element | null | undefined) => act(async () => (el as HTMLElement).click());
const amountInput = () => document.querySelector<HTMLInputElement>('input[placeholder="12,000"]');
const noteInput = () => document.querySelector<HTMLTextAreaElement>("textarea");
const type = (el: HTMLInputElement | HTMLTextAreaElement | null, value: string) =>
  act(async () => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
const alerts = () => [...document.querySelectorAll('[role="alert"]')].map((el) => el.textContent);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function dialog(patch: Partial<SpendDialogProps> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    campaigns: [{ id: c1, name: "November escape" }],
    onSave: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    now: NOW,
    ...patch,
  };
  return { props, node: createElement(SpendDialog, props) };
}

describe("SpendDialog", () => {
  it("validates with validateSpend, then saves this month so far by default", async () => {
    const { props, node } = dialog();
    await render(node);
    expect(document.activeElement).toBe(amountInput());

    await click(button("Add spend"));
    expect(alerts()).toContain("Enter the amount in whole baht.");
    expect(props.onSave).not.toHaveBeenCalled();

    await type(amountInput(), "12.5");
    await click(button("Add spend"));
    expect(alerts()).toContain("Enter the amount in whole baht.");

    await type(amountInput(), "12,000");
    await type(noteInput(), "  Meta ads · 1–8 Nov ");
    await click(button("Add spend"));
    expect(props.onSave).toHaveBeenCalledWith({ id: undefined, campaignId: c1, amount: 12000, from: "2026-11-01", to: "2026-11-08", note: "Meta ads · 1–8 Nov" });
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("flags dates in the wrong order and a note that's too long", async () => {
    const { props, node } = dialog({ defaults: { from: "2026-11-10", to: "2026-11-01", amount: 500 } });
    await render(node);
    expect(amountInput()?.value).toBe("500");
    await type(noteInput(), "x".repeat(501));
    await click(button("Add spend"));
    expect(alerts()).toEqual(expect.arrayContaining(["Choose a start date on or before the end date.", "Keep the note under 500 characters."]));
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it("shows the server's message and stays open", async () => {
    const { props, node } = dialog({ onSave: vi.fn().mockRejectedValue(new ConvexError({ code: "invalid", message: "That campaign is archived" })) });
    await render(node);
    await type(amountInput(), "900");
    await click(button("Add spend"));
    expect(alerts()).toContain("That campaign is archived");
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
    expect(amountInput()?.value).toBe("900");
  });

  it("edits an entry and deletes it after confirming", async () => {
    const { props, node } = dialog({ entry: october });
    await render(node);
    expect(text()).toContain("Edit spend");
    expect(amountInput()?.value).toBe("27,000");
    expect(noteInput()?.value).toBe("Meta ads · October invoice");

    await type(amountInput(), "28000");
    await click(button("Save changes"));
    expect(props.onSave).toHaveBeenCalledWith({ id: "s1", campaignId: c1, amount: 28000, from: "2026-10-08", to: "2026-10-31", note: "Meta ads · October invoice" });

    await click(button("Delete"));
    expect(text()).toContain(`Delete ${thb(27000)} of spend?`);
    await click(button("Delete spend"));
    expect(props.onDelete).toHaveBeenCalledWith("s1");
    expect(props.onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("has no Delete while adding", async () => {
    await render(dialog().node);
    expect(button("Delete")).toBeUndefined();
  });

  it("hides the campaign picker with one campaign", async () => {
    await render(dialog().node);
    expect(document.querySelector('[role="combobox"]')).toBeNull();
    expect(text()).toContain("Enter what November escape cost.");
  });

  it("offers the campaign picker with more than one campaign", async () => {
    const { props, node } = dialog({ campaigns: [{ id: c1, name: "November escape" }, { id: c2, name: "Spa week" }], defaults: { campaignId: c2 } });
    await render(node);
    expect(document.querySelector('[role="combobox"]')?.textContent).toContain("Spa week");
    await type(amountInput(), "1200");
    await click(button("Add spend"));
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ campaignId: c2, amount: 1200 }));
  });
});

describe("CampaignSpendSection", () => {
  const section = (spend: ReportSpend[] | undefined, budget?: number, patch: { onSave?: () => Promise<void>; onDelete?: () => Promise<void> } = {}) =>
    createElement(CampaignSpendSection, {
      campaign: { _id: c1, name: "November escape", budget },
      spend,
      onSave: patch.onSave ?? vi.fn().mockResolvedValue(undefined),
      onDelete: patch.onDelete ?? vi.fn().mockResolvedValue(undefined),
      now: NOW,
    });

  it("lists entries newest first with the total against the budget", async () => {
    await render(section([october, november], 60000));
    const rows = [...document.querySelectorAll("li")].map((li) => li.textContent);
    expect(rows[0]).toContain("1–6 Nov 2026");
    expect(rows[0]).toContain("No note");
    expect(rows[1]).toContain("Meta ads · October invoice");
    expect(text()).toContain(`Total of ${thb(60000)} budget`);
    expect(text()).toContain(`${thb(45000)} (75%)`);
    expect(document.querySelector('[role="meter"]')?.getAttribute("aria-valuenow")).toBe("45000");
    expect(text()).toContain("Without spend, ROAS is unavailable, never 0×.");
  });

  it("shows a plain total without a budget, and says when it's over", async () => {
    await render(section([october], undefined));
    expect(text()).toContain(`Total${thb(27000)}`);
    expect(document.querySelector('[role="meter"]')).toBeNull();
    await render(section([october, november], 40000));
    expect(text()).toContain(`${thb(5000)} over budget`);
  });

  it("has an empty state", async () => {
    await render(section([]));
    expect(text()).toContain("No spend yet. Add it when the invoice arrives.");
    expect(text()).not.toContain("Total");
  });

  it("opens the dialog for this campaign and deletes after confirming", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn().mockResolvedValue(undefined);
    await render(section([october], 60000, { onSave, onDelete }));
    await click(button("Add spend"));
    expect(document.querySelector('[role="combobox"]')).toBeNull();
    await type(amountInput(), "3000");
    await click([...document.querySelectorAll('[role="dialog"] button[type="submit"]')][0]);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ campaignId: c1, amount: 3000, from: "2026-11-01", to: "2026-11-08" }));
    expect(text()).toContain(`Added ${thb(3000)} of spend`);

    await click(document.querySelector('button[aria-label^="Actions for spend"]'));
    await click(button("Delete"));
    await click(button("Delete spend"));
    expect(onDelete).toHaveBeenCalledWith("s1");
  });
});

describe("CouponRefusalsCard", () => {
  const summary = (byProblem: CouponRefusalSummary["byProblem"], bySurface: CouponRefusalSummary["bySurface"] = []): CouponRefusalSummary => ({
    since: "2026-10-10",
    total: byProblem.reduce((sum, row) => sum + row.count, 0),
    byProblem,
    bySurface,
  });

  it("labels every refusal code in plain words", () => {
    for (const problem of COUPON_REFUSAL_PROBLEMS) expect(REFUSAL_LABELS[problem], problem).toMatch(/^[A-Z][a-z]/);
    expect(REFUSAL_LABELS.sold_out).toBe("Sold out");
    expect(REFUSAL_LABELS.min_nights).toBe("Minimum nights not met");
    expect(REFUSAL_LABELS.coupon_changed).toBe("Savings changed at payment");
  });

  it("keeps coupon_worse out of the refusals and merges codes that share a label", () => {
    const result = refusalRows(summary([
      { problem: "min_nights", count: 14 },
      { problem: "coupon_worse", count: 4 },
      { problem: "wrong_property", count: 2 },
      { problem: "villa_only", count: 3 },
      { problem: "expired", count: 0 },
    ]));
    expect(result).toEqual({ rows: [{ label: "Minimum nights not met", count: 14 }, { label: "Not for this villa", count: 5 }], refused: 19, notUsed: 4 });
  });

  it("shows the counts, the not-used line and where it happened", async () => {
    await render(createElement(CouponRefusalsCard, {
      summary: summary(
        [{ problem: "sold_out", count: 31 }, { problem: "stay_outside_dates", count: 3 }, { problem: "coupon_worse", count: 9 }],
        [{ surface: "booking", count: 30 }, { surface: "pos", count: 4 }],
      ),
    }));
    expect(text()).toContain("Refused, last 30 days");
    expect(text()).toContain("Refused34");
    const rows = [...document.querySelectorAll('ul[aria-label="Refusals by reason"] li')].map((li) => li.textContent);
    expect(rows).toEqual(["Sold out31", "Stay outside the dates3"]);
    expect(text()).toContain("Not used: the direct offer was better");
    expect(rows.join()).not.toContain("direct offer");
    expect(text()).toContain("Booking site30");
    expect(text()).toContain("Staff booking0");
    expect(text()).toContain("Checkout4");
    expect(text()).toContain("Counted when a guest or staff member saw the refusal. Diagnostic only.");
  });

  it("has an empty state", async () => {
    await render(createElement(CouponRefusalsCard, { summary: summary([]) }));
    expect(text()).toContain("No refusals in the last 30 days.");
    expect(text()).not.toContain("Where it happened");
    expect(text()).not.toContain("Not used");
  });
});

describe("spend slot in the campaign sheet", () => {
  const campaign = {
    _id: c1, _creationTime: 0, name: "November escape", source: "facebook", medium: "social", status: "active", budget: 60000,
    createdAt: 0, updatedAt: 0, updatedByEmail: "a@example.com", linkCount: 0, couponCount: 0, opens: 0, countsCapped: false,
  } as CampaignRow;

  it("renders for a saved campaign only", async () => {
    const spend = vi.fn((row: CampaignRow) => createElement("p", { "data-testid": "spend" }, `Spend of ${row.name}`));
    await render(createElement(CampaignsView, {
      campaigns: [campaign], links: [], coupons: [], today: "2026-11-08", linksHref: "/l", couponHref: (id) => `/c/${id}`,
      actions: { saveCampaign: vi.fn(), setCampaignStatus: vi.fn() }, spend,
    }));
    await click(button("New campaign"));
    expect(document.querySelector('[data-testid="spend"]')).toBeNull();
    await click(button("Cancel"));
    await click([...document.querySelectorAll("button")].find((el) => el.textContent === "November escape"));
    expect(document.querySelector('[data-testid="spend"]')?.textContent).toBe("Spend of November escape");
  });
});
