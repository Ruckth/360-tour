// @vitest-environment happy-dom
import { act, createElement, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Doc } from "convex/_generated/dataModel";
import { VillaPicker } from "@/components/admin/VillaPicker";
import { ServicePicker } from "@/components/admin/ServicePicker";

const photo = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
const villas: ComponentProps<typeof VillaPicker>["properties"] = [
  { _id: "villa1", name: "Garden Villa", slug: "garden", status: "active", imageUrl: photo, maxGuests: 4, pricePerNight: 4000, directDiscountPercent: 0, currency: "THB" },
  { _id: "villa2", name: "Pool Villa", slug: "pool", status: "active", imageUrl: photo, maxGuests: 6, pricePerNight: 6000, directDiscountPercent: 0, currency: "THB" },
] as ComponentProps<typeof VillaPicker>["properties"];
const services = [
  { _id: "service1", name: "Thai Massage", category: "Wellness", durationMin: 60, price: 1000, currency: "THB", imageUrl: photo, description: "Relaxing massage" },
  { _id: "service2", name: "Oil Massage", category: "Wellness", durationMin: 90, price: 1500, currency: "THB", imageUrl: photo, description: "Oil massage" },
] as Doc<"services">[];
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });
const click = (el: Element) => act(async () => (el as HTMLElement).click());
const closeLightbox = async () => {
  const dialog = document.querySelector('[role="dialog"]')!;
  const close = [...dialog.querySelectorAll("button")].find(b => b.textContent?.trim() === "Close")!;
  await click(close);
  await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
};

it("selects a villa when its option thumbnail is clicked; photo inspection stays an explicit selected-value action", async () => {
  const changed = vi.fn();
  function Harness() {
    const [value, setValue] = useState<string>();
    return createElement(VillaPicker, { properties: villas, value, onChange: next => { changed(next); setValue(next); } });
  }
  await act(async () => root.render(createElement(Harness)));
  expect(document.querySelector('[aria-label^="View photo"]')).toBeNull();
  await click(document.querySelector('[aria-label="Villa: Choose a villa"]')!);
  const pool = [...document.querySelectorAll('[cmdk-item]')].find(row => row.textContent?.includes("Pool Villa"))!;
  expect(pool.querySelector("button")).toBeNull();
  await click(pool.querySelector("img")!);
  expect(changed).toHaveBeenCalledExactlyOnceWith("villa2");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  const preview = document.querySelector<HTMLButtonElement>('[aria-label="View photo of Pool Villa"]')!;
  expect(preview).not.toBeNull();
  expect(preview.closest('[cmdk-list]')).toBeNull();
  await click(preview);
  expect(document.querySelector('[role="dialog"] img')?.getAttribute("alt")).toBe("Photo of Pool Villa");
  await closeLightbox();
  expect(document.activeElement).toBe(preview);
  expect(changed).toHaveBeenCalledTimes(1);
});

it("keeps the selected service's photo keyboard accessible and returns focus to its actual trigger", async () => {
  await act(async () => root.render(createElement(ServicePicker, { services, value: services[0]._id, onChange: vi.fn() })));
  const preview = document.querySelector<HTMLButtonElement>('[aria-label="View photo of Thai Massage"]')!;
  expect(preview.tabIndex).toBe(0);
  preview.focus();
  await click(preview);
  expect(document.querySelector('[role="dialog"] img')?.getAttribute("alt")).toBe("Photo of Thai Massage");
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(preview);
});

it("does not add a photo affordance for an image-less selection", async () => {
  await act(async () => root.render(createElement(VillaPicker, { properties: [{ ...villas[0], imageUrl: undefined }], value: villas[0]._id, onChange: vi.fn(), compact: true })));
  expect(document.querySelector('[aria-label^="View photo"]')).toBeNull();
  expect(document.querySelector('[aria-label="Villa: Garden Villa"]')).not.toBeNull();
});

it("keeps the calendar filter focused on selection even when the chosen villa has a photo", async () => {
  const changed = vi.fn();
  await act(async () => root.render(createElement(VillaPicker, { properties: villas, value: villas[0]._id, onChange: changed, compact: true, includeAll: true })));
  expect(document.querySelector('[aria-label^="View photo"]')).toBeNull();
  await click(document.querySelector('[aria-label="Villa: Garden Villa"]')!);
  const all = [...document.querySelectorAll('[cmdk-item]')].find(row => row.textContent === "All villas")!;
  await click(all);
  expect(changed).toHaveBeenCalledExactlyOnceWith("all");
});
