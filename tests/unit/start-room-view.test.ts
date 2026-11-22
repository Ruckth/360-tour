// @vitest-environment happy-dom
import React, { act, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../messages/en.json";
import type { Review } from "@/lib/data/reviews";
import type { PublicVilla } from "@/lib/villas";
import { localizeHref } from "@/i18n/routing";
import { StartRoomError, StartRoomNotFound } from "@/start-app/guest/StartRoomBoundaries";
import {
  StartRoomLoadError,
  StartRoomUnavailableError,
} from "@/start-app/guest/room-route";

const { mockSearch, mockReplace, mockTourViewerRender, mockLoadTourViewer, mockPreloadTourViewer } = vi.hoisted(() => ({
  mockSearch: { current: new URLSearchParams() },
  mockReplace: vi.fn(),
  mockTourViewerRender: vi.fn(),
  mockLoadTourViewer: vi.fn(),
  mockPreloadTourViewer: vi.fn(),
}));

vi.mock("@/platform/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => React.createElement("a", { href, ...rest }, children),
}));

// Exposes the props that decide the request: priority (preload + high), quality (part of the optimizer URL),
// loading and fetchPriority.
vi.mock("@/platform/image", () => ({
  default: ({
    src,
    alt,
    className,
    priority,
    quality,
    loading,
    fetchPriority,
  }: {
    src: string;
    alt: string;
    className?: string;
    priority?: boolean;
    quality?: number;
    loading?: "eager" | "lazy";
    fetchPriority?: "high" | "low" | "auto";
  }) =>
    React.createElement("img", {
      src,
      alt,
      className,
      loading,
      fetchPriority,
      "data-priority": String(Boolean(priority)),
      "data-quality": quality,
    }),
}));

vi.mock("@/platform/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => "/rooms/pool-villa",
  useSearchParams: () => mockSearch.current,
}));

vi.mock("@/platform/intl", () => ({
  useLocale: () => "en",
  useMessages: () => enMessages,
  useTranslations: (namespace: keyof typeof enMessages) => {
    const table = enMessages[namespace] as Record<string, string>;
    return (key: string, values?: Record<string, string | number>) => {
      let template = table[key] ?? `${namespace}.${key}`;
      if (values) {
        for (const [k, v] of Object.entries(values)) {
          template = template.replaceAll(`{${k}}`, String(v));
        }
      }
      return template;
    };
  },
}));

vi.mock("convex/react", () => ({
  useQuery: () => undefined,
}));

// RoomDetailClient mounts the viewer through RoomTourViewer, which imports it only after the tour is requested.
vi.mock("@/lib/tour/preload", () => ({
  loadTourViewer: mockLoadTourViewer,
  preloadTourViewer: mockPreloadTourViewer,
}));

function MockTourViewer({ property, onFirstSceneDrawn }: { property: PublicVilla; onFirstSceneDrawn?: () => void }) {
  mockTourViewerRender(property.id);
  return React.createElement("button", { "data-testid": "mock-webgl-tour", onClick: onFirstSceneDrawn }, `360:${property.id}`);
}

const sampleVilla: PublicVilla = {
  id: "pool-villa",
  slug: "pool-villa",
  name: "Pool Villa",
  tagline: "Private infinity pool overlooking the bay",
  description: "Spacious hillside sanctuary with private pool and ocean deck.",
  pricePerNight: 1_200_000,
  currency: "THB",
  maxGuests: 4,
  bedrooms: 2,
  bathrooms: 2,
  area: 180,
  images: ["/images/pool-villa-hero.webp"],
  amenities: ["Private pool", "High-speed Wi-Fi"],
  tourRoomIds: ["pv-living"],
  directDiscountPercent: 1500,
  rating: { average: 4.9, count: 12 },
};

const sampleReviews: Review[] = [
  {
    id: "rev-1",
    propertyId: "pool-villa",
    author: { name: "Nadia", city: "Singapore", country: "Singapore", avatarUrl: "" },
    rating: 5,
    title: "Unforgettable view",
    body: "Waking up to the bay was extraordinary.",
    date: "2026-09-01",
    verified: true,
  },
];

