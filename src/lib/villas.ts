import type { api } from "convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { resort } from "@/lib/data/resort-config";
import type { Review } from "@/lib/data/reviews";
import {
  localizePropertyLike,
  type LocalizableProperty,
  type PublicMessages,
} from "@/lib/i18n/public-content";

// Admin-managed catalog content comes only from Convex. Bundled translations are presentation.

export type RatingSummary = { average: number; count: number };

export type PublicVilla = LocalizableProperty & {
  currency: string;
  directDiscountPercent: number;
  /** Null when the villa has no reviews: we never show invented ratings. */
  rating: RatingSummary | null;
};

export type VillaCatalog = { source: "db"; villas: PublicVilla[] };

export type DbVillaList = FunctionReturnType<typeof api.catalog.publicProperties.list>;
export type DbVillaDetail = NonNullable<FunctionReturnType<typeof api.catalog.publicProperties.getBySlug>>;
type DbVilla = DbVillaList["villas"][number];
type DbReview = DbVillaDetail["reviews"][number];

export function summarizeRatings(reviews: { rating: number }[]): RatingSummary | null {
  if (!reviews.length) return null;
  const total = reviews.reduce((sum, review) => sum + review.rating, 0);
  return { average: Math.round((total / reviews.length) * 100) / 100, count: reviews.length };
}

export function currencyPrefix(currency: string) {
  return currency === resort.currency ? resort.currencySymbol : `${currency} `;
}

export function villaFromDb(row: DbVilla, messages: PublicMessages, localeTag: string): PublicVilla {
  return localizePropertyLike(
    {
      id: row.slug,
      slug: row.slug,
      name: row.name,
      tagline: row.tagline,
      description: row.description,
      pricePerNight: row.pricePerNight,
      currency: row.currency,
      maxGuests: row.maxGuests,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      area: row.area,
      images: row.images,
      amenities: row.amenities,
      tourRoomIds: row.tourRoomIds,
      directDiscountPercent: row.directDiscountPercent,
      translations: row.translations,
      contentEditedAt: row.contentEditedAt,
      rating:
        row.reviewCount > 0 && row.averageRating !== null
          ? { average: row.averageRating, count: row.reviewCount }
          : null,
    },
    messages,
    localeTag,
  );
}

export function reviewFromDb(row: DbReview): Review {
  return {
    id: row.id,
    propertyId: row.propertySlug,
    author: {
      name: row.authorName,
      city: row.authorCity,
      country: row.authorCountry,
      avatarUrl: row.authorAvatarUrl,
    },
    rating: row.rating,
    title: row.title,
    body: row.body,
    date: row.date,
    verified: row.verified,
    photos: row.photos,
  };
}

/** Missing or empty backend data never invents bookable inventory. */
export function catalogFrom(
  list: DbVillaList | undefined,
  messages: PublicMessages,
  localeTag: string,
): VillaCatalog {
  if (!list) return { source: "db", villas: [] };
  return { source: "db", villas: list.villas.map((row) => villaFromDb(row, messages, localeTag)) };
}
