import { createFileRoute, Outlet } from "@tanstack/react-router";
import { createServerFn, useServerFn } from "@tanstack/react-start";
import { Suspense, useEffect, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { CommerceMessages } from "@/components/checkout/commerce-messages";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { Locale } from "@/i18n/routing";
import { useAuth } from "@/platform/auth";
import type { AbstractIntlMessages } from "@/platform/intl";
import { pathLocale } from "../request-locale";
import {
  AdminClerkSetupRequired,
  StartAdminNotFound,
  StartAdminViewError,
} from "../admin/AdminBoundaries";
import {
  buildAdminHead,
  createAdminRedirect,
  resolveAdminRedirect,
  validateAdminLayoutInput,
} from "../admin/admin-route";
import type { StartAdminLayoutData } from "../admin/admin-layout.server";

export const loadStartAdminLayoutServerFn = createServerFn({ method: "GET" })
  .validator(validateAdminLayoutInput)
  .handler(async ({ data }): Promise<StartAdminLayoutData> => {
    // Return configuration only. Commerce messages never enter route loader hydration.
    const { loadStartAdminLayoutData } = await import("../admin/admin-layout.server");
    return loadStartAdminLayoutData(data);
  });

const loadStartAdminCommerceServerFn = createServerFn({ method: "GET" })
  .validator(validateAdminLayoutInput)
  .handler(async ({ data }) => {
    const [{ auth }, { setResponseHeader }, { loadStartAdminCommerceData }] = await Promise.all([
      import("@clerk/tanstack-react-start/server"),
      import("@tanstack/react-start/server"),
      import("../admin/admin-layout.server"),
    ]);
    return loadStartAdminCommerceData(data, { getAuth: auth, setResponseHeader });
  });

export const Route = createFileRoute("/admin")({
  beforeLoad: ({ location }) => {
    const target = resolveAdminRedirect(location.pathname);
    if (target) {
      throw createAdminRedirect(target);
    }
  },
  loader: ({ location }) =>
    loadStartAdminLayoutServerFn({ data: { locale: pathLocale(location.pathname) } }),
  head: buildAdminHead,
  component: StartAdminLayoutRoute,
  errorComponent: StartAdminViewError,
  notFoundComponent: StartAdminNotFound,
});

function StartAdminLayoutRoute() {
  const data = Route.useLoaderData();
  if (!data.clerkConfigured) {
    return <AdminClerkSetupRequired />;
  }

  return (
    <Suspense fallback={null}>
      <AdminSession locale={data.locale} />
    </Suspense>
  );
}

function AdminSession({ locale }: { locale: Locale }) {
  const { isLoaded, isSignedIn, sessionId } = useAuth();
  if (!isLoaded || !isSignedIn || !sessionId) return <AdminShell><Outlet /></AdminShell>;

  // The session is a client lifecycle key only. The server function authenticates
  // its own request and never trusts an identity supplied by the browser.
  return <SignedInAdmin key={`${sessionId}:${locale}`} locale={locale} />;
}

function SignedInAdmin({ locale }: { locale: Locale }) {
  const fetchMessages = useServerFn(loadStartAdminCommerceServerFn);
  const [messages, setMessages] = useState<AbstractIntlMessages | null>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    void fetchMessages({ data: { locale } }).then(
      (loaded) => { if (current) setMessages(loaded); },
      () => { if (current) setMessages(null); },
    );
    return () => { current = false; };
  }, [fetchMessages, locale, attempt]);

  if (messages === undefined) {
    return <div className="grid min-h-dvh place-items-center"><Spinner label="Loading admin" className="size-6" /></div>;
  }
  if (!messages) {
    return (
      <main className="grid min-h-dvh place-content-center gap-4 px-5">
        <h1 role="alert" className="text-xl font-semibold">Admin messages could not load</h1>
        <Button onClick={() => { setMessages(undefined); setAttempt(attempt + 1); }}>Try again</Button>
      </main>
    );
  }
  return <CommerceMessages messages={messages}><AdminShell><Outlet /></AdminShell></CommerceMessages>;
}
