// @vitest-environment happy-dom
import React, { act, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../messages/en.json";
import type { Review } from "@/lib/data/reviews";
import type { PublicVilla } from "@/lib/villas";
import { StartRoomError, StartRoomNotFound } from "@/start-app/guest/StartRoomBoundaries";
import {
  StartRoomLoadError,
  StartRoomUnavailableError,
} from "@/start-app/guest/room-route";

const { mockSearch, mockReplace, mockTourViewerRender } = vi.hoisted(() => ({
  mockSearch: { current: new URLSearchParams() },
  mockReplace: vi.fn(),
  mockTourViewerRender: vi.fn(),
}));

// Mirror the adapter contract Root provides in the Start runtime:
// next/dynamic with ssr:false renders nothing during SSR and loads client-only WebGL after hydration.
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<React.ComponentType<Record<string, unknown>>>) => {
    return function DynamicAdapter(props: Record<string, unknown>) {
      const [Loaded, setLoaded] = React.useState<React.ComponentType<Record<string, unknown>> | null>(
        null,
      );
      React.useEffect(() => {
        let active = true;
        void loader().then((Component) => {
          if (active) setLoaded(() => Component);
        });
        return () => {
          active = false;
        };
      }, []);
      return Loaded ? React.createElement(Loaded, props) : null;
    };
  },
}));

vi.mock("next/link", () => ({
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

vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    className,
  }: {
    src: string;
    alt: string;
    className?: string;
  }) => React.createElement("img", { src, alt, className }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => "/rooms/pool-villa",
  useSearchParams: () => mockSearch.current,
}));

vi.mock("next-intl", () => ({
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

vi.mock("@/lib/tour/preload", () => ({
  loadTourViewer: async () => {
    return function MockTourViewer({ property }: { property: PublicVilla }) {
      mockTourViewerRender(property.id);
      return React.createElement("div", { "data-testid": "mock-webgl-tour" }, `360:${property.id}`);
    };
  },
  preloadTourViewer: vi.fn(),
}));

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
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="mock-webgl-tour"]')?.textContent).toBe(
      "360:pool-villa",
    );
    expect(mockTourViewerRender).toHaveBeenCalledWith("pool-villa");

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
