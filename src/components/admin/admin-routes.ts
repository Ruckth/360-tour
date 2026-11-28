import { BedDouble, Boxes, Building2, CalendarClock, HelpCircle, Mail, Megaphone, MessageCircle, Settings, ShoppingBag, type LucideIcon } from "lucide-react";

/** `keywords` are extra words the sidebar search matches, e.g. the channels a page covers. */
export type AdminNavLink = { href: string; label: string; keywords?: readonly string[] };
/** `shortLabel` names the section where space is tight: the iPad rail and the phone tab bar. */
export type AdminNavItem = AdminNavLink & { icon: LucideIcon; shortLabel?: string; children?: readonly AdminNavLink[] };

export const ADMIN_STAFF_TABS = ["calendar", "roster", "staff", "services"] as const;
export type AdminStaffTab = (typeof ADMIN_STAFF_TABS)[number];

export const ADMIN_STAFF_TAB_LABELS: Record<AdminStaffTab, string> = {
  calendar: "Calendar",
  roster: "Roster",
  // Therapist profiles (who performs services); staff logins and access live in Settings → Team.
  staff: "Therapists",
  services: "Services",
};

const STAFF_TAB_KEYWORDS: Record<AdminStaffTab, readonly string[]> = {
  calendar: ["appointments", "bookings"],
  roster: ["shifts", "schedule", "time off"],
  staff: ["staff", "people", "profiles"],
  services: ["treatments", "activities"],
};

/** Settings tabs; the first is the page's default and has no `?tab=`. */
export const ADMIN_SETTINGS_TABS = [
  { id: "business", label: "Business", keywords: ["profile", "contact"] },
  { id: "bookingRules", label: "Booking rules", keywords: ["holds", "minimum nights", "cutoff"] },
  { id: "checkoutRules", label: "Checkout rules", keywords: ["refunds", "VAT", "vouchers", "packages", "sale switches", "new payments"] },
  { id: "ai", label: "AI assistant", keywords: ["model", "concierge"] },
  { id: "email", label: "Email", keywords: ["notifications"] },
  { id: "channels", label: "Channels", keywords: ["LINE", "Facebook", "Messenger", "Instagram", "WhatsApp"] },
  { id: "team", label: "Team", keywords: ["admins", "access", "users", "roles", "cashier", "manager", "invite"] },
  { id: "branches", label: "Branches", keywords: ["locations", "setup", "suspend", "archive", "issuer"] },
] as const;
export type AdminSettingsTab = (typeof ADMIN_SETTINGS_TABS)[number]["id"];

export function isOwnerOnlySettingsTab(tab: AdminSettingsTab): boolean {
  return tab === "team" || tab === "branches";
}

export function adminSettingsTabPath(tab: AdminSettingsTab): string {
  return tab === "business" ? "/admin/settings" : `/admin/settings?tab=${tab}`;
}

/** The settings tab a `?tab=` value opens; the old `admins` links open Team. */
export function adminSettingsTab(value: string | null): AdminSettingsTab {
  const id = value === "admins" ? "team" : value;
  return ADMIN_SETTINGS_TABS.find((tab) => tab.id === id)?.id ?? "business";
}

/** Stock sub-pages, in sidebar order. `/admin/stock` opens Balances. */
export const ADMIN_STOCK_PAGES = [
  { id: "balances", label: "Balances", keywords: ["inventory", "on hand", "on order", "recount", "receive", "count", "adjust"] },
  { id: "activity", label: "Activity", keywords: ["movements", "history", "ledger", "corrections", "needs review"] },
  { id: "products", label: "Products", keywords: ["catalog", "variants", "SKU", "barcode", "archive"] },
  { id: "purchasing", label: "Purchasing", keywords: ["requests", "PR", "orders", "PO", "suppliers", "receipts", "held goods"] },
  { id: "expansion", label: "Transfers & Lots", keywords: ["transfers", "lots", "expiry", "holds", "reservations"] },
] as const;
export type AdminStockPage = (typeof ADMIN_STOCK_PAGES)[number]["id"];
const ADMIN_STOCK_DEFAULT: AdminStockPage = "balances";

export function isAdminStockPage(value: string): value is AdminStockPage {
  return ADMIN_STOCK_PAGES.some((page) => page.id === value);
}

export function adminStockPath(page: AdminStockPage): string {
  return `/admin/stock/${page}`;
}

