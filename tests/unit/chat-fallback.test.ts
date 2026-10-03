import { describe, expect, it } from "vitest";
import { getFallbackResponse } from "../../convex/lib/chatFallback";

const property = {
  name: "Tideglass Pool Residence",
  pricePerNight: 8500,
  directDiscountPercent: 15,
  amenities: ["Private Pool", "WiFi"],
  area: 145,
  bedrooms: 2,
  bathrooms: 2,
  maxGuests: 4,
} as never;

describe("localized chat fallback responses", () => {
  it("returns English pricing and property details", () => {
    expect(getFallbackResponse("How much is it?", property, "en")).toContain("฿7,225/night");
    expect(getFallbackResponse("What amenities are included?", property, "en")).toContain("Private Pool");
  });

  it("matches Thai intent text and keeps facts unchanged", () => {
    const response = getFallbackResponse("ราคาเท่าไหร่", property, "th");

    expect(response).toContain("Tideglass Pool Residence");
    expect(response).toContain("฿7,225");
    expect(response).toContain("คืน");
  });

  it("localizes no-key fallbacks for every visible non-English locale", () => {
    const expectations = [
      ["zh-CN", "直接预订"],
      ["ja", "直接予約"],
      ["ko", "직접 예약"],
      ["fr", "réservation directe"],
      ["de", "Direktbuchung"],
      ["es", "reserva directa"],
      ["ru", "Прямое бронирование"],
      ["it", "prenotazione diretta"],
      ["hi", "सीधी बुकिंग"],
    ] as const;

    for (const [locale, expected] of expectations) {
      expect(getFallbackResponse("book dates", null, locale)).toContain(expected);
    }
  });

  it("lists villas and prices from the database instead of a hardcoded catalog", () => {
    const villas = [
      { ...(property as object), name: "Sky House", pricePerNight: 10000, directDiscountPercent: 20, currency: "THB" },
      { ...(property as object), name: "Reef Cabin", pricePerNight: 3000, directDiscountPercent: 20, currency: "USD" },
    ] as never[];

    const price = getFallbackResponse("How much?", null, "en", villas);
    expect(price).toContain("We have 2 luxury properties");
    expect(price).toContain("**Sky House**: ฿10,000/night (฿8,000 direct)");
    expect(price).toContain("**Reef Cabin**: USD 3,000/night (USD 2,400 direct)");
    expect(price).toContain("20% direct booking discount");
    expect(price).not.toContain("Tideglass");

    expect(getFallbackResponse("hello", null, "en", villas)).toContain("Sky House or Reef Cabin");
    expect(getFallbackResponse("book dates", null, "th", villas)).toContain("ส่วนลด 20%");
  });

  it("omits the shared-discount line when villas have different discounts", () => {
    const villas = [
      { ...(property as object), name: "A", directDiscountPercent: 10 },
      { ...(property as object), name: "B", directDiscountPercent: 15 },
    ] as never[];
    expect(getFallbackResponse("price", null, "en", villas)).not.toContain("All prices include");
  });

  it("no longer asserts retired policy benefits that are not in settings or property records", () => {
    // The retirement removed hardcoded free airport pickup / welcome basket / late checkout
    // claims from the coded fallback: they are not owner-approved facts.
    const booking = getFallbackResponse("book my dates", property, "en");
    expect(booking).toContain("15% off");
    for (const retired of ["airport pickup", "welcome basket", "late checkout", "breakfast"]) {
      expect(booking.toLowerCase()).not.toContain(retired);
    }
    // Localized presets must not reintroduce the claims either.
    expect(getFallbackResponse("book dates", null, "th")).not.toContain("รับสนามบิน");
    expect(getFallbackResponse("book dates", null, "ko")).not.toContain("공항 픽업");
    expect(getFallbackResponse("book dates", null, "ja")).not.toContain("空港送迎");
  });
});
