import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isNotFound, notFound, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { guestLocaleContext } from "@/start-app/guest/guest-route";
import {
  GLOBAL_NOT_FOUND_TITLE,
  globalNotFound,
  NOINDEX_META,
  rootNotFoundKind,
  withRootNotFoundHead,
} from "@/start-app/not-found";

const rootMeta = [{ charSet: "utf-8" }, { title: "Auralis Cove Retreat - วิลล่าหรูใน Koh Samui, Thailand" }, { name: "description", content: "d" }];

describe("Start not-found contracts", () => {
  it("classifies unmatched and unknown-locale URLs as global, plain route notFound() as designed", () => {
    expect(rootNotFoundKind({ _notFound: false })).toBeUndefined();
    expect(rootNotFoundKind({ status: "notFound", error: notFound() })).toBeUndefined();
    expect(rootNotFoundKind({ _notFound: true })).toBe("global");
    expect(rootNotFoundKind({ _notFound: true, error: globalNotFound() })).toBe("global");
    // Dehydrated errors are plain objects; the marker survives serialization.
    expect(rootNotFoundKind({ _notFound: true, error: JSON.parse(JSON.stringify(globalNotFound())) })).toBe("global");
    expect(rootNotFoundKind({ _notFound: true, error: notFound() })).toBe("designed");
  });

  it("uses Next's global 404 title for global 404s and keeps the root title for designed ones, both noindex", () => {
    expect(withRootNotFoundHead(rootMeta, { _notFound: false })).toEqual(rootMeta);
    expect(withRootNotFoundHead(rootMeta, { _notFound: true })).toEqual([
      rootMeta[0], { title: GLOBAL_NOT_FOUND_TITLE }, rootMeta[2], NOINDEX_META,
    ]);
    expect(withRootNotFoundHead(rootMeta, { _notFound: true, error: notFound() })).toEqual([...rootMeta, NOINDEX_META]);
  });

  it("routes unknown guest locales to the root global 404", () => {
    let thrown: unknown;
    try {
      guestLocaleContext({ params: { locale: "xx" }, location: { href: "/xx/services" } });
    } catch (error) {
      thrown = error;
    }
    expect(isNotFound(thrown)).toBe(true);
    expect(thrown).toMatchObject({ routeId: rootRouteId });
    expect(rootNotFoundKind({ _notFound: true, error: thrown })).toBe("global");
  });

  it("wires the root boundary and room head/locale handling to these contracts", () => {
    const routes = resolve(__dirname, "../../src/start-app/routes");
    const root = readFileSync(resolve(routes, "__root.tsx"), "utf8");
    expect(root).toMatch(/withRootNotFoundHead\(\[[\s\S]*\], match\)/);
    expect(root).toContain("notFoundComponent: GlobalNotFound");
    const room = readFileSync(resolve(routes, "{-$locale}.rooms.$id.tsx"), "utf8");
    expect(room).toContain("throw globalNotFound()");
    expect(room).toContain("isRouteNotFound(match) ? { meta: [NOINDEX_META] }");
  });
});