/** Marketing sub-pages, in sidebar order. `/admin/marketing` opens the dashboard. */
export const ADMIN_MARKETING_PAGES = [
  { id: "dashboard", label: "Dashboard", keywords: ["report", "ROAS", "conversion", "attribution", "spend", "export"] },
  { id: "profitability", label: "Profitability", keywords: ["profit", "LTV", "CAC", "costs", "transactions"] },
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

/** Sidebar sections, in order. Add a route `src/start-app/routes/admin.<section>.tsx` and list it here. */
export const ADMIN_NAV: readonly AdminNavItem[] = [
  { href: "/admin/chats", label: "Chats", icon: MessageCircle, keywords: ["inbox", "messages", "conversations"] },
  { href: "/admin/hotel", label: "Hotel bookings", shortLabel: "Hotel", icon: BedDouble, keywords: ["reservations", "tourScenes"] },
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
  { href: "/admin/checkout", label: "Checkout", icon: ShoppingBag, keywords: ["POS", "pay", "orders", "receipt", "till", "bill"] },
  {
    href: adminStockPath(ADMIN_STOCK_DEFAULT),
    label: "Stock",
    icon: Boxes,
    keywords: ["inventory", "warehouse", "goods", "replenish", "purchasing"],
    children: ADMIN_STOCK_PAGES.map(({ id, label, keywords }) => ({ href: adminStockPath(id), label, keywords })),
  },
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

/** The sections on the phone tab bar, besides Menu: the ones staff use all day. Search is in Menu. */
export const ADMIN_TAB_BAR: readonly AdminNavItem[] = ["/admin/chats", "/admin/hotel", "/admin/staff/calendar", "/admin/checkout"].map(
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

/** Hotel panels a link may open directly: `/admin/hotel?panel=ota-calendars` opens OTA calendars. */
export const HOTEL_PANELS = ["ota-calendars"] as const;
export type HotelPanel = (typeof HOTEL_PANELS)[number];

export function hotelPanel(value: string | null): HotelPanel | null {
  return HOTEL_PANELS.find((panel) => panel === value) ?? null;
}

export function isAdminStaffTab(value: string): value is AdminStaffTab {
  return (ADMIN_STAFF_TABS as readonly string[]).includes(value);
}

export function adminStaffTabPath(tab: AdminStaffTab): string {
  return `/admin/staff/${tab}`;
}

const ADMIN_HOME = "/admin/chats";

/**
 * Used by the request middleware (site-redirect.server.ts): where to send an `/admin` URL whose section doesn't exist
 * (`/admin`, the old `/admin/chat`, typos), or null to render the page. An unknown Staff bookings or
 * Marketing sub-page renders (as not found) inside its own section, which offers that section's
 * permitted pages instead of dropping the person in Chats (see adminSectionRecovery).
 */
export function adminRedirectPath(pathname: string): string | null {
  const [, , section, subpage] = pathname.split("/");
  if (section === "receipt") return subpage ? null : ADMIN_HOME;
  if (section === "staff") {
    return subpage ? null : adminStaffTabPath("calendar");
  }
  if (section === "stock") {
    if (!subpage) return adminStockPath(ADMIN_STOCK_DEFAULT);
    return isAdminStockPage(subpage) ? null : ADMIN_HOME;
  }
  if (section === "marketing") {
    return subpage ? null : adminMarketingPath(ADMIN_MARKETING_DEFAULT);
  }
  return adminNavItem(pathname) ? null : ADMIN_HOME;
}

/**
 * For a not-found admin URL: the section it was meant for and the pages there this person may open
 * (pass their filtered navigation), or null when the section isn't theirs or has no sub-pages.
 */
export function adminSectionRecovery(pathname: string, nav: readonly AdminNavItem[]): { label: string; links: readonly AdminNavLink[] } | null {
  const section = adminNavItem(pathname);
  const allowed = section && nav.find((item) => item.href === section.href);
  if (!allowed?.children?.length) return null;
  return { label: allowed.label, links: allowed.children };
}

function navMatchRank(link: AdminNavLink, query: string) {
  const label = link.label.toLowerCase();
  if (label === query) return 3;
  if (label.includes(query)) return 2;
  return link.keywords?.some((word) => word.toLowerCase().includes(query)) ? 1 : 0;
}

/** Keep matching pages in their sections, with the strongest match first for Enter. */
export function searchAdminNav(query: string, nav: readonly AdminNavItem[] = ADMIN_NAV): AdminNavItem[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return [...nav];
  const byRank = (a: { rank: number }, b: { rank: number }) => b.rank - a.rank;

  return nav.map((item) => {
    // "Settings team" names both levels. "Settings" alone still points at the section.
    const prefix = item.label.toLowerCase() + " ";
    const childQuery = q.startsWith(prefix) ? q.slice(prefix.length) : q;
    const matches = (item.children ?? [])
      .map((child) => ({ child, rank: navMatchRank(child, childQuery) }))
      .filter(({ rank }) => rank > 0)
      .sort(byRank);
    return {
      item: { ...item, children: matches.length ? matches.map(({ child }) => child) : undefined },
      rank: Math.max(navMatchRank(item, q), matches[0]?.rank ?? 0),
    };
  }).filter(({ rank }) => rank > 0).sort(byRank).map(({ item }) => item);
}

/** The sub-page link for this URL: an exact path and `?tab` match, else the section's link without a tab, else the page it's nested under. */
export function activeAdminSubLink(item: AdminNavItem, pathname: string, tabParam: string | null): string | undefined {
  const tab = tabParam === "admins" ? "team" : tabParam;
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
