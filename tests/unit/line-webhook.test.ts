import { describe, expect, it } from "vitest";
import {
  buildLineQuickReplyItems,
  normalizeLineQuestion,
  parseLineIntentFromPostback,
  parseLineLocaleFromPostback,
  questionFromLinePostback,
} from "@/lib/line/quick-answers";
import { createLineSignature, verifyLineSignature } from "@/lib/line/signature";

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

  it("normalizes question text for locale hints", () => {
    expect(normalizeLineQuestion("  SEE   PRICES? ")).toBe("see prices");
  });

  it("turns LINE postbacks into the question the guest saw, never a fixed answer", () => {
    expect(parseLineIntentFromPostback("intent=tour")).toBe("tour");
    expect(parseLineLocaleFromPostback("intent=tour&locale=fr")).toBe("fr");
    expect(parseLineIntentFromPostback("intent=unknown")).toBeNull();

    // Menu postbacks become the localized label the guest tapped (LINE shows it as their message).
    expect(questionFromLinePostback("intent=tour&locale=fr")).toBe("Voir la visite 360");
    expect(questionFromLinePostback("intent=pricing&locale=ja")).toBe("料金を見る");
    // Older rich-menu intents become ordinary questions for the concierge.
    expect(questionFromLinePostback("intent=cancellation")).toBe("What is the cancellation policy?");
    // A greeting or unknown postback carries no question.
    expect(questionFromLinePostback("intent=welcome")).toBeUndefined();
    expect(questionFromLinePostback("intent=unknown")).toBeUndefined();
    expect(questionFromLinePostback(undefined)).toBeUndefined();
  });

  it("builds a localized quick-reply menu whose postbacks round-trip to questions", () => {
    expect(buildLineQuickReplyItems().map((item) => item.action.label)).toEqual([
      "Check dates",
      "See prices",
      "View 360 tour",
      "Contact host",
    ]);
    const french = buildLineQuickReplyItems("fr");
    expect(french[0]?.action.data).toBe("intent=availability&locale=fr");
    for (const item of french) {
      expect(questionFromLinePostback(item.action.data)).toBe(item.action.displayText);
    }
  });
});
