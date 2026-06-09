import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { locales } from "@/i18n/routing";
import {
  getChatActionCard,
  getChatActionHintForRankedTopic,
  getChatActionHintForStaticSuggestion,
  resolveChatActionHint,
} from "@/lib/chat/action-card";
import type { ChatSuggestionId } from "@/lib/chat/suggestions";

type ChatMessages = Record<string, string>;

const staticSuggestions: Array<{
  id: ChatSuggestionId;
  questionKey: string;
  answerKey: string;
  expectedType: "booking" | "tour" | "none";
}> = [
  {
    id: "availability",
    questionKey: "suggestionAvailability",
    answerKey: "answerAvailability",
    expectedType: "booking",
  },
  {
    id: "totalPrice",
    questionKey: "suggestionTotalPrice",
    answerKey: "answerTotalPrice",
    expectedType: "booking",
  },
  {
    id: "direct",
    questionKey: "suggestionDirect",
    answerKey: "answerDirect",
    expectedType: "booking",
  },
  {
    id: "tour",
    questionKey: "suggestion360",
    answerKey: "answer360",
    expectedType: "tour",
  },
  {
    id: "guests",
    questionKey: "suggestionGuests",
    answerKey: "answerGuests",
    expectedType: "none",
  },
  {
    id: "contact",
    questionKey: "suggestionContact",
    answerKey: "answerContact",
    expectedType: "none",
  },
  {
    id: "couple",
    questionKey: "suggestionCouple",
    answerKey: "answerCouple",
    expectedType: "none",
  },
  {
    id: "family",
    questionKey: "suggestionFamily",
    answerKey: "answerFamily",
    expectedType: "none",
  },
  {
    id: "cancellation",
    questionKey: "suggestionCancellation",
    answerKey: "answerCancellation",
    expectedType: "none",
  },
  {
    id: "airport",
    questionKey: "suggestionAirport",
    answerKey: "answerAirport",
    expectedType: "none",
  },
  {
    id: "amenitiesIncluded",
    questionKey: "suggestionAmenitiesIncluded",
    answerKey: "answerAmenitiesIncluded",
    expectedType: "none",
  },
  {
    id: "location",
    questionKey: "suggestionLocation",
    answerKey: "answerLocation",
    expectedType: "none",
  },
];

function readChatMessages(locale: string) {
  const messages = JSON.parse(
    readFileSync(join(process.cwd(), "messages", `${locale}.json`), "utf8"),
  ) as { Chat: ChatMessages };
  return messages.Chat;
}

describe("chat action card mapping", () => {
  it("maps every localized static suggestion to the expected component", () => {
    for (const locale of locales) {
      const chat = readChatMessages(locale);

      for (const item of staticSuggestions) {
        expect(
          getChatActionCard({
            latestUserMessage: chat[item.questionKey],
            latestAssistantMessage: chat[item.answerKey],
            clickedSuggestionId: item.id,
          }).type,
          `${locale}:${item.id}`,
        ).toBe(item.expectedType);
        expect(getChatActionHintForStaticSuggestion(item.id), item.id).toBe(item.expectedType);
      }
    }
  });

  it("maps ranked suggestion topics to the expected component", () => {
    expect(getChatActionHintForRankedTopic("direct_booking")).toBe("booking");
    expect(getChatActionHintForRankedTopic("availability")).toBe("booking");
    expect(getChatActionHintForRankedTopic("booking")).toBe("booking");
    expect(getChatActionHintForRankedTopic("tour")).toBe("tour");
    expect(getChatActionHintForRankedTopic("villa_fit")).toBe("none");
    expect(getChatActionHintForRankedTopic("amenities")).toBe("none");
    expect(getChatActionHintForRankedTopic("contact")).toBe("none");

    expect(
      getChatActionCard({
        latestUserMessage: "Can I see these spaces in 360?",
        latestAssistantMessage: "Yes, the 360 view is available.",
        rankedSuggestionTopic: "amenities",
      }).type,
    ).toBe("none");
  });

  it("does not mistake Thai availability copy for a tour request", () => {
    const chat = readChatMessages("th");

    expect(
      getChatActionCard({
        latestUserMessage: chat.suggestionAvailability,
        latestAssistantMessage: chat.answerAvailability,
      }).type,
    ).toBe("booking");
  });

  it("lets clear availability text override a contradictory ranked tour topic", () => {
    const chat = readChatMessages("th");

    expect(
      resolveChatActionHint({
        latestUserMessage: chat.suggestionAvailability,
        rankedSuggestionTopic: "tour",
      }),
    ).toBe("booking");
    expect(
      getChatActionCard({
        latestUserMessage: chat.suggestionAvailability,
        latestAssistantMessage: chat.answerAvailability,
        rankedSuggestionTopic: "tour",
      }).type,
    ).toBe("booking");
  });

  it("uses persisted action metadata before text heuristics", () => {
    expect(
      getChatActionCard({
        latestUserMessage: "Can I see the villa in 360?",
        latestAssistantMessage: "Yes, open the 360 tour.",
        actionHint: "booking",
      }).type,
    ).toBe("booking");

    expect(
      getChatActionCard({
        latestUserMessage: "Can I check availability?",
        latestAssistantMessage: "Yes, choose dates in the booking card.",
        actionHint: "none",
      }).type,
    ).toBe("none");
  });

  it("does not mistake guest-capacity language for booking intent", () => {
    const chat = readChatMessages("en");

    expect(
      getChatActionCard({
        latestUserMessage: chat.suggestionGuests,
        latestAssistantMessage: chat.answerGuests,
      }).type,
    ).toBe("none");
  });

  it("still treats explicit tour requests as tour actions", () => {
    expect(
      getChatActionCard({
        latestUserMessage: "Can I tour before booking?",
        latestAssistantMessage: "Yes, start with the 360 tour and book after that.",
      }).type,
    ).toBe("tour");
  });
});
