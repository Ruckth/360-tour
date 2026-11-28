// @vitest-environment happy-dom
import React, { act, useState, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IntlProvider } from "@/platform/intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";
import type { PublicVilla } from "@/lib/villas";
import { PriceComparison } from "@/components/pricing/PriceComparison";
import { HomeHero } from "@/components/home/HomeHero";
import { HomeQuickBooking } from "@/components/home/HomeQuickBooking";
import { LocationMapPreview, RESORT_DIRECTIONS_URL } from "@/components/home/LocationMapPreview";
import { VillaCard } from "@/components/home/VillaCard";
import { BookingRangePicker } from "@/components/booking/BookingDatePicker";
import { MobileStickyBar } from "@/components/booking/MobileStickyBar";
import { RoomDetailClient } from "@/components/rooms/RoomDetailClient";
import { StarRating } from "@/components/social/StarRating";
import { LeadCapture } from "@/components/tour/LeadCapture";
import { TourViewerContent } from "@/components/tour/TourViewerContent";
import { useTourOpener } from "@/lib/interaction/use-modal-focus";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  mutation: vi.fn(),
  query: vi.fn(),
  searchParams: new URLSearchParams(),
  liveRooms: [{ id: "pv-living", name: "Living Area", imagePath: "/tour/living.jpg", hotspots: [] }],
}));

vi.mock("@/platform/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace, prefetch: mocks.prefetch }),
  usePathname: () => "/rooms/pool-villa",
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/platform/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode; [key: string]: unknown }) =>
    React.createElement("a", { href, ...rest }, children),
}));

vi.mock("@/platform/image", () => ({
  default: ({ src, alt, className }: { src: string; alt: string; className?: string }) =>
    React.createElement("img", { src, alt, className }),
}));

vi.mock("@/platform/auth", () => ({
  useAuth: () => ({ userId: null }),
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery: () => undefined,
  useConvex: () => ({ mutation: mocks.mutation, query: mocks.query }),
}));

vi.mock("@/lib/tour/use-live-tour-rooms", () => ({
  useLiveTourRooms: () => ({ rooms: mocks.liveRooms, fresh: true }),
}));

vi.mock("@/platform/dynamic", () => ({
  default: () =>
    function DynamicWrapper(props: ComponentProps<typeof BookingRangePicker>) {
      return React.createElement(BookingRangePicker, props);
    },
}));

const sampleVilla: PublicVilla = {
  id: "pool-villa",
  slug: "pool-villa",
  name: "Tideglass Pool Residence",
  tagline: "Private infinity pool overlooking the bay",
  description: "Spacious hillside sanctuary.",
  pricePerNight: 550000,
  currency: "THB",
  maxGuests: 4,
  bedrooms: 2,
  bathrooms: 2,
  area: 180,
  images: ["/img/1.webp", "/img/2.webp", "/img/3.webp", "/img/4.webp"],
  amenities: ["Private pool"],
  tourRoomIds: ["pv-living"],
  directDiscountPercent: 1500,
  rating: { average: 4.9, count: 12 },
};

let root: Root | null = null;

async function renderIntl(node: ReactNode, locale = "en", messages = en) {
  const intl = { locale, messages, timeZone: "Asia/Bangkok" } as unknown as ComponentProps<typeof IntlProvider>;
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(React.createElement(IntlProvider, intl, node));
    await Promise.resolve();
  });
  return container;
}

