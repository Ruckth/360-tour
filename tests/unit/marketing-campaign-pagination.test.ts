// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { Id } from "convex/_generated/dataModel";
import { CAMPAIGN_PAGE_SIZE } from "convex/shared/marketingTypes";
import { expect, it, vi } from "vitest";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { MarketingCampaignsScreen } from "@/components/admin/marketing/MarketingScreens";
import type { CampaignRow } from "@/components/admin/marketing/types";

const mocks = vi.hoisted(() => ({ useQuery: vi.fn(), mutation: vi.fn(), client: {} }));
vi.mock("convex/react", async (importOriginal) => ({
  ...await importOriginal<typeof import("convex/react")>(),
  useQuery: mocks.useQuery,
  useConvex: () => mocks.client,
  useMutation: () => mocks.mutation,
}));

it("pages campaign metrics while searching and counting every campaign in the directory", async () => {
  const rows: CampaignRow[] = Array.from({ length: CAMPAIGN_PAGE_SIZE * 2 + 2 }, (_, index) => ({
    _id: `campaign-${index}` as Id<"marketingCampaigns">,
    _creationTime: index,
    name: `Campaign ${index}`,
    source: "Meta",
    medium: "Social",
    status: index === CAMPAIGN_PAGE_SIZE * 2 + 1 ? "archived" : "active",
    notes: index >= CAMPAIGN_PAGE_SIZE * 2 ? "Patio offer" : "",
    linkCount: 2,
    couponCount: 1,
    opens: 4,
    countsCapped: false,
    createdAt: index,
    updatedAt: index,
    updatedByEmail: "owner@example.com",
  }));
  const options = rows.map(({ _id, name, status, source, medium, notes }) => ({
    _id, name, status, searchText: [name, source, medium, notes].join(" ").toLowerCase(),
  }));
  const rowRequests = vi.fn((ids: Id<"marketingCampaigns">[]) =>
    ids.map((id) => rows.find((row) => row._id === id)),
  );
  const previewRequests = vi.fn<(name: string, campaignId?: Id<"marketingCampaigns">) => unknown[]>(() => []);
  mocks.useQuery.mockImplementation((ref: FunctionReference<"query">, args: { campaignIds?: Id<"marketingCampaigns">[]; campaignId?: Id<"marketingCampaigns"> } | "skip") => {
    if (args === "skip") return undefined;
    const name = getFunctionName(ref);
    switch (name) {
      case "marketing/queries:listCampaignOptions": return options;
      case "marketing/queries:listCampaignRows": return rowRequests(args.campaignIds ?? []);
      case "marketing/queries:listLinks":
      case "marketing/queries:listCoupons": return previewRequests(name, args.campaignId);
      case "marketing/report:listSpend": return [];
      default: throw new Error(`Unexpected campaign list subscription to ${name}`);
    }
  });

  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  const button = (text: string) => [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === text);
  const click = (element: HTMLButtonElement | undefined) => act(async () => element?.click());
  try {
    await act(async () => root.render(createElement(ConfirmProvider, null, createElement(MarketingCampaignsScreen))));
    expect(rowRequests).toHaveBeenLastCalledWith(rows.slice(0, CAMPAIGN_PAGE_SIZE).map((row) => row._id));
    expect(container.textContent).toContain("Page 1 of 3");
    expect(button("Previous")?.disabled).toBe(true);
    const active = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((tab) => tab.textContent?.startsWith("Active"));
    expect(active?.textContent).toContain(String(CAMPAIGN_PAGE_SIZE * 2 + 1));

    await click(button("Next"));
    expect(rowRequests).toHaveBeenLastCalledWith(rows.slice(CAMPAIGN_PAGE_SIZE, CAMPAIGN_PAGE_SIZE * 2).map((row) => row._id));

    const search = container.querySelector<HTMLInputElement>('input[aria-label="Search campaigns"]');
    expect(search).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(search, "  PaTio OfF ");
      search?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(rowRequests).toHaveBeenLastCalledWith([rows[CAMPAIGN_PAGE_SIZE * 2]._id]);
    expect(button("Next")).toBeUndefined();
    const archived = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((tab) => tab.textContent?.startsWith("Archived"));
    await click(archived);
    const last = rows[CAMPAIGN_PAGE_SIZE * 2 + 1];
    expect(rowRequests).toHaveBeenLastCalledWith([last._id]);
    expect(previewRequests).not.toHaveBeenCalled();
    await click(button(last.name));
    expect(previewRequests).toHaveBeenCalledWith("marketing/queries:listLinks", last._id);
    expect(previewRequests).toHaveBeenCalledWith("marketing/queries:listCoupons", last._id);
    expect(previewRequests.mock.calls.every(([, id]) => id === last._id)).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    mocks.useQuery.mockReset();
  }
});
