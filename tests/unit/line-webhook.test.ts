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

  it("builds customer links from the site origin even when SITE_URL includes the webhook path", () => {
    const answer = resolveLineQuickAnswer({
      eventType: "message",
      messageText: "Check dates",
      properties,
      siteUrl: "https://tour.helpgueststay.com/api/line/webhook",
    });

    expect(answer?.text).toContain("https://tour.helpgueststay.com/booking");
    expect(answer?.text).not.toContain("/api/line/webhook/booking");
  });

  it("keeps all deterministic customer links on the public site origin", () => {
    const webhookSiteUrl = "https://tour.helpgueststay.com/api/line/webhook";
    const scenarios = [
      { eventType: "follow" as const },
      { eventType: "message" as const, messageText: "Check dates" },
      { eventType: "message" as const, messageText: "See prices" },
      { eventType: "message" as const, messageText: "Direct booking" },
      { eventType: "message" as const, messageText: "Villa details" },
      { eventType: "message" as const, messageText: "View 360 tour" },
      { eventType: "message" as const, messageText: "Where are you located" },
      { eventType: "postback" as const, postbackData: "intent=availability" },
      { eventType: "postback" as const, postbackData: "intent=pricing" },
      { eventType: "postback" as const, postbackData: "intent=direct_booking" },
      { eventType: "postback" as const, postbackData: "intent=villa_details" },
      { eventType: "postback" as const, postbackData: "intent=tour" },
      { eventType: "postback" as const, postbackData: "intent=contact" },
    ];

    for (const scenario of scenarios) {
      const answer = resolveLineQuickAnswer({
        eventType: scenario.eventType,
        messageText: "messageText" in scenario ? scenario.messageText : undefined,
        postbackData: "postbackData" in scenario ? scenario.postbackData : undefined,
        properties,
        siteUrl: webhookSiteUrl,
      });

      expect(answer, JSON.stringify(scenario)).not.toBeNull();
      expect(answer?.text, JSON.stringify(scenario)).not.toContain("/api/line/webhook");
      expect(answer?.text, JSON.stringify(scenario)).not.toContain("tour.helpgueststay.com/api");
    }
  });
});
