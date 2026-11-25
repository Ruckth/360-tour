import { redirect, rootRouteId } from "@tanstack/react-router";
import { defaultLocale, isLocale, localizeHref, type Locale } from "@/i18n/routing";
import type { Review } from "@/lib/data/reviews";
import type { PublicMessages } from "@/lib/i18n/public-content";
import { firstParam, type PageSearch } from "@/lib/page-search";
import { servicesQuery, type ServicesQuery } from "@/lib/services-query";
import type { PublicVilla } from "@/lib/villas";
import { globalNotFound } from "../not-found";
import { resolveRoomLocale, type StartHeadMetaTag, type StartRouteHead } from "./room-route";

// Shared contracts for the localized guest page routes (`/{-$locale}/...`). Everything here is
// browser-safe: server reads are injected by each route's createServerFn handler.

/** Root loader data every guest route reads for copy and metadata (see `routes/__root.tsx`). */
export type GuestShell = { locale: Locale; messages: PublicMessages; resort: string; site: string };

/**
 * `beforeLoad` for every localized guest route: bare paths are English, `/en/...` redirects to
 * the bare path (the request middleware already does this for documents), and an unknown
 * prefix is a real 404 handled by the root not-found boundary. There is deliberately no
 * catch-all route, so unknown paths never render a synthetic 200.
 */
export function guestLocaleContext({
  params,
  location,
}: {
  params: { locale?: string };
  location: { href: string };
}): { guestLocale: Locale } {
  const resolution = resolveRoomLocale(params.locale);
  if (resolution.kind === "redirect") {
    throw redirect({ href: localizeHref(location.href, defaultLocale), statusCode: 308 });
  }
  if (resolution.kind === "invalid") throw globalNotFound();
  return { guestLocale: resolution.locale };
}

/** Keeps every string parameter (including attribution such as `mk`) so links and reloads retain it. */
export function guestSearch(search: Record<string, unknown>): PageSearch {
  const result: PageSearch = {};
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === "string") result[key] = value;
    else if (Array.isArray(value) && value.every((item) => typeof item === "string")) result[key] = value;
  }
  return result;
}

export function guestShell(matches: readonly { routeId: string; loaderData?: unknown }[]): GuestShell | undefined {
  return matches.find((match) => match.routeId === rootRouteId)?.loaderData as GuestShell | undefined;
}

export type GuestHeadInput = {
  title: string;
  description?: string;
  /** Open Graph/Twitter card for pages that override the root card (relative image resolved against the site). */
  social?: { title: string; description: string; image: string };
};

/** Child tags override the root's tags with the same title/name/property. */
export function guestHead(
  matches: readonly { routeId: string; loaderData?: unknown }[],
  pick: (messages: PublicMessages) => GuestHeadInput,
): StartRouteHead {
  const shell = guestShell(matches);
  if (!shell) return { meta: [] };
  const { title, description, social } = pick(shell.messages);
  const meta: StartHeadMetaTag[] = [{ title }];
  if (description) meta.push({ name: "description", content: description });
  if (social) {
    const image = new URL(social.image, shell.site).href;
    meta.push(
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: shell.resort },
      { property: "og:title", content: social.title },
      { property: "og:description", content: social.description },
      { property: "og:image", content: image },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: social.title },
      { name: "twitter:description", content: social.description },
      { name: "twitter:image", content: image },
    );
  }
  return { meta };
}

export function validateGuestLocaleInput(input: unknown): { locale: Locale } {
  const locale = input && typeof input === "object" ? (input as { locale?: unknown }).locale : undefined;
  if (typeof locale !== "string" || !isLocale(locale)) throw new Error("Unsupported guest locale.");
  return { locale };
}

type ResponseDeps = {
  setResponseStatus: (status: number, statusText?: string) => void;
  setResponseHeader: (name: string, value: string) => void;
};

