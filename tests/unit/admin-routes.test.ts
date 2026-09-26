import { describe, expect, it } from "vitest";
import { adminRoute, adminStaffTabPath, adminViewPath } from "@/components/admin/admin-routes";

describe("admin routes", () => {
  it.each([
    ["/admin/chats", "chats", "calendar"],
    ["/admin/hotel", "hotel", "calendar"],
    ["/admin/staff/calendar", "staff", "calendar"],
    ["/admin/staff/staff", "staff", "staff"],
    ["/admin/staff/services", "staff", "services"],
    ["/admin/questions", "questions", "calendar"],
    ["/admin/properties", "properties", "calendar"],
    ["/admin/leads", "leads", "calendar"],
  ] as const)("maps %s to %s", (path, view, staffTab) => {
    expect(adminRoute(path)).toEqual({ view, staffTab });
  });

  it.each(["/admin", "/admin/chat", "/admin/staff", "/admin/other", "/admin/staff/other"])(
    "rejects %s",
    (path) => expect(adminRoute(path)).toBeNull(),
  );

  it("builds module and staff tab paths", () => {
    expect(adminViewPath("chats")).toBe("/admin/chats");
    expect(adminViewPath("hotel")).toBe("/admin/hotel");
    expect(adminViewPath("staff")).toBe("/admin/staff/calendar");
    expect(adminViewPath("questions")).toBe("/admin/questions");
    expect(adminViewPath("properties")).toBe("/admin/properties");
    expect(adminViewPath("leads")).toBe("/admin/leads");
    expect(adminStaffTabPath("calendar")).toBe("/admin/staff/calendar");
    expect(adminStaffTabPath("staff")).toBe("/admin/staff/staff");
    expect(adminStaffTabPath("services")).toBe("/admin/staff/services");
  });
});
