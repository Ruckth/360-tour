// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IntlProvider } from "@/platform/intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { ProposalPayClient } from "@/components/booking/ProposalPayClient";
import en from "../../messages/en.json";
import th from "../../messages/th.json";

const client = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
  action: vi.fn(),
}));
vi.mock('convex/react', async (importOriginal) => ({ ...await importOriginal<typeof import('convex/react')>(), useConvex: () => client }));
let root: Root;
const summary = {
  property: "Pool Villa",
  checkIn: "2026-12-01",
  checkOut: "2026-12-03",
  guests: 2,
  nights: 2,
  total: 20000,
  currency: "THB",
  cancellationPolicy: "Free cancellation",
  unpaidHoldMinutes: 30,
  holdExpiresAt: null,
};
function render(locale = "en") {
  return act(async () =>
    root.render(
      // eslint-disable-next-line react/no-children-prop -- use-intl requires children in createElement props.
      createElement(IntlProvider, {
        locale,
        messages: locale === "th" ? th : en,
        children: createElement(ProposalPayClient, {
          token: "signed-proposal",
        }),
      }),
    ),
  );
}
/** getConfirmProposal answers `proposal`; the status query answers `reason` only when it is null. */
function answer(proposal: typeof summary | null, reason?: string | Error) {
  client.query.mockImplementation(async (ref) => {
    if (getFunctionName(ref) === "bookings/bookings:getConfirmProposal") return proposal;
    if (reason instanceof Error) throw reason;
    return reason;
  });
}
const links = () => [...document.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  client.query.mockReset().mockResolvedValue(summary);
  client.mutation
    .mockReset()
    .mockResolvedValue({ bookingId: "booking", accessToken: "access" });
  client.action
    .mockReset()
    .mockResolvedValue({ url: "https://checkout.stripe.com/test" });
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("only reads the proposal on opening and shows its summary, policy and hold", async () => {
  await render();
  expect(getFunctionName(client.query.mock.calls[0][0])).toBe(
    "bookings/bookings:getConfirmProposal",
  );
  expect(client.query.mock.calls[0][1]).toEqual({ token: "signed-proposal" });
  expect(client.mutation).not.toHaveBeenCalled();
  expect(client.action).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Pool Villa");
  expect(document.body.textContent).toContain("Free cancellation");
  expect(document.body.textContent).toContain("30 minutes after you confirm");
});
it("a double click confirms once and goes straight into Stripe checkout", async () => {
  const redirect = vi
    .spyOn(window.location, "assign")
    .mockImplementation(() => {});
  await render();
  await act(async () => {
    document.querySelector("button")!.click();
    document.querySelector("button")!.click();
  });
  expect(client.mutation).toHaveBeenCalledTimes(1);
  expect(getFunctionName(client.mutation.mock.calls[0][0])).toBe(
    "bookings/bookings:confirmProposal",
  );
  expect(client.action.mock.calls[0][1]).toEqual({
    bookingId: "booking",
    accessToken: "access",
  });
  expect(redirect).toHaveBeenCalledWith("https://checkout.stripe.com/test");
});
it("shows the existing deadline when returning to an already confirmed hold", async () => {
  const holdExpiresAt = Date.UTC(2026, 11, 1, 10, 30);
  client.query.mockResolvedValue({ ...summary, holdExpiresAt });
  await render();
  expect(document.body.textContent).toContain(new Date(holdExpiresAt).toLocaleString("en"));
  expect(document.body.textContent).not.toContain("30 minutes after you confirm");
  expect(client.mutation).not.toHaveBeenCalled();
});
it("shows a localized expired summary without a confirmation button", async () => {
  answer(null, "summary_expired");
  await render("th");
  expect(getFunctionName(client.query.mock.calls[1][0])).toBe("bookings/bookings:getConfirmProposalStatus");
  expect(document.body.textContent).toContain(th.Booking.summaryExpired);
  expect(document.querySelector("button")).toBeNull();
  expect(client.mutation).not.toHaveBeenCalled();
  // G34: one localized chat action, with no proposal token in its URL.
  const chat = [...document.querySelectorAll("a")].filter((a) => a.textContent === th.Chat.open);
  expect(chat).toHaveLength(1);
  expect(chat[0].getAttribute("href")).toBe("/th/chat");
});
it("G34: an unverifiable proposal keeps the booking fallback without the expired chat action", async () => {
  client.query.mockRejectedValue(new Error("network"));
  await render();
  expect(document.body.textContent).toContain(en.Booking.liveVerificationUnavailable);
  expect([...document.querySelectorAll("a")].map((a) => a.textContent)).toEqual([en.Booking.backToBooking]);
});
it("G34: a verified hold expiry says so in context and hands off to plain chat", async () => {
  answer(null, "hold_expired");
  await render();
  expect(document.body.textContent).toContain(en.Booking.proposalHoldExpired);
  expect(document.body.textContent).not.toContain(en.Booking.summaryExpired);
  expect(links()).toEqual([[en.Chat.open, "/chat"], [en.Booking.backToBooking, "/booking"]]);
  expect(document.body.innerHTML).not.toContain("signed-proposal");
});
it.each([
  ["unavailable", en.Booking.proposalUnavailable],
  ["settled", en.Booking.proposalSettled],
])("G34: a %s link never claims expiry and offers no chat handoff", async (reason, copy) => {
  answer(null, reason);
  await render();
  expect(document.body.textContent).toContain(copy);
  expect(document.body.textContent).not.toContain(en.Booking.summaryExpired);
  expect(document.querySelector("button")).toBeNull();
  expect(links()).toEqual([[en.Booking.backToBooking, "/booking"]]);
});
it("G34: when the reason itself cannot be verified, the page stays neutral", async () => {
  answer(null, new Error("network"));
  await render();
  expect(document.body.textContent).toContain(en.Booking.liveVerificationUnavailable);
  expect(document.body.textContent).not.toContain(en.Booking.summaryExpired);
  expect(links()).toEqual([[en.Booking.backToBooking, "/booking"]]);
});
it("a refused confirm on a replaced link shows the neutral state, not expiry", async () => {
  answer(summary, "unavailable");
  client.mutation.mockRejectedValue(new Error("This summary has expired. Ask in the chat for a new one."));
  await render();
  await act(async () => document.querySelector("button")!.click());
  expect(document.body.textContent).toContain(en.Booking.proposalUnavailable);
  expect(document.body.textContent).not.toContain("Pool Villa");
  expect(client.action).not.toHaveBeenCalled();
});
it("handles a summary expiring between opening and pressing confirm", async () => {
  answer(summary, "summary_expired");
  client.mutation.mockRejectedValue(
    new Error("This summary has expired. Ask in the chat for a new one."),
  );
  await render();
  await act(async () => document.querySelector("button")!.click());
  expect(document.body.textContent).toContain(en.Booking.summaryExpired);
  expect(document.querySelector("button")).toBeNull();
  expect(client.action).not.toHaveBeenCalled();
  expect([...document.querySelectorAll("a")].find((a) => a.textContent === en.Chat.open)?.getAttribute("href")).toBe("/chat");
});
