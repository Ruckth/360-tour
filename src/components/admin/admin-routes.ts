import { BedDouble, Building2, CalendarClock, HelpCircle, Mail, Megaphone, MessageCircle, Settings, ShoppingBag, type LucideIcon } from "lucide-react";

/** `keywords` are extra words the sidebar search matches, e.g. the channels a page covers. */
export type AdminNavLink = { href: string; label: string; keywords?: readonly string[] };
/** `shortLabel` names the section where space is tight: the iPad rail and the phone tab bar. */
export type AdminNavItem = AdminNavLink & { icon: LucideIcon; shortLabel?: string; children?: readonly AdminNavLink[] };

export const ADMIN_STAFF_TABS = ["calendar", "roster", "staff", "services"] as const;
export type AdminStaffTab = (typeof ADMIN_STAFF_TABS)[number];

export const ADMIN_STAFF_TAB_LABELS: Record<AdminStaffTab, string> = {
  calendar: "Calendar",
  roster: "Roster",
  staff: "Staff",
  services: "Services",
};

const STAFF_TAB_KEYWORDS: Record<AdminStaffTab, readonly string[]> = {
  calendar: ["appointments", "bookings"],
  roster: ["shifts", "schedule", "time off"],
  staff: ["people", "team", "therapists"],
  services: ["treatments", "activities"],
};

/** Settings tabs; the first is the page's default and has no `?tab=`. */
export const ADMIN_SETTINGS_TABS = [
  { id: "business", label: "Business", keywords: ["profile", "contact"] },
  { id: "bookingRules", label: "Booking rules", keywords: ["holds", "minimum nights", "cutoff"] },
  { id: "ai", label: "AI assistant", keywords: ["model", "concierge"] },
  { id: "email", label: "Email", keywords: ["notifications"] },
  { id: "channels", label: "Channels", keywords: ["LINE", "Facebook", "Messenger", "Instagram", "WhatsApp"] },
  { id: "admins", label: "Admins", keywords: ["team", "access", "users"] },
] as const;
export type AdminSettingsTab = (typeof ADMIN_SETTINGS_TABS)[number]["id"];

export function adminSettingsTabPath(tab: AdminSettingsTab): string {
  return tab === "business" ? "/admin/settings" : `/admin/settings?tab=${tab}`;
}

/** Marketing sub-pages, in sidebar order. `/admin/marketing` opens the dashboard. */
export const ADMIN_MARKETING_PAGES = [
  { id: "dashboard", label: "Dashboard", keywords: ["report", "ROAS", "conversion", "attribution", "spend", "export"] },
  { id: "campaigns", label: "Campaigns", keywords: ["utm", "source", "medium", "budget"] },
  { id: "links", label: "Links & QR", keywords: ["short links", "QR code", "tracking"] },
  { id: "coupons", label: "Coupons", keywords: ["discount", "promo code", "offers"] },
  { id: "affiliates", label: "Affiliates", keywords: ["partners", "referrals", "credits"] },
  { id: "access", label: "Access", keywords: ["permissions", "roles", "invitations"] },
] as const;
export type AdminMarketingPage = (typeof ADMIN_MARKETING_PAGES)[number]["id"];
const ADMIN_MARKETING_DEFAULT: AdminMarketingPage = "dashboard";

export function isAdminMarketingPage(value: string): value is AdminMarketingPage {
  return ADMIN_MARKETING_PAGES.some((page) => page.id === value);
}

export function adminMarketingPath(page: AdminMarketingPage): string {
  return `/admin/marketing/${page}`;
}

