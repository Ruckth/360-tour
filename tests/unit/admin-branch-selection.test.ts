import type { Id } from "convex/_generated/dataModel";
import { describe, expect, it } from "vitest";
import { BRANCH_STATE_META } from "@/components/admin/branch/branch-pills";
import { branchReadOnlyRoute, branchRouteScope, branchStorageKeys, branchSwitchHref, resolveWorkingBranch } from "@/components/admin/branch/branch-selection";

const branch = (id: string) => ({ id: id as Id<"branches"> });
const samui = branch("samui");
const phuket = branch("phuket");
const both = [samui, phuket];

describe("working branch selection", () => {
  it("has no branch without assignments", () => {
    expect(resolveWorkingBranch([], { session: "samui", device: "samui" })).toEqual({ kind: "none" });
  });

  it("selects the only branch without asking", () => {
    expect(resolveWorkingBranch([samui], {})).toEqual({ kind: "selected", id: "samui" });
  });

  it("asks a first-time person with two branches to choose", () => {
    expect(resolveWorkingBranch(both, {})).toEqual({ kind: "choose" });
  });

  it("prefers this tab, then the last branch on this device", () => {
    expect(resolveWorkingBranch(both, { session: "phuket", device: "samui" })).toEqual({ kind: "selected", id: "phuket" });
    expect(resolveWorkingBranch(both, { device: "phuket" })).toEqual({ kind: "selected", id: "phuket" });
  });

  it("never lets a stored choice grant access", () => {
    expect(resolveWorkingBranch(both, { session: "chiang-mai", device: "krabi" })).toEqual({ kind: "choose" });
    expect(resolveWorkingBranch([samui], { session: "phuket", device: "phuket" })).toEqual({ kind: "selected", id: "samui" });
  });

  it("keeps the branch this tab is working in", () => {
    expect(resolveWorkingBranch(both, { current: "phuket", session: "samui", device: "samui" })).toEqual({ kind: "selected", id: "phuket" });
  });

  it("moves to a remaining branch and names the lost one when access is removed mid-session", () => {
    expect(resolveWorkingBranch([samui], { current: "phuket", device: "phuket" })).toEqual({ kind: "selected", id: "samui", revokedId: "phuket" });
    // The device's last branch wins when it is still assigned.
    const krabi = branch("krabi");
    expect(resolveWorkingBranch([samui, krabi], { current: "phuket", device: "krabi" })).toEqual({ kind: "selected", id: "krabi", revokedId: "phuket" });
    expect(resolveWorkingBranch([samui, krabi], { current: "phuket" })).toEqual({ kind: "selected", id: "samui", revokedId: "phuket" });
  });

  it("makes checkout and receipts read-only, and nothing else", () => {
    for (const path of ["/admin/checkout", "/admin/checkout/preview", "/admin/receipt", "/admin/receipt/order123"]) expect(branchReadOnlyRoute(path), path).toBe(true);
    for (const path of ["/admin/chats", "/admin/hotel", "/admin/checkouts", "/admin/settings"]) expect(branchReadOnlyRoute(path), path).toBe(false);
  });

  it("keeps each person's choice apart on a shared device", () => {
    expect(branchStorageKeys("niran@example.com")).toEqual({ session: "admin:branch:niran@example.com", device: "admin:last-branch:niran@example.com" });
    expect(branchStorageKeys(null).session).not.toBe(branchStorageKeys("niran@example.com").session);
  });

  it("labels every state from one map: Active success, Setup warning, Suspended danger, Archived muted", () => {
    expect(BRANCH_STATE_META).toEqual({
      active: { tone: "success", label: "Active" },
      setup: { tone: "warning", label: "Setup · hidden from guests" },
      suspended: { tone: "danger", label: "Suspended · no new sales" },
      archived: { tone: "muted", label: "Archived · read only" },
    });
  });

  it("scopes Settings and Marketing to the company, and every other route to the branch", () => {
    for (const path of ["/admin/settings", "/admin/marketing", "/admin/marketing/dashboard"]) expect(branchRouteScope(path), path).toBe("company");
    for (const path of ["/admin/chats", "/admin/hotel", "/admin/checkout", "/admin/settingsx"]) expect(branchRouteScope(path), path).toBe("branch");
  });

  it("drops the old branch's URL state on a switch, keeping only the tab", () => {
    expect(branchSwitchHref("/admin/chats", new URLSearchParams("session=s1&q=maya&state=open"))).toBe("/admin/chats");
    expect(branchSwitchHref("/admin/staff-bookings", new URLSearchParams("tab=list&booking=b1"))).toBe("/admin/staff-bookings?tab=list");
    expect(branchSwitchHref("/admin/hotel", new URLSearchParams(""))).toBeNull();
    expect(branchSwitchHref("/admin/properties/villa-1", new URLSearchParams())).toBe("/admin/properties");
    expect(branchSwitchHref("/admin/settings", new URLSearchParams("tab=team&draft=1"))).toBeNull();
    expect(branchSwitchHref("/admin/marketing/coupons/coupon-1", new URLSearchParams("draft=1"))).toBeNull();
    expect(branchSwitchHref("/admin/checkout", new URLSearchParams("order=o1"))).toBeNull();
    expect(branchSwitchHref("/admin/receipt/o1", new URLSearchParams("print=1"))).toBeNull();
  });
});
