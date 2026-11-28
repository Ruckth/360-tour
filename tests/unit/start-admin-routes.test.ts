import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {} from "@/start-app/routeTree.gen";
import { archivedNextAppFiles } from "../../scripts/dual-entry-checkpoint.mjs";
import {
  isStartClerkConfigured,
  loadCommerceMessages,
  loadStartAdminCommerceData,
  loadStartAdminLayoutData,
  resolveStartCheckoutPreviewAccess,
} from "@/start-app/admin/admin-layout.server";
import {
  buildAdminHead,
  isServerFnRpcRequest,
  resolveAdminRedirect,
  resolveMarketingAccessRedirect,
  validateAdminLayoutInput,
  validateAdminSettingsSearch,
} from "@/start-app/admin/admin-route";

const root = process.cwd();

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

/** Maps a Next App Router page under `src/app/admin` to its TanStack Start flat route file. */
const EXPECTED_PAGE_ROUTE_MAP: Record<string, { file: string; routeId: string }> = {
  "src/app/admin/chats/page.tsx": { file: "src/start-app/routes/admin.chats.tsx", routeId: "/admin/chats" },
  "src/app/admin/checkout/page.tsx": { file: "src/start-app/routes/admin.checkout.index.tsx", routeId: "/admin/checkout/" },
  "src/app/admin/checkout/preview/page.tsx": { file: "src/start-app/routes/admin.checkout.preview.tsx", routeId: "/admin/checkout/preview" },
  "src/app/admin/hotel/page.tsx": { file: "src/start-app/routes/admin.hotel.tsx", routeId: "/admin/hotel" },
  "src/app/admin/leads/page.tsx": { file: "src/start-app/routes/admin.leads.tsx", routeId: "/admin/leads" },
  "src/app/admin/marketing/access/page.tsx": { file: "src/start-app/routes/admin.marketing.access.tsx", routeId: "/admin/marketing/access" },
  "src/app/admin/marketing/affiliates/page.tsx": { file: "src/start-app/routes/admin.marketing.affiliates.tsx", routeId: "/admin/marketing/affiliates" },
  "src/app/admin/marketing/campaigns/page.tsx": { file: "src/start-app/routes/admin.marketing.campaigns.tsx", routeId: "/admin/marketing/campaigns" },
  "src/app/admin/marketing/coupons/[id]/page.tsx": { file: "src/start-app/routes/admin.marketing.coupons.$id.tsx", routeId: "/admin/marketing/coupons/$id" },
  "src/app/admin/marketing/coupons/page.tsx": { file: "src/start-app/routes/admin.marketing.coupons.index.tsx", routeId: "/admin/marketing/coupons/" },
  "src/app/admin/marketing/dashboard/page.tsx": { file: "src/start-app/routes/admin.marketing.dashboard.tsx", routeId: "/admin/marketing/dashboard" },
  "src/app/admin/marketing/links/page.tsx": { file: "src/start-app/routes/admin.marketing.links.tsx", routeId: "/admin/marketing/links" },
  "src/app/admin/properties/[id]/page.tsx": { file: "src/start-app/routes/admin.properties.$id.tsx", routeId: "/admin/properties/$id" },
  "src/app/admin/properties/page.tsx": { file: "src/start-app/routes/admin.properties.index.tsx", routeId: "/admin/properties/" },
  "src/app/admin/questions/page.tsx": { file: "src/start-app/routes/admin.questions.tsx", routeId: "/admin/questions" },
  "src/app/admin/receipt/[orderId]/page.tsx": { file: "src/start-app/routes/admin.receipt.$orderId.tsx", routeId: "/admin/receipt/$orderId" },
  "src/app/admin/settings/page.tsx": { file: "src/start-app/routes/admin.settings.tsx", routeId: "/admin/settings" },
  "src/app/admin/staff/[tab]/page.tsx": { file: "src/start-app/routes/admin.staff.$tab.tsx", routeId: "/admin/staff/$tab" },
};

const EXPECTED_LAYOUT_AND_FALLBACK_ROUTES: Array<{ file: string; routeId: string }> = [
  { file: "src/start-app/routes/admin.tsx", routeId: "/admin" },
  { file: "src/start-app/routes/admin.index.tsx", routeId: "/admin/" },
  { file: "src/start-app/routes/admin.$.tsx", routeId: "/admin/$" },
  { file: "src/start-app/routes/admin.marketing.tsx", routeId: "/admin/marketing" },
  { file: "src/start-app/routes/admin.marketing.index.tsx", routeId: "/admin/marketing/" },
  { file: "src/start-app/routes/admin.staff.tsx", routeId: "/admin/staff" },
  { file: "src/start-app/routes/admin.staff.index.tsx", routeId: "/admin/staff/" },
  { file: "src/start-app/routes/admin.receipt.index.tsx", routeId: "/admin/receipt/" },
];

