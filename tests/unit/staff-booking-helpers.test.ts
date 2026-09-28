import { describe, expect, it } from "vitest";
import { isInAppNavigation } from "@/lib/react/use-unsaved-changes";
import { DAY_MS, pickSlot, timeOffRange, timeOffRangeProblem } from "@/lib/staff-bookings";

describe("pickSlot", () => {
  const slots = [{ start: 900 }, { start: 600 }, { start: 1200 }];

  it("keeps the wanted time when it's open", () => {
    expect(pickSlot(slots, 900)).toEqual({ start: 900 });
  });

  it("picks the next open time after the wanted one, not the earliest", () => {
    expect(pickSlot(slots, 1000)).toEqual({ start: 1200 });
    expect(pickSlot(slots, 700)).toEqual({ start: 900 });
  });

  it("falls back to the first open time", () => {
    expect(pickSlot(slots, 1300)).toEqual({ start: 600 });
    expect(pickSlot(slots, null)).toEqual({ start: 600 });
    expect(pickSlot([], 600)).toBeUndefined();
    expect(pickSlot(undefined, 600)).toBeUndefined();
  });
});

describe("timeOffRangeProblem", () => {
  it("accepts a normal range", () => {
    expect(timeOffRangeProblem(timeOffRange({ from: "2026-09-28", to: "2026-09-30", startTime: "", endTime: "" }))).toBeNull();
  });

  it("rejects ranges the server would reject", () => {
    expect(timeOffRangeProblem(timeOffRange({ from: "2026-09-28", to: "", startTime: "12:00", endTime: "09:00" }))).toMatch(/end after/);
    expect(timeOffRangeProblem(timeOffRange({ from: "2026-09-28", to: "2026-12-31", startTime: "", endTime: "" }))).toMatch(/60 days/);
    expect(timeOffRangeProblem(timeOffRange({ from: "not-a-date", to: "", startTime: "", endTime: "" }))).toMatch(/valid/);
    expect(timeOffRangeProblem({ start: 0, end: 60 * DAY_MS })).toBeNull();
  });
});

describe("isInAppNavigation", () => {
  const location = { href: "https://villa.test/admin/staff/services", origin: "https://villa.test", pathname: "/admin/staff/services", search: "" } as Location;
  const click = (init: Partial<MouseEvent> = {}) => ({ defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...init }) as MouseEvent;
  const link = (href: string, attrs: { target?: string; download?: boolean } = {}) =>
    ({ href, target: attrs.target ?? "", hasAttribute: (name: string) => name === "download" && Boolean(attrs.download) }) as unknown as HTMLAnchorElement;

  it("guards plain clicks on links to other pages of the site", () => {
    expect(isInAppNavigation(click(), link("https://villa.test/admin/chats"), location)).toBe(true);
    expect(isInAppNavigation(click(), link("https://villa.test/admin/staff/services?x=1"), location)).toBe(true);
  });

  it("ignores new tabs, downloads, other sites and same-page links", () => {
    expect(isInAppNavigation(click({ metaKey: true }), link("https://villa.test/admin/chats"), location)).toBe(false);
    expect(isInAppNavigation(click(), link("https://villa.test/admin/chats", { target: "_blank" }), location)).toBe(false);
    expect(isInAppNavigation(click(), link("https://villa.test/file.pdf", { download: true }), location)).toBe(false);
    expect(isInAppNavigation(click(), link("https://example.com/"), location)).toBe(false);
    expect(isInAppNavigation(click(), link("https://villa.test/admin/staff/services#top"), location)).toBe(false);
  });
});
