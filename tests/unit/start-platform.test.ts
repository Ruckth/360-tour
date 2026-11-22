import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { localizeHref } from "@/i18n/routing";
import dynamic from "@/start-app/platform/dynamic";
import { canOptimizeImage, imageSources, vercelImages } from "@/start-app/platform/image-config";
import { parseUrlSearch, stringifyUrlSearch } from "@/start-app/platform/search";

it("keeps locale changes and Start search round trips compatible with URLSearchParams", () => {
  const href = "/rooms/pool-villa?tour=1&code=0003&tag=a&tag=b&empty=&note=a%3Fb#a%23b";
  expect(localizeHref(href, "th")).toBe("/th" + href);
  expect(localizeHref("/th" + href, "en")).toBe(href);
  expect(localizeHref("/rooms/pool-villa?note=a?b#hash#suffix", "th"))
    .toBe("/th/rooms/pool-villa?note=a?b#hash#suffix");
  const input = new URL(href, "https://local.invalid");
  const result = new URLSearchParams(stringifyUrlSearch(parseUrlSearch(input.search)));
  expect(result.get("code")).toBe("0003");
  expect(result.getAll("tag")).toEqual(["a", "b"]);
  expect(result.get("empty")).toBe("");
  expect(result.get("note")).toBe("a?b");
  expect(parseUrlSearch("?__proto__=data")).toHaveProperty("__proto__", "data");
});

it("emits only supported Vercel image widths and scopes optimizer requests to allowed sources", () => {
  for (const src of [
    "/pool-villa-living.webp",
    "/experiences/hero-samui-experiences.png",
    "https://demo-resort.convex.cloud/api/storage/image",
    "https://qr-official.line.me/gs/code.png?param=value",
    "https://images.unsplash.com/photo-123",
  ]) expect(canOptimizeImage(src)).toBe(true);
  for (const src of [
    "//images.unsplash.com/photo-123",
    "/\\images.unsplash.com/photo-123",
    "/admin/report.png",
    "/favicon.svg",
    "http://images.unsplash.com/photo-123",
    "https://images.unsplash.com.evil.invalid/photo-123",
    "https://a.b.convex.cloud/photo",
    "https://user@images.unsplash.com/photo",
    "https://images.unsplash.com:8080/photo",
  ]) expect(canOptimizeImage(src)).toBe(false);

  const src = "https://images.unsplash.com/photo-123?a=one&b=two";
  const responsive = imageSources(src, undefined, "(min-width: 768px) 50vw, 100vw", 82);
  for (const candidate of responsive.srcSet.split(", ")) {
    const [url, width] = candidate.split(" ");
    const params = new URL(url, "https://local.invalid").searchParams;
    expect(params.get("url")).toBe(src);
    expect(vercelImages.sizes).toContain(Number(params.get("w")));
    expect(width).toBe(params.get("w") + "w");
    expect(params.get("q")).toBe("82");
  }
  const fixed = imageSources(src, 44, undefined, 75);
  expect(fixed.srcSet).toContain("&w=48&q=75 1x");
  expect(fixed.srcSet).toContain("&w=96&q=75 2x");
});

it("does not fetch a client-only island when rendering the shell on the server", () => {
  const load = vi.fn(async () => function ViewerContent() { return createElement("p", null, "Viewer"); });
  const Viewer = dynamic(load, { ssr: false, loading: () => createElement("p", null, "Loading") });
  expect(renderToString(createElement(Viewer))).toContain("Loading");
  expect(load).not.toHaveBeenCalled();
});
