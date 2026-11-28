import { RESORT_BRANCH_KEY } from "convex/shared/resortBranch";
import type { api } from "convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { ADMIN_NAV, ADMIN_TAB_BAR, adminNavItem, adminSettingsTab, isOwnerOnlySettingsTab, type AdminNavItem } from "./admin-routes";

/** auth/staffAccess.myAccess: the signed-in person's role, capabilities and the cashier rules. */
export type StaffAccessView = FunctionReturnType<typeof api.auth.staffAccess.myAccess>;
export type StaffCapabilities = StaffAccessView["capabilities"];
type Access = Pick<StaffAccessView, "role" | "capabilities">;
type AccessWithBranches = Access & Pick<StaffAccessView, "branches">;

/** Match the server's legacy resort record access for Chats and Hotel. */
export function canOpenResortDesk(
  access: Pick<StaffAccessView, "capabilities" | "branches" | "companyScope">,
  capability: "chats" | "bookings",
) {
  return access.capabilities[capability] && (access.companyScope ||
    access.branches.some(branch => branch.key === RESORT_BRANCH_KEY && branch.state !== "archived"));
}

export const CASHIER_HOME = "/admin/checkout";

/**
 * Only owners see everything. Managers and cashiers get their role's sections; a signed-in person
 * without a role gets only what their capabilities open (Marketing for a marketing-only grant),
 * never the owner's navigation. Without access data (isolated fixtures) the admin reads as an owner.
 */
function restricted(access: Access | null | undefined): access is Access {
  return access != null && access.role !== "owner";
}

/** Whether these capabilities open a page: its section's area, and Settings › Team for owners only. */
export function adminPageAllowed(pathname: string, tab: string | null, caps: StaffCapabilities): boolean {
  const section = adminNavItem(pathname)?.href;
  // Unknown paths are redirected by the proxy before they render.
  if (!section) return true;
  if (section === "/admin/checkout") return caps.checkout;
  if (section === "/admin/chats") return caps.chats;
  if (section === "/admin/hotel") return caps.bookings;
  if (section === "/admin/stock/balances") return caps.operations || caps.stock === true;
  if (section.startsWith("/admin/marketing")) return caps.marketing;
  if (section === "/admin/settings") return caps.operations && (!isOwnerOnlySettingsTab(adminSettingsTab(tab)) || caps.manageTeam);
  return caps.operations;
}

function linkAllowed(href: string, caps: StaffCapabilities) {
  const url = new URL(href, "http://admin.local");
  return adminPageAllowed(url.pathname, url.searchParams.get("tab"), caps);
}

/** The sidebar for this person, including any Stock or Marketing access granted to cashiers. */
export function adminNavFor(access: (Access & Partial<Pick<StaffAccessView, "branches" | "companyScope">>) | null | undefined, nav: readonly AdminNavItem[] = ADMIN_NAV): AdminNavItem[] {
  if (!restricted(access)) return [...nav];
  return nav.flatMap((item) => {
    if (!linkAllowed(item.href, access.capabilities)) return [];
    if (access.branches && access.companyScope !== undefined) {
      const desk = { ...access, branches: access.branches, companyScope: access.companyScope };
      if (item.href === "/admin/chats" && !canOpenResortDesk(desk, "chats")) return [];
      if (item.href === "/admin/hotel" && !canOpenResortDesk(desk, "bookings")) return [];
    }
    return [item.children ? { ...item, children: item.children.filter((child) => linkAllowed(child.href, access.capabilities)) } : item];
  });
}

/**
 * Whether this person gets the till alone: no navigation, Sign out in the header. That is a
 * cashier whose only section is Checkout. A cashier with Stock or Marketing access keeps navigation.
 */
export function adminTillOnly(access: Access | null | undefined): boolean {
  if (access?.role !== "cashier") return false;
  return adminNavFor(access).every((item) => item.href === CASHIER_HOME);
}

/** The phone tab bar's sections, besides Menu: the daily ones this person has, else their first sections. */
export function adminTabBarFor(nav: readonly AdminNavItem[]): AdminNavItem[] {
  const daily = ADMIN_TAB_BAR.filter((item) => nav.some((allowed) => allowed.href === item.href));
  return daily.length ? daily : nav.slice(0, 3);
}

/**
 * Whether this signed-in person has no admin at all: no section opens for them (no role and no
 * Marketing grant), or a desk role with no branch left. The shell shows "No access" instead.
 */
export function adminNoAccess(access: AccessWithBranches): boolean {
  if (access.role === "owner") return false;
  if (access.role !== null && access.branches.length === 0) return true;
  return adminNavFor(access).length === 0;
}

/**
 * Where to send someone from a page their role doesn't open, or null to render it. Cashiers go to
 * checkout, which is also where `/admin` lands for them (the proxy sends it to Chats first). A
 * manager on Settings › Team goes to Settings. A manager without Marketing access stays, so the
 * Marketing gate can say why. A marketing-only person goes to Marketing.
 */
export function adminAccessRedirect(pathname: string, tab: string | null, access: Access | null | undefined): string | null {
  if (!restricted(access) || adminPageAllowed(pathname, tab, access.capabilities)) return null;
  if (access.role === "cashier") return CASHIER_HOME;
  if (access.role === null) return adminNavFor(access)[0]?.href ?? null;
  return adminNavItem(pathname)?.href === "/admin/settings" ? "/admin/settings" : null;
}