describe("Slice 2: Home, rooms, reviews, and 360 tour UX", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.push.mockReset();
    mocks.replace.mockReset();
    mocks.prefetch.mockReset();
    mocks.mutation.mockReset();
    mocks.query.mockReset();
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root!.unmount());
      root = null;
    }
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("G07: HomeHero provides Pause/Play toggle that halts slide timers and hides under reduced motion", async () => {
    vi.useFakeTimers();
    let reduced = false;
    vi.stubGlobal("matchMedia", () => ({
      get matches() {
        return reduced;
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    }));

    const container = await renderIntl(React.createElement(HomeHero));
    const toggle = container.querySelector<HTMLButtonElement>('[data-testid="hero-motion-toggle"]');
    expect(toggle).not.toBeNull();
    expect(toggle!.getAttribute("aria-pressed")).toBe("false");

    await act(async () => toggle!.click());
    expect(toggle!.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[data-testid="home-hero"]')?.getAttribute("data-hero-motion")).toBe("paused");

    const stepWhilePaused = container.querySelector('[data-testid="home-hero"]')?.getAttribute("data-hero-step");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(container.querySelector('[data-testid="home-hero"]')?.getAttribute("data-hero-step")).toBe(stepWhilePaused);

    // Unmount and verify reduced motion hides forced animation toggle.
    await act(async () => root!.unmount());
    root = null;
    document.body.innerHTML = "";
    reduced = true;
    const reducedContainer = await renderIntl(React.createElement(HomeHero));
    expect(reducedContainer.querySelector('[data-testid="hero-motion-toggle"]')).toBeNull();
    expect(reducedContainer.querySelector('[data-testid="home-hero"]')?.getAttribute("data-hero-motion")).toBe("reduced");
  });

  it("G08: HomeQuickBooking opens Check-in calendar on blank Book submit without showing an error", async () => {
    const container = await renderIntl(React.createElement(HomeQuickBooking));
    expect(container.querySelector('[data-testid="booking-check-in"]')).not.toBeNull();
    const bookButton = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    await act(async () => {
      bookButton.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    const grid = document.querySelector('[role="grid"]');
    expect(grid).not.toBeNull();
    expect(document.activeElement).toBe(grid!.querySelector("button:not([disabled])"));
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it.each([
    { currency: "THB", price: 550000, discount: 1500, direct: "฿4,675", standard: "฿5,500" },
    { currency: "EUR", price: 12345, discount: 1255, direct: "EUR 107.96", standard: "EUR 123.45" },
    { currency: "USD", price: 12345, discount: 0, direct: "USD 123.45", standard: null },
  ])("G09 & G13: villa prices agree for $currency with discount $discount", async ({ currency, price, discount, direct, standard }) => {
    const property = { ...sampleVilla, currency, pricePerNight: price, directDiscountPercent: discount };
    const container = await renderIntl(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(VillaCard, { property }),
        React.createElement(PriceComparison, { property }),
        React.createElement(MobileStickyBar, {
          propertyId: property.id,
          pricePerNight: price,
          directDiscountPercent: discount,
          currency,
        }),
      ),
    );
    const cardRate = container.querySelector('[data-testid="villa-card-rate"]')!;
    expect(cardRate.textContent).toContain(direct);
    if (standard) {
      expect(cardRate.querySelector("s")?.textContent).toBe(standard);
      expect(cardRate.textContent).toContain(en.Pricing.standardRate);
      expect(cardRate.textContent).toContain(en.Villa.directRate);
    } else {
      expect(cardRate.querySelector("s")).toBeNull();
    }
    expect(container.querySelector('[data-testid="mobile-sticky-rate"]')?.textContent).toContain(direct);
    expect(container.querySelector("aside")?.textContent).toContain(direct);
  });

  it("G10: LocationMapPreview renders a safe static preview by default and an explicit directions link", async () => {
    const container = await renderIntl(
      React.createElement(LocationMapPreview, {
        resortName: "Auralis Cove Retreat",
        location: "Koh Samui, Thailand",
        address: "88/8 Moo 3, Bophut",
        imageAlt: "Aerial view",
        openInMapsLabel: "Open in Google Maps",
        showInteractiveMapLabel: "Show interactive map",
      }),
    );
    expect(container.querySelector("iframe")).toBeNull();
    const directions = container.querySelector<HTMLAnchorElement>('[data-testid="location-directions-link"]')!;
    expect(directions.getAttribute("href")).toBe(RESORT_DIRECTIONS_URL);
    expect(directions.getAttribute("target")).toBe("_blank");

    const showMapBtn = container.querySelector("button")!;
    await act(async () => showMapBtn.click());
    expect(container.querySelector("iframe")).not.toBeNull();
  });

  it("G11 & G12: RoomDetailClient supports direct thumbnail selection, counter, boundary state, and non-duplicated mobile tour CTA", async () => {
    const container = await renderIntl(
      React.createElement(RoomDetailClient, { property: sampleVilla, reviews: [] }),
    );
    const counter = container.querySelector('[data-testid="room-gallery-counter"]')!;
    expect(counter.textContent?.trim()).toBe("1 / 4");

    const prevBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Previous photo"]')!;
    const nextBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Next photo"]')!;
    expect(prevBtn.getAttribute("aria-disabled")).toBe("true");
    expect(nextBtn.getAttribute("aria-disabled")).toBe("false");

    const thumbs = container.querySelectorAll<HTMLButtonElement>('[data-testid="room-gallery-thumbnails"] button');
    expect(thumbs).toHaveLength(4);

    // Jump straight from photo 1 to photo 4 in 1 activation.
    await act(async () => thumbs[3].click());
    expect(counter.textContent?.trim()).toBe("4 / 4");
    expect(thumbs[3].getAttribute("aria-current")).toBe("true");
    expect(nextBtn.getAttribute("aria-disabled")).toBe("true");
    expect(prevBtn.getAttribute("aria-disabled")).toBe("false");

    // G12: overlay tour button is desktop-only (`hidden ... md:inline-flex`), mobile button is `md:hidden`.
    const overlayTour = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === en.Villa.explore360);
    const mobileTour = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === en.Villa.exploreIn360);
    expect(overlayTour?.className).toContain("hidden");
    expect(overlayTour?.className).toContain("md:inline-flex");
    expect(mobileTour?.className).toContain("md:hidden");
  });

  it("G14: StarRating exposes one localized screen-reader rating label and hides decorative star icons", async () => {
    const container = await renderIntl(
      React.createElement(
        React.Fragment,
        null,
        React.createElement("div", { id: "icon-only" }, React.createElement(StarRating, { rating: 5 })),
        React.createElement("div", { id: "with-value" }, React.createElement(StarRating, { rating: 4.94, showValue: true, reviewCount: 12 })),
      ),
    );
    const iconOnly = container.querySelector("#icon-only [role='img']")!;
    expect(iconOnly.getAttribute("aria-label")).toBe("5 out of 5 stars");
    expect(iconOnly.querySelectorAll("svg[aria-hidden='true']")).toHaveLength(5);

    const withValue = container.querySelector("#with-value")!;
    expect(withValue.querySelector(".sr-only")?.textContent).toBe("4.94 out of 5 stars");
    expect(withValue.querySelector("span[aria-hidden=true]")?.textContent).toBe("4.94");
    expect(withValue.querySelectorAll("svg[aria-hidden='true']")).toHaveLength(5);
  });

  it("G16: Active TourViewerContent exposes labeled modal dialog, traps Tab focus, and restores opener on close", async () => {
    const visible = document.createElement("div").getClientRects();
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue({ ...visible, length: 1 });

    function MockCanvas({ onLoaded }: { onLoaded: () => void }) {
      React.useEffect(() => {
        onLoaded();
      }, [onLoaded]);
      return null;
    }
    function Harness() {
      const [open, setOpen] = useState(false);
      const opener = useTourOpener(open);
      return React.createElement(
        React.Fragment,
        null,
        React.createElement("button", {
          type: "button", id: "opener", onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
            opener.current = event.currentTarget;
            setOpen(true);
          },
        }, "Explore 360"),
        open
          ? React.createElement(TourViewerContent, {
              property: sampleVilla,
              onClose: () => setOpen(false),
              Canvas: MockCanvas as never,
            })
          : null,
      );
    }

    const container = await renderIntl(React.createElement(Harness));
    const opener = container.querySelector<HTMLButtonElement>("#opener")!;
    expect(document.activeElement).not.toBe(opener);
    await act(async () => opener.click());

    const dialog = document.querySelector<HTMLElement>('[data-testid="tour-viewer"]')!;
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Tideglass Pool Residence 360 tour");
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Tab stays contained inside dialog.
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    });
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Closing restores focus to opener.
    const closeBtn = dialog.querySelector<HTMLButtonElement>('button[aria-label="Close tour"]')!;
    await act(async () => {
      closeBtn.click();
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(opener);
  });

  it("G18: LeadCapture submits on Enter inside a labeled form, blocks duplicate submission while pending, and retains input on error", async () => {
    let resolveMutation!: () => void;
    mocks.mutation.mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveMutation = resolve; }),
    );
    const container = await renderIntl(
      React.createElement(LeadCapture, { propertySlug: "pool-villa", onClose: vi.fn() }),
    );
    const form = container.querySelector("form")!;
    const input = container.querySelector<HTMLInputElement>('input[type="email"]')!;
    const label = container.querySelector(`label[for="${input.id}"]`);
    expect(label?.textContent).toBe("Email");

    // Set email value using native setter so React controlled input updates.
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      nativeSetter.call(input, "guest@example.com");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(mocks.mutation).toHaveBeenCalledTimes(1);
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);

    await act(async () => {
      resolveMutation();
      await Promise.resolve();
    });
    expect(container.textContent).toContain(en.Tour.leadSaved);

    // Error path keeps entered email intact.
    await act(async () => root!.unmount());
    root = null;
    document.body.innerHTML = "";
    mocks.mutation.mockRejectedValueOnce(new Error("Network failure"));
    const errorContainer = await renderIntl(
      React.createElement(LeadCapture, { propertySlug: "pool-villa", onClose: vi.fn() }),
    );
    const errInput = errorContainer.querySelector<HTMLInputElement>('input[type="email"]')!;
    await act(async () => {
      nativeSetter.call(errInput, "retry@example.com");
      errInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      errorContainer.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(errorContainer.querySelector('[role="alert"]')?.textContent).toContain("Network failure");
    expect(errInput.value).toBe("retry@example.com");
  });
});
