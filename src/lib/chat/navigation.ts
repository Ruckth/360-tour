import { localizeHref, stripLocalePrefix } from "@/i18n/routing";

export const CHAT_RETURN_TO_PARAM = "returnTo";

const CHAT_RETURN_ORIGIN = "https://seaview.local";

type SearchValue = URLSearchParams | string | null | undefined;

export function usesFloatingChatOnMobile(pathname: string) {
  const page = stripLocalePrefix(pathname).replace(/\/$/, "");
  return page !== "" && page !== "/booking" && !page.startsWith("/rooms/");
}

function normalizeSearch(search: SearchValue) {
  const value = typeof search === "string" ? search : search?.toString() ?? "";
  return value.startsWith("?") ? value.slice(1) : value;
}

export function getPathWithSearch(pathname: string, search: SearchValue) {
  const normalizedSearch = normalizeSearch(search);
  return normalizedSearch ? `${pathname}?${normalizedSearch}` : pathname;
}

export function buildChatHref({
  locale,
  pathname,
  propertySlug,
  search,
}: {
  locale: string;
  pathname: string;
  propertySlug?: string | null;
  search?: SearchValue;
}) {
  const params = new URLSearchParams();

  if (propertySlug) {
    params.set("property", propertySlug);
  }

  if (stripLocalePrefix(pathname) !== "/chat") {
    params.set(CHAT_RETURN_TO_PARAM, getPathWithSearch(pathname, search));
  }

  const query = params.toString();
  return localizeHref(`/chat${query ? `?${query}` : ""}`, locale);
}

export function getSafeChatReturnTo(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;

  try {
    const url = new URL(value, CHAT_RETURN_ORIGIN);
    if (url.origin !== CHAT_RETURN_ORIGIN) return null;
    if (stripLocalePrefix(url.pathname) === "/chat") return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
