// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NotifyGuestField } from "@/components/admin/BookingMoneyFields";
let root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); root = createRoot(document.body.appendChild(document.createElement("div"))); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });
it("keeps the action and full email visible while exposing the caller's explicit opt-out", async () => {
  const changed = vi.fn(), address = "a.long.guest.address+reservation@example.com";
  const props = { id: "notify", guestEmail: address, checked: true, onChange: changed, action: "the cancellation" };
  await act(async () => root.render(createElement(NotifyGuestField, props)));
  const checkbox = document.getElementById("notify") as HTMLInputElement;
  expect(checkbox.checked).toBe(true);
  expect(document.querySelector('label[for="notify"]')?.textContent).toContain("Email guest about the cancellation");
  expect(document.body.textContent).toContain(address);
  await act(async () => checkbox.click());
  expect(changed).toHaveBeenCalledExactlyOnceWith(false);
  await act(async () => root.render(createElement(NotifyGuestField, { ...props, checked: false })));
  expect((document.getElementById("notify") as HTMLInputElement).checked).toBe(false);
});
it("does not offer a send checkbox when no address exists", async () => {
  const changed = vi.fn();
  await act(async () => root.render(createElement(NotifyGuestField, { id: "notify", checked: false, onChange: changed, action: "this booking" })));
  expect(document.querySelector('input[type="checkbox"]')).toBeNull();
  expect(document.body.textContent).toBe("No guest email on file.");
  expect(changed).not.toHaveBeenCalled();
});
