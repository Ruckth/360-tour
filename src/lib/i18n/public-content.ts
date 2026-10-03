import { defaultLocale, isLocale, type Locale } from "@/i18n/routing";
import { directBenefits, getPricingByPropertyId } from "@/lib/data/pricing";
import { getPropertyById, properties, type Property } from "@/lib/data/properties";
import type { PropertySocialProof } from "@/lib/data/reviews";
import { resort } from "@/lib/data/resort-config";
import { rooms, type Room } from "@/lib/data/rooms";
import { getSocialProofByPropertyId } from "@/lib/data/social-proof";
import { getPropertyTagline } from "@/lib/data/stories";
import { getConclusionForProperty, type TourConclusion } from "@/lib/data/tourflow";

/**
 * Pure localization helpers. This module must NEVER statically import any
 * `messages/*.json` dictionary — the shape is pulled in as a TYPE only, which is
 * erased at runtime — so it is safe to import from client components. Each helper
 * takes the active locale's message object (`messages`); callers obtain it from
 * the server loader (`@/lib/i18n/server-content`) or the next-intl provider
 * (`useMessages()` on the client).
 */
export type PublicMessages = typeof import("../../../messages/en.json");
type PropertyKey = keyof PublicMessages["Properties"];

// English property keys, needed to decide which seeded villas have bundled copy.
const propertyKeys = ["pool-villa", "garden-suite", "penthouse"] as const satisfies readonly PropertyKey[];
const propertyKeySet = new Set<string>(propertyKeys);

const resortAmenityKeys = [
  "infinityPool",
  "spaWellness",
  "farmRestaurant",
  "airportTransfer",
  "conciergeService",
  "privateBeach",
  "yogaMeditation",
  "waterSports",
] as const;

const resortHighlightKeys = [
  "villaTypes",
  "guestRating",
  "reviews",
  "directSavings",
] as const;

const locationBulletKeys = ["bophut", "airport", "fisherman", "transfer"] as const;

const propertyAmenityKeys = {
  "pool-villa": ["privatePool", "wifi", "airConditioning", "kitchen", "gardenView", "kingBed"],
  "garden-suite": ["wifi", "airConditioning", "gardenTerrace", "rainShower", "queenBed"],
  penthouse: [
    "wifi",
    "airConditioning",
    "kitchenette",
    "treetopWindows",
    "loftLounge",
    "kingBed",
    "designerLighting",
  ],
} as const satisfies Record<PropertyKey, readonly string[]>;

const pricingBenefitKeys = [
  "freeAirportPickup",
  "welcomeBasket",
  "lateCheckout",
  "noServiceFees",
  "freeCancellation",
  "directWhatsappSupport",
] as const;

const tourHighlightKeys = ["one", "two", "three", "four"] as const;

function propertyKeyFrom(value: { id?: string; slug?: string } | string): PropertyKey | undefined {
  const key = typeof value === "string" ? value : value.slug ?? value.id;
  return key && propertyKeySet.has(key) ? (key as PropertyKey) : undefined;
}

function valuesFromKeys<T extends Record<string, string>, K extends readonly string[]>(
  value: T,
  keys: K,
) {
  return keys.map((key) => value[key]).filter(Boolean);
}

export function getLocalizedResort(messages: PublicMessages) {
  return {
    ...resort,
    tagline: messages.Resort.tagline,
    description: messages.Resort.description,
    location: messages.Resort.location,
    amenities: resort.amenities.map((amenity, index) => ({
      ...amenity,
      name: messages.Resort.amenities[resortAmenityKeys[index]],
    })),
    highlights: resort.highlights.map((highlight, index) => ({
      ...highlight,
      label: messages.Resort.highlights[resortHighlightKeys[index]],
    })),
  };
}

export function getLocationBullets(messages: PublicMessages) {
  return valuesFromKeys(messages.Resort.locationBullets, locationBulletKeys);
}

export function getLocationImageAlt(messages: PublicMessages) {
  return messages.Resort.locationImageAlt;
}

export type PropertyTranslation = {
  locale: string;
  tagline?: string;
  description?: string;
  amenities?: string[];
};

/** Villa copy as stored in Convex: English fields plus optional per-locale overrides. */
export type LocalizableProperty = Property & {
  slug?: string;
  translations?: PropertyTranslation[];
  contentEditedAt?: number | null;
};

/**
 * Resolves guest-facing villa copy for a locale, per field:
 * DB translation → edited DB English → bundled messages/*.json copy → DB English.
 * Bundled copy only exists for the seeded slugs, and stops applying once an admin edits the English text.
 *
 * `messages` is the ACTIVE locale's dictionary; `localeTag` is the normalized locale string
 * used to match a per-locale DB translation entry.
 */
