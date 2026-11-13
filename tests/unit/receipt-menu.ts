import { act } from "react";
import { expect, vi } from "vitest";

/**
 * Opens the receipt's ⋯ (MoreMenu, Base UI) and picks `item`, as a pointer would. Works with or
 * without fake timers.
 */
export async function pickReceiptAction(item: string) {
  const trigger = document.querySelector<HTMLElement>('[aria-label="More receipt actions"]');
  expect(trigger, "⋯ More receipt actions").toBeTruthy();
  await act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) trigger!.dispatchEvent(new MouseEvent(type, { bubbles: true }));
  });
  await settle();
  const entry = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent === item);
  expect(entry, item).toBeTruthy();
  await act(async () => entry!.click());
  await settle();
}

/** The labels in the receipt's ⋯ right now, opening it if needed; closes it again. */
export async function receiptActions() {
  const trigger = document.querySelector<HTMLElement>('[aria-label="More receipt actions"]')!;
  await act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) trigger.dispatchEvent(new MouseEvent(type, { bubbles: true }));
  });
  await settle();
  const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((el) => ({ label: el.textContent ?? "", disabled: el.getAttribute("aria-disabled") === "true" }));
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await settle();
  return items;
}

async function settle() {
  await act(async () => {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(100);
    else await new Promise((resolve) => setTimeout(resolve, 50));
  });
}
