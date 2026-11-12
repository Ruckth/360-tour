// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// The booking funnel in live mode with its panels stubbed: what reaches CouponField and bookings.create.
const fixture = vi.hoisted(() => ({
  // Stable across renders, like the real hooks, so the funnel's effects don't loop.
  client: {},
  t: (key: string) => key,
  coupon: null as null | { code: string | null; source: string },
  createBooking: null as unknown as Mock<(client: unknown, args: { marketing?: unknown }) => Promise<{ bookingId: string; accessToken: string }>>,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ prefetch: () => {}, push: () => {} }) }));
vi.mock("next-intl", () => ({ useLocale: () => "en", useTranslations: () => fixture.t }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/lib/react/convex", () => ({ useOptionalConvex: () => fixture.client }));
vi.mock("@/lib/i18n/use-public-messages", async () => {
  const { getPublicMessages } = await import("@/lib/i18n/messages-loader");
  const messages = getPublicMessages("en");
  return { usePublicMessages: () => messages };
});
vi.mock("@/lib/booking/use-blocked-dates", () => {
  const months = { blockedDates: [], pendingMonths: [], failedMonths: [], retry: () => {} };
  const stay = {};
  return { useVillaBlockedMonths: () => months, useStayBlockedDates: () => stay };
});
vi.mock("@/lib/react/convex-api", () => ({
  listLiveProperties: async () => [{
    _id: "p1", slug: "pool-villa", name: "Pool villa", tagline: "", description: "", pricePerNight: 500000, maxGuests: 4,
    bedrooms: 1, bathrooms: 1, area: 50, images: [], amenities: [], tourRoomIds: [], currency: "THB", directDiscountPercent: 1500,
  }],
  isPropertyAvailable: async () => true,
  createBooking: (client: unknown, args: { marketing?: unknown }) => fixture.createBooking(client, args),
}));
vi.mock("@/components/booking/useCouponPreview", () => {
  const state = { preview: { status: "idle" }, retry: () => {} };
  return { useCouponPreview: () => state };
});
vi.mock("@/components/booking/CouponField", () => ({
  CouponField: (props: { code: string | null; source: string }) => {
    fixture.coupon = props;
    return null;
  },
}));
vi.mock("@/components/booking/VillaSelector", () => ({ VillaSelector: () => null }));
vi.mock("@/components/booking/BookingPriceSummary", () => ({ BookingPriceSummary: () => null, PriceLines: () => null }));
vi.mock("@/components/booking/BookingStepNav", () => ({ BookingStepNav: () => null }));
vi.mock("@/components/booking/BookingPanels", () => ({
  DateStatus: () => null,
  GuestCountsPanel: () => null,
  GuestDetailsPanel: (props: { onGuestNameChange: (v: string) => void; onGuestEmailChange: (v: string) => void; onGuestPhoneChange: (v: string) => void }) => {
    useEffect(() => {
      props.onGuestNameChange("Anna Lee");
      props.onGuestEmailChange("anna@example.com");
      props.onGuestPhoneChange("+66812345678");
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
  },
  ReviewPanel: ({ coupon }: { coupon: unknown }) => coupon,
}));

let root: Root;
const button = (label: string) => [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === label) as HTMLButtonElement;

async function book(initialCoupon = "") {
  const { BookingFunnel } = await import("@/components/booking/BookingFunnel");
  await act(async () => root.render(createElement(BookingFunnel, {
    initialProperty: "pool-villa", initialCheckIn: "2030-01-10", initialCheckOut: "2030-01-12", initialGuests: "2", initialCoupon,
  })));
  for (let step = 0; step < 3; step++) await act(async () => button("continue").click());
  await act(async () => button("continueToPay").click());
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/booking");
  fixture.coupon = null;
  fixture.createBooking = vi.fn().mockResolvedValue({ bookingId: "b1", accessToken: "t" });
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("booking funnel capture", () => {
  it("carries the coupon of the link this tab arrived through, as a link coupon, and sends the link", async () => {
    window.sessionStorage.setItem("marketing-arrival", JSON.stringify({ slug: "f1", coupon: "dcnt-f1-20" }));
    await book();
    expect(fixture.coupon).toMatchObject({ code: "DCNT-F1-20", source: "link" });
    expect(fixture.createBooking).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ propertySlug: "pool-villa", marketing: { slug: "f1" } }));
  });

  it("keeps the URL's coupon over the carried one", async () => {
    window.sessionStorage.setItem("marketing-arrival", JSON.stringify({ slug: "f1", coupon: "DCNT-F1-20" }));
    await book("DCNT-SPA-500");
    expect(fixture.coupon).toMatchObject({ code: "DCNT-SPA-500", source: "link" });
  });

  it("adds the visitor key after consent, and sends nothing without a link or consent", async () => {
    await book();
    expect(fixture.coupon).toMatchObject({ code: null });
    expect(fixture.createBooking.mock.calls[0][1].marketing).toBeUndefined();

    await act(async () => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    window.localStorage.setItem("analytics-consent-v2", "yes");
    window.localStorage.setItem("marketing-visitor", JSON.stringify({ visitorKey: `mv_${"b".repeat(32)}`, sessionId: "s1", lastActiveAt: 1 }));
    await book();
    expect(fixture.createBooking.mock.calls[1][1].marketing).toEqual({ visitorKey: `mv_${"b".repeat(32)}` });
  });
});
