import { notFound, rootRouteId } from "@tanstack/react-router";

// Not-found contracts shared by the root boundary and guest routes, matching the Next app:
// - Global 404 (no route matches the URL, or a guest URL has an unknown locale prefix): Next's
//   default "404: This page could not be found." title and copy.
// - Designed 404 (a matched route throws a plain `notFound()`, e.g. /dev/checkout-preview in
//   production): the root title, as when a Next page calls notFound() under the root layout.
// Both, and route-level boundaries such as a missing villa, carry `<meta name="robots" content="noindex">`.
// The classification reads only the root match's `_notFound` flag and serialized `error`, which
// SSR dehydrates and client navigation sets identically, so document and client heads agree.

export const GLOBAL_NOT_FOUND_TITLE = "404: This page could not be found.";
export const GLOBAL_NOT_FOUND_MESSAGE = "This page could not be found.";
export const NOINDEX_META = { name: "robots", content: "noindex" } as const;

const GLOBAL_MARKER = "start-global-404";

/** Throw from a matched route when its URL should behave like an unmatched one (unknown locale). */
export function globalNotFound() {
  return notFound({ routeId: rootRouteId, data: { kind: GLOBAL_MARKER } });
}

type NotFoundMatch = { _notFound?: boolean; status?: string; error?: unknown };

export function rootNotFoundKind(match: NotFoundMatch | undefined): "global" | "designed" | undefined {
  if (!match?._notFound) return undefined;
  const data = match.error && typeof match.error === "object" ? (match.error as { data?: unknown }).data : undefined;
  if (match.error == null) return "global";
  return data && typeof data === "object" && (data as { kind?: unknown }).kind === GLOBAL_MARKER ? "global" : "designed";
}

type MetaTag = { title?: string } & Record<string, unknown>;

/** Root head for a root-handled 404: noindex, plus the global title when the URL is unmatched. */
export function withRootNotFoundHead<T extends MetaTag>(meta: T[], match: NotFoundMatch | undefined): (T | MetaTag)[] {
  const kind = rootNotFoundKind(match);
  if (!kind) return meta;
  const tags: (T | MetaTag)[] = kind === "global"
    ? meta.map((tag) => ("title" in tag ? { title: GLOBAL_NOT_FOUND_TITLE } : tag))
    : [...meta];
  tags.push(NOINDEX_META);
  return tags;
}

/** Head for a route-level not-found boundary: keep the root (localized) title and add noindex. */
export function isRouteNotFound(match: NotFoundMatch | undefined) {
  return match?.status === "notFound";
}
