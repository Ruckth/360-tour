import type { BookingProperty } from "@/lib/booking/booking";
import { resort } from "@/lib/data/resort-config";
import { getLocalizedProperties, localizePropertyLike } from "@/lib/i18n/public-content";
import type { LivePropertyRow } from "@/lib/react/convex-api";

export const chatVillaBackgrounds: Record<string, string> = {
  "pool-villa": "/pool-villa-veranda-view.webp",
  "garden-suite": "/garden-image.webp",
  penthouse: "/canopy-loft-bedroom-photo.jpg",
};

export function getChatVillaBackground(property: Pick<BookingProperty, "id" | "slug">) {
  return chatVillaBackgrounds[property.slug] ?? chatVillaBackgrounds[property.id];
}

export function getDemoChatProperties(locale: string): BookingProperty[] {
  return getLocalizedProperties(locale).map((property) => ({
    ...property,
    _id: `demo-${property.id}`,
    slug: property.id,
    currency: resort.currency,
    directDiscountPercent: 15,
    source: "demo",
  }));
}

export function getLiveChatProperties(rows: LivePropertyRow[], locale: string): BookingProperty[] {
  return rows.map((row) =>
    localizePropertyLike(
      {
        ...row,
        id: row.slug,
        source: "live" as const,
      },
      locale,
    ),
  );
}
