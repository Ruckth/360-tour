// @vitest-environment happy-dom
import { act, createElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
let discard: () => Promise<boolean>;
let setDirty: (dirty: boolean) => void;
function Editor() {
  const [dirty, set] = useState(true);
  const { confirmDiscard } = useUnsavedGuard(dirty);
  useEffect(() => {
    setDirty = set;
    discard = confirmDiscard;
  }, [confirmDiscard]);
  return createElement("a", { href: "/admin/settings?tab=team" }, "Leave");
}
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent === text,
  )!;
beforeEach(async () => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(createElement(ConfirmProvider, null, createElement(Editor))),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("keeps a dirty draft unless Discard is explicitly chosen", async () => {
  let answer!: Promise<boolean>;
  await act(async () => {
    answer = discard();
  });
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
    "Discard unsaved changes?",
  );
  await act(async () => button("Keep editing").click());
  expect(await answer).toBe(false);
  await act(async () => {
    answer = discard();
  });
  await act(async () => button("Discard").click());
  expect(await answer).toBe(true);
});

it("coalesces repeated navigation attempts into one confirmation", async () => {
  let first!: Promise<boolean>;
  let second!: Promise<boolean>;
  await act(async () => {
    first = discard();
    second = discard();
  });
  expect(first).toBe(second);
  await act(async () => button("Keep editing").click());
  expect(await first).toBe(false);
});

it("guards page unload while dirty and removes the handler when clean", async () => {
  const unload = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  expect(unload()).toBe(true);
  await act(async () => setDirty(false));
  expect(unload()).toBe(false);
  expect(await discard()).toBe(true);
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});

it("blocks an in-app link until discard, then replays it once", async () => {
  const anchor = host.querySelector("a")!;
  let navigations = 0;
  anchor.addEventListener("click", (event) => {
    event.preventDefault();
    navigations += 1;
  });
  await act(async () => anchor.click());
  expect(navigations).toBe(0);
  await act(async () => button("Keep editing").click());
  expect(navigations).toBe(0);
  await act(async () => anchor.click());
  await act(async () => button("Discard").click());
  expect(navigations).toBe(1);
});

it("replays once across nested dirty guards and repeated captured clicks", async () => {
  function NestedEditor() {
    useUnsavedGuard(true);
    return createElement(Editor);
  }
  await act(async () => root.render(createElement(ConfirmProvider, null, createElement(NestedEditor))));
  const anchor = host.querySelector("a")!;
  let navigations = 0;
  anchor.addEventListener("click", (event) => {
    event.preventDefault();
    navigations += 1;
  });
  await act(async () => { anchor.click(); anchor.click(); });
  expect(navigations).toBe(0);
  expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
  await act(async () => button("Keep editing").click());
  expect(navigations).toBe(0);
  await act(async () => { anchor.click(); anchor.click(); });
  await act(async () => button("Discard").click());
  expect(navigations).toBe(1);
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});
