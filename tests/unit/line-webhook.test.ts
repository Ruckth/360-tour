import { describe, expect, it } from "vitest";
import {
  buildLineQuickReplyItems,
  normalizeLineQuestion,
  parseLineIntentFromPostback,
  resolveLineQuickAnswer,
  type LinePropertySummary,
} from "@/lib/line/quick-answers";
import { createLineSignature, verifyLineSignature } from "@/lib/line/signature";

const properties: LinePropertySummary[] = [
  {
    slug: "pool-villa",
    name: "Tideglass Pool Residence",
    tagline: "Private paradise with infinity pool",
    pricePerNight: 8500,
    currency: "THB",
    maxGuests: 4,
    bedrooms: 2,
    bathrooms: 2,
    area: 145,
    amenities: ["Private Pool", "WiFi"],
    directDiscountPercent: 15,
  },
];

describe("LINE webhook helpers", () => {
  it("verifies LINE HMAC signatures using the raw body", () => {
    const body = JSON.stringify({ events: [] });
    const channelSecret = "test-secret";
    const signature = createLineSignature(body, channelSecret);

    expect(verifyLineSignature({ body, channelSecret, signature })).toBe(true);
    expect(
      verifyLineSignature({
        body: `${body}\n`,
        channelSecret,
        signature,
      }),
    ).toBe(false);
  });

  it("only resolves exact normalized questions before AI fallback", () => {
    expect(normalizeLineQuestion("  SEE   PRICES? ")).toBe("see prices");

    const exact = resolveLineQuickAnswer({
      eventType: "message",
      messageText: "See prices?",
      properties,
      siteUrl: "https://tour.helpgueststay.com",
    });
    const nearMiss = resolveLineQuickAnswer({
      eventType: "message",
      messageText: "Can you show me your latest price for tomorrow?",
      properties,
      siteUrl: "https://tour.helpgueststay.com",
    });

    expect(exact?.intent).toBe("pricing");
    expect(exact?.text).toContain("Tideglass Pool Residence");
    expect(nearMiss).toBeNull();
  });

  it("maps LINE postback data to deterministic answers and quick reply buttons", () => {
    expect(parseLineIntentFromPostback("intent=tour")).toBe("tour");
    expect(parseLineIntentFromPostback("intent=unknown")).toBeNull();

    const postback = resolveLineQuickAnswer({
      eventType: "postback",
      postbackData: "intent=tour",
      properties,
      siteUrl: "https://tour.helpgueststay.com",
    });

    expect(postback).toMatchObject({ intent: "tour", mode: "postback" });
    expect(buildLineQuickReplyItems().map((item) => item.action.label)).toEqual([
      "Check dates",
      "See prices",
      "View 360 tour",
      "Contact host",
    ]);
  });
});
