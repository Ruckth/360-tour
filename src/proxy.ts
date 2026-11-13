import { clerkMiddleware } from "@clerk/nextjs/server";
import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";
import { adminRedirectPath } from "@/components/admin/admin-routes";
import { routing } from "@/i18n/routing";
import { isClerkConfigured } from "@/lib/clerk-config";
import { bypassesI18n } from "@/lib/i18n-exempt";

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { isMarketingBot } from "@/lib/marketing/bot";
import { isInternalMarketingPath, marketingSlugForPath } from "@/lib/marketing/proxy";

const handleI18nRouting = createMiddleware(routing);
const clerkEnabled = isClerkConfigured();

async function handleRequest(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl;

  const slug = marketingSlugForPath(pathname);
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.PUBLIC_CONVEX_URL;
  if (slug && convexUrl && convexUrl !== "placeholder") {
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

  return handleI18nRouting(request);
}

const proxy = clerkEnabled
  ? clerkMiddleware((_auth, request, event) => handleRequest(request, event))
  : (request: NextRequest, event: NextFetchEvent) => handleRequest(request, event);

export default proxy;

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|mp4|webm|ogg|mov|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|txt|xml)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
