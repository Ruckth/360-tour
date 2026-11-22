import { clerkMiddleware } from "@clerk/nextjs/server";
import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";
import { adminRedirectPath } from "@/components/admin/admin-routes";
import { routing } from "@/i18n/routing";
import { requireClerkConfiguration } from "@/lib/clerk-config";
import { bypassesI18n } from "@/lib/i18n-exempt";
import {
  VILLA_BENCH_REQUEST_HEADER,
  VILLA_BENCH_REQUEST_ID_HEADER,
  VILLA_CACHE_NAMESPACE_HEADER,
  villaBenchmarkNamespace,
} from "@/lib/server/villa-cache-benchmark";

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { isMarketingBot } from "@/lib/marketing/bot";
import { isInternalMarketingPath, marketingSlugForPath } from "@/lib/marketing/proxy";

const handleI18nRouting = createMiddleware(routing);
requireClerkConfiguration();

async function handleRequest(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl;

  const slug = marketingSlugForPath(pathname);
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.PUBLIC_CONVEX_URL;
  if (slug && convexUrl) {
    try {
      const client = new ConvexHttpClient(convexUrl);
      const resolved = await client.query(api.marketing.public.resolveLink, { slug });
      if (resolved && isInternalMarketingPath(resolved.path)) {
        // Keep the event alive after the response without delaying the redirect.
        event.waitUntil(client.mutation(api.marketing.public.recordOpen, {
          slug, bot: isMarketingBot(request.headers.get("user-agent")),
        }).catch(() => undefined));
        const response = NextResponse.redirect(new URL(resolved.path, request.url), 302);
        response.headers.set("Cache-Control", "no-store");
        return response;
      }
    } catch {
      // Unknown links and temporary backend failures use normal app routing.
    }
  }

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    const target = adminRedirectPath(pathname);
    return target ? NextResponse.redirect(new URL(target, request.url)) : NextResponse.next();
  }

  if (bypassesI18n(pathname)) {
    return NextResponse.next();
  }

  const i18n = handleI18nRouting(request);
  if (/^\/(?:[^/]+\/)?rooms\/[^/]+\/villa-benchmark\/?$/.test(pathname)) return new NextResponse(null, { status: 404 });

  if (
    request.method !== "GET" || i18n.headers.has("location") ||
    request.headers.has("rsc") || request.headers.has("next-router-prefetch") ||
    !/^\/(?:[^/]+\/)?rooms\/[^/]+\/?$/.test(pathname)
  ) return i18n;
  const benchmarkNamespace = villaBenchmarkNamespace(request.headers.get(VILLA_BENCH_REQUEST_HEADER));
  if (!benchmarkNamespace) return i18n;

  const target = new URL(i18n.headers.get("x-middleware-rewrite") ?? request.url, request.url);
  target.pathname = target.pathname.replace(/\/$/, "") + "/villa-benchmark";
  const forwarded = new Headers(request.headers);
  for (const name of i18n.headers.get("x-middleware-override-headers")?.split(",") ?? []) {
    const value = i18n.headers.get(`x-middleware-request-${name}`);
    if (value !== null) forwarded.set(name, value);
  }
  const requestId = crypto.randomUUID();
  forwarded.set(VILLA_BENCH_REQUEST_ID_HEADER, requestId);

  const headers = new Headers(i18n.headers);
  headers.delete("x-middleware-next");
  headers.set("Cache-Control", "private, no-store");
  headers.set(VILLA_CACHE_NAMESPACE_HEADER, benchmarkNamespace);
  headers.set(VILLA_BENCH_REQUEST_ID_HEADER, requestId);
  return NextResponse.rewrite(target, { headers, request: { headers: forwarded } });
}

const proxy = clerkMiddleware((_auth, request, event) => handleRequest(request, event));

export default proxy;

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|mp4|webm|ogg|mov|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|txt|xml)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
