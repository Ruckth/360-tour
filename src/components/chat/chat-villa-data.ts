import { type BookingProperty } from "@/lib/booking/booking";
import {
  localizePropertyLike,
  type PublicMessages,
} from "@/lib/i18n/public-content";
import type { LivePropertyRow } from "@/lib/booking/backend-types";

export const chatVillaBackgrounds: Record<string, string> = {
  "pool-villa": "/pool-villa-veranda-view.webp",
  "garden-suite": "/garden-image.webp",
  penthouse: "/canopy-loft-bedroom-photo.jpg",
};

export function getChatVillaBackground(property: Pick<BookingProperty, "id" | "slug">) {
  return chatVillaBackgrounds[property.slug] ?? chatVillaBackgrounds[property.id];
}

export function getLiveChatProperties(
  rows: LivePropertyRow[],
  messages: PublicMessages,
  localeTag: string,
): BookingProperty[] {
  return rows.map((row) =>
    localizePropertyLike(
      {
        ...row,
        id: row.slug,
        source: "live" as const,
      },
      messages,
      localeTag,
    ),
  );
}