describe("start admin route parity and bundle boundaries", () => {
  it("migrates every archived src/app/admin page route and nested layout", () => {
    // The retired Next entry, read from git at the accepted dual-entry checkpoint.
    const nextAdminPages = archivedNextAppFiles(root)
      .filter((file) => file.startsWith("src/app/admin/") && file.endsWith("/page.tsx"));

    expect(nextAdminPages).toHaveLength(18);
    expect(nextAdminPages).toEqual(Object.keys(EXPECTED_PAGE_ROUTE_MAP).sort());

    for (const { file, routeId } of [
      ...Object.values(EXPECTED_PAGE_ROUTE_MAP),
      ...EXPECTED_LAYOUT_AND_FALLBACK_ROUTES,
    ]) {
      const fullPath = resolve(root, file);
      expect(existsSync(fullPath), `Missing Start route file ${file}`).toBe(true);
      const source = readFileSync(fullPath, "utf8");
      expect(source).toContain(`createFileRoute("${routeId}")`);
    }
  });

  it("contains zero Next.js framework imports across all Start admin routes and helpers", () => {
    const startAdminFiles = [
      ...listFiles(resolve(root, "src/start-app/admin")),
      ...listFiles(resolve(root, "src/start-app/routes")).filter((file) =>
        relative(resolve(root, "src/start-app/routes"), file).startsWith("admin"),
      ),
    ];

    expect(startAdminFiles.length).toBeGreaterThanOrEqual(28);
    const forbidden = /from\s+["'](?:next(?:\/|$)|next-intl(?:\/|$)|@(?:clerk|sentry)\/nextjs(?:\/|$))/;
    for (const file of startAdminFiles) {
      const source = readFileSync(file, "utf8");
      expect(source, `Forbidden Next import in ${relative(root, file)}`).not.toMatch(forbidden);
    }
  });

  it("keeps server-only commerce dictionaries and heavy screens out of admin.tsx static imports", () => {
    const layoutSource = readFileSync(resolve(root, "src/start-app/routes/admin.tsx"), "utf8");
    const staticImports = layoutSource
      .split("\n")
      .filter((line) => /^\s*import\s+/.test(line) && !/^\s*import\s+type\s+/.test(line))
      .join("\n");

    expect(staticImports).not.toContain("admin-layout.server");
    expect(staticImports).not.toContain("messages/commerce");
    for (const heavyScreen of [
      "ChatsView",
      "CheckoutView",
      "CheckoutPreview",
      "AdminBookingsView",
      "AdminStaffBookingsView",
      "AdminPropertyEditor",
      "AdminPropertiesView",
      "AdminSettingsView",
      "DashboardScreen",
      "AffiliatesScreen",
      "MarketingScreens",
      "ReceiptView",
    ]) {
      expect(staticImports).not.toContain(heavyScreen);
    }
    expect(layoutSource).toContain('import("../admin/admin-layout.server")');
  });

  it("keeps CheckoutPreview and fixture data out of the live /admin/checkout route entry", () => {
    const checkoutRouteSource = readFileSync(
      resolve(root, "src/start-app/routes/admin.checkout.index.tsx"),
      "utf8",
    );
    expect(checkoutRouteSource).not.toContain("CheckoutPreview");
    expect(checkoutRouteSource).not.toContain("fixture-backend");
    expect(checkoutRouteSource).not.toContain("messages/commerce");

    const sharedCheckoutPageSource = readFileSync(
      resolve(root, "src/components/checkout/AdminCheckoutPage.tsx"),
      "utf8",
    );
    expect(sharedCheckoutPageSource).toContain('from "@/platform/navigation"');
    expect(sharedCheckoutPageSource).not.toContain('from "next/navigation"');
  });
});

describe("start admin route helpers and server logic", () => {
  it("validates layout loader inputs, viewport head metadata, and settings search params", () => {
    expect(validateAdminLayoutInput({ locale: "en" })).toEqual({ locale: "en" });
    expect(validateAdminLayoutInput({ locale: "th" })).toEqual({ locale: "th" });
    expect(() => validateAdminLayoutInput(null)).toThrow("Invalid admin layout request");
    expect(() => validateAdminLayoutInput({ locale: "zz" })).toThrow("Unsupported admin locale");

    const head = buildAdminHead();
    expect(head.meta).toEqual([
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", media: "(prefers-color-scheme: light)", content: "#ffffff" },
      { name: "theme-color", media: "(prefers-color-scheme: dark)", content: "#0b0f17" },
    ]);

    expect(validateAdminSettingsSearch({ tab: "team", extra: "1" })).toEqual({ tab: "team", extra: "1" });
    expect(validateAdminSettingsSearch({ tab: "" })).toEqual({ tab: "" });
    expect(isServerFnRpcRequest(new Request("https://example.test/_serverFn/loadStartAdmin"))).toBe(true);
    expect(isServerFnRpcRequest(new Request("https://example.test/admin/chats"))).toBe(false);
  });

  it.each([
    ["/admin", { to: "/admin/chats", replace: true, statusCode: 307 }],
    ["/admin/", { to: "/admin/chats", replace: true, statusCode: 307 }],
    ["/admin/chat", { to: "/admin/chats", replace: true, statusCode: 307 }],
    ["/admin/unknown", { to: "/admin/chats", replace: true, statusCode: 307 }],
    ["/admin/staff", { to: "/admin/staff/$tab", params: { tab: "calendar" }, replace: true, statusCode: 307 }],
    ["/admin/staff/unknown", null],
    ["/admin/marketing", { to: "/admin/marketing/dashboard", replace: true, statusCode: 307 }],
    ["/admin/marketing/", { to: "/admin/marketing/dashboard", replace: true, statusCode: 307 }],
    ["/admin/marketing/unknown", null],
    ["/admin/receipt", { to: "/admin/chats", replace: true, statusCode: 307 }],
    ["/admin/chats", null],
    ["/admin/checkout", null],
    ["/admin/checkout/preview", null],
    ["/admin/hotel", null],
    ["/admin/leads", null],
    ["/admin/questions", null],
    ["/admin/properties", null],
    ["/admin/properties/prop-1", null],
    ["/admin/receipt/order-1", null],
    ["/admin/settings", null],
    ["/admin/staff/calendar", null],
    ["/admin/staff/roster", null],
    ["/admin/staff/staff", null],
    ["/admin/staff/services", null],
    ["/admin/marketing/dashboard", null],
    ["/admin/marketing/campaigns", null],
    ["/admin/marketing/links", null],
    ["/admin/marketing/coupons", null],
    ["/admin/marketing/coupons/new", null],
    ["/admin/marketing/affiliates", null],
    ["/admin/marketing/access", null],
    ["/admin/stock", { to: "/admin/stock/balances", replace: true, statusCode: 307 }],
    ["/admin/stock/", { to: "/admin/stock/balances", replace: true, statusCode: 307 }],
    ["/admin/stock/unknown", { to: "/admin/chats", replace: true, statusCode: 307 }],
    ["/admin/stock/balances", null],
    ["/admin/stock/activity", null],
    ["/admin/stock/products", null],
    ["/admin/stock/purchasing", null],
    ["/admin/stock/purchasing/requests/req-1", null],
    ["/admin/stock/purchasing/orders/po-1", null],
    ["/admin/stock/purchasing/receipts/gr-1", null],
    ["/admin/stock/expansion", null],
  ] as const)("maps %s redirect via common adminRedirectPath", (pathname, expected) => {
    expect(resolveAdminRedirect(pathname)).toEqual(expected);
  });

  it("redirects /admin/marketing/access to Settings Team tab", () => {
    expect(resolveMarketingAccessRedirect()).toEqual({
      to: "/admin/settings",
      search: { tab: "team" },
      replace: true,
      statusCode: 307,
    });
  });

  it("checks Clerk configuration across VITE/NEXT/PUBLIC keys and loads per-locale commerce messages", async () => {
    expect(isStartClerkConfigured({})).toBe(false);
    expect(isStartClerkConfigured({ VITE_CLERK_PUBLISHABLE_KEY: "pk_test_placeholder", CLERK_SECRET_KEY: "sk_test_1" })).toBe(false);
    expect(isStartClerkConfigured({ VITE_CLERK_PUBLISHABLE_KEY: "pk_test_real" })).toBe(false);
    expect(isStartClerkConfigured({ VITE_CLERK_PUBLISHABLE_KEY: "pk_test_real", CLERK_SECRET_KEY: "sk_test_1" })).toBe(true);
    expect(isStartClerkConfigured({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_real", CLERK_SECRET_KEY: "sk_test_1" })).toBe(true);
    expect(isStartClerkConfigured({ PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_real", CLERK_SECRET_KEY: "sk_test_1" })).toBe(true);

    expect(await loadStartAdminLayoutData({ locale: "en" }, {})).toEqual({ clerkConfigured: false });

    const configured = await loadStartAdminLayoutData(
      { locale: "en" },
      { VITE_CLERK_PUBLISHABLE_KEY: "pk_test_real", CLERK_SECRET_KEY: "sk_test_1" },
    );
    expect(configured.clerkConfigured).toBe(true);
    if (!configured.clerkConfigured) throw new Error("expected configured");
    expect(configured.locale).toBe("en");
    expect(configured).not.toHaveProperty("commerce");

    const thCommerce = await loadCommerceMessages("th");
    expect(thCommerce).toHaveProperty("Commerce");
  });

  it("serves commerce copy only to a request with a trusted Clerk user and session", async () => {
    const setResponseHeader = vi.fn();
    for (const auth of [
      { userId: null, sessionId: null },
      { userId: "user_fixture", sessionId: null },
      { userId: null, sessionId: "sess_fixture" },
    ]) {
      expect(await loadStartAdminCommerceData({ locale: "th" }, {
        getAuth: async () => auth, setResponseHeader,
      })).toBeNull();
    }
    expect(await loadStartAdminCommerceData({ locale: "th" }, {
      getAuth: async () => ({ userId: "user_fixture", sessionId: "sess_fixture" }), setResponseHeader,
    })).toEqual(await loadCommerceMessages("th"));
    expect(setResponseHeader.mock.calls).toEqual(Array.from({ length: 4 }, () => ["Cache-Control", "private, no-store"]));
  });

  it("gates /admin/checkout/preview to development/preview and stamps 404 only on document SSR", () => {
    const previewStatus = vi.fn();
    expect(
      resolveStartCheckoutPreviewAccess({
        getRequest: () => new Request("https://example.test/admin/checkout/preview"),
        setResponseStatus: previewStatus,
        env: { NODE_ENV: "production", VERCEL_ENV: "preview" },
      }),
    ).toEqual({ enabled: true });
    expect(previewStatus).not.toHaveBeenCalled();

    const prodDocStatus = vi.fn();
    expect(
      resolveStartCheckoutPreviewAccess({
        getRequest: () => new Request("https://example.test/admin/checkout/preview"),
        setResponseStatus: prodDocStatus,
        env: { NODE_ENV: "production", VERCEL_ENV: "production" },
      }),
    ).toEqual({ enabled: false });
    expect(prodDocStatus).toHaveBeenCalledWith(404, "Not Found");

    const prodRpcStatus = vi.fn();
    expect(
      resolveStartCheckoutPreviewAccess({
        getRequest: () => new Request("https://example.test/_serverFn/loadStartCheckoutPreview"),
        setResponseStatus: prodRpcStatus,
        env: { NODE_ENV: "production", VERCEL_ENV: "production" },
      }),
    ).toEqual({ enabled: false });
    expect(prodRpcStatus).not.toHaveBeenCalled();
  });
});

describe("start admin route lifecycle with mocked TanStack Start runtime", () => {
  const getRequest = vi.fn();
  const setResponseStatus = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    getRequest.mockReset();
    setResponseStatus.mockReset();
    getRequest.mockReturnValue(new Request("https://example.test/admin/checkout/preview"));

    vi.doMock("@tanstack/react-router", () => ({
      createFileRoute: (id: string) => (options: Record<string, unknown>) => ({
        id,
        options,
        useLoaderData: () => undefined,
        useParams: () => ({}),
        useRouteContext: () => ({}),
      }),
      Outlet: () => null,
      Navigate: () => null,
      notFound: (payload?: Record<string, unknown>) => ({ __notFound: true, ...(payload ?? {}) }),
      redirect: (payload: Record<string, unknown>) => ({ __redirect: true, ...payload }),
      useRouter: () => ({ invalidate: vi.fn() }),
    }));

    vi.doMock("@tanstack/react-start", () => ({
      createServerFn: () => ({
        validator: (validate: (input: unknown) => unknown) => ({
          handler:
            (fn: (ctx: { data: unknown }) => Promise<unknown>) =>
            async ({ data }: { data: unknown }) =>
              fn({ data: validate(data) }),
        }),
        handler: (fn: () => Promise<unknown>) => async () => fn(),
      }),
    }));

    vi.doMock("@tanstack/react-start/server", () => ({
      getRequest,
      setResponseStatus,
    }));

    vi.doMock("@/components/admin/AdminShell", () => ({
      AdminShell: () => null,
    }));
    vi.doMock("@/components/admin/AdminStaffBookingsView", () => ({
      AdminStaffTabs: () => null,
      AdminStaffBookingsView: () => null,
    }));
    vi.doMock("@/components/checkout/CheckoutPreview", () => ({
      CheckoutPreview: () => null,
    }));
  });

  afterEach(() => {
    vi.doUnmock("@tanstack/react-router");
    vi.doUnmock("@tanstack/react-start");
    vi.doUnmock("@tanstack/react-start/server");
    vi.doUnmock("@/components/admin/AdminShell");
    vi.doUnmock("@/components/admin/AdminStaffBookingsView");
    vi.doUnmock("@/components/checkout/CheckoutPreview");
    vi.unstubAllEnvs();
  });

  it("enforces admin.tsx redirects, Clerk gate loader, and viewport head", async () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "pk_test_real");
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_real");

    const mod = await import("@/start-app/routes/admin");
    const route = mod.Route as unknown as {
      id: string;
      options: {
        beforeLoad: (args: { location: { pathname: string } }) => void;
        loader: (args: { location: { pathname: string } }) => Promise<{ clerkConfigured: boolean; locale?: string; commerce?: Record<string, unknown> }>;
        head: () => { meta: Array<Record<string, string>> };
      };
    };

    expect(route.id).toBe("/admin");
    expect(() => route.options.beforeLoad({ location: { pathname: "/admin" } })).toThrow();
    try {
      route.options.beforeLoad({ location: { pathname: "/admin/staff" } });
    } catch (thrown) {
      expect(thrown).toEqual({
        __redirect: true,
        to: "/admin/staff/$tab",
        params: { tab: "calendar" },
        replace: true,
        statusCode: 307,
      });
    }

    expect(() => route.options.beforeLoad({ location: { pathname: "/admin/chats" } })).not.toThrow();
    const loaded = await route.options.loader({ location: { pathname: "/admin/chats" } });
    expect(loaded.clerkConfigured).toBe(true);
    expect(loaded.locale).toBe("en");
    expect(loaded).not.toHaveProperty("commerce");
    expect(route.options.head().meta[0]).toEqual({
      name: "viewport",
      content: "width=device-width, initial-scale=1, viewport-fit=cover",
    });
  });

  it("handles /admin/marketing/access, /admin/staff/$tab, /admin/$, and /admin/checkout/preview guards", async () => {
    const accessMod = await import("@/start-app/routes/admin.marketing.access");
    const accessRoute = accessMod.Route as unknown as {
      options: { beforeLoad?: () => void; component: () => { props: unknown } };
    };
    expect(accessRoute.options.beforeLoad).toBeUndefined();
    expect(accessRoute.options.component().props).toMatchObject({
      to: "/admin/settings",
      search: { tab: "team" },
      replace: true,
    });

    const staffMod = await import("@/start-app/routes/admin.staff.$tab");
    const staffRoute = staffMod.Route as unknown as {
      options: { beforeLoad: (args: { params: { tab: string } }) => { tab: string } };
    };
    expect(staffRoute.options.beforeLoad({ params: { tab: "roster" } })).toEqual({ tab: "roster" });
    let caughtBadTab: unknown;
    try {
      staffRoute.options.beforeLoad({ params: { tab: "bogus" } });
    } catch (thrown) {
      caughtBadTab = thrown;
    }
    // N06: a stale staff sub-page stays in Staff bookings; its not-found screen offers the section's pages.
    expect(caughtBadTab).toEqual({ __notFound: true });

    const splatMod = await import("@/start-app/routes/admin.$");
    const splatRoute = splatMod.Route as unknown as {
      options: { beforeLoad: (args: { location: { pathname: string } }) => void };
    };
    let caughtTypo: unknown;
    try {
      splatRoute.options.beforeLoad({ location: { pathname: "/admin/chat" } });
    } catch (thrown) {
      caughtTypo = thrown;
    }
    expect(caughtTypo).toEqual({
      __redirect: true,
      to: "/admin/chats",
      replace: true,
      statusCode: 307,
    });
    let caughtDeep404: unknown;
    try {
      splatRoute.options.beforeLoad({ location: { pathname: "/admin/chats/nonexistent" } });
    } catch (thrown) {
      caughtDeep404 = thrown;
    }
    expect(caughtDeep404).toEqual({ __notFound: true });

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    const previewMod = await import("@/start-app/routes/admin.checkout.preview");
    const previewRoute = previewMod.Route as unknown as {
      options: { loader: () => Promise<{ enabled: boolean }> };
    };
    await expect(previewRoute.options.loader()).rejects.toEqual({ __notFound: true });
    expect(setResponseStatus).toHaveBeenCalledWith(404, "Not Found");

    vi.stubEnv("VERCEL_ENV", "preview");
    await expect(previewRoute.options.loader()).resolves.toEqual({ enabled: true });
  });
});
