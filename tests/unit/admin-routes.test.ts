import { describe, expect, it } from "vitest";
import {
  ADMIN_NAV,
  activeAdminSubLink,
  adminMarketingPath,
  adminNavItem,
  adminRedirectPath,
  adminStaffTabPath,
  isAdminMarketingPage,
  isAdminStaffTab,
  searchAdminNav,
} from "@/components/admin/admin-routes";

describe("admin routes", () => {
  it.each([
    ["/admin/chats", "Chats"],
    ["/admin/hotel", "Hotel bookings"],
    ["/admin/staff/calendar", "Staff bookings"],
    ["/admin/staff/staff", "Staff bookings"],
    ["/admin/staff/services", "Staff bookings"],
    ["/admin/checkout", "Checkout"],
    ["/admin/receipt/abc123", "Checkout"],
    ["/admin/questions", "Business facts"],
    ["/admin/properties", "Properties"],
    ["/admin/properties/abc123", "Properties"],
    ["/admin/leads", "Leads"],
    ["/admin/marketing/dashboard", "Marketing"],
    ["/admin/marketing/campaigns", "Marketing"],
    ["/admin/marketing/links", "Marketing"],
    ["/admin/marketing/coupons", "Marketing"],
    ["/admin/marketing/coupons/abc123", "Marketing"],
    ["/admin/settings", "Settings"],
  ] as const)("maps %s to the %s sidebar item", (path, label) => {
    expect(adminNavItem(path)?.label).toBe(label);
  });

  it.each(["/admin", "/admin/chat", "/admin/other"])("has no sidebar item for %s", (path) =>
    expect(adminNavItem(path)).toBeUndefined(),
  );

  it.each([
    ["/admin", "/admin/chats"],
    ["/admin/chat", "/admin/chats"],
    ["/admin/unknown", "/admin/chats"],
    ["/admin/staff", "/admin/staff/calendar"],
    ["/admin/staff/unknown", "/admin/chats"],
    ["/admin/chats", null],
    ["/admin/hotel", null],
    ["/admin/staff/services", null],
    ["/admin/staff/roster", null],
    ["/admin/properties", null],
    ["/admin/properties/abc123", null],
    ["/admin/checkout", null],
    ["/admin/receipt/abc123", null],
    ["/admin/receipt", "/admin/chats"],
    ["/admin/marketing", "/admin/marketing/dashboard"],
    ["/admin/marketing/", "/admin/marketing/dashboard"],
    ["/admin/marketing/unknown", "/admin/chats"],
    ["/admin/marketing/dashboard", null],
    ["/admin/marketing/campaigns", null],
    ["/admin/marketing/links", null],
    ["/admin/marketing/coupons", null],
    ["/admin/marketing/coupons/abc123", null],
  ] as const)("redirects %s to %s", (path, target) => {
    expect(adminRedirectPath(path)).toBe(target);
  });

  it("validates staff tabs and builds their paths", () => {
    expect(isAdminStaffTab("calendar")).toBe(true);
    expect(isAdminStaffTab("services")).toBe(true);
    expect(isAdminStaffTab("roster")).toBe(true);
    expect(isAdminStaffTab("other")).toBe(false);
    expect(adminStaffTabPath("calendar")).toBe("/admin/staff/calendar");
    expect(adminStaffTabPath("staff")).toBe("/admin/staff/staff");
    expect(adminStaffTabPath("services")).toBe("/admin/staff/services");
  });

  it("lists the marketing pages in order and builds their paths", () => {
    const marketing = ADMIN_NAV.find((item) => item.label === "Marketing")!;
    expect(marketing.href).toBe("/admin/marketing/dashboard");
    expect(marketing.children?.map((child) => [child.label, child.href])).toEqual([
      ["Dashboard", "/admin/marketing/dashboard"],
      ["Campaigns", "/admin/marketing/campaigns"],
      ["Links & QR", "/admin/marketing/links"],
      ["Coupons", "/admin/marketing/coupons"],
    ]);
    expect(isAdminMarketingPage("coupons")).toBe(true);
    expect(isAdminMarketingPage("dashboard")).toBe(true);
    expect(isAdminMarketingPage("reports")).toBe(false);
    expect(adminMarketingPath("campaigns")).toBe("/admin/marketing/campaigns");
  });

  describe("sidebar search", () => {
    const shown = (query: string) =>
      searchAdminNav(query).map((item) => [item.label, item.children?.map((child) => child.label) ?? []]);

    it("shows every section with its sub-pages when empty", () => {
      expect(searchAdminNav("  ")).toHaveLength(ADMIN_NAV.length);
    });

    it("finds sub-pages by label or keyword and keeps their section", () => {
      expect(shown("roster")).toEqual([["Staff bookings", ["Roster"]]]);
      expect(shown("whatsapp")).toEqual([["Settings", ["Channels"]]]);
      expect(shown("coupon")).toEqual([["Marketing", ["Coupons"]]]);
      expect(shown("qr")).toEqual([["Marketing", ["Links & QR"]]]);
      expect(shown("roas")).toEqual([["Marketing", ["Dashboard"]]]);
    });

    it("finds a section by its own name without listing unmatched sub-pages", () => {
      expect(shown("lead")).toEqual([["Leads", []]]);
      expect(shown("settings")).toEqual([["Settings", []]]);
    });

    it("returns nothing for no match", () => {
      expect(searchAdminNav("zzz")).toEqual([]);
    });
  });

  describe("active sub-page", () => {
    const staff = ADMIN_NAV.find((item) => item.label === "Staff bookings")!;
    const settings = ADMIN_NAV.find((item) => item.label === "Settings")!;
    const marketing = ADMIN_NAV.find((item) => item.label === "Marketing")!;

    it("matches the staff tab from the path", () => {
      expect(activeAdminSubLink(staff, "/admin/staff/roster", null)).toBe("/admin/staff/roster");
    });

    it("matches the settings tab from ?tab and falls back to the default tab", () => {
      expect(activeAdminSubLink(settings, "/admin/settings", "channels")).toBe("/admin/settings?tab=channels");
      expect(activeAdminSubLink(settings, "/admin/settings", null)).toBe("/admin/settings");
      expect(activeAdminSubLink(settings, "/admin/settings", "bogus")).toBe("/admin/settings");
    });

    it("keeps a list page active on its detail pages", () => {
      expect(activeAdminSubLink(marketing, "/admin/marketing/links", null)).toBe("/admin/marketing/links");
      expect(activeAdminSubLink(marketing, "/admin/marketing/dashboard", null)).toBe("/admin/marketing/dashboard");
      expect(activeAdminSubLink(marketing, "/admin/marketing/coupons/abc123", null)).toBe("/admin/marketing/coupons");
      expect(activeAdminSubLink(marketing, "/admin/marketing/couponsx", null)).toBeUndefined();
    });
  });
});
