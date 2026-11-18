// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useStoredState } from "@/lib/use-stored-state";

let root: Root;
const setters: Record<string, (value: string) => void> = {};
function Pref({ id, storageKey = "pref" }: { id: string; storageKey?: string }) {
  const [value, setValue] = useStoredState(storageKey, "fallback");
  useEffect(() => { setters[id] = setValue; });
  return createElement("span", { id }, value);
}
const text = (id: string) => document.getElementById(id)?.textContent;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("server-renders the fallback so hydration markup matches", () => {
  localStorage.setItem("pref", "stored");
  expect(renderToString(createElement(Pref, { id: "a" }))).toContain("fallback");
});

it("shows the stored value on the client and keeps same-key readers in step", async () => {
  localStorage.setItem("pref", "stored");
  await act(async () => root.render([createElement(Pref, { id: "a", key: "a" }), createElement(Pref, { id: "b", key: "b" })]));
  expect(text("a")).toBe("stored");
  await act(async () => setters.a("next"));
  expect(localStorage.getItem("pref")).toBe("next");
  expect([text("a"), text("b")]).toEqual(["next", "next"]);
});

it("still applies an update when storage is blocked", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  await act(async () => root.render(createElement(Pref, { id: "a", storageKey: "blocked" })));
  expect(text("a")).toBe("fallback");
  await act(async () => setters.a("kept"));
  expect(text("a")).toBe("kept");
});