export type StartHomeData = { villas: PublicVilla[]; reviews: Review[] };
export type StartHomeResult =
  | { status: "ok"; data: StartHomeData }
  | { status: "unavailable"; retryAfterSeconds: number }
  | { status: "error" };

/**
 * Home reads the live villa catalog (required) and featured reviews (an empty list when the
 * read fails). A cold catalog outage is a 503 with Retry-After; any other failure is a 500.
 */
export async function loadStartHomeData(
  locale: Locale,
  deps: ResponseDeps & {
    getCatalog: (locale: string) => Promise<{ villas: PublicVilla[] }>;
    getFeaturedReviews: () => Promise<Review[]>;
    isVillaUnavailableError: (error: unknown) => error is { retryAfterSeconds: number };
  },
): Promise<StartHomeResult> {
  try {
    const [catalog, reviews] = await Promise.all([deps.getCatalog(locale), deps.getFeaturedReviews()]);
    return { status: "ok", data: { villas: catalog.villas, reviews } };
  } catch (error) {
    deps.setResponseHeader("Cache-Control", "no-store");
    if (deps.isVillaUnavailableError(error)) {
      deps.setResponseStatus(503, "Service Unavailable");
      deps.setResponseHeader("Retry-After", String(error.retryAfterSeconds));
      return { status: "unavailable", retryAfterSeconds: error.retryAfterSeconds };
    }
    deps.setResponseStatus(500, "Internal Server Error");
    return { status: "error" };
  }
}

const MAX_CHAT_PARAM_LENGTH = 200;
export type StartChatQuery = { property?: string; service?: string; duration?: string };
export type StartChatInput = StartChatQuery & { locale: Locale };
export type StartChatData = {
  /** `durationMin` only when the requested length is one the service offers. */
  service: { slug: string; name: string; durationMin?: number } | null;
  property: { id: string; name: string } | null;
};

const chatParam = (value: unknown) =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_CHAT_PARAM_LENGTH ? value : undefined;
const durationParam = (value: unknown) => (typeof value === "string" && /^\d{1,4}$/.test(value) ? value : undefined);

export function chatQuery(search: PageSearch): StartChatQuery {
  return {
    property: chatParam(firstParam(search, "property")),
    service: chatParam(firstParam(search, "service")),
    duration: durationParam(firstParam(search, "duration")),
  };
}

export function validateChatInput(input: unknown): StartChatInput {
  const { locale } = validateGuestLocaleInput(input);
  const { property, service, duration } = input as Record<string, unknown>;
  return { locale, property: chatParam(property), service: chatParam(service), duration: durationParam(duration) };
}

/** Unknown or unreadable services and villas simply omit the draft or villa context, as on Next. */
export async function loadStartChatData(
  { locale, property, service, duration }: StartChatInput,
  deps: {
    getPublicService: (slug: string) => Promise<{ slug: string; name: string; options?: { durationMin: number }[] } | null>;
    getVilla: (slug: string, locale: string) => Promise<{ page: { villa: PublicVilla } | null }>;
  },
): Promise<StartChatData> {
  const [serviceRow, villa] = await Promise.all([
    service ? deps.getPublicService(service).catch(() => null) : null,
    property ? deps.getVilla(property, locale).then((read) => read.page?.villa ?? null, () => null) : null,
  ]);
  return {
    service: serviceRow
      ? {
          slug: serviceRow.slug,
          name: serviceRow.name,
          ...(serviceRow.options?.some((option) => String(option.durationMin) === duration) ? { durationMin: Number(duration) } : {}),
        }
      : null,
    property: villa ? { id: villa.id, name: villa.name } : null,
  };
}

/** Re-applies the page's own parameter rules (`servicesQuery`) to RPC input. */
export function validateServicesInput(input: unknown): ServicesQuery {
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const text = (value: unknown) => (typeof value === "string" ? value : undefined);
  return servicesQuery({
    category: text(record.category),
    q: text(record.query),
    cursor: text(record.cursor),
    categoryAfter: text(record.categoryAfter),
  });
}
