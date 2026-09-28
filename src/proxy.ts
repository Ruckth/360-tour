import { clerkMiddleware } from "@clerk/nextjs/server";
import createMiddleware from "next-intl/middleware";
import { NextResponse } from "next/server";
import { adminRedirectPath } from "@/components/admin/admin-routes";
import { routing } from "@/i18n/routing";
import { isClerkConfigured } from "@/lib/clerk-config";

const handleI18nRouting = createMiddleware(routing);
const clerkEnabled = isClerkConfigured();

function handleRequest(request: Request & { nextUrl: URL }) {
  const { pathname } = request.nextUrl;

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    const target = adminRedirectPath(pathname);
    return target ? NextResponse.redirect(new URL(target, request.url)) : NextResponse.next();
  }

  if (
    pathname.startsWith("/api") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/__clerk") ||
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/sign-up")
  ) {
    return NextResponse.next();
  }

  return handleI18nRouting(request);
}

const proxy = clerkEnabled
  ? clerkMiddleware((_auth, request) => handleRequest(request))
  : (request: Request & { nextUrl: URL }) => handleRequest(request);

export default proxy;

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|mp4|webm|ogg|mov|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
