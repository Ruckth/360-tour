// @vitest-environment happy-dom
import React, { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntlProvider } from "@/platform/intl";
import en from "../../messages/en.json";
import th from "../../messages/th.json";
import ja from "../../messages/ja.json";
import fr from "../../messages/fr.json";
import { buildEmailHref } from "@/lib/contact-links";
import { applyThemePreference, readThemePreference, resolveStoredTheme, THEME_STORAGE_KEY } from "@/lib/theme";
import { registerGuestBottomControl } from "@/lib/guest-bottom-inset";
import { StartRoomError } from "@/start-app/guest/StartRoomBoundaries";
import { StartRoomUnavailableError, loadStartRoomData } from "@/start-app/guest/room-route";

const navState = vi.hoisted(() => ({
  pathname: "/",
  searchParams: new URLSearchParams(),
}));

vi.mock("@/platform/navigation", () => ({
  usePathname: () => navState.pathname,
  useSearchParams: () => navState.searchParams,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/platform/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children?: ReactNode;
    [key: string]: unknown;
  }) => React.createElement("a", { href, ...rest }, children),
}));

let root: Root | null = null;

async function renderWithIntl(locale: string, messages: typeof en, node: ReactNode) {
  const intl = { locale, messages, timeZone: "Asia/Bangkok" } as unknown as ComponentProps<typeof IntlProvider>;
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(React.createElement(IntlProvider, intl, node));
  });
  return container;
}

