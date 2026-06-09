import { describe, expect, it } from "vitest";
import { resolveLineQuickAnswer, type LinePropertySummary } from "@/lib/line/quick-answers";

const properties: LinePropertySummary[] = [
  {
    slug: "pool-villa",
    name: "Pool Villa",
    tagline: "Private pool retreat",
    pricePerNight: 12000,
    currency: "THB",
    maxGuests: 4,
    bedrooms: 2,
    bathrooms: 2,
    area: 140,
    amenities: ["Private pool", "Kitchen"],
    directDiscountPercent: 15,
  },
];

describe("LINE quick answers", () => {
  it("resolves hardcoded exact quick answers before question-bank fallback would run", () => {
    const answer = resolveLineQuickAnswer({
      eventType: "message",
      messageText: "See prices",
      properties,
      siteUrl: "https://tour.helpgueststay.com",
    });

    expect(answer).toMatchObject({
      mode: "exact",
      intent: "pricing",
    });
    expect(answer?.text).toContain("Current direct booking prices");
  });
});
