import { act } from "../support/checkout-act";
// @vitest-environment happy-dom
import { createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IntlProvider } from "@/platform/intl";
import commerceEn from "../../messages/commerce/en.json";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CheckoutBackendProvider, returnArgs, type CheckoutBackend, type OrderView, type ReturnLookup, type ReturnsDesk } from "@/components/checkout/backend";
import { rememberTill } from "@/components/checkout/pay-desk";
import { ReplacementVouchers } from "@/components/checkout/ReturnItemsEntry";
import { returnsTillId } from "@/components/checkout/returns-desk";
import type { Id } from "convex/_generated/dataModel";

/*
 * PR #93 restack: returns use the pay desk's device identity, and a receipt reloaded after a return
 * still shows the replacement vouchers it issued (returnItems.get({ orderId, completed: true })).
 */

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.clear();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

it("names this device before the cutover admits it, then the pay desk's server till", () => {
  const before = returnsTillId();
  expect(before).toMatch(/^device:[A-Za-z0-9_-]{20,128}$/);
  expect(returnsTillId()).toBe(before);
  rememberTill("till1" as Id<"tills">);
  expect(returnsTillId()).toBe("till1");
});

it("asks the server for the latest completed return with replacement vouchers", () => {
  const orderId = "order1" as OrderView["order"]["_id"];
  expect(returnArgs({ orderId, completed: true })).toEqual({ orderId, completed: true });
  expect(returnArgs({ orderId, returnId: null, tillId: "till1" })).toEqual({ orderId, tillId: "till1" });
});

it("shows Replacement vouchers on a returned receipt: each names the voucher it replaces and its last usable day (astra r3 B3, B4)", async () => {
  const lookups: (ReturnLookup | null)[] = [];
  const desk = {
    useReturn: (args: ReturnLookup | null) => {
      lookups.push(args);
      return { giftSlips: [
        { voucherId: "v1", replaces: "o1", code: "GV-7KQ2-Q9XD", amount: 50000, expiresAt: null },
        // Two equal replacements issued 20 Nov 2026 for 90 days: stored end 00:00 Bangkok on 19 Feb, exclusive.
        { voucherId: "v2", replaces: "o2", code: "GV-8LR3-Z1AB", amount: 25000, expiresAt: Date.parse("2027-02-19T00:00:00+07:00") },
        { voucherId: "v3", replaces: "o3", code: "GV-9MT4-Y2CD", amount: 25000, expiresAt: Date.parse("2027-02-19T00:00:00+07:00") },
      ] };
    },
  } as unknown as ReturnsDesk;
  // A voucher-only return refunds no cash (returnedTotal 0); its gift slips still come back after a reload.
  const voucherPayments = [{ _id: "p2", voucherId: "o2", amount: 25000, codeMask: "GV-••••-Q9XD" }, { _id: "p3", voucherId: "o3", amount: 25000, codeMask: "GV-••••-R8TB" }];
  const view = (fields: Record<string, unknown>) => ({ order: { _id: "order1", returnedTotal: 0 }, commerce: { hasReplacementSlips: true }, activeReturn: null, voucherPayments, ...fields }) as unknown as OrderView;
  const show = (receipt: OrderView) => act(async () => root.render(createElement(
    CheckoutBackendProvider, { backend: { returns: desk, useActions: () => ({}) } as unknown as CheckoutBackend } as ComponentProps<typeof CheckoutBackendProvider>,
    createElement(IntlProvider, { locale: "en", timeZone: "Asia/Bangkok", messages: commerceEn } as unknown as ComponentProps<typeof IntlProvider>,
      createElement(ReplacementVouchers, { view: receipt }) as ReactNode),
  )));

  await show(view({}));
  const block = document.querySelector("[data-replacement-vouchers]");
  expect(block?.textContent).toContain("Replacement vouchers");
  expect([...document.querySelectorAll("[data-gift-slip]")].map((slip) => [
    slip.querySelector("[data-gift-slip-voucher]")?.textContent, slip.querySelector("[data-gift-slip-replaces]")?.textContent ?? null,
  ])).toEqual([
    ["New voucher GV-7KQ2-Q9XD · ฿500 · no expiry", null],
    ["New voucher GV-8LR3-Z1AB · ฿250 · valid through 18 Feb 2027", "Replaces GV-••••-Q9XD"],
    ["New voucher GV-9MT4-Y2CD · ฿250 · valid through 18 Feb 2027", "Replaces GV-••••-R8TB"],
  ]);
  expect(lookups.at(-1)).toEqual({ orderId: "order1", completed: true });

  // Nothing to read on a receipt without gift slips, even one that refunded cash, or while a return
  // is open (the sheet shows it).
  lookups.length = 0;
  await show(view({ order: { _id: "order1", returnedTotal: 70000 }, commerce: { returnedAmountSatang: 70000 } }));
  await show(view({ activeReturn: { returnId: "r1" } }));
  expect(lookups).toEqual([]);
  expect(document.querySelector("[data-replacement-vouchers]")).toBeNull();
});
