import { redirect } from "@tanstack/react-router";
import { adminPropertyTab, adminRedirectPath, adminSettingsTabPath, isAdminStaffTab, type AdminPropertyTab, type AdminStaffTab } from "@/components/admin/admin-routes";
import { isLocale, type Locale } from "@/i18n/routing";

export type AdminLayoutInput = {
  locale: Locale;
};

export type AdminRedirectTarget =
  | { to: "/admin/chats"; replace: true; statusCode: 307 }
  | { to: "/admin/today"; replace: true; statusCode: 307 }
  | { to: "/admin/staff/$tab"; params: { tab: AdminStaffTab }; replace: true; statusCode: 307 }
  | { to: "/admin/stock/balances"; replace: true; statusCode: 307 }
  | { to: "/admin/marketing/dashboard"; replace: true; statusCode: 307 }
  | { to: "/admin/settings"; search: { tab: "team"; people?: "marketing" }; replace: true; statusCode: 307 };

export function validateAdminLayoutInput(value: unknown): AdminLayoutInput {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid admin layout request");
  }
  const { locale } = value as { locale?: unknown };
  if (typeof locale !== "string" || !isLocale(locale)) {
    throw new Error("Unsupported admin locale");
  }
  return { locale };
}

export function isServerFnRpcRequest(request: Request): boolean {
  return new URL(request.url).pathname.startsWith("/_serverFn");
}

/**
 * Converts a target returned by `adminRedirectPath` into typed TanStack Router
 * redirect options so both SSR (HTTP 307) and SPA navigation stay in-app.
 */
export function toAdminRedirectTarget(target: string): AdminRedirectTarget {
  if (target === "/admin/chats") {
    return { to: "/admin/chats", replace: true, statusCode: 307 };
  }
  if (target === "/admin/today") {
    return { to: "/admin/today", replace: true, statusCode: 307 };
  }
  if (target === "/admin/stock/balances") {
    return { to: "/admin/stock/balances", replace: true, statusCode: 307 };
  }
  if (target === "/admin/marketing/dashboard") {
    return { to: "/admin/marketing/dashboard", replace: true, statusCode: 307 };
  }
  if (target.startsWith("/admin/staff/")) {
    const tab = target.slice("/admin/staff/".length);
    if (isAdminStaffTab(tab)) {
      return { to: "/admin/staff/$tab", params: { tab }, replace: true, statusCode: 307 };
    }
  }
  if (target === adminSettingsTabPath("team")) {
    return { to: "/admin/settings", search: { tab: "team" }, replace: true, statusCode: 307 };
  }
  return { to: "/admin/chats", replace: true, statusCode: 307 };
}

export function resolveAdminRedirect(pathname: string): AdminRedirectTarget | null {
  const target = adminRedirectPath(pathname);
  return target ? toAdminRedirectTarget(target) : null;
}

export function resolveMarketingAccessRedirect(): AdminRedirectTarget {
  return { to: "/admin/settings", search: { tab: "team", people: "marketing" }, replace: true, statusCode: 307 };
}

export function createAdminRedirect(target: AdminRedirectTarget) {
  switch (target.to) {
    case "/admin/chats":
      return redirect({ to: "/admin/chats", replace: true, statusCode: 307 });
    case "/admin/today":
      return redirect({ to: "/admin/today", replace: true, statusCode: 307 });
    case "/admin/stock/balances":
      return redirect({ to: "/admin/stock/balances", replace: true, statusCode: 307 });
    case "/admin/marketing/dashboard":
      return redirect({ to: "/admin/marketing/dashboard", replace: true, statusCode: 307 });
    case "/admin/staff/$tab":
      return redirect({ to: "/admin/staff/$tab", params: target.params, replace: true, statusCode: 307 });
    case "/admin/settings":
      return redirect({ to: "/admin/settings", search: target.search, replace: true, statusCode: 307 });
  }
}

/**
 * Admin viewport head (carried over from the retired Next admin layout):
 * edge-to-edge on notched phones/iPads with light & dark theme colors.
 */
export function buildAdminHead() {
  return {
    meta: [
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", media: "(prefers-color-scheme: light)", content: "#ffffff" },
      { name: "theme-color", media: "(prefers-color-scheme: dark)", content: "#0b0f17" },
    ],
  };
}

/**
 * Preserves all query parameters while typing `tab` for Settings links and redirects.
 */
export function validateAdminSettingsSearch(search: Record<string, unknown>): Record<string, unknown> & { tab?: string } {
  return typeof search.tab === "string" && search.tab.length > 0
    ? { ...search, tab: search.tab }
    : { ...search };
}

/**
 * Validates the villa editor `?tab=` query parameter, falling back to the default `details` section.
 */
export function validateAdminPropertySearch(search: Record<string, unknown>): Record<string, unknown> & { tab?: AdminPropertyTab } {
  if (search.tab === undefined) return { ...search, tab: undefined };
  // The router merges validated search over the raw values. Override an invalid tab explicitly.
  return { ...search, tab: adminPropertyTab(typeof search.tab === "string" ? search.tab : null) };
}
