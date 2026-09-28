import { BedDouble, Building2, CalendarClock, HelpCircle, Mail, MessageCircle, type LucideIcon } from "lucide-react";

export type AdminNavItem = { href: string; label: string; icon: LucideIcon };

/** Sidebar sections, in order. Add a page under `src/app/admin/<section>` and list it here. */
export const ADMIN_NAV: readonly AdminNavItem[] = [
  { href: "/admin/chats", label: "Chats", icon: MessageCircle },
  { href: "/admin/hotel", label: "Hotel bookings", icon: BedDouble },
  { href: "/admin/staff/calendar", label: "Staff bookings", icon: CalendarClock },
  { href: "/admin/questions", label: "Questions", icon: HelpCircle },
  { href: "/admin/properties", label: "Properties", icon: Building2 },
  { href: "/admin/leads", label: "Leads", icon: Mail },
];

/** "/admin/staff/services" -> "/admin/staff": the part of a path that picks the sidebar section. */
function adminSection(pathname: string) {
  return pathname.split("/").slice(0, 3).join("/");
}

export function adminNavItem(pathname: string): AdminNavItem | undefined {
  const section = adminSection(pathname);
  return ADMIN_NAV.find((item) => adminSection(item.href) === section);
}

export const ADMIN_STAFF_TABS = ["calendar", "staff", "services"] as const;
export type AdminStaffTab = (typeof ADMIN_STAFF_TABS)[number];

export function isAdminStaffTab(value: string): value is AdminStaffTab {
  return (ADMIN_STAFF_TABS as readonly string[]).includes(value);
}

export function adminStaffTabPath(tab: AdminStaffTab): string {
  return `/admin/staff/${tab}`;
}

const ADMIN_HOME = "/admin/chats";

/**
 * Used by the proxy: where to send an `/admin` URL whose section doesn't exist
 * (`/admin`, the old `/admin/chat`, typos), or null to render the page.
 */
export function adminRedirectPath(pathname: string): string | null {
  const [, , section, subpage] = pathname.split("/");
  if (section === "staff") {
    if (!subpage) return adminStaffTabPath("calendar");
    return isAdminStaffTab(subpage) ? null : ADMIN_HOME;
  }
  return adminNavItem(pathname) ? null : ADMIN_HOME;
}
