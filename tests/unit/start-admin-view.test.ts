// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {} from "@/start-app/routeTree.gen";
import {
  AdminClerkSetupRequired,
  AdminViewErrorCard,
  StartAdminNotFound,
} from "@/start-app/admin/AdminBoundaries";

const state = vi.hoisted(() => ({
  loaderData: { clerkConfigured: true, locale: "en", commerce: { Commerce: { ok: "OK" } } } as Record<string, unknown>,
  params: { id: "prop-123", orderId: "order-789" } as Record<string, string>,
  search: {} as Record<string, unknown>,
  routeContext: { tab: "services" } as Record<string, unknown>,
  push: vi.fn(),
  sessionId: null as string | null,
  fetchCommerce: vi.fn(async () => ({ Commerce: { ok: "OK" } })),
}));

// Boundary components read the path to name the section; route wiring tests below replace this.
const boundaryPath = vi.hoisted(() => ({ value: "/admin/nowhere" }));
vi.mock("@/platform/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/platform/navigation")>()),
  usePathname: () => boundaryPath.value,
}));

vi.mock("@/platform/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode; [key: string]: unknown }) =>
    React.createElement("a", { href, ...rest }, children),
}));

describe("Start admin boundary components", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("renders the Clerk setup gate with exact required env variable guidance", () => {
    const html = renderToStaticMarkup(React.createElement(AdminClerkSetupRequired));
    expect(html).toContain("Admin setup");
    expect(html).toContain("Clerk is required for admin");
    expect(html).toContain("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
    expect(html).toContain("CLERK_SECRET_KEY");
    expect(html).toContain("CLERK_JWT_ISSUER_DOMAIN");
    expect(html).toContain("company owner grant");
  });

  it("renders AdminViewErrorCard with alert semantics, fallback copy, and retry action", async () => {
    const onRetry = vi.fn();
    await act(async () => {
      root.render(
        React.createElement(AdminViewErrorCard, {
          error: new Error("Not authorized for operations"),
          onRetry,
        }),
      );
    });

    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("This view could not load");
    expect(alert?.textContent).toContain("Not authorized for operations");

    await act(async () => {
      host.querySelector("button")?.click();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);

    const fallbackHtml = renderToStaticMarkup(
      React.createElement(AdminViewErrorCard, { error: new Error(""), onRetry }),
    );
    expect(fallbackHtml).toContain("Check admin authorization and try again.");
  });

  it("renders StartAdminNotFound with standard 404 boundary copy and a link back to /admin/chats", () => {
    const html = renderToStaticMarkup(React.createElement(StartAdminNotFound));
    expect(html).toContain(">404<");
    expect(html).toContain("This page could not be found.");
    expect(html).toContain('href="/admin/chats"');
    expect(html).toContain("Back to Chats");
  });

  it("keeps a stale Staff bookings link in its section with that section's pages (N06)", () => {
    boundaryPath.value = "/admin/staff/old-tab";
    const html = renderToStaticMarkup(React.createElement(StartAdminNotFound));
    boundaryPath.value = "/admin/nowhere";
    expect(html).toContain("This Staff bookings page doesn’t exist");
    for (const href of ["/admin/staff/calendar", "/admin/staff/roster", "/admin/staff/staff", "/admin/staff/services"]) expect(html).toContain(`href="${href}"`);
    expect(html).not.toContain("Back to Chats");
  });
});

describe("Start admin route components wiring", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    state.push.mockReset();
    state.sessionId = null;
    state.search = {};
    state.fetchCommerce.mockClear();
    vi.doMock("@/platform/auth", () => ({
      useAuth: () => ({ isLoaded: true, isSignedIn: Boolean(state.sessionId), sessionId: state.sessionId }),
    }));

    vi.doMock("@tanstack/react-router", () => ({
      createFileRoute: (id: string) => (options: Record<string, unknown>) => ({
        id,
        options,
        useLoaderData: () => state.loaderData,
        useParams: () => state.params,
        useNavigate: () => state.push,
        useSearch: () => (options.validateSearch as ((search: Record<string, unknown>) => unknown) | undefined)?.(state.search) ?? state.search,
        useRouteContext: () => state.routeContext,
      }),
      Outlet: () => React.createElement("div", { "data-testid": "admin-outlet" }, "outlet-child"),
      notFound: () => ({ __notFound: true }),
      redirect: (payload: Record<string, unknown>) => ({ __redirect: true, ...payload }),
      useRouter: () => ({ invalidate: vi.fn() }),
      useBlocker: vi.fn(),
    }));

    vi.doMock("@tanstack/react-start", () => ({
      useServerFn: () => state.fetchCommerce,
      createServerFn: () => ({
        validator: () => ({ handler: () => async () => state.loaderData }),
        handler: () => async () => ({ enabled: true }),
      }),
    }));

    vi.doMock("@/components/admin/AdminShell", () => ({
      AdminShell: ({ children }: { children: React.ReactNode }) =>
        React.createElement("div", { "data-testid": "real-admin-shell" }, children),
    }));

    vi.doMock("@/components/checkout/commerce-messages", () => ({
      CommerceMessages: ({ messages, children }: { messages: Record<string, unknown>; children: React.ReactNode }) =>
        React.createElement("div", { "data-testid": "commerce-messages", "data-has-commerce": String("Commerce" in messages) }, children),
    }));

    vi.doMock("@/components/admin/AdminPropertyEditor", () => ({
      AdminPropertyEditor: ({ propertyId, tab }: { propertyId: string; tab?: string }) =>
        React.createElement("div", { "data-property-id": propertyId, "data-property-tab": tab ?? "details" }),
    }));

    vi.doMock("@/components/admin/marketing/MarketingScreens", () => ({
      MarketingCouponScreen: ({ couponId }: { couponId: string }) =>
        React.createElement("div", { "data-coupon-id": couponId }),
      MarketingCampaignsScreen: () => null,
      MarketingCouponsScreen: () => null,
      MarketingLinksScreen: () => null,
    }));

    vi.doMock("@/components/admin/AdminStaffBookingsView", () => ({
      AdminStaffTabs: ({ children }: { children: React.ReactNode }) =>
        React.createElement("div", { "data-testid": "staff-tabs" }, children),
      AdminStaffBookingsView: ({ tab }: { tab: string }) =>
        React.createElement("div", { "data-staff-tab": tab }),
    }));

    vi.doMock("@/platform/navigation", () => ({
      useRouter: () => ({ push: state.push, replace: vi.fn() }),
      useSearchParams: () => new URLSearchParams(),
      usePathname: () => "/admin/receipt/order-789",
      useSelectedLayoutSegment: () => null,
    }));

    vi.doMock("@/components/checkout/convex-backend", () => {
      const actions = { reportCouponRefusal: vi.fn() };
      return { convexCheckoutBackend: { useActions: () => actions } };
    });

    vi.doMock("@/components/checkout/timing-gate", () => ({
      useCheckoutTiming: (backend: unknown) => ({
        backend,
        readout: React.createElement("span", { "data-testid": "timing-readout" }),
      }),
    }));

    vi.doMock("@/components/checkout/ReceiptView", () => ({
      ReceiptView: ({
        orderId,
        onNewSale,
        onOpenOrder,
      }: {
        orderId: string;
        onNewSale: () => void;
        onOpenOrder: (id: string) => void;
      }) =>
        React.createElement(
          "div",
          { "data-receipt-order": orderId },
          React.createElement("button", { type: "button", "data-action": "new-sale", onClick: onNewSale }, "New sale"),
          React.createElement(
            "button",
            { type: "button", "data-action": "open-order", onClick: () => onOpenOrder("order-next") },
            "Open order",
          ),
        ),
    }));
  });

  afterEach(() => {
    vi.doUnmock("@tanstack/react-router");
    vi.doUnmock("@tanstack/react-start");
    vi.doUnmock("@/components/admin/AdminShell");
    vi.doUnmock("@/components/checkout/commerce-messages");
    vi.doUnmock("@/components/admin/AdminPropertyEditor");
    vi.doUnmock("@/components/admin/marketing/MarketingScreens");
    vi.doUnmock("@/components/admin/AdminStaffBookingsView");
    vi.doUnmock("@/platform/navigation");
    vi.doUnmock("@/platform/auth");
    vi.doUnmock("@/components/checkout/convex-backend");
    vi.doUnmock("@/components/checkout/timing-gate");
    vi.doUnmock("@/components/checkout/ReceiptView");
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("mounts commerce messages after sign-in and removes them on sign-out", async () => {
    const adminMod = await import("@/start-app/routes/admin");
    const Layout = (adminMod.Route as unknown as { options: { component: React.ComponentType } }).options.component;

    state.loaderData = { clerkConfigured: false };
    const unconfiguredHtml = renderToStaticMarkup(React.createElement(Layout));
    expect(unconfiguredHtml).toContain("Clerk is required for admin");
    expect(unconfiguredHtml).not.toContain("real-admin-shell");

    state.loaderData = { clerkConfigured: true, locale: "en" };
    const anonymous = renderToStaticMarkup(React.createElement(Layout));
    expect(anonymous).toContain('data-testid="real-admin-shell"');
    expect(anonymous).toContain('data-testid="admin-outlet"');
    expect(anonymous).not.toContain("commerce-messages");
    expect(state.fetchCommerce).not.toHaveBeenCalled();

    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    try {
      state.sessionId = "owner-session";
      await act(async () => root.render(React.createElement(Layout)));
      expect(state.fetchCommerce).toHaveBeenCalledTimes(1);
      expect(host.querySelector('[data-testid="commerce-messages"]')?.getAttribute("data-has-commerce")).toBe("true");
      expect(host.querySelector('[data-testid="admin-outlet"]')).not.toBeNull();

      state.sessionId = null;
      await act(async () => root.render(React.createElement(Layout)));
      expect(host.querySelector('[data-testid="commerce-messages"]')).toBeNull();
      expect(state.fetchCommerce).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it("forwards dynamic $id, $tab, and $orderId params and receipt navigation controls", async () => {
    const propertyMod = await import("@/start-app/routes/admin.properties.$id");
    const { ConfirmProvider } = await import("@/components/admin/ConfirmDialog");
    const Property = (propertyMod.Route as unknown as { options: { component: React.ComponentType } }).options.component;
    const renderProperty = () => renderToStaticMarkup(React.createElement(ConfirmProvider, null, React.createElement(Property)));
    state.params = { id: "villa-42" };
    state.search = { tab: "reviews" };
    const propertyHtml = renderProperty();
    expect(propertyHtml).toContain('data-property-id="villa-42"');
    expect(propertyHtml).toContain('data-property-tab="reviews"');
    state.search = { tab: ["reviews", "calendar"] };
    expect(renderProperty()).toContain('data-property-tab="details"');

    const couponMod = await import("@/start-app/routes/admin.marketing.coupons.$id");
    const Coupon = (couponMod.Route as unknown as { options: { component: React.ComponentType } }).options.component;
    state.params = { id: "new" };
    expect(renderToStaticMarkup(React.createElement(Coupon))).toContain('data-coupon-id="new"');

    const staffLayoutMod = await import("@/start-app/routes/admin.staff");
    const StaffLayout = (staffLayoutMod.Route as unknown as { options: { component: React.ComponentType } }).options.component;
    expect(renderToStaticMarkup(React.createElement(StaffLayout))).toContain('data-testid="staff-tabs"');

    const staffTabMod = await import("@/start-app/routes/admin.staff.$tab");
    const StaffTab = (staffTabMod.Route as unknown as { options: { component: React.ComponentType } }).options.component;
    state.routeContext = { tab: "services" };
    expect(renderToStaticMarkup(React.createElement(StaffTab))).toContain('data-staff-tab="services"');

    const receiptMod = await import("@/start-app/routes/admin.receipt.$orderId");
    const Receipt = (receiptMod.Route as unknown as { options: { component: React.ComponentType } }).options.component;
    state.params = { orderId: "order-789" };
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    await act(async () => {
      root.render(React.createElement(Receipt));
    });
    expect(host.querySelector('[data-receipt-order="order-789"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="timing-readout"]')).not.toBeNull();

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-action="new-sale"]')?.click();
      host.querySelector<HTMLButtonElement>('[data-action="open-order"]')?.click();
    });
    expect(state.push).toHaveBeenNthCalledWith(1, "/admin/checkout");
    expect(state.push).toHaveBeenNthCalledWith(2, "/admin/checkout?order=order-next");

    await act(async () => root.unmount());
  });
});
