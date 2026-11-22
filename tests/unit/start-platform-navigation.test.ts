// @vitest-environment happy-dom

import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Link from "@/platform/link";
import { useRouter, useSearchParams } from "@/platform/navigation";

const fixture = vi.hoisted(() => ({
  router: { navigate: vi.fn() },
  search: "?tour=1&tag=a&tag=b",
}));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => fixture.router,
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { searchStr: fixture.search } }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  fixture.router.navigate.mockClear();
  fixture.search = "?tour=1&tag=a&tag=b";
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it("keeps anchor semantics for modified clicks and navigates with query and hash on ordinary clicks", () => {
  const href = "/th/rooms/pool-villa?tour=1&tag=a&tag=b#scene";
  const onClick = vi.fn();
  act(() => root.render(createElement("div", { onClick: (event) => event.preventDefault() },
    createElement(Link, { href, onClick }, "Tour"))));
  const link = host.querySelector("a")!;
  expect(link.getAttribute("href")).toBe(href);
  act(() => {
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }));
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
  });
  expect(fixture.router.navigate).not.toHaveBeenCalled();
  act(() => link.click());
  expect(fixture.router.navigate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ href, replace: false }));
  expect(onClick).toHaveBeenCalledTimes(3);
});

it("keeps search parameter and navigation identities stable, and supports replace without scrolling", () => {
  const observe = vi.fn<(router: ReturnType<typeof useRouter>, searchParams: URLSearchParams) => void>();
  function Inspect() {
    const router = useRouter();
    const searchParams = useSearchParams();
    useEffect(() => { observe(router, searchParams); });
    return null;
  }
  act(() => root.render(createElement(Inspect)));
  const [router, search] = observe.mock.calls[0];
  expect(search.getAll("tag")).toEqual(["a", "b"]);
  act(() => root.render(createElement(Inspect)));
  expect(observe.mock.calls[1][0]).toBe(router);
  expect(observe.mock.calls[1][1]).toBe(search);
  fixture.search = "?tour=0";
  act(() => root.render(createElement(Inspect)));
  expect(observe.mock.calls[2][1].get("tour")).toBe("0");
  expect(observe.mock.calls[2][1]).not.toBe(search);
  router.replace("/rooms/pool-villa#scene", { scroll: false });
  expect(fixture.router.navigate).toHaveBeenLastCalledWith({
    href: "/rooms/pool-villa#scene", replace: true, resetScroll: false, hashScrollIntoView: false,
  });
});
