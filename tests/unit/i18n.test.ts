import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultLocale, locales, localizeHref, stripLocalePrefix } from "@/i18n/routing";
import {
  getLocalizedPricingByPropertyId,
  getLocalizedProperties,
  getLocalizedResort,
  getLocalizedRooms,
  getLocalizedSocialProofByPropertyId,
  getLocalizedTourConclusion,
} from "@/lib/i18n/public-content";
import { properties } from "@/lib/data/properties";

type Messages = Record<string, unknown>;

function flattenKeys(value: Messages, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === "object" && !Array.isArray(child)
      ? flattenKeys(child as Messages, path)
      : [path];
  });
}

function readMessages(locale: string) {
  return JSON.parse(readFileSync(join(process.cwd(), "messages", `${locale}.json`), "utf8")) as Messages;
}

function placeholders(value: string) {
  return [...value.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort();
}

function isAllowedSameAsEnglish(key: string) {
  return [
    /^Booking\.(fullNameExample|emailExample|phoneExample|details|email|total)$/,
    /^Chat\.(name|email|whatsapp|line|whatsappPlaceholder)$/,
    /^Nav\.(villas|contact)$/,
    /^SEO\.(rootOgTitle|villaFallback)$/,
    /^Resort\.location$/,
    /^Resort\.amenities\.(spaWellness|yogaMeditation)$/,
    /^Properties\..*\.amenities\.wifi$/,
    /^Properties\.penthouse\.amenities\.kitchenette$/,
    /^Rooms\.gs-lounge\.name$/,
    /^Rooms\.gs-dining\.hotspots\.gs-dining-to-lounge$/,
    /^Tour\.leadEmailPlaceholder$/,
    /^BookingDocuments\.(email|total)$/,
  ].some((pattern) => pattern.test(key));
}

describe("i18n routing helpers", () => {
  it("keeps English unprefixed and prefixes translated routes", () => {
    expect(localizeHref("/", defaultLocale)).toBe("/");
    expect(localizeHref("/booking", "en")).toBe("/booking");
    expect(localizeHref("/booking", "th")).toBe("/th/booking");
    expect(localizeHref("/rooms/garden-suite?tour=1", "ja")).toBe("/ja/rooms/garden-suite?tour=1");
    expect(localizeHref("/#villas", "zh-CN")).toBe("/zh-CN#villas");
    expect(localizeHref("/th/booking?unit=garden-suite", "en")).toBe("/booking?unit=garden-suite");
  });

  it("strips supported locale prefixes and leaves external links unchanged", () => {
    expect(stripLocalePrefix("/th/booking")).toBe("/booking");
    expect(stripLocalePrefix("/zh-CN/rooms/pool-villa")).toBe("/rooms/pool-villa");
    expect(stripLocalePrefix("/ar/booking")).toBe("/ar/booking");
    expect(localizeHref("https://example.com", "ja")).toBe("https://example.com");
    expect(localizeHref("mailto:stay@example.com", "ja")).toBe("mailto:stay@example.com");
    expect(localizeHref("tel:+6677000000", "ja")).toBe("tel:+6677000000");
  });
});

describe("message files", () => {
  it("has complete message keys for every supported locale", () => {
    const englishKeys = flattenKeys(readMessages("en")).sort();

    for (const locale of locales) {
      const keys = flattenKeys(readMessages(locale)).sort();
      expect(keys, locale).toEqual(englishKeys);
    }
  });

  it("keeps placeholders aligned across locales", () => {
    const english = readMessages("en");
    const englishKeys = flattenKeys(english);
    const englishFlat = Object.fromEntries(englishKeys.map((key) => [key, key.split(".").reduce<unknown>((value, part) => (value as Messages)[part], english)]));

    for (const locale of locales) {
      const messages = readMessages(locale);
      for (const key of englishKeys) {
        const value = key.split(".").reduce<unknown>((current, part) => (current as Messages)[part], messages);
        expect(placeholders(String(value)), `${locale}:${key}`).toEqual(placeholders(String(englishFlat[key])));
      }
    }
  });

  it("flags accidental English holdovers in public translated catalogs", () => {
    const english = readMessages("en");
    const englishKeys = flattenKeys(english);
    const englishFlat = Object.fromEntries(englishKeys.map((key) => [key, key.split(".").reduce<unknown>((value, part) => (value as Messages)[part], english)]));

    for (const locale of locales.filter((item) => item !== "en")) {
      const messages = readMessages(locale);
      const unexpected = englishKeys.filter((key) => {
        const value = key.split(".").reduce<unknown>((current, part) => (current as Messages)[part], messages);
        return String(value) === String(englishFlat[key]) && !isAllowedSameAsEnglish(key);
      });

      expect(unexpected, locale).toEqual([]);
    }
  });
});

describe("localized public content overlays", () => {
  it("preserves property identifiers, names, prices, and media while localizing display copy", () => {
    const englishPool = properties.find((property) => property.id === "pool-villa");
    const thaiPool = getLocalizedProperties("th").find((property) => property.id === "pool-villa");

    expect(thaiPool?.id).toBe(englishPool?.id);
    expect(thaiPool?.name).toBe(englishPool?.name);
    expect(thaiPool?.pricePerNight).toBe(englishPool?.pricePerNight);
    expect(thaiPool?.images).toEqual(englishPool?.images);
    expect(thaiPool?.tagline).not.toBe(englishPool?.tagline);
    expect(thaiPool?.amenities).toContain("สระส่วนตัว");
  });

  it("localizes resort, room, pricing, review, and tour content", () => {
    expect(getLocalizedResort("de").tagline).toBe("Wo der Ozean auf Ruhe trifft");
    expect(getLocalizedRooms("ja").find((room) => room.id === "pv-living")?.name).toBe("リビングエリア");
    expect(getLocalizedPricingByPropertyId("pool-villa", "ko")?.directBenefits[0]?.benefit).toBe("무료 공항 픽업");

    const germanProof = getLocalizedSocialProofByPropertyId("pool-villa", "de");
    expect(germanProof?.reviews[0]?.author.name).toBe("Sophie Laurent");
    expect(germanProof?.reviews[0]?.author.city).toBe("Paris");
    expect(germanProof?.reviews[0]?.title).not.toBe("The pool was absolutely stunning");

    const thaiConclusion = getLocalizedTourConclusion("garden-suite", "th");
    expect(thaiConclusion?.headline).toBe("สถานที่พักผ่อนของคุณรออยู่");
    expect(thaiConclusion?.highlights[0]).toContain("ระเบียง");
  });
});
