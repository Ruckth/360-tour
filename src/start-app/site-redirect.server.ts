import { getCookie, setCookie, setResponseHeader } from "@tanstack/react-start/server";
import { waitUntil } from "@vercel/functions";
import { ConvexHttpClient } from "convex/browser";
import { api } from "convex/_generated/api";
import { adminRedirectPath } from "@/components/admin/admin-routes";
import { defaultLocale, isLocale, locales, localizeHref, stripLocalePrefix } from "@/i18n/routing";
import { bypassesI18n } from "@/lib/i18n-exempt";
import { isMarketingBot } from "@/lib/marketing/bot";
import { isInternalMarketingPath, marketingSlugForPath } from "@/lib/marketing/proxy";
import { requestLanguage } from "./locale-preference.server";

export async function siteRedirect(request: Request) {
  const url = new URL(request.url);
  const { pathname } = url;
  const slug = marketingSlugForPath(pathname);
  if (slug && import.meta.env.VITE_CONVEX_URL) {
    const client = new ConvexHttpClient(import.meta.env.VITE_CONVEX_URL);
    try {
      const resolved = await client.query(api.marketing.public.resolveLink, { slug });
      if (resolved && isInternalMarketingPath(resolved.path)) {
        waitUntil(client.mutation(api.marketing.public.recordOpen, {
          slug, bot: isMarketingBot(request.headers.get("user-agent")),
        }).catch(() => undefined));
        return new Response(null, { status: 302, headers: { location: new URL(resolved.path, url).href, "cache-control": "no-store" } });
      }
    } catch { /* An unresolvable short link continues through normal routing. */ }
  }
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    const target = adminRedirectPath(pathname);
    if (target) return new Response(null, { status: 307, headers: { location: new URL(target, url).href } });
  }
  if (/\.[^/]+$/.test(pathname) || pathname.startsWith("/api/")) return;
  if (pathname !== "/display") setResponseHeader("cache-control", "private, no-store, max-age=0");
  if (bypassesI18n(pathname)) return;
  const languages = [...locales, "x-default"] as const;
  const alternates = languages.map((language) => {
    const target = new URL(url.origin);
    target.pathname = localizeHref(pathname, language === "x-default" ? defaultLocale : language);
    return `<${target.href}>; rel="alternate"; hreflang="${language}"`;
  });
  setResponseHeader("link", alternates.join(", "));
  const first = pathname.split("/")[1];
  const cookie = getCookie("NEXT_LOCALE");
  const language = requestLanguage(request.headers.get("accept-language"));
  const preference = cookie && isLocale(cookie) ? cookie : language ?? defaultLocale;
  const selected = isLocale(first) ? first : preference;
  if (selected !== (cookie ?? language)) setCookie("NEXT_LOCALE", selected, { path: "/", sameSite: "lax" });
  if (isLocale(first)) {
    if (first !== defaultLocale) return;
    url.pathname = stripLocalePrefix(pathname);
  } else if (preference !== defaultLocale) {
    url.pathname = localizeHref(pathname, preference);
  } else return;
  return new Response(null, { status: 307, headers: { location: url.href } });
}
