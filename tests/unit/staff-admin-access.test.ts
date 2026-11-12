import { describe, expect, it } from "vitest";
import { adminAccessRedirect, adminNavFor, adminPageAllowed, adminTabBarFor } from "@/components/admin/admin-access";
import { ADMIN_NAV, activeAdminSubLink, adminNavItem, adminSettingsTab, searchAdminNav } from "@/components/admin/admin-routes";
import { staffAccessFor, type ShellRole } from "./admin-shell-convex";

const nav = (role: ShellRole, patch: Partial<ReturnType<typeof staffAccessFor>["capabilities"]> = {}) => {
  const access = staffAccessFor(role);
  return adminNavFor({ ...access, capabilities: { ...access.capabilities, ...patch } });
};
const hrefs = (items: ReturnType<typeof nav>) => items.map((item) => item.href);
const settingsLinks = (items: ReturnType<typeof nav>) => items.find((item) => item.href === "/admin/settings")?.children?.map((child) => child.label);

describe("navigation by staff role", () => {
  it("leaves the navigation as it was for owners and people without a role", () => {
    expect(nav("owner")).toEqual([...ADMIN_NAV]);
    // No role: the server answers "Not authorized" on each page, as before staff roles.
    expect(nav(null)).toEqual([...ADMIN_NAV]);
    expect(adminNavFor(undefined)).toEqual([...ADMIN_NAV]);
  });

  it("gives a cashier only Checkout, in the sidebar, its search and the phone tab bar", () => {
    const items = nav("cashier");
    expect(hrefs(items)).toEqual(["/admin/checkout"]);
    expect(searchAdminNav("settings", items)).toEqual([]);
    expect(searchAdminNav("receipt", items).map((item) => item.href)).toEqual(["/admin/checkout"]);
    expect(adminTabBarFor(items).map((item) => item.href)).toEqual(["/admin/checkout"]);
  });

  it("adds Marketing for a cashier who also has a Marketing grant", () => {
    expect(hrefs(nav("cashier", { marketing: true }))).toEqual(["/admin/checkout", "/admin/marketing/dashboard"]);
  });

  it("gives a manager every section except Team, and Marketing only with a Marketing grant", () => {
    const items = nav("manager");
    expect(hrefs(items)).toEqual(ADMIN_NAV.map((item) => item.href).filter((href) => !href.startsWith("/admin/marketing")));
    expect(settingsLinks(items)).toEqual(["Business", "Booking rules", "AI assistant", "Email", "Channels"]);
    expect(settingsLinks(nav("owner"))).toContain("Team");
    expect(searchAdminNav("cashier", items)).toEqual([]);
    expect(hrefs(nav("manager", { marketing: true }))).toContain("/admin/marketing/dashboard");
    expect(adminTabBarFor(items).map((item) => item.href)).toEqual(["/admin/chats", "/admin/hotel", "/admin/staff/calendar"]);
  });
});

describe("redirects by staff role", () => {
  const cashier = staffAccessFor("cashier");
  const manager = staffAccessFor("manager");

  it.each(["/admin/chats", "/admin/hotel", "/admin/staff/calendar", "/admin/settings", "/admin/marketing/dashboard", "/admin/properties/abc"])(
    "sends a cashier from %s to checkout",
    (path) => expect(adminAccessRedirect(path, null, cashier)).toBe("/admin/checkout"),
  );

  it("keeps a cashier on checkout and its receipts", () => {
    expect(adminAccessRedirect("/admin/checkout", null, cashier)).toBeNull();
    expect(adminAccessRedirect("/admin/receipt/abc123", null, cashier)).toBeNull();
  });

  it("sends a manager from Team, under its old and new address, to Settings", () => {
    expect(adminAccessRedirect("/admin/settings", "team", manager)).toBe("/admin/settings");
    expect(adminAccessRedirect("/admin/settings", "admins", manager)).toBe("/admin/settings");
    expect(adminAccessRedirect("/admin/settings", "email", manager)).toBeNull();
    expect(adminAccessRedirect("/admin/chats", null, manager)).toBeNull();
    // Without a Marketing grant the Marketing gate explains itself.
    expect(adminAccessRedirect("/admin/marketing/coupons", null, manager)).toBeNull();
  });

  it("never redirects owners or people without a role", () => {
    for (const role of ["owner", null] as const) {
      expect(adminAccessRedirect("/admin/settings", "team", staffAccessFor(role))).toBeNull();
      expect(adminAccessRedirect("/admin/chats", null, staffAccessFor(role))).toBeNull();
    }
  });

  it("decides each page from the capabilities alone", () => {
    expect(adminPageAllowed("/admin/settings", "team", manager.capabilities)).toBe(false);
    expect(adminPageAllowed("/admin/settings", null, manager.capabilities)).toBe(true);
    expect(adminPageAllowed("/admin/receipt/x", null, cashier.capabilities)).toBe(true);
  });
});

describe("Settings › Team address", () => {
  it("opens Team from ?tab=team and the old ?tab=admins", () => {
    expect(adminSettingsTab("team")).toBe("team");
    expect(adminSettingsTab("admins")).toBe("team");
    expect(adminSettingsTab(null)).toBe("business");
    expect(adminSettingsTab("nope")).toBe("business");
    const settings = adminNavItem("/admin/settings")!;
    expect(activeAdminSubLink(settings, "/admin/settings", "admins")).toBe("/admin/settings?tab=team");
  });
});
