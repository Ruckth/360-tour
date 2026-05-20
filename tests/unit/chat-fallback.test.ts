import { describe, expect, it } from "vitest";
import { getFallbackResponse } from "../../convex/lib/chatFallback";

const property = {
  name: "Pool Villa",
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

    expect(response).toContain("Pool Villa");
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
});
