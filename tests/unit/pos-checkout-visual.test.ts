// @vitest-environment happy-dom
import type { Id } from "convex/_generated/dataModel";
import { act, createElement, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckoutBackendProvider, type CheckoutBackend, type OrderId } from "@/components/checkout/backend";
import { sectionCount } from "@/components/checkout/CatalogPane";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { createFixtureBackend } from "@/components/checkout/fixture-backend";

let root: Root;
const shown: { orderId: OrderId | null } = { orderId: null };
function Page({ start = null }: { start?: OrderId | null }) {
  const [orderId, setOrderId] = useState<OrderId | null>(start);
  shown.orderId = orderId;
  return createElement(CheckoutView, { orderId, onOrderChange: setOrderId, onPaid: () => {} });
}
const show = (backend: CheckoutBackend, start: OrderId | null = null) =>
  act(async () => root.render(createElement(CheckoutBackendProvider, { backend } as ComponentProps<typeof CheckoutBackendProvider>, createElement(Page, { start }))));
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(200); });
const click = (el: Element | null | undefined) => act(async () => (el as HTMLElement).click());
const catalog = () => document.querySelector<HTMLElement>("#checkout-catalog")!;
const tab = (name: string) => [...document.querySelectorAll('[role="tab"]')].find((el) => el.textContent === name)!;
/** A catalog tile by item name (its button starts with the name, or a count badge then the name). */
const tile = (name: string) => [...catalog().querySelectorAll("button")].find((el) => el.textContent?.replace(/^\d+ on the order/, "").startsWith(name))!;
const header = (group: string) => [...catalog().querySelectorAll("h3 button")].find((el) => el.textContent?.startsWith(group)) as HTMLButtonElement;
const order = () => document.querySelector<HTMLElement>('aside[aria-label="Order"]')!;
const row = (name: string) => [...order().querySelectorAll("li")].find((li) => li.querySelector("button")?.textContent?.startsWith(name))!;
function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("checkout catalog photos", () => {
  it("shows a service's own photo and a villa's first image, and a kind icon for items without one", async () => {
    await show(createFixtureBackend());
    await click(tab("Spa"));
    expect(tile("Sunrise yoga by the pool 60").querySelector("img")?.getAttribute("src")).toBe("/experiences/wellness-yoga.png");
    expect(tile("Thai massage 60").querySelector("img")).toBeNull();
    expect(tile("Thai massage 60").querySelector("[data-photo-fallback]")).toBeTruthy();
    await click(tab("Rooms"));
    expect(tile("Garden Villa").querySelector("img")?.getAttribute("src")).toBe("/garden-image.webp");
    expect(tile("Sunrise Suite").querySelector("[data-photo-fallback]")).toBeTruthy();
    // Photos are decorative: the tile is named by its text, never by an image description.
    expect(tile("Garden Villa").querySelector("img")?.getAttribute("alt")).toBe("");
  });

  it("falls back to the icon tile when a photo fails to load, without losing the tile", async () => {
    await show(createFixtureBackend());
    await click(tab("Spa"));
    const img = tile("Coconut body scrub 45").querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/experiences/coconut-scrub-missing.jpg");
    await act(async () => img.dispatchEvent(new Event("error")));
    expect(tile("Coconut body scrub 45").querySelector("img")).toBeNull();
    expect(tile("Coconut body scrub 45").querySelector("[data-photo-fallback]")).toBeTruthy();
    expect(tile("Coconut body scrub 45").textContent).toContain("฿1,100");
  });

  it("shows loading tiles until the catalog arrives", async () => {
    await show({ ...createFixtureBackend(), useCatalog: () => undefined });
    expect(document.querySelector('[role="status"][aria-label="Loading items"]')).toBeTruthy();
  });
});

