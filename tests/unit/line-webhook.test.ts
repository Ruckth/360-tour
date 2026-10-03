import { expect, it } from "vitest";
import {
  parseLineIntentFromPostback,
  parseLineLocaleFromPostback,
  normalizeLineQuestion,
  questionFromLinePostback,
} from "@/lib/line/quick-answers";
import { createLineSignature, verifyLineSignature } from "@/lib/line/signature";
it("verifies LINE HMAC signatures against the raw body", () => {
  const body = JSON.stringify({ events: [] });
  const channelSecret = "test-secret";
  const signature = createLineSignature(body, channelSecret);
  expect(verifyLineSignature({ body, channelSecret, signature })).toBe(true);
  expect(
    verifyLineSignature({ body: body + "\n", channelSecret, signature }),
  ).toBe(false);
});
it("keeps existing menu payloads compatible while turning them into questions", () => {
  expect(normalizeLineQuestion("  SEE   PRICES? ")).toBe("see prices");
  expect(parseLineIntentFromPostback("intent=tour")).toBe("tour");
  expect(parseLineLocaleFromPostback("intent=tour&locale=fr")).toBe("fr");
  expect(parseLineIntentFromPostback("intent=unknown")).toBeNull();
  expect(questionFromLinePostback("intent=cancellation")).toBe(
    "What is the cancellation policy?",
  );
});