describe("RoomDetailClient SSR and client-only WebGL island", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mockSearch.current = new URLSearchParams();
    mockReplace.mockReset();
    mockTourViewerRender.mockReset();
    // RoomTourViewer caches its import per module instance; each test starts without it.
    vi.resetModules();
    mockLoadTourViewer.mockReset();
    mockLoadTourViewer.mockResolvedValue(MockTourViewer);
    mockPreloadTourViewer.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("renders full villa SSR HTML directly while keeping WebGL TourViewer out of SSR even on ?tour=1", async () => {
    mockSearch.current = new URLSearchParams("tour=1");
    const { RoomDetailClient } = await import("@/components/rooms/RoomDetailClient");

    const html = renderToStaticMarkup(
      React.createElement(
        Suspense,
        { fallback: React.createElement("div", null, "Loading villa...") },
        React.createElement(RoomDetailClient, { property: sampleVilla, reviews: sampleReviews }),
      ),
    );

    expect(html).toContain("<h1");
    expect(html).toContain("Pool Villa");
    expect(html).toContain("Private infinity pool overlooking the bay");
    expect(html).toContain("Spacious hillside sanctuary with private pool and ocean deck.");
    expect(html).toContain("Private pool");
    expect(html).toContain("Unforgettable view");
    expect(html).toContain("Explore 360");
    expect(html).not.toContain("mock-webgl-tour");
    expect(mockTourViewerRender).not.toHaveBeenCalled();
    // The server render never starts the client-only viewer import.
    expect(mockLoadTourViewer).not.toHaveBeenCalled();
    // The tour intro covers the room from the server render on, with a plain link back to the room.
    expect(html).toContain('data-testid="tour-viewer-loading"');
    expect(html).toContain(">Loading...</p>");
    expect(html).toMatch(new RegExp(`<a href="${localizeHref("/rooms/pool-villa", "en")}"[^>]*aria-label="Close"`));
    // The full-screen intro owns the transfer window until the panorama draws or the guest closes.
    expect(html).not.toContain('alt="Pool Villa photo 1"');
  });

  it("keeps an ordinary room visit unchanged: no tour intro and a high-priority first photo", () => {
    return import("@/components/rooms/RoomDetailClient").then(({ RoomDetailClient }) => {
      const html = renderToStaticMarkup(React.createElement(RoomDetailClient, { property: sampleVilla, reviews: sampleReviews }));
      expect(html).not.toContain("tour-viewer-loading");
      expect(html).toMatch(/<img[^>]*alt="Pool Villa photo 1"[^>]*loading="eager"[^>]*data-priority="true"[^>]*data-quality="82"/);
      expect(html).not.toContain('fetchpriority="low"');
    });
  });

  it("never requests the viewer module on an ordinary room page", async () => {
    const { RoomDetailClient } = await import("@/components/rooms/RoomDetailClient");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(RoomDetailClient, { property: sampleVilla, reviews: sampleReviews }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Explore 360");
    expect(container.querySelector('[data-testid="mock-webgl-tour"]')).toBeNull();
    expect(mockLoadTourViewer).not.toHaveBeenCalled();
    expect(mockPreloadTourViewer).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("closes from the loading intro, before the viewer module arrives, without refetching the photo", async () => {
    mockSearch.current = new URLSearchParams("tour=1");
    let resolveViewer!: (viewer: typeof MockTourViewer) => void;
    mockLoadTourViewer.mockReturnValue(new Promise((resolve) => (resolveViewer = resolve)));
    const { RoomDetailClient } = await import("@/components/rooms/RoomDetailClient");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(RoomDetailClient, { property: sampleVilla, reviews: sampleReviews }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector('img[alt="Pool Villa photo 1"]')).toBeNull();

    await act(async () => {
      container.querySelector<HTMLAnchorElement>('a[aria-label="Close"]')!.click();
    });
    expect(mockReplace).toHaveBeenCalledWith(localizeHref("/rooms/pool-villa", "en"), { scroll: false });
    expect(container.querySelector('[data-testid="tour-viewer-loading"]')).toBeNull();
    const after = container.querySelector('img[alt="Pool Villa photo 1"]');
    expect(after?.getAttribute("src")).toBe(sampleVilla.images[0]);
    expect(after?.getAttribute("data-quality")).toBe("82");
    expect(after?.getAttribute("data-priority")).toBe("true");
    expect(after?.getAttribute("fetchpriority")).not.toBe("low");

    await act(async () => {
      resolveViewer(MockTourViewer);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mockTourViewerRender).not.toHaveBeenCalled();
    expect(mockLoadTourViewer).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
  });

  it("closes the loading intro with Escape after hydration", async () => {
    mockSearch.current = new URLSearchParams("tour=1");
    mockLoadTourViewer.mockReturnValue(new Promise(() => {}));
    const { RoomDetailClient } = await import("@/components/rooms/RoomDetailClient");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(RoomDetailClient, { property: sampleVilla, reviews: sampleReviews }));
    });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(container.querySelector('[data-testid="tour-viewer-loading"]')).toBeNull();
    expect(mockReplace).toHaveBeenCalledWith(localizeHref("/rooms/pool-villa", "en"), { scroll: false });
    await act(async () => root.unmount());
  });

  it("mounts the client-only WebGL TourViewer after hydration when ?tour=1 is active", async () => {
    mockSearch.current = new URLSearchParams("tour=1");
    const { RoomDetailClient } = await import("@/components/rooms/RoomDetailClient");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(
          Suspense,
          { fallback: React.createElement("div", null, "Loading villa...") },
          React.createElement(RoomDetailClient, { property: sampleVilla, reviews: sampleReviews }),
        ),
      );
      // The import resolves through a short promise chain; one macrotask settles it.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockLoadTourViewer).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="mock-webgl-tour"]')?.textContent).toBe(
      "360:pool-villa",
    );
    expect(mockTourViewerRender).toHaveBeenCalledWith("pool-villa");
    expect(container.querySelector('img[alt="Pool Villa photo 1"]')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="mock-webgl-tour"]')!.click());
    const photo = container.querySelector('img[alt="Pool Villa photo 1"]');
    expect(photo?.getAttribute("src")).toBe(sampleVilla.images[0]);
    expect(photo?.getAttribute("fetchpriority")).toBe("low");
    expect(photo?.getAttribute("data-quality")).toBe("82");

    await act(async () => {
      root.unmount();
    });
  });
});

