import { calculateDirectQuote } from "convex/shared/pricing";
import { describe, expect, it } from "vitest";
import { properties } from "@/lib/data/properties";
import { getPublicMessages } from "@/lib/i18n/messages-loader";
import { localizePropertyLike } from "@/lib/i18n/server-content";
import { catalogFrom, summarizeRatings, type DbVillaList } from "@/lib/villas";

// The catalog helpers now take the active locale's message object; these tests exercise
// the English catalog, so bind the English dictionary once.
const enMessages = getPublicMessages("en");
const catalogEn = (list: DbVillaList | undefined) => catalogFrom(list, enMessages, "en");

const seededPool = properties.find((property) => property.id === "pool-villa")!;

function dbVilla(overrides: Partial<DbVillaList["villas"][number]> = {}): DbVillaList["villas"][number] {
  return {
    _id: "p1" as import("convex/_generated/dataModel").Id<"properties">,
    slug: "pool-villa",
    name: "Tideglass Pool Residence",
    tagline: seededPool.tagline,
    description: seededPool.description,
    pricePerNight: 900000,
    currency: "THB",
    maxGuests: 4,
    bedrooms: 2,
    bathrooms: 2,
    area: 145,
    images: ["/a.webp"],
    amenities: ["Private Pool"],
    tourRoomIds: [],
    directDiscountPercent: 1000,
    translations: [],
    contentEditedAt: null,
    reviewCount: 0,
    averageRating: null,
    ...overrides,
  };
}

describe("villa copy locale resolution", () => {
  const base = { ...seededPool, slug: "pool-villa" };

  it("uses bundled i18n copy for seeded villas the admin has not edited", () => {
    const thai = localizePropertyLike(base, "th");
    expect(thai.tagline).not.toBe(seededPool.tagline);
    expect(thai.amenities).toContain("สระส่วนตัว");
  });

  it("prefers a DB translation, field by field", () => {
    const thai = localizePropertyLike(
      { ...base, translations: [{ locale: "th", tagline: "แท็กไลน์จากแอดมิน" }] },
      "th",
    );
    expect(thai.tagline).toBe("แท็กไลน์จากแอดมิน");
    // No DB description translation → bundled Thai copy still applies.
    expect(thai.description).toBe(localizePropertyLike(base, "th").description);
  });

  it("shows edited DB English instead of stale bundled translations", () => {
    const edited = { ...base, tagline: "New owner tagline", amenities: ["Sauna"], contentEditedAt: 1 };
    expect(localizePropertyLike(edited, "th")).toMatchObject({ tagline: "New owner tagline", amenities: ["Sauna"] });
    expect(
      localizePropertyLike({ ...edited, translations: [{ locale: "zh-cn", tagline: "新标语" }] }, "zh-CN").tagline,
    ).toBe("新标语");
  });

  it("falls back to DB English for villas without bundled copy", () => {
    const villa = { ...base, id: "sky-house", slug: "sky-house", tagline: "Above the clouds" };
    expect(localizePropertyLike(villa, "ja").tagline).toBe("Above the clouds");
  });
});

describe("backend villa catalog", () => {
  it("shows no inventory when Convex is unavailable or empty", () => {
    for (const list of [undefined, { hasProperties: false, villas: [] }]) {
      const catalog = catalogEn(list);
      expect(catalog.source).toBe("db");
      expect(catalog.villas).toEqual([]);
    }
  });

  it("uses only the database review aggregate for public ratings", () => {
    const pool = catalogEn({hasProperties:true,villas:[dbVilla({reviewCount:6,averageRating:4.83})]}).villas[0];
    expect(pool?.rating?.count).toBe(6);
    expect(pool?.rating?.average).toBeCloseTo(4.83, 2);
  });

  it("serves DB villas once the database has properties, even if none are active", () => {
    expect(catalogEn({ hasProperties: true, villas: [] })).toEqual({ source: "db", villas: [] });

    const catalog = catalogEn(
      { hasProperties: true, villas: [dbVilla({ reviewCount: 2, averageRating: 4.5 }), dbVilla({ slug: "new", name: "New" })] },
    );
    expect(catalog.source).toBe("db");
    expect(catalog.villas[0]).toMatchObject({ id: "pool-villa", pricePerNight: 900000, directDiscountPercent: 1000, rating: { average: 4.5, count: 2 } });
    expect(catalog.villas[1]).toMatchObject({ id: "new", rating: null });
  });

  it("summarizes ratings", () => {
    expect(summarizeRatings([])).toBeNull();
    expect(summarizeRatings([{ rating: 5 }, { rating: 4 }, { rating: 4 }])).toEqual({ average: 4.33, count: 3 });
  });
});

it('quotes the actual database catalog using its stored discount', () => {
  const villa = catalogEn({hasProperties:true,villas:[dbVilla({pricePerNight:850000,directDiscountPercent:1500})]}).villas[0];
  expect(calculateDirectQuote({ pricePerNight: villa.pricePerNight, directDiscountPercent: villa.directDiscountPercent, currency: villa.currency }, 2)).toMatchObject({ subtotal: 1700000, discountAmount: 255000, directTotal: 1445000 });
});
