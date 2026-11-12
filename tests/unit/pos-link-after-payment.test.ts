// @vitest-environment happy-dom
import type { Id } from "convex/_generated/dataModel";
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CheckoutBackendProvider, type CheckoutBackend, type CustomerId } from "@/components/checkout/backend";
import { createFixtureBackend } from "@/components/checkout/fixture-backend";
import { ReceiptView } from "@/components/checkout/ReceiptView";

/** Linking a paid service row to its appointment from the receipt screen, against the fixture backend. */

let root: Root;
const SOMCHAI = "fxcust000002" as CustomerId;
const THAI_90 = "fxsvc000002" as Id<"services">;
const SOMCHAI_APPOINTMENT = "fxappt000002" as Id<"appointments">;
const tick = (ms = 200) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>("button")];
const button = (text: string) => buttons().find((b) => b.textContent?.trim() === text);
const click = async (text: string) => { const el = button(text); expect(el, text).toBeTruthy(); await act(async () => el!.click()); };
const type = (selector: string, value: string) => act(async () => {
  const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  expect(el, selector).toBeTruthy();
  Object.getOwnPropertyDescriptor(el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
const panel = () => document.querySelector<HTMLElement>('section[aria-label="After payment"]')!;
// What prints: screen-only controls on the receipt (a line's Refund) are left out.
const printed = () => {
  const paper = document.querySelector<HTMLElement>('article[aria-label="Receipt"]')!.cloneNode(true) as HTMLElement;
  paper.querySelectorAll("[data-screen-only]").forEach((node) => node.remove());
  return paper.textContent;
};

async function paidMassage() {
  const backend = createFixtureBackend();
  const actions = backend.useActions();
  const pending = async <T,>(promise: Promise<T>) => { await tick(); return promise; };
  const { orderId } = await pending(actions.addItem({ item: { kind: "service", serviceId: THAI_90 } }));
  await pending(actions.linkCustomer({ orderId, customerId: SOMCHAI }));
  await pending(actions.settleOrder({ orderId, idempotencyKey: "paid-massage-01", expectedDue: 160000, expectedRevision: 2, expectedCustomerRevision: 0, tenders: [{ method: "cash", amount: 160000 }] }));
  const provider = { backend: backend as CheckoutBackend } as ComponentProps<typeof CheckoutBackendProvider>;
  await act(async () => root.render(createElement(CheckoutBackendProvider, provider, createElement(ReceiptView, { orderId, onNewSale: () => {}, onOpenOrder: () => {} }))));
  return { backend, orderId };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-10T08:20:00Z"));
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.useRealTimers(); vi.unstubAllGlobals(); });

it("pays an unscheduled service, links it to the guest's appointment later and unlinks it, leaving the receipt as issued", async () => {
  const { backend } = await paidMassage();
  const issued = printed();
  expect(issued).toContain("To be scheduled");
  expect(panel().textContent).toContain("1 to link to an appointment");
  expect(panel().textContent).toContain("No appointment");

  await click("Link appointment");
  // The customer's own unpaid appointment is suggested; another guest's other service can't take it.
  const candidates = () => [...document.querySelectorAll('[data-testid="link-candidate"]')].map((el) => el.textContent ?? "");
  expect(candidates()[0]).toContain("SVC-0002");
  await type('input[aria-label="Find the appointment"]', "Anna");
  expect(candidates().find((text) => text.includes("Hot stone"))).toMatch(/different service/);
  expect(button("Can't link")?.disabled).toBe(true);
  await type('input[aria-label="Find the appointment"]', "");
  await click("Review");
  const review = document.querySelector('[data-testid="link-review"]')!.textContent;
  expect(review).toContain("Not changed: receipt R-000142");
  expect(button("Confirm link")?.disabled).toBe(true);
  await type('textarea[id^="link-reason-"]', "Guest booked the prepaid massage");
  await click("Confirm link");
  await tick();

  expect(panel().textContent).toContain("Linked · SVC-0002");
  expect(panel().textContent).toContain("Scheduling");
  expect(panel().textContent).not.toContain("to link to an appointment");
  expect(document.body.textContent).toContain("Row linked after payment · #1");
  expect(backend.appointmentSnapshot(SOMCHAI_APPOINTMENT)).toMatchObject({ paid: true, price: 160000 });
  expect(printed()).toBe(issued);

  await click("Unlink…");
  await type('textarea[id^="unlink-reason-"]', "Wrong guest");
  await click("Unlink");
  await tick();
  expect(panel().textContent).toContain("No appointment");
  expect(document.body.textContent).toContain("Link undone · #2");
  expect(backend.appointmentSnapshot(SOMCHAI_APPOINTMENT)).toMatchObject({ paid: false, price: 160000 });
  expect(printed()).toBe(issued);
});

it("refuses a link reviewed before the appointment changed, and shows why", async () => {
  const { backend } = await paidMassage();
  await click("Link appointment");
  await click("Review");
  await act(async () => backend.setAppointmentSnapshot(SOMCHAI_APPOINTMENT, { revision: 3 }));
  await type('textarea[id^="link-reason-"]', "Booked it");
  await click("Confirm link");
  await tick();
  expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/changed since you opened it/);
  expect(backend.appointmentSnapshot(SOMCHAI_APPOINTMENT)).toMatchObject({ paid: false });
});
