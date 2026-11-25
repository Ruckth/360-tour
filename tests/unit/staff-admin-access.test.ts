import { describe, expect, it } from "vitest";
import { adminAccessRedirect, adminNavFor, adminNoAccess, adminPageAllowed, adminTabBarFor, adminTillOnly } from "@/components/admin/admin-access";
import { ADMIN_NAV, activeAdminSubLink, adminNavItem, adminRedirectPath, adminSettingsTab, searchAdminNav } from "@/components/admin/admin-routes";
import { staffAccessFor, type ShellRole } from "./admin-shell-convex";

const nav = (role: ShellRole, patch: Partial<ReturnType<typeof staffAccessFor>["capabilities"]> = {}) => {
  const access = staffAccessFor(role);
  return adminNavFor({ ...access, capabilities: { ...access.capabilities, ...patch } });
};
const hrefs = (items: ReturnType<typeof nav>) => items.map((item) => item.href);
const settingsLinks = (items: ReturnType<typeof nav>) => items.find((item) => item.href === "/admin/settings")?.children?.map((child) => child.label);

describe("navigation by staff role", () => {
  it("gives owners, and fixtures without access data, the whole navigation", () => {
    expect(nav("owner")).toEqual([...ADMIN_NAV]);
    expect(adminNavFor(undefined)).toEqual([...ADMIN_NAV]);
  });

  it("never gives a person without a role the owner's navigation", () => {
    expect(nav(null)).toEqual([]);
    expect(adminNoAccess(staffAccessFor(null))).toBe(true);
    // A marketing-only grant opens Marketing alone, and other pages send them there.
    const marketer = { ...staffAccessFor(null), capabilities: { ...staffAccessFor(null).capabilities, marketing: true } };
    expect(hrefs(adminNavFor(marketer))).toEqual(["/admin/marketing/dashboard"]);
    expect(adminNoAccess(marketer)).toBe(false);
    expect(adminAccessRedirect("/admin/chats", null, marketer)).toBe("/admin/marketing/dashboard");
    expect(adminAccessRedirect("/admin/marketing/coupons", null, marketer)).toBeNull();
  });

  it("refuses a desk role with no branch left, never an owner", () => {
    const branch = { id: "b1", key: "samui", name: "Koh Samui", slug: "koh-samui", state: "active" } as never;
    expect(adminNoAccess({ ...staffAccessFor("manager"), branches: [] })).toBe(true);
    expect(adminNoAccess({ ...staffAccessFor("manager"), branches: [branch] })).toBe(false);
    expect(adminNoAccess({ ...staffAccessFor("owner"), branches: [] })).toBe(false);
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
    expect(settingsLinks(items)).toEqual(["Business", "Booking rules", "Checkout rules", "AI assistant", "Email", "Channels"]);
    expect(settingsLinks(nav("owner"))).toContain("Team");
    expect(searchAdminNav("cashier", items)).toEqual([]);
    expect(hrefs(nav("manager", { marketing: true }))).toContain("/admin/marketing/dashboard");
    expect(adminTabBarFor(items).map((item) => item.href)).toEqual(["/admin/chats", "/admin/hotel", "/admin/staff/calendar", "/admin/checkout"]);
  });
});

describe("the till-only shell", () => {
  it("is for cashiers whose only section is Checkout", () => {
    expect(adminTillOnly(staffAccessFor("cashier"))).toBe(true);
    const marketing = staffAccessFor("cashier");
    expect(adminTillOnly({ ...marketing, capabilities: { ...marketing.capabilities, marketing: true } })).toBe(false);
    for (const role of ["owner", "manager", null] as const) expect(adminTillOnly(staffAccessFor(role))).toBe(false);
    expect(adminTillOnly(undefined)).toBe(false);
  });
});

describe("redirects by staff role", () => {
  const cashier = staffAccessFor("cashier");
  const manager = staffAccessFor("manager");

  it.each(["/admin/chats", "/admin/hotel", "/admin/staff/calendar", "/admin/settings", "/admin/marketing/dashboard", "/admin/properties/abc"])(
    "sends a cashier from %s to checkout",
    (path) => expect(adminAccessRedirect(path, null, cashier)).toBe("/admin/checkout"),
  );

  it("opens the till for a cashier on /admin, and keeps a manager's landing on Chats", () => {
    const landing = adminRedirectPath("/admin")!;
    expect(landing).toBe("/admin/chats");
    expect(adminAccessRedirect(landing, null, cashier)).toBe("/admin/checkout");
    expect(adminAccessRedirect(landing, null, manager)).toBeNull();
  });

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

  it("never redirects owners, nor a person without a role who has nowhere to go", () => {
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