describe("StartRoomNotFound and StartRoomError boundaries", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("renders localized 404 state and safe fallback when data is omitted", () => {
    const localizedHtml = renderToStaticMarkup(
      React.createElement(StartRoomNotFound, {
        data: {
          locale: "th",
          reason: "missing-villa",
          title: "ไม่พบวิลล่า",
          backHomeLabel: "กลับหน้าหลัก",
          homeHref: "/th",
        },
      }),
    );
    expect(localizedHtml).toContain("ไม่พบวิลล่า");
    expect(localizedHtml).toContain('href="/th"');
    expect(localizedHtml).toContain("กลับหน้าหลัก");

    const fallbackHtml = renderToStaticMarkup(React.createElement(StartRoomNotFound, {}));
    expect(fallbackHtml).toContain("Property not found");
    expect(fallbackHtml).toContain('href="/"');
  });

  it("renders retriable 503 state and sanitized 500 state without exposing raw error text", async () => {
    const onRetry = vi.fn();
    const error503 = new StartRoomUnavailableError({
      retryAfterSeconds: 30,
      homeHref: "/th",
      backHomeLabel: "กลับหน้าหลัก",
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(StartRoomError, { error: error503, onRetry }));
    });

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.getAttribute("data-status")).toBe("503");
    expect(container.textContent).toContain("Villa details are temporarily unavailable");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/th");

    await act(async () => {
      container.querySelector("button")?.click();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);

    const error500 = new StartRoomLoadError({
      homeHref: "/ja",
      backHomeLabel: "ホームに戻る",
    });
    const html500 = renderToStaticMarkup(React.createElement(StartRoomError, { error: error500 }));
    expect(html500).toContain('data-status="500"');
    expect(html500).toContain('href="/ja"');
    expect(html500).toContain("Something went wrong");

    await act(async () => {
      root.unmount();
    });
  });
});
