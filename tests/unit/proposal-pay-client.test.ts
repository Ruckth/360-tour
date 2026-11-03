// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
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
vi.mock("@/lib/react/convex", () => ({ useOptionalConvex: () => client }));
let root: Root;
const summary = {
  property: "Pool Villa",
  checkIn: "2026-12-01",
  checkOut: "2026-12-03",
  guests: 2,
  nights: 2,
  total: 200,
  currency: "THB",
  cancellationPolicy: "Free cancellation",
  unpaidHoldMinutes: 30,
  holdExpiresAt: null,
};
function render(locale = "en") {
  return act(async () =>
    root.render(
      // eslint-disable-next-line react/no-children-prop -- next-intl requires children in createElement props.
      createElement(NextIntlClientProvider, {
        locale,
        messages: locale === "th" ? th : en,
        children: createElement(ProposalPayClient, {
          token: "signed-proposal",
        }),
      }),
    ),
  );
}
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
    "bookings:getConfirmProposal",
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
    "bookings:confirmProposal",
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
  client.query.mockResolvedValue(null);
  await render("th");
  expect(document.body.textContent).toContain(th.Booking.summaryExpired);
  expect(document.querySelector("button")).toBeNull();
  expect(client.mutation).not.toHaveBeenCalled();
});
it("handles a summary expiring between opening and pressing confirm", async () => {
  client.mutation.mockRejectedValue(
    new Error("This summary has expired. Ask in the chat for a new one."),
  );
  await render();
  await act(async () => document.querySelector("button")!.click());
  expect(document.body.textContent).toContain(en.Booking.summaryExpired);
  expect(document.querySelector("button")).toBeNull();
  expect(client.action).not.toHaveBeenCalled();
});
