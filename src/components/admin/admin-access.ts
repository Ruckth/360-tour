import type { api } from "convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { ADMIN_NAV, ADMIN_TAB_BAR, adminNavItem, adminSettingsTab, type AdminNavItem } from "./admin-routes";

/** staffAccess.myAccess: the signed-in person's role, capabilities and the cashier rules. */
export type StaffAccessView = FunctionReturnType<typeof api.staffAccess.myAccess>;
export type StaffCapabilities = StaffAccessView["capabilities"];
type Access = Pick<StaffAccessView, "role" | "capabilities">;

export const CASHIER_HOME = "/admin/checkout";

/**
 * Only a staff grant narrows the admin. Owners, and signed-in people without a role (who get the
 * server's "Not authorized" as before), see the same navigation as before staff roles existed.
 */
function restricted(access: Access | null | undefined): access is Access {
  return access?.role === "manager" || access?.role === "cashier";
}

/** Whether these capabilities open a page: its section's area, and Settings › Team for owners only. */
export function adminPageAllowed(pathname: string, tab: string | null, caps: StaffCapabilities): boolean {
  const section = adminNavItem(pathname)?.href;
  // Unknown paths are redirected by the proxy before they render.
  if (!section) return true;
  if (section === "/admin/checkout") return caps.checkout;
  if (section.startsWith("/admin/marketing")) return caps.marketing;
  if (section === "/admin/settings") return caps.operations && (adminSettingsTab(tab) !== "team" || caps.manageTeam);
  return caps.operations;
}

function linkAllowed(href: string, caps: StaffCapabilities) {
  const url = new URL(href, "http://admin.local");
  return adminPageAllowed(url.pathname, url.searchParams.get("tab"), caps);
}

/** The sidebar for this person: a cashier gets Checkout; a manager everything but owner-only pages. */
export function adminNavFor(access: Access | null | undefined, nav: readonly AdminNavItem[] = ADMIN_NAV): AdminNavItem[] {
  if (!restricted(access)) return [...nav];
  return nav.flatMap((item) => {
    if (!linkAllowed(item.href, access.capabilities)) return [];
    return [item.children ? { ...item, children: item.children.filter((child) => linkAllowed(child.href, access.capabilities)) } : item];
  });
}

/** The phone tab bar's sections: the daily ones this person has, else their first sections. */
export function adminTabBarFor(nav: readonly AdminNavItem[]): AdminNavItem[] {
  const daily = ADMIN_TAB_BAR.filter((item) => nav.some((allowed) => allowed.href === item.href));
  return daily.length ? daily : nav.slice(0, 3);
}

/**
 * Where to send someone from a page their role doesn't open, or null to render it. Cashiers go to
 * checkout; a manager on Settings › Team goes to Settings. A manager without Marketing access
 * stays, so the Marketing gate can say why.
 */
export function adminAccessRedirect(pathname: string, tab: string | null, access: Access | null | undefined): string | null {
  if (!restricted(access) || adminPageAllowed(pathname, tab, access.capabilities)) return null;
  if (access.role === "cashier") return CASHIER_HOME;
  return adminNavItem(pathname)?.href === "/admin/settings" ? "/admin/settings" : null;
}
