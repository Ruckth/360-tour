import { ClerkProvider } from "@clerk/tanstack-react-start";
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { Providers } from "@/app/providers";
import { PublicSiteShell, SiteShell } from "@/components/global/SiteShell";
import { defaultLocale, isLocale, type Locale } from "@/i18n/routing";
import { bypassesI18n } from "@/lib/i18n-exempt";
import { themeInitScript } from "@/lib/theme";
import { GLOBAL_NOT_FOUND_MESSAGE, withRootNotFoundHead } from "../not-found";
import { pathLocale } from "../request-locale";
import cssUrl from "../start.css?url";

const loadShell = createServerFn({ method: "GET" })
  .validator((value: { locale: Locale; guest: boolean }) => {
    if (!value || !isLocale(value.locale) || typeof value.guest !== "boolean") throw new Error("Invalid shell request");
    return value;
  })
  .handler(async ({ data }) => {
    const { getPublicMessages, getLocalizedResort } = await import("@/lib/i18n/server-content");
    const { siteUrl } = await import("@/lib/site-url");
    const { hasStartFeaturedReviews } = await import("../villas.server");
    return {
      locale: data.locale, guest: data.guest, messages: getPublicMessages(data.locale),
      resort: getLocalizedResort(data.locale).name, site: siteUrl(),
      hasReviews: data.guest && await hasStartFeaturedReviews(),
    };
  });

export const Route = createRootRoute({
  loader: ({ location }) => loadShell({ data: {
    locale: pathLocale(location.pathname), guest: !bypassesI18n(location.pathname),
  } }),
  head: ({ loaderData, match }) => {
    const seo = loaderData?.messages.SEO;
    const photo = loaderData ? new URL("/garden-image.webp", loaderData.site).href : undefined;
    return {
      meta: withRootNotFoundHead([
        { charSet: "utf-8" }, { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: seo?.rootTitle }, { name: "description", content: seo?.rootDescription },
        { property: "og:type", content: "website" }, { property: "og:site_name", content: loaderData?.resort },
        { property: "og:title", content: seo?.rootOgTitle }, { property: "og:description", content: seo?.rootDescription },
        { property: "og:image", content: photo }, { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: seo?.rootOgTitle }, { name: "twitter:description", content: seo?.rootDescription },
        { name: "twitter:image", content: photo },
      ], match),
      links: [
        { rel: "stylesheet", href: cssUrl },
        { rel: "icon", href: "/favicon.ico", sizes: "256x256" },
        { rel: "icon", href: "/icon.png", type: "image/png", sizes: "512x512" },
      ],
    };
  },
  component: Site,
  shellComponent: Document,
  notFoundComponent: GlobalNotFound,
  errorComponent: () => <main role="alert"><h1>Page temporarily unavailable</h1><p>Please try again.</p></main>,
});

/** Next's default not-found copy (`404` / "This page could not be found."). */
function GlobalNotFound() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center px-5 py-24 text-center">
      <div className="flex items-center">
        <h1 className="mr-5 border-r border-foreground/30 pr-6 text-2xl font-medium leading-[49px]">404</h1>
        <h2 className="text-sm font-normal leading-[49px]">{GLOBAL_NOT_FOUND_MESSAGE}</h2>
      </div>
    </main>
  );
}

function Site() {
  const { locale, messages, hasReviews, guest } = Route.useLoaderData();
  const convexUrl = import.meta.env.VITE_CONVEX_URL;
  if (!convexUrl) throw new Error("VITE_CONVEX_URL is required");
  return (
    <IntlProvider locale={locale} messages={messages} timeZone="Asia/Bangkok">
      <ClerkProvider publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}>
        <Providers convexUrl={convexUrl}>
          <SiteShell>{guest ? <PublicSiteShell hasReviews={hasReviews}><Outlet /></PublicSiteShell> : <Outlet />}</SiteShell>
        </Providers>
      </ClerkProvider>
    </IntlProvider>
  );
}

function Document({ children }: { children: ReactNode }) {
  const data = Route.useLoaderData();
  return (
    <html lang={data?.locale ?? defaultLocale} suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {data && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
          "@context": "https://schema.org", "@type": "WebSite", name: data.resort, url: data.site,
        }).replace(/</g, "\\u003c") }} />}
        <HeadContent />
      </head>
      <body>{children}<Scripts /></body>
    </html>
  );
}
