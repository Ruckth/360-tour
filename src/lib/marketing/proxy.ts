import { validateMarketingSlug } from "../../../convex/shared/marketingSlugs";

/** Only bare short links are resolved, before next-intl sees the request. */
export function marketingSlugForPath(pathname: string): string | null {
  if (!/^\/(?:[a-z0-9-]+|r\/[a-z0-9-]+)\/?$/.test(pathname)) return null;
  const slug = pathname.slice(1).replace(/\/$/, "");
  return validateMarketingSlug(slug).reason ? null : slug;
}

/** Defense in depth at the HTTP boundary, even though the resolver builds paths. */
export function isInternalMarketingPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !/[\\\s\u0000-\u001f\u007f]/.test(path);
}
