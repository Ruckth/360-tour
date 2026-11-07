// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialGuestCounts } from "@/lib/booking/booking";

const fixture = vi.hoisted(() => ({
  guestProps: null as null | { adults: number; childCount: number },
  months: { blockedDates: [], pendingMonths: [], failedMonths: [], retry: () => {} },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ prefetch: () => {}, push: () => {} }) }));
vi.mock("next-intl", () => ({ useLocale: () => "en", useTranslations: () => (key: string) => key }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/lib/react/convex", () => ({ useOptionalConvex: () => null }));
vi.mock("@/lib/i18n/use-public-messages", async () => {
  const { getPublicMessages } = await import("@/lib/i18n/messages-loader");
  const messages = getPublicMessages("en");
  return { usePublicMessages: () => messages };
});
vi.mock("@/lib/booking/use-blocked-dates", () => ({ useVillaBlockedMonths: () => fixture.months, useStayBlockedDates: () => ({}) }));
vi.mock("@/components/booking/VillaSelector", () => ({ VillaSelector: () => null }));
vi.mock("@/components/booking/BookingPriceSummary", () => ({ BookingPriceSummary: () => null }));
vi.mock("@/components/booking/BookingStepNav", () => ({ BookingStepNav: () => null }));
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

describe("booking link party size", () => {
  let root: Root | undefined;
  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = undefined;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it.each([
    [{ initialGuests: "4" }, { adults: 4, childCount: 0 }],
    [{ initialGuests: "4", initialChildren: "1" }, { adults: 3, childCount: 1 }],
  ])("carries %o into the guest step", async (params, expected) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const { BookingFunnel } = await import("@/components/booking/BookingFunnel");
    root = createRoot(document.body.appendChild(document.createElement("div")));
    // The demo pool-villa sleeps four, so the requested party fits.
    await act(async () => root!.render(createElement(BookingFunnel, {
      ...params, initialProperty: "pool-villa", initialCheckIn: "2030-01-10", initialCheckOut: "2030-01-11",
    })));
    const next = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "continue");
    expect(next?.disabled).toBe(false);
    await act(async () => next!.click());
    expect(fixture.guestProps).toMatchObject(expected);
  });
});
