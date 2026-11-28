// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntlProvider } from "@/platform/intl";
import { parseGuestPhoneInput } from "convex/shared/phone";
import { GuestDetailsPanel, ReviewPanel } from "@/components/booking/BookingPanels";
import { chooseGuestPhoneCountry, emptyGuestPhone, guestPhoneE164, shownPhoneCountry, type GuestPhoneDraft } from "@/lib/booking/guest-phone";
import { isValidGuestInfo, type BookingProperty } from "@/lib/booking/booking";
import en from "../../messages/en.json";

describe("G26 guest phone parsing", () => {
  it.each([
    ["+91 98765 43210", "TH", "+919876543210", "IN"],
    ["+39 347 123 4567", "TH", "+393471234567", "IT"],
    ["+39 06 1234 5678", "TH", "+390612345678", "IT"], // Italy keeps its significant zero.
    ["0039 06 1234 5678", "US", "+390612345678", "IT"],
    ["81 234 5678", "TH", "+66812345678", "TH"],
    ["081-234-5678", "TH", "+66812345678", "TH"],
    ["+66 77 111 222", "US", "+6677111222", "TH"],
    ["202 555 0123", "US", "+12025550123", "US"],
    ["+1 416 555 0123", "US", "+14165550123", "CA"], // A shared +1 resolves by the number, not the picker.
  ] as const)("%s with %s selected is %s", (text, country, e164, detected) => {
    expect(parseGuestPhoneInput(text, country)).toEqual({ e164, country: detected });
  });

  it.each([["19876543210", "TH"], ["12345", "TH"], ["+66 81 234", "TH"], ["call me", "TH"], ["081 234 5678 ext 2", "TH"], ["", "TH"]] as const)(
    "rejects %s", (text, country) => {
      expect(parseGuestPhoneInput(text, country).e164).toBeUndefined();
    },
  );

  it("never lets an incomplete shared code pick a country, and a country pick follows recognised numbers", () => {
    expect(shownPhoneCountry({ country: "TH", text: "+1 41" })).toBe("TH");
    expect(shownPhoneCountry({ country: "TH", text: "+1 416 555 0123" })).toBe("CA");
    expect(shownPhoneCountry({ country: "TH", text: "81 234 5678" })).toBe("TH");
    expect(chooseGuestPhoneCountry({ country: "TH", text: "81 234 5678" }, "US")).toEqual({ country: "US", text: "81 234 5678" });
    expect(chooseGuestPhoneCountry({ country: "TH", text: "+44 7400 123456" }, "GB")).toEqual({ country: "GB", text: "+44 7400 123456" });
    expect(chooseGuestPhoneCountry({ country: "TH", text: "+66 81 234 5678" }, "US")).toEqual({ country: "US", text: "812345678" });
  });

  it("gates guest info on a valid E.164 phone only", () => {
    expect(isValidGuestInfo("Sam Lee", "sam@example.com", guestPhoneE164({ country: "TH", text: "+91 98765 43210" }) ?? "")).toBe(true);
    expect(isValidGuestInfo("Sam Lee", "sam@example.com", guestPhoneE164({ country: "TH", text: "19876543210" }) ?? "")).toBe(false);
  });
});

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
const intl = (node: React.ReactNode) =>
  // eslint-disable-next-line react/no-children-prop -- use-intl requires children in createElement props.
  createElement(IntlProvider, { locale: "en", messages: en, timeZone: "Asia/Bangkok", children: node });

describe("G26 booking phone field", () => {
  let latest: GuestPhoneDraft = emptyGuestPhone;
  function Harness() {
    const [phone, setPhone] = useState<GuestPhoneDraft>(emptyGuestPhone);
    latest = phone;
    return createElement(GuestDetailsPanel, {
      guestName: "", guestEmail: "", guestPhone: phone,
      onGuestNameChange: () => {}, onGuestEmailChange: () => {}, onGuestPhoneChange: setPhone,
    });
  }
  async function type(value: string) {
    const input = document.querySelector<HTMLInputElement>("#booking-guest-phone")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return input;
  }

  it("keeps a pasted +91 number intact under the Thailand selector and shows its own country", async () => {
    await act(async () => root.render(intl(createElement(Harness))));
    const input = await type("+91 98765 43210");
    expect(input.value).toBe("+91 98765 43210");
    expect(latest).toEqual({ country: "TH", text: "+91 98765 43210" });
    expect(document.querySelector('[data-testid="booking-phone-country"]')?.textContent).toBe("IN +91");
    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(input.getAttribute("aria-describedby")).toBe("booking-guest-phone-hint");
  });

  it("retains invalid text for correction and explains the rule", async () => {
    await act(async () => root.render(intl(createElement(Harness))));
    const input = await type("19876543210");
    await act(async () => { input.dispatchEvent(new FocusEvent("blur")); input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(input.value).toBe("19876543210");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.querySelector("#booking-guest-phone-error")?.textContent).toBe(en.Booking.phoneError);
    await type("081 234 5678");
    expect(guestPhoneE164(latest)).toBe("+66812345678");
    expect(input.getAttribute("aria-invalid")).toBe("false");
  });
});

describe("G27 booking review contact details", () => {
  const property = { name: "Pool villa", slug: "pool-villa", currency: "THB" } as BookingProperty;
  it("shows name, email and phone with one Edit guest details action", async () => {
    const onEditContact = vi.fn();
    await act(async () => root.render(intl(createElement(ReviewPanel, {
      property, guests: 2, nights: 2, checkIn: "2030-01-10", checkOut: "2030-01-12",
      contact: { name: "Sam Lee", email: "sam@example.com", phone: "+390612345678" }, onEditContact,
    }))));
    const text = (id: string) => document.querySelector(`[data-testid="${id}"]`)?.textContent;
    expect(text("booking-review-name")).toBe("Sam Lee");
    expect(text("booking-review-email")).toBe("sam@example.com");
    expect(text("booking-review-phone")).toBe("+39 06 1234 5678");
    expect(text("booking-review-property")).toContain("Pool villa");
    const edit = [...document.querySelectorAll("button")].filter((button) => button.textContent === en.Booking.editGuestDetails);
    expect(edit).toHaveLength(1);
    await act(async () => edit[0].click());
    expect(onEditContact).toHaveBeenCalledTimes(1);
  });
});