describe("Slice 1 guest chrome, navigation, legal, auth, theme, and error UX", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    navState.pathname = "/";
    navState.searchParams = new URLSearchParams();
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
    document.documentElement.style.removeProperty("--guest-bottom-clearance");
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root!.unmount());
      root = null;
    }
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("G01 & G33: LanguageSwitcher ignores pointerdown drags, navigates on click, and stays on valid auth routes", async () => {
    navState.pathname = "/sign-up";
    navState.searchParams = new URLSearchParams("redirect_url=%2Fadmin");
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign, hash: "#step-1" });

    const { LanguageSwitcher } = await import("@/components/global/LanguageSwitcher");
    const container = await renderWithIntl("en", en, React.createElement(LanguageSwitcher, { compact: true }));

    const trigger = container.querySelector<HTMLButtonElement>('[data-testid="language-switcher"]');
    expect(trigger).not.toBeNull();
    await act(async () => {
      trigger!.click();
    });

    const thaiLink = document.querySelector<HTMLAnchorElement>('a[data-locale="th"]');
    expect(thaiLink).not.toBeNull();
    // G33: exempt auth route keeps /sign-up instead of unregistered /th/sign-up, preserving query & hash.
    expect(thaiLink!.getAttribute("href")).toBe("/sign-up?redirect_url=%2Fadmin#step-1");

    // G01: pointerdown alone (e.g. start of touch scroll drag) must not navigate.
    await act(async () => {
      thaiLink!.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    });
    expect(assign).not.toHaveBeenCalled();

    // Completed primary click sets locale cookie and navigates.
    await act(async () => {
      thaiLink!.click();
    });
    expect(document.cookie).toContain("NEXT_LOCALE=th");
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("G02, N01, N02: SiteHeader and SiteFooter expose localized Services, legal labels, and stay enquiry email", async () => {
    const { SiteHeader } = await import("@/components/global/SiteHeader");
    const { SiteFooter } = await import("@/components/global/SiteFooter");
    const container = await renderWithIntl(
      "th",
      th,
      React.createElement(React.Fragment, null, React.createElement(SiteHeader), React.createElement(SiteFooter)),
    );

    const headerLinks = [...container.querySelectorAll("header a")];
    const headerServices = headerLinks.find((link) => link.getAttribute("href") === "/th/services");
    expect(headerServices?.textContent?.trim()).toBe(th.Nav.services);

    const footerLinks = [...container.querySelectorAll("footer a")];
    expect(footerLinks.find((link) => link.getAttribute("href") === "/th/services")?.textContent?.trim()).toBe(
      th.Nav.services,
    );
    expect(footerLinks.find((link) => link.getAttribute("href") === "/th/privacy")?.textContent?.trim()).toBe(
      th.Legal.privacy.title,
    );
    expect(footerLinks.find((link) => link.getAttribute("href") === "/th/terms")?.textContent?.trim()).toBe(
      th.Legal.terms.title,
    );

    const mailLink = footerLinks.find((link) => link.getAttribute("href")?.startsWith("mailto:"));
    expect(mailLink).toBeDefined();
    const mailUrl = new URL(mailLink!.getAttribute("href")!);
    expect(mailUrl.searchParams.get("subject")).toBe(th.Footer.enquirySubject.replace("{resortName}", "Auralis Cove Retreat"));
    expect(mailUrl.searchParams.get("body")).toBe(th.Footer.enquiryBody.replace("{resortName}", "Auralis Cove Retreat"));
    expect(mailUrl.searchParams.get("subject")).not.toContain("Website inquiry");

    // Also verify Japanese and French legal titles resolve properly.
    expect(ja.Legal.privacy.title).not.toBe("Privacy policy");
    expect(fr.Legal.terms.title).not.toBe("Terms");
    expect(buildEmailHref("guest@example.com", "Stay question", "Stay enquiry")).toContain("subject=Stay%20enquiry");
  });

  it("N03: ThemeToggle offers System, Light and Dark, clears override for System, and follows device scheme changes", async () => {
    let prefersDark = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", () => ({
      get matches() {
        return prefersDark;
      },
      addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
    }));

    const { ThemeToggle } = await import("@/components/global/ThemeToggle");
    const container = await renderWithIntl("en", en, React.createElement(ThemeToggle));
    const trigger = container.querySelector<HTMLButtonElement>('[data-testid="theme-toggle"]')!;

    await act(async () => trigger.click());
    const darkOption = [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
      (btn) => btn.textContent?.includes("Dark"),
    );
    expect(darkOption).toBeDefined();
    await act(async () => darkOption!.click());
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    // Return to System: removes explicit preference and follows media query changes.
    await act(async () => trigger.click());
    const systemOption = [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
      (btn) => btn.textContent?.includes("System"),
    );
    await act(async () => systemOption!.click());
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(readThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY))).toBe("system");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    prefersDark = true;
    await act(async () => {
      for (const listener of listeners) listener();
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(resolveStoredTheme(null, true)).toBe(true);
    expect(applyThemePreference("light", { prefersDark: true, dispatch: false })).toBe(false);
  });

  it("G03: guest bottom inset coordinates clearance for MobileStickyBar and cleans up on unmount", () => {
    const bar = document.createElement("div");
    document.body.appendChild(bar);
    const cleanup = registerGuestBottomControl("mobile-sticky-bar", bar, { fallbackPx: 88 });
    expect(document.documentElement.style.getPropertyValue("--guest-bottom-clearance")).toBe("88px");
    cleanup();
    expect(document.documentElement.style.getPropertyValue("--guest-bottom-clearance")).toBe("");
  });

  it("G32: LegalPage renders an article instead of a nested main landmark", async () => {
    const { LegalPage } = await import("@/components/legal/LegalPage");
    const html = renderToStaticMarkup(
      React.createElement(
        IntlProvider,
        { locale: "en", messages: en, timeZone: "Asia/Bangkok" } as unknown as ComponentProps<typeof IntlProvider>,
        React.createElement("main", null, React.createElement(LegalPage, { kind: "privacy" })),
      ),
    );
    expect(html.match(/<main\b/g)?.length).toBe(1);
    expect(html).toContain("<article");
  });

  it("N08: Thai villa-load outage returns localized heading, detail, and retry label with 503 status", async () => {
    const setResponseStatus = vi.fn();
    const setResponseHeader = vi.fn();
    const result = await loadStartRoomData(
      { slug: "pool-villa", locale: "th" },
      {
        getStartVilla: () => Promise.reject({ retryAfterSeconds: 20 }),
        villaCacheHeader: () => "unavailable",
        isVillaUnavailableError: (err): err is { retryAfterSeconds: number } =>
          Boolean(err && typeof err === "object" && "retryAfterSeconds" in err),
        getLocalizedResort: () => ({ name: "Auralis Cove Retreat", description: "desc" }),
        getPublicMessages: () => ({ Villa: th.Villa }),
        siteUrl: () => "https://auralis.example",
        getRequest: () => new Request("https://auralis.example/th/rooms/pool-villa"),
        setResponseStatus,
        setResponseHeader,
      },
    );

    expect(setResponseStatus).toHaveBeenCalledWith(503, "Service Unavailable");
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") throw new Error("expected unavailable");
    expect(result.heading).toBe(th.Villa.unavailableTitle);
    expect(result.detail).toBe(th.Villa.unavailableDetail);
    expect(result.retryLabel).toBe(th.Villa.tryAgain);

    const html = renderToStaticMarkup(
      React.createElement(StartRoomError, {
        error: new StartRoomUnavailableError(result),
        onRetry: () => {},
      }),
    );
    expect(html).toContain('data-status="503"');
    expect(html).toContain(th.Villa.unavailableTitle);
    expect(html).toContain(th.Villa.unavailableDetail);
    expect(html).toContain(th.Villa.tryAgain);
    expect(html).toContain(th.Villa.backHome);
  });
});
