/** Prefixes that live outside `[locale]`, so the next-intl middleware must not localize them. */
const EXEMPT_PREFIXES = ["/api", "/admin", "/dev/", "/__clerk", "/sign-in", "/sign-up"];

/** The customer display is its own route with its own (English-only for now) messages. */
const EXEMPT_ROUTES = ["/display"];

export function bypassesI18n(pathname: string): boolean {
  return (
    EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    EXEMPT_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))
  );
}
