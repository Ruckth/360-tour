import type { Room } from "@/lib/data/rooms";
import { getPublicMessages, normalizePublicLocale } from "@/lib/i18n/messages-loader";
import {
  getBookingDocumentMessages as getBookingDocumentMessagesPure,
  getLocalizedDirectBenefits as getLocalizedDirectBenefitsPure,
  getLocalizedPricingByPropertyId as getLocalizedPricingByPropertyIdPure,
  getLocalizedProperties as getLocalizedPropertiesPure,
  getLocalizedPropertyById as getLocalizedPropertyByIdPure,
  getLocalizedPropertyTagline as getLocalizedPropertyTaglinePure,
  getLocalizedResort as getLocalizedResortPure,
  getLocalizedRooms as getLocalizedRoomsPure,
  getLocalizedSocialProofByPropertyId as getLocalizedSocialProofByPropertyIdPure,
  getLocalizedTourConclusion as getLocalizedTourConclusionPure,
  getLocationBullets as getLocationBulletsPure,
  getLocationImageAlt as getLocationImageAltPure,
  localizePropertyLike as localizePropertyLikePure,
  localizeRooms as localizeRoomsPure,
  type LocalizableProperty,
} from "@/lib/i18n/public-content";

export { normalizePublicLocale, getPublicMessages };
export type { PublicMessages } from "@/lib/i18n/public-content";

/**
 * Locale-string localization API for SERVER code (layout, pages, generateMetadata,
 * PDF documents, the server-side villa catalog) and unit tests. Each wrapper loads
 * the active locale's dictionary with `getPublicMessages` and forwards to the pure
 * helper. The all-locale import graph lives in `messages-loader.ts` and never
 * reaches a client bundle.
 */
export function getLocalizedResort(locale?: string) {
  return getLocalizedResortPure(getPublicMessages(locale));
}

export function getLocationBullets(locale?: string) {
  return getLocationBulletsPure(getPublicMessages(locale));
}

export function getLocationImageAlt(locale?: string) {
  return getLocationImageAltPure(getPublicMessages(locale));
}

export function localizePropertyLike<T extends LocalizableProperty>(property: T, locale?: string): T {
  return localizePropertyLikePure(property, getPublicMessages(locale), normalizePublicLocale(locale));
}

export const localizeProperty = localizePropertyLike;

export function getLocalizedProperties(locale?: string) {
  return getLocalizedPropertiesPure(getPublicMessages(locale), normalizePublicLocale(locale));
}

export function getLocalizedPropertyById(id: string, locale?: string) {
  return getLocalizedPropertyByIdPure(id, getPublicMessages(locale), normalizePublicLocale(locale));
}

export function getLocalizedPropertyTagline(propertyId: string, locale?: string) {
  return getLocalizedPropertyTaglinePure(propertyId, getPublicMessages(locale));
}

export function localizeRooms(baseRooms: Room[], locale?: string) {
  return localizeRoomsPure(baseRooms, getPublicMessages(locale));
}

export function getLocalizedRooms(locale?: string) {
  return getLocalizedRoomsPure(getPublicMessages(locale));
}

export function getLocalizedSocialProofByPropertyId(propertyId: string, locale?: string) {
  return getLocalizedSocialProofByPropertyIdPure(propertyId, getPublicMessages(locale));
}

export function getLocalizedDirectBenefits(locale?: string) {
  return getLocalizedDirectBenefitsPure(getPublicMessages(locale));
}

export function getLocalizedPricingByPropertyId(propertyId: string, locale?: string) {
  return getLocalizedPricingByPropertyIdPure(propertyId, getPublicMessages(locale));
}

export function getLocalizedTourConclusion(propertyId: string, locale?: string) {
  return getLocalizedTourConclusionPure(propertyId, getPublicMessages(locale));
}

export function getBookingDocumentMessages(locale?: string) {
  return getBookingDocumentMessagesPure(getPublicMessages(locale));
}