describe("checkout category groups", () => {
  it("counts each group's items in its header", () => {
    expect(sectionCount([{ kind: "service" }])).toBe("1 service");
    expect(sectionCount([{ kind: "service" }, { kind: "service" }])).toBe("2 services");
    expect(sectionCount([{ kind: "room" }, { kind: "room" }, { kind: "room" }])).toBe("3 rooms");
    expect(sectionCount([{ kind: "service" }, { kind: "extra" }])).toBe("2 items");
  });

  it("folds a group from its header button, which says whether it is open and what it controls", async () => {
    await show(createFixtureBackend());
    await click(tab("Spa"));
    const massage = header("Massage");
    expect(massage.textContent).toContain("4 services");
    expect(massage.getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById(massage.getAttribute("aria-controls")!)!;
    expect(panel.querySelectorAll("button").length).toBeGreaterThan(0);

    await click(massage);
    expect(header("Massage").getAttribute("aria-expanded")).toBe("false");
    expect(panel.hidden).toBe(true);
    expect(tile("Thai massage 60").closest("[hidden]")).toBe(panel);
    // Other groups are untouched.
    expect(header("Body").getAttribute("aria-expanded")).toBe("true");
    expect(tile("Hot stone 60").closest("[hidden]")).toBeNull();

    // Searching keeps the fold, with the matching count still shown in the header.
    await act(async () => type(document.querySelector<HTMLInputElement>('input[aria-label="Search items"]')!, "Thai"));
    expect(header("Massage").textContent).toContain("2 services");
    expect(header("Massage").getAttribute("aria-expanded")).toBe("false");

    await click(header("Massage"));
    expect(tile("Thai massage 60").closest("[hidden]")).toBeNull();
    expect(tile("Thai massage 90").closest("[hidden]")).toBeNull();
    expect(tile("Aroma oil massage 90")).toBeUndefined();
  });

  it("keeps each tab's folds separate", async () => {
    await show(createFixtureBackend());
    await click(tab("Spa"));
    await click(header("Body"));
    await click(tab("Rooms"));
    expect(header("Villas").getAttribute("aria-expanded")).toBe("true");
    await click(tab("Spa"));
    expect(header("Body").getAttribute("aria-expanded")).toBe("false");
  });
});

describe("checkout order rows", () => {
  it("steps quantities only on rooms and extras; services stay one scheduled row each", async () => {
    await show(createFixtureBackend());
    await click(tab("Spa"));
    await click(tile("Thai massage 60"));
    await settle();
    await click(tile("Thai massage 60"));
    await settle();
    await click(tab("Rooms"));
    await click(tile("Garden Villa"));
    await settle();
    await click(tab("Extras"));
    await click(tile("Coconut water"));
    await settle();

    // Two massages are two rows, each with its own therapist and time, and no quantity control.
    const massages = [...order().querySelectorAll("li")].filter((li) => li.textContent?.startsWith("Thai massage 60"));
    expect(massages).toHaveLength(2);
    for (const li of massages) expect(li.querySelector('[role="group"]')).toBeNull();

    const villa = row("Garden Villa");
    expect(villa.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe("Nights for Garden Villa");
    expect(villa.querySelector("output")?.textContent).toBe("1 night");
    expect(villa.querySelector<HTMLButtonElement>('button[aria-label="One night fewer"]')?.disabled).toBe(true);
    await click(villa.querySelector('button[aria-label="One more night"]'));
    await settle();
    expect(row("Garden Villa").querySelector("output")?.textContent).toBe("2 nights");
    expect(row("Garden Villa").textContent).toContain("฿8,500 each");
    expect(row("Garden Villa").textContent).toContain("฿17,000");

    await click(row("Coconut water").querySelector('button[aria-label="One more"]'));
    await settle();
    expect(row("Coconut water").querySelector("output")?.textContent).toBe("2");
    // The catalog badge follows the quantity.
    expect(tile("Coconut water").textContent).toMatch(/^2 on the order/);
  });

  it("shows each row's catalog photo, including the booked villa's on a stay, and keeps stays at one", async () => {
    const backend = createFixtureBackend();
    const opening = backend.useActions().openOrderFor({ bookingId: "fxbkg000001" as Id<"bookings"> });
    await vi.advanceTimersByTimeAsync(200);
    const { orderId } = await opening;
    await show(backend, orderId);
    await click(tab("Spa"));
    await click(tile("Sunrise yoga by the pool 60"));
    await settle();
    await click(tab("Extras"));
    await click(tile("Breakfast basket"));
    await settle();

    const stay = row("Stay · Lagoon Pool Villa");
    expect(stay.querySelector("img")?.getAttribute("src")).toBe("/pool-villa-veranda-view.webp");
    expect(stay.querySelector('[role="group"]')).toBeNull();
    expect(stay.textContent).toContain("paid online");
    expect(row("Sunrise yoga by the pool 60").querySelector("img")?.getAttribute("src")).toBe("/experiences/wellness-yoga.png");
    expect(row("Breakfast basket").querySelector("[data-photo-fallback]")).toBeTruthy();

    // A row photo that fails to load falls back too.
    await act(async () => row("Sunrise yoga by the pool 60").querySelector("img")!.dispatchEvent(new Event("error")));
    expect(row("Sunrise yoga by the pool 60").querySelector("[data-photo-fallback]")).toBeTruthy();
  });
});

describe("checkout theme", () => {
  it("wears its own dark theme on the screen and on the layers it opens", async () => {
    await show(createFixtureBackend());
    expect(document.querySelector(".checkout-theme.dark")).toBeTruthy();
    await click([...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === "Orders"));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.classList.contains("checkout-theme")).toBe(true);
    expect(dialog.classList.contains("dark")).toBe(true);
  });
});
