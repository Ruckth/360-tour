import { describe, expect, it } from "vitest";
import { locales } from "@/i18n/routing";
import {
  buildLineQuickReplyItems,
  localizedTimeoutFallbackReply,
  localizedUnknownFallbackReply,
  questionFromLinePostback,
  resolveLineQuickAnswer,
} from "@/lib/line/quick-answers";

describe("LINE question menu", () => {
  it.each(locales)(
    "turns every %s menu payload into a question without a saved answer",
    (locale) => {
      const menu = buildLineQuickReplyItems(locale);
      expect(menu).toHaveLength(4);
      for (const item of menu) {
        expect(questionFromLinePostback(item.action.data)).toBe(
          item.action.displayText,
        );
        expect(
          resolveLineQuickAnswer({
            eventType: "postback",
            postbackData: item.action.data,
            properties: [],
            siteUrl: "https://example.com",
          }),
        ).toBeNull();
      }
    },
  );
  it.each([
    "See prices",
    "ราคาเท่าไหร่",
    "가격이 얼마인가요",
    "Free cancellation?",
    "Direct booking",
  ])("sends %s through the concierge", (messageText) => {
    expect(
      resolveLineQuickAnswer({
        eventType: "message",
        messageText,
        properties: [],
        siteUrl: "https://example.com",
      }),
    ).toBeNull();
  });
  it("has honest localized fallbacks and rejects unknown intents", () => {
    expect(questionFromLinePostback("intent=unknown")).toBeUndefined();
    for (const locale of locales) {
      expect(localizedUnknownFallbackReply(locale)).toBeTruthy();
      expect(localizedTimeoutFallbackReply(locale)).toBeTruthy();
    }
    expect(localizedUnknownFallbackReply("en")).not.toMatch(
      /alerted|notified|included|discount/i,
    );
  });
});
