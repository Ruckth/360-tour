// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getHighestAllowedStepIndex, initialGuestCounts } from "@/lib/booking/booking";
import { BookingFunnel } from "@/components/booking/BookingFunnel";

const fixture = vi.hoisted(() => ({
  guestProps: null as null | { adults: number; childCount: number },
  months: { blockedDates: [] as string[], pendingMonths: [], failedMonths: [], retry: () => {} },
}));
vi.mock("@/platform/navigation", () => ({ useRouter: () => ({ prefetch: () => {}, push: () => {} }) }));
vi.mock("@/platform/intl", () => ({ useLocale: () => "en", useTranslations: () => (key: string) => key }));
vi.mock("@/platform/dynamic", () => ({ default: () => () => null }));
vi.mock('convex/react', () => ({
  useConvex: () => ({ query: async () => [], mutation: async () => null }),
  useMutation: () => async () => null,
  useQuery: () => [{ _id: 'p1', slug: 'garden-suite', name: 'Garden suite', tagline: '', description: '', pricePerNight: 500000, maxGuests: 8, bedrooms: 1, bathrooms: 1, area: 50, images: [], amenities: [], tourRoomIds: [], currency: 'THB', directDiscountPercent: 1500 }],
}));
vi.mock("@/lib/i18n/use-public-messages", async () => {
  const { getPublicMessages } = await import("@/lib/i18n/messages-loader");
  const messages = getPublicMessages("en");
  return { usePublicMessages: () => messages };
});
vi.mock("@/lib/booking/use-blocked-dates", () => ({ useVillaBlockedMonths: () => fixture.months, useStayBlockedDates: () => ({}) }));
vi.mock("@/components/booking/VillaSelector", () => ({ VillaSelector: () => null }));
vi.mock("@/components/booking/BookingPriceSummary", () => ({ BookingPriceSummary: () => null }));
vi.mock("@/components/booking/BookingPanels", () => ({
  DateStatus: () => null,
  GuestDetailsPanel: () => null,
  ReviewPanel: () => null,
  GuestCountsPanel: (props: { adults: number; childCount: number }) => {
    fixture.guestProps = props;
    return null;
  },
}));

describe("initialGuestCounts", () => {
  it.each([
    [{ guests: "4", adults: "", children: "" }, { adults: 4, children: 0 }],
    [{ guests: "4", adults: "", children: "1" }, { adults: 3, children: 1 }],
    [{ guests: "4", adults: "  ", children: " " }, { adults: 4, children: 0 }],
    [{ guests: " 4 ", adults: "abc", children: "" }, { adults: 4, children: 0 }],
    [{ guests: "4", adults: "2", children: "1" }, { adults: 2, children: 1 }],
    [{ guests: "", adults: "3", children: "" }, { adults: 3, children: 0 }],
    [{ guests: "4", adults: "0", children: "" }, { adults: 1, children: 0 }],
    [{ guests: "2", adults: "", children: "5" }, { adults: 1, children: 5 }],
    [{ guests: "", adults: "", children: "" }, { adults: 1, children: 0 }],
    [{ guests: "x", adults: "", children: "-2" }, { adults: 1, children: 0 }],
    [{ guests: "3.7", adults: "", children: "1.9" }, { adults: 2, children: 1 }],
  ])("%o starts with %o", (params, expected) => {
    expect(initialGuestCounts(params)).toEqual(expected);
  });
});

describe("booking progression", () => {
  it.each([
    [{ selectValid: false, guestsValid: true, infoValid: true }, 0],
    [{ selectValid: true, guestsValid: false, infoValid: true }, 1],
    [{ selectValid: true, guestsValid: true, infoValid: false }, 1],
    [{ selectValid: true, guestsValid: true, infoValid: true }, 2],
  ])("allows the furthest step for %o", (validity, step) => {
    expect(getHighestAllowedStepIndex(validity)).toBe(step);
  });
});

describe("booking link party size", () => {
  let root: Root | undefined;
  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = undefined;
    document.body.innerHTML = "";
    fixture.guestProps = null;
    fixture.months.blockedDates = [];
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("focuses and scrolls to the active step only when it changes", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    const button = (name: string) =>
      [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === name)!;
    root = createRoot(document.body.appendChild(document.createElement("div")));
    const render = async () => act(async () => root!.render(createElement(BookingFunnel, {
      initialProperty: "garden-suite", initialCheckIn: "2030-01-10", initialCheckOut: "2030-01-11",
    })));

    await render();
    expect(document.activeElement).toBe(document.body);
    expect(scroll).not.toHaveBeenCalled();

    await act(async () => button("continue").click());
    expect(document.activeElement).toBe(button("guestDetails"));
    expect(scroll).toHaveBeenLastCalledWith({ block: "start", behavior: "instant" });

    await act(async () => button("back").click());
    expect(document.activeElement).toBe(button("villaDates"));
    await act(async () => button("guestDetails").click());
    expect(document.activeElement).toBe(button("guestDetails"));

    button("back").focus();
    scroll.mockClear();
    await render();
    expect(document.activeElement).toBe(button("back"));
    expect(scroll).not.toHaveBeenCalled();

    fixture.months.blockedDates = ["2030-01-10"];
    await render();
    expect(document.activeElement).toBe(button("villaDates"));
    expect(scroll).toHaveBeenCalledOnce();
  });

  it.each([
    [{ initialGuests: "4" }, { adults: 4, childCount: 0 }],
    [{ initialGuests: "4", initialChildren: "1" }, { adults: 3, childCount: 1 }],
  ])("carries %o into the guest details step", async (params, expected) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    root = createRoot(document.body.appendChild(document.createElement("div")));
    // The fixture's garden suite sleeps eight, so the requested party fits.
    await act(async () => root!.render(createElement(BookingFunnel, {
      ...params, initialProperty: "garden-suite", initialCheckIn: "2030-01-10", initialCheckOut: "2030-01-11",
    })));
    const next = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "continue");
    expect(next?.disabled).toBe(false);
    await act(async () => next!.click());
    expect(fixture.guestProps).toMatchObject(expected);
  });
});
