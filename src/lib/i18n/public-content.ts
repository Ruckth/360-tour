import de from "../../../messages/de.json";
import en from "../../../messages/en.json";
import es from "../../../messages/es.json";
import fr from "../../../messages/fr.json";
import hi from "../../../messages/hi.json";
import it from "../../../messages/it.json";
import ja from "../../../messages/ja.json";
import ko from "../../../messages/ko.json";
import ru from "../../../messages/ru.json";
import th from "../../../messages/th.json";
import zhCN from "../../../messages/zh-CN.json";
import { defaultLocale, isLocale, type Locale } from "@/i18n/routing";
import { getPricingByPropertyId } from "@/lib/data/pricing";
import { getPropertyById, properties, type Property } from "@/lib/data/properties";
import type { PropertySocialProof } from "@/lib/data/reviews";
import { resort } from "@/lib/data/resort-config";
import { rooms, type Room } from "@/lib/data/rooms";
import { getSocialProofByPropertyId } from "@/lib/data/social-proof";
import { getPropertyTagline } from "@/lib/data/stories";
import { getConclusionForProperty, type TourConclusion } from "@/lib/data/tourflow";

type PublicMessages = typeof en;
type PropertyKey = keyof PublicMessages["Properties"];

const messagesByLocale = {
  de,
  en,
  es,
  fr,
  hi,
  it,
  ja,
  ko,
  ru,
  th,
  "zh-CN": zhCN,
} satisfies Record<Locale, PublicMessages>;

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

export function normalizePublicLocale(locale?: string): Locale {
  if (locale && isLocale(locale)) return locale;
  if (locale?.toLowerCase() === "zh-cn") return "zh-CN";
  return defaultLocale;
}

export function getPublicMessages(locale?: string) {
  return messagesByLocale[normalizePublicLocale(locale)];
}

function propertyKeyFrom(value: { id?: string; slug?: string } | string): PropertyKey | undefined {
  const key = typeof value === "string" ? value : value.slug ?? value.id;
  return key && key in en.Properties ? (key as PropertyKey) : undefined;
}

function valuesFromKeys<T extends Record<string, string>, K extends readonly string[]>(
  value: T,
  keys: K,
) {
  return keys.map((key) => value[key]).filter(Boolean);
}

export function getLocalizedResort(locale?: string) {
  const messages = getPublicMessages(locale);

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

export function getLocationBullets(locale?: string) {
  const messages = getPublicMessages(locale);
  return valuesFromKeys(messages.Resort.locationBullets, locationBulletKeys);
}

export function getLocationImageAlt(locale?: string) {
  return getPublicMessages(locale).Resort.locationImageAlt;
}

export function localizeProperty<T extends Property>(property: T, locale?: string): T {
  const key = propertyKeyFrom(property);
  if (!key) return property;

  const content = getPublicMessages(locale).Properties[key];
  return {
    ...property,
    tagline: content.tagline,
    description: content.description,
    amenities: valuesFromKeys(content.amenities, propertyAmenityKeys[key]),
  };
}

export function localizePropertyLike<T extends Property & { slug?: string }>(
  property: T,
  locale?: string,
): T {
  const key = propertyKeyFrom(property);
  if (!key) return property;

  const content = getPublicMessages(locale).Properties[key];
  return {
    ...property,
    tagline: content.tagline,
    description: content.description,
    amenities: valuesFromKeys(content.amenities, propertyAmenityKeys[key]),
  };
}

export function getLocalizedProperties(locale?: string) {
  return properties.map((property) => localizeProperty(property, locale));
}

export function getLocalizedPropertyById(id: string, locale?: string) {
  const property = getPropertyById(id);
  return property ? localizeProperty(property, locale) : undefined;
}

export function getLocalizedPropertyTagline(propertyId: string, locale?: string) {
  const key = propertyKeyFrom(propertyId);
  return key ? getPublicMessages(locale).Properties[key].storyTagline : getPropertyTagline(propertyId);
}

export function localizeRooms(baseRooms: Room[], locale?: string): Room[] {
  const messages = getPublicMessages(locale);

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

export function getLocalizedRooms(locale?: string) {
  return localizeRooms(rooms, locale);
}

export function getLocalizedSocialProofByPropertyId(
  propertyId: string,
  locale?: string,
): PropertySocialProof | undefined {
  const socialProof = getSocialProofByPropertyId(propertyId);
  if (!socialProof) return undefined;

  const messages = getPublicMessages(locale);
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

export function getLocalizedPricingByPropertyId(propertyId: string, locale?: string) {
  const pricing = getPricingByPropertyId(propertyId);
  if (!pricing) return undefined;

  const benefits = getPublicMessages(locale).Pricing.benefits;
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
  locale?: string,
): TourConclusion | undefined {
  const conclusion = getConclusionForProperty(propertyId);
  const key = propertyKeyFrom(propertyId);
  if (!conclusion || !key) return conclusion;

  const content = getPublicMessages(locale).TourConclusions[key];
  return {
    ...conclusion,
    headline: content.headline,
    summary: content.summary,
    highlights: valuesFromKeys(content.highlights, tourHighlightKeys),
    closingLine: content.closingLine,
  };
}

export function getBookingDocumentMessages(locale?: string) {
  return getPublicMessages(locale).BookingDocuments;
}
