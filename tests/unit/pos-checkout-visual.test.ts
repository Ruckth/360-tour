// @vitest-environment happy-dom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

const buttonText = (text: string) => [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === text);

/** The layers checkout portals out of its screen, and how staff open each one. */
const LAYERS: Record<string, () => Promise<void>> = {
  Orders: () => click(buttonText("Orders")),
  Customer: () => click(document.querySelector('[aria-label="Add customer"]')),
  "Add booking": () => click(buttonText("Add booking")),
  Filters: () => click(document.querySelector('[aria-label^="Filters"]')),
  "Custom item": async () => {
    await click(tab("Extras"));
    await click(buttonText("Custom item"));
  },
  "Order sheet": () => click(document.querySelector('[aria-label$="open the order"]')),
};

describe("checkout theme", () => {
  afterEach(() => document.documentElement.classList.remove("dark"));

  // The app theme lives on <html> (see src/lib/theme.ts); checkout adds none of its own.
  for (const theme of ["light", "dark"] as const) {
    for (const [name, open] of Object.entries(LAYERS)) {
      it(`${theme}: the ${name} layer and its backdrop take the app theme, with touch sizes`, async () => {
        document.documentElement.classList.toggle("dark", theme === "dark");
        await show(createFixtureBackend());
        await open();
        const content = [...document.querySelectorAll('[role="dialog"]')].at(-1)!;
        expect(content, name).toBeTruthy();
        const overlay = content.previousElementSibling!;
        expect(overlay.className).toContain("bg-background/80");
        expect(content.className).toContain("pointer-coarse:[&_button]:min-h-11");
        // No checkout-only palette, and nothing below <html> forces a theme.
        expect(document.querySelector(".checkout-theme")).toBeNull();
        expect(document.body.querySelector(".dark")).toBeNull();
        const html = theme === "dark" ? document.documentElement : null;
        expect(content.closest(".dark")).toBe(html);
        expect(overlay.closest(".dark")).toBe(html);
      });
    }
  }

  it("keeps checkout's source free of its own palette and forced colour scheme", () => {
    const dir = join(process.cwd(), "src/components/checkout");
    const files = readdirSync(dir).filter((file) => /\.tsx?$/.test(file));
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source, file).not.toMatch(/checkout-theme|color-scheme|oklch\(|radial-gradient|CHECKOUT_THEME/);
      // A literal "dark" class (not a dark: variant) would force the dark theme on a subtree.
      expect(source, file).not.toMatch(/["'`](?:[^"'`\n]*\s)?dark(?:\s[^"'`\n]*)?["'`]/);
    }
  });

  it("lays the villa photo under a wash of the theme's own background", async () => {
    await show(createFixtureBackend());
    const backdrop = document.querySelector("[data-checkout-backdrop]")!;
    expect(backdrop.getAttribute("aria-hidden")).toBe("true");
    expect(backdrop.querySelector("img")?.getAttribute("src")).toBe("/pool-villa-veranda-view.webp");
    const wash = backdrop.lastElementChild!;
    expect(wash.className).toMatch(/\bfrom-background\b/);
    expect(wash.className).toMatch(/\bto-background\/\d+/);
  });
});

/**
 * Whether an element shows at a width, from its own and its ancestors' Tailwind display classes:
 * "phone" is below `sm`, "desktop" is `lg` and up (where the order panel sits beside the catalog).
 */
function shownAt(el: Element, width: "phone" | "desktop") {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const classes = [...node.classList];
    if (classes.includes("sr-only") || node.hasAttribute("hidden")) return false;
    if (width === "phone" && classes.includes("hidden")) return false;
    if (width === "desktop") {
      if (classes.includes("lg:hidden")) return false;
      if (classes.includes("hidden") && !classes.some((c) => /^(sm|md|lg):(flex|block|grid|inline|inline-flex)$/.test(c))) return false;
    }
  }
  return true;
}
/** Visible elements whose own text is exactly `text`. */
const shownText = (text: string, width: "phone" | "desktop", scope: ParentNode = document.body) =>
  [...scope.querySelectorAll("*")].filter((el) => el.children.length === 0 && el.textContent?.trim() === text && shownAt(el, width));

describe("checkout order title", () => {
  it("names the order once on desktop, in the order panel, keeping the strip's context and actions", async () => {
    await show(createFixtureBackend());
    await click(tab("Spa"));
    await click(tile("Thai massage 60"));
    await settle();

    const titles = shownText("Order #1043", "desktop");
    expect(titles).toHaveLength(1);
    expect(titles[0].closest('aside[aria-label="Order"]')).toBeTruthy();
    expect(titles[0].getAttribute("data-testid")).toBe("order-panel-title");
    // The strip's title is still in the page for narrow screens, just not on desktop.
    expect(shownAt(document.querySelector('[data-testid="order-title"]')!, "desktop")).toBe(false);
    // Booking context, customer, Orders and New order stay in the strip on desktop.
    expect(shownText("No booking", "desktop")).toHaveLength(1);
    expect(shownAt(document.querySelector('[aria-label="Add customer"]')!, "desktop")).toBe(true);
    expect(shownAt(buttonText("Orders")!, "desktop")).toBe(true);
    const newOrder = document.querySelector<HTMLButtonElement>('[aria-label="New order"]')!;
    expect(shownAt(newOrder, "desktop")).toBe(true);
    expect(newOrder.disabled).toBe(false);
    expect(shownText("New order", "desktop")).toHaveLength(1);
  });

  it("keeps the strip's title on phones, where the order panel lives in the sheet", async () => {
    await show(createFixtureBackend());
    await click(tab("Spa"));
    await click(tile("Thai massage 60"));
    await settle();

    // Sheet closed: the strip names the order; the desktop panel is hidden.
    const titles = shownText("Order #1043", "phone");
    expect(titles).toHaveLength(1);
    expect(titles[0].getAttribute("data-testid")).toBe("order-title");
    expect(shownAt(order(), "phone")).toBe(false);

    // Sheet open: it is named by the order and shows the panel's own heading.
    await click(document.querySelector('[aria-label$="open the order"]'));
    const sheet = [...document.querySelectorAll('[role="dialog"]')].at(-1)!;
    expect(document.getElementById(sheet.getAttribute("aria-labelledby")!)?.textContent).toBe("Order #1043");
    const heading = shownText("Order #1043", "phone", sheet);
    expect(heading).toHaveLength(1);
    expect(heading[0].tagName).toBe("H2");
  });
});