export function localizePropertyLike<T extends LocalizableProperty>(
  property: T,
  messages: PublicMessages,
  localeTag: string,
): T {
  const translation = property.translations?.find((item) => matchesLocaleTag(item.locale, localeTag));
  const key = property.contentEditedAt ? undefined : propertyKeyFrom(property);
  const bundled = key ? messages.Properties[key] : undefined;
  const bundledAmenities = key && bundled ? valuesFromKeys(bundled.amenities, propertyAmenityKeys[key]) : undefined;

  return {
    ...property,
    tagline: translation?.tagline?.trim() || bundled?.tagline || property.tagline,
    description: translation?.description?.trim() || bundled?.description || property.description,
    amenities: translation?.amenities?.length ? translation.amenities : bundledAmenities ?? property.amenities,
  };
}

/**
 * Match a DB translation entry's locale against the active locale, using the SAME
 * normalization the server loader uses so results are identical to the previous
 * `normalizePublicLocale(a) === normalizePublicLocale(b)` comparison (e.g. an
 * unsupported tag folds to the default locale on both sides).
 */
function normalizeTag(locale?: string): Locale {
  if (locale && isLocale(locale)) return locale;
  if (locale?.toLowerCase() === "zh-cn") return "zh-CN";
  return defaultLocale;
}

function matchesLocaleTag(entryLocale: string, localeTag: string) {
  return normalizeTag(entryLocale) === normalizeTag(localeTag);
}

export const localizeProperty = localizePropertyLike;

export function getLocalizedProperties(messages: PublicMessages, localeTag: string) {
  return properties.map((property) => localizePropertyLike(property, messages, localeTag));
}

export function getLocalizedPropertyById(id: string, messages: PublicMessages, localeTag: string) {
  const property = getPropertyById(id);
  return property ? localizePropertyLike(property, messages, localeTag) : undefined;
}

export function getLocalizedPropertyTagline(propertyId: string, messages: PublicMessages) {
  const key = propertyKeyFrom(propertyId);
  return key ? messages.Properties[key].storyTagline : getPropertyTagline(propertyId);
}

export function localizeRooms(baseRooms: Room[], messages: PublicMessages): Room[] {
  return baseRooms.map((room) => {
    const content = messages.Rooms[room.id as keyof PublicMessages["Rooms"]];
    if (!content) return room;

    return {
      ...room,
      name: content.name,
      hotspots: room.hotspots.map((hotspot) => ({
        ...hotspot,
        label: content.hotspots[hotspot.id as keyof typeof content.hotspots] ?? hotspot.label,
      })),
    };
  });
}

export function getLocalizedRooms(messages: PublicMessages) {
  return localizeRooms(rooms, messages);
}

export function getLocalizedSocialProofByPropertyId(
  propertyId: string,
  messages: PublicMessages,
): PropertySocialProof | undefined {
  const socialProof = getSocialProofByPropertyId(propertyId);
  if (!socialProof) return undefined;

  return {
    ...socialProof,
    reviews: socialProof.reviews.map((review) => {
      const content = messages.Reviews[review.id as keyof PublicMessages["Reviews"]];
      return content
        ? {
            ...review,
            title: content.title,
            body: content.body,
          }
        : review;
    }),
    tourSnippets: socialProof.tourSnippets.map((snippet) => {
      const content = messages.TourSnippets[snippet.id as keyof PublicMessages["TourSnippets"]];
      return content ? { ...snippet, quote: content.quote } : snippet;
    }),
  };
}

/** Direct-booking perks shared by every villa. */
export function getLocalizedDirectBenefits(messages: PublicMessages) {
  const benefits = messages.Pricing.benefits;
  return directBenefits.map((benefit, index) => ({
    ...benefit,
    benefit: benefits[pricingBenefitKeys[index]] ?? benefit.benefit,
  }));
}

export function getLocalizedPricingByPropertyId(propertyId: string, messages: PublicMessages) {
  const pricing = getPricingByPropertyId(propertyId);
  if (!pricing) return undefined;

  const benefits = messages.Pricing.benefits;
  return {
    ...pricing,
    directBenefits: pricing.directBenefits.map((benefit, index) => ({
      ...benefit,
      benefit: benefits[pricingBenefitKeys[index]] ?? benefit.benefit,
    })),
  };
}

export function getLocalizedTourConclusion(
  propertyId: string,
  messages: PublicMessages,
): TourConclusion | undefined {
  const conclusion = getConclusionForProperty(propertyId);
  const key = propertyKeyFrom(propertyId);
  if (!conclusion || !key) return conclusion;

  const content = messages.TourConclusions[key];
  return {
    ...conclusion,
    headline: content.headline,
    summary: content.summary,
    highlights: valuesFromKeys(content.highlights, tourHighlightKeys),
    closingLine: content.closingLine,
  };
}

export function getBookingDocumentMessages(messages: PublicMessages) {
  return messages.BookingDocuments;
}
