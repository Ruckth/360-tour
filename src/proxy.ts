import { clerkMiddleware } from "@clerk/nextjs/server";
import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { adminRedirectPath } from "@/components/admin/admin-routes";
import { routing } from "@/i18n/routing";
import { isClerkConfigured } from "@/lib/clerk-config";
import { bypassesI18n } from "@/lib/i18n-exempt";

const handleI18nRouting = createMiddleware(routing);
const clerkEnabled = isClerkConfigured();

function handleRequest(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
  ? clerkMiddleware((_auth, request) => handleRequest(request))
  : (request: NextRequest) => handleRequest(request);

export default proxy;

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|mp4|webm|ogg|mov|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|txt|xml)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
