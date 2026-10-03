import { describe, expect, it } from "vitest";
import { adminNavItem, adminRedirectPath, adminStaffTabPath, isAdminStaffTab } from "@/components/admin/admin-routes";

describe("admin routes", () => {
  it.each([
    ["/admin/chats", "Chats"],
    ["/admin/hotel", "Hotel bookings"],
    ["/admin/staff/calendar", "Staff bookings"],
    ["/admin/staff/staff", "Staff bookings"],
    ["/admin/staff/services", "Staff bookings"],
    ["/admin/questions", "Business facts"],
    ["/admin/properties", "Properties"],
    ["/admin/properties/abc123", "Properties"],
    ["/admin/leads", "Leads"],
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
});