/** Sidebar sections, in order. Add a page under `src/app/admin/<section>` and list it here. */
export const ADMIN_NAV: readonly AdminNavItem[] = [
  { href: "/admin/chats", label: "Chats", icon: MessageCircle, keywords: ["inbox", "messages", "conversations"] },
  { href: "/admin/hotel", label: "Hotel bookings", shortLabel: "Hotel", icon: BedDouble, keywords: ["reservations", "rooms"] },
  {
    href: "/admin/staff/calendar",
    label: "Staff bookings",
    shortLabel: "Spa",
    icon: CalendarClock,
    children: ADMIN_STAFF_TABS.map((tab) => ({
      href: adminStaffTabPath(tab),
      label: ADMIN_STAFF_TAB_LABELS[tab],
      keywords: STAFF_TAB_KEYWORDS[tab],
    })),
  },
  { href: "/admin/checkout", label: "Checkout", icon: ShoppingBag, keywords: ["POS", "pay", "orders", "receipt"] },
  { href: "/admin/questions", label: "Business facts", shortLabel: "Facts", icon: HelpCircle, keywords: ["questions", "answers", "FAQ"] },
  { href: "/admin/properties", label: "Properties", icon: Building2, keywords: ["villas"] },
  { href: "/admin/leads", label: "Leads", icon: Mail },
  {
    href: adminMarketingPath(ADMIN_MARKETING_DEFAULT),
    label: "Marketing",
    icon: Megaphone,
    children: ADMIN_MARKETING_PAGES.filter(({ id }) => id !== "access").map(({ id, label, keywords }) => ({ href: adminMarketingPath(id), label, keywords })),
  },
  {
    href: "/admin/settings",
    label: "Settings",
    icon: Settings,
    children: ADMIN_SETTINGS_TABS.map(({ id, label, keywords }) => ({ href: adminSettingsTabPath(id), label, keywords })),
  },
];

/** The sections on the phone tab bar, besides Search and Menu: the ones staff use all day. */
export const ADMIN_TAB_BAR: readonly AdminNavItem[] = ["/admin/chats", "/admin/hotel", "/admin/staff/calendar"].map(
  (href) => ADMIN_NAV.find((item) => item.href === href)!,
);

/** "/admin/staff/services" -> "/admin/staff": the part of a path that picks the sidebar section. */
function adminSection(pathname: string) {
  return pathname.split("/").slice(0, 3).join("/");
}

export function adminNavItem(pathname: string): AdminNavItem | undefined {
  // Receipts belong to checkout.
  const section = adminSection(pathname.replace(/^\/admin\/receipt(?=\/|$)/, "/admin/checkout"));
  return ADMIN_NAV.find((item) => adminSection(item.href) === section);
}

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
  if (section === "receipt") return subpage ? null : ADMIN_HOME;
  if (section === "staff") {
    if (!subpage) return adminStaffTabPath("calendar");
    return isAdminStaffTab(subpage) ? null : ADMIN_HOME;
  }
  if (section === "marketing") {
    if (!subpage) return adminMarketingPath(ADMIN_MARKETING_DEFAULT);
    return isAdminMarketingPage(subpage) ? null : ADMIN_HOME;
  }
  return adminNavItem(pathname) ? null : ADMIN_HOME;
}

function navLinkMatches(link: AdminNavLink, query: string) {
  return [link.label, ...(link.keywords ?? [])].some((word) => word.toLowerCase().includes(query));
}

/**
 * Sidebar search: sections whose label or keywords match, with only their matching sub-pages.
 * A section matched just by a sub-page keeps that sub-page so it can be reached.
 */
export function searchAdminNav(query: string, nav: readonly AdminNavItem[] = ADMIN_NAV): AdminNavItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...nav];
  return nav.flatMap((item): AdminNavItem[] => {
    const children = item.children?.filter((child) => navLinkMatches(child, q)) ?? [];
    if (children.length) return [{ ...item, children }];
    return navLinkMatches(item, q) ? [{ ...item, children: undefined }] : [];
  });
}

/** The sub-page link for this URL: an exact path and `?tab` match, else the section's link without a tab, else the page it's nested under. */
export function activeAdminSubLink(item: AdminNavItem, pathname: string, tab: string | null): string | undefined {
  const links = item.children ?? [];
  const parts = (href: string) => {
    const url = new URL(href, "http://admin.local");
    return { path: url.pathname, tab: url.searchParams.get("tab") };
  };
  return (
    links.find((link) => parts(link.href).path === pathname && parts(link.href).tab === tab) ??
    links.find((link) => parts(link.href).path === pathname && parts(link.href).tab === null) ??
    // A detail page such as /admin/marketing/coupons/<id> keeps its list page highlighted.
    links.find((link) => pathname.startsWith(`${parts(link.href).path}/`))
  )?.href;
}
