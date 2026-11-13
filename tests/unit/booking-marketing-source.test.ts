// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "convex/_generated/dataModel";
import type { MarketingAttribution, MarketingTouch } from 'convex/shared/marketingAttribution';
import { BookingMarketingSource } from "@/components/admin/BookingMarketingSource";

const touch = (slug: string, patch: Partial<MarketingTouch> = {}): MarketingTouch => ({
  linkId: `link-${slug}` as Id<"marketingLinks">,
  slug,
  campaignId: "c1" as Id<"marketingCampaigns">,
  campaignName: "November escape",
  source: "facebook",
  medium: "paid_social",
  entry: "link",
  ...patch,
});
const touchedAt = new Date(2026, 10, 7, 14, 5).getTime();
const tracked = (patch: Partial<MarketingAttribution> = {}): MarketingAttribution => ({
  model: "last_touch_30d@1",
  evidence: "tracked",
  sessionId: "s2" as Id<"marketingSessions">,
  last: touch("f1", { placement: "Beach flyer", sessionId: "s2" as Id<"marketingSessions">, touchedAt }),
  first: touch("f1", { placement: "Beach flyer", sessionId: "s2" as Id<"marketingSessions">, touchedAt }),
  capturedAt: touchedAt + 1000,
  ...patch,
});

let root: Root;
const render = (attribution: MarketingAttribution | null) => act(async () => root.render(createElement(BookingMarketingSource, { attribution })));
const lines = () => [...document.querySelectorAll('[data-testid="booking-marketing-source"] > span')].map((el) => el.textContent);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("booking sheet source row", () => {
  it("shows a tracked visit with its link, campaign, placement and date", async () => {
    await render(tracked());
    expect(lines()).toEqual(["/f1 · facebook / paid_social", "November escape · Beach flyer", "7 Nov 2026, 14:05 · Tracked visit"]);
  });

  it("labels a link seen only in this visit, without a date", async () => {
    await render({ model: "last_touch_30d@1", evidence: "current_link", last: touch("q1", { medium: "qr", entry: "qr" }), capturedAt: touchedAt });
    expect(lines()).toEqual(["/q1 · facebook / qr", "November escape", "Link from this visit only (measurement wasn’t on)"]);
  });

  it("names the first link when it differs from the last", async () => {
    await render(tracked({ first: touch("q1", { touchedAt: touchedAt - 86_400_000 }) }));
    expect(lines()).toContain("First seen via /q1");
  });

  it("says so when a tracked visit had no link in the window", async () => {
    await render(tracked({ last: undefined, first: undefined }));
    expect(lines()).toEqual(["No link in the last 30 days"]);
  });

  it("renders nothing without a snapshot", async () => {
    await render(null);
    expect(document.body.textContent).toBe("");
  });
});
