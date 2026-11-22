import { allowedImageUrl, IMAGE_HOSTS, IMAGE_HOST_SUFFIX } from "../../convex/shared/imageUrls";
import type { NitroConfig } from "nitro/types";

const deviceSizes = [640, 750, 828, 1080, 1200, 1920, 2048, 3840];
const sizes = [32, 48, 64, 96, 128, 256, 384, ...deviceSizes];
const localImagePath = "^/(?:(?:contact|experiences|tour|videos)/(?:[^/]+/)*)?[^/]+\\.(?:avif|gif|ico|jpe?g|png|webp)$";

function escapePattern(value: string) {
  return value.replaceAll(".", "\\.");
}

// Build Output API allowlists use anchored regular expressions.
export const vercelImages = {
  sizes,
  domains: [],
  qualities: [72, 75, 82],
  formats: ["image/avif", "image/webp"],
  localPatterns: [{ pathname: localImagePath }],
  remotePatterns: [
    ...IMAGE_HOSTS.map((hostname) => ({ hostname: "^" + escapePattern(hostname) + "$" })),
    { hostname: "^[a-z0-9-]+" + escapePattern(IMAGE_HOST_SUFFIX) + "$" },
  ].map((pattern) => ({ ...pattern, protocol: "https", port: "" })),
} satisfies NonNullable<NonNullable<NonNullable<NitroConfig["vercel"]>["config"]>["images"]> & {
  qualities: number[];
  localPatterns: { pathname: string }[];
};

export function canOptimizeImage(src: string) {
  if (!allowedImageUrl(src)) return false;
  if (src.startsWith("https://")) return !new URL(src).pathname.toLowerCase().endsWith(".svg");
  const pathname = new URL(src, "https://local.invalid").pathname;
  return new RegExp(localImagePath).test(pathname);
}

export function imageSources(src: string, width: number | undefined, layoutSizes: string | undefined, quality: number) {
  const srcForWidth = (candidate: number) =>
    `/_vercel/image?url=${encodeURIComponent(src)}&w=${candidate}&q=${quality}`;
  const widthDescriptor = Boolean(layoutSizes) || width === undefined;
  let widths: number[];
  if (layoutSizes) {
    const viewportWidths = Array.from(layoutSizes.matchAll(/(?:^|\s)(1?\d?\d)vw/g), ([, size]) => Number(size));
    widths = viewportWidths.length
      ? sizes.filter((size) => size >= deviceSizes[0] * Math.min(...viewportWidths) / 100)
      : sizes;
  } else if (width === undefined) {
    widths = deviceSizes;
  } else {
    widths = [...new Set([width, width * 2].map((value) => sizes.find((size) => size >= value) ?? sizes[sizes.length - 1]))];
  }
  return {
    src: srcForWidth(widths[widths.length - 1]),
    srcSet: widths.map((value, index) => `${srcForWidth(value)} ${widthDescriptor ? value + "w" : index + 1 + "x"}`).join(", "),
    sizes: layoutSizes ?? (width === undefined ? "100vw" : undefined),
  };
}
