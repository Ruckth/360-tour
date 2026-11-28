import { ClerkProvider } from "@clerk/tanstack-react-start";
import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  useRouter,
  useRouterState,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, type ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { Providers } from "@/components/global/Providers";
import { PublicSiteShell, SiteShell } from "@/components/global/SiteShell";
import { defaultLocale, isLocale, localizeHref, type Locale } from "@/i18n/routing";
import { bypassesI18n } from "@/lib/i18n-exempt";
import { themeInitScript } from "@/lib/theme";
import { GLOBAL_NOT_FOUND_MESSAGE, withRootNotFoundHead } from "../not-found";
import { pathLocale } from "../request-locale";
import cssUrl from "../start.css?url";

const loadShell = createServerFn({ method: "GET" })
  .validator((value: { locale: Locale; guest: boolean; auth?: boolean }) => {
    if (
      !value ||
      !isLocale(value.locale) ||
      typeof value.guest !== "boolean" ||
      (value.auth !== undefined && typeof value.auth !== "boolean")
    ) {
      throw new Error("Invalid shell request");
    }
    return value;
  })
  .handler(async ({ data }) => {
    const [content, { siteUrl }] = await Promise.all([
      import("@/lib/i18n/server-content"),
      import("@/lib/site-url"),
    ]);
    let resolvedLocale: Locale = data.locale;
    if (data.auth) {
      const { getCookie } = await import("@tanstack/react-start/server");
      const cookieLocale = getCookie("NEXT_LOCALE");
      if (cookieLocale && isLocale(cookieLocale)) {
        resolvedLocale = cookieLocale;
      }
    }
    let hasReviews = false;
    if (data.guest) {
      const [{ hasStartFeaturedReviews }, { getRequest }] = await Promise.all([
        import("../villas.server"),
        import("@tanstack/react-start/server"),
      ]);
      hasReviews = await hasStartFeaturedReviews(getRequest());
    }
    return {
      locale: resolvedLocale, guest: data.guest, messages: content.getPublicMessages(resolvedLocale),
      resort: content.getLocalizedResort(resolvedLocale).name, site: siteUrl(), hasReviews,
    };
  });

export const Route = createRootRoute({
  loader: ({ location }) => loadShell({ data: {
    locale: pathLocale(location.pathname),
    guest: !bypassesI18n(location.pathname),
    auth: location.pathname.startsWith("/sign-in") || location.pathname.startsWith("/sign-up"),
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
  errorComponent: RootError,
});

/** Next's default not-found copy (`404` / "This page could not be found."), plus recovery links. */
function GlobalNotFound() {
  const data = Route.useLoaderData();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const locale = data?.locale ?? pathLocale(pathname);
  const backHomeLabel = data?.messages?.Villa?.backHome ?? "Back to Home";
  const villasLabel = data?.messages?.Nav?.villas ?? "Villas";

  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center px-5 py-24 text-center">
      <div className="flex items-center">
        <h1 className="mr-5 border-r border-foreground/30 pr-6 text-2xl font-medium leading-[49px]">404</h1>
        <h2 className="text-sm font-normal leading-[49px]">{GLOBAL_NOT_FOUND_MESSAGE}</h2>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
        <a
          href={localizeHref("/", locale)}
          className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
        >
          {backHomeLabel}
        </a>
        <a
          href={localizeHref("/#villas", locale)}
          className="text-sm font-medium text-primary hover:underline"
        >
          {villasLabel}
        </a>
      </div>
    </main>
  );
}

function RootError({ reset }: ErrorComponentProps) {
  const router = useRouter();
  const data = Route.useLoaderData();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [retrying, setRetrying] = useState(false);
  const locale = data?.locale ?? pathLocale(pathname);
  const heading = data?.messages?.Villa?.pageUnavailableTitle ?? "Page temporarily unavailable";
  const detail = data?.messages?.Villa?.pageUnavailableDetail ?? "Please try again.";
  const retryLabel = data?.messages?.Villa?.tryAgain ?? "Try again";
  const backHomeLabel = data?.messages?.Villa?.backHome ?? "Back to Home";

  async function handleRetry() {
    if (retrying) return;
    setRetrying(true);
    try {
      reset();
      await router.invalidate();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <main role="alert" className="flex min-h-[60vh] flex-col items-center justify-center px-5 py-24 text-center">
      <div className="max-w-md">
        <h1 className="text-2xl font-bold text-foreground">{heading}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{detail}</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
          <button
            type="button"
            disabled={retrying}
            onClick={() => void handleRetry()}
            className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
          >
            {retryLabel}
          </button>
          <a
            href={localizeHref("/", locale)}
            className="text-sm font-medium text-primary hover:underline"
          >
            {backHomeLabel}
          </a>
        </div>
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
