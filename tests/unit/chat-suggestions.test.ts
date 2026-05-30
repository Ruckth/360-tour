import { describe, expect, it } from "vitest";
import { selectChatSuggestions, type ChatSuggestionCandidate } from "@/lib/chat/suggestions";

const candidates: ChatSuggestionCandidate[] = [
  { id: "couple", text: "Which villa is best for a couple?" },
  { id: "direct", text: "What's included when booking direct?" },
  { id: "tour", text: "Can I see the villa in 360?" },
  { id: "availability", text: "Can I check availability for my dates?" },
  { id: "guests", text: "How many guests can stay comfortably?" },
  { id: "contact", text: "How do I contact the host directly?" },
];

describe("selectChatSuggestions", () => {
  it("shows six curated suggestions on general pages", () => {
    expect(selectChatSuggestions({ candidates }).map((item) => item.id)).toEqual([
      "couple",
      "direct",
      "tour",
      "availability",
      "guests",
      "contact",
    ]);
  });

  it("starts with tour and direct but still shows six suggestions on property pages", () => {
    expect(
      selectChatSuggestions({ candidates, activePropertySlug: "garden-suite" }).map(
        (item) => item.id,
      ),
    ).toEqual(["tour", "direct", "availability", "couple", "guests", "contact"]);
  });

  it("does not repeat a clicked couple suggestion", () => {
    expect(
      selectChatSuggestions({
        candidates,
        latestUserMessage: "Which villa is best for a couple?",
        latestAssistantMessage: "The Mossbell Garden Suite is the quietest couples' retreat.",
        clickedSuggestionId: "couple",
      }).map((item) => item.id),
    ).toEqual(["direct", "tour"]);
  });

  it("routes direct booking questions to tour and couple follow-ups", () => {
    expect(
      selectChatSuggestions({
        candidates,
        latestUserMessage: "Do direct booking discounts include airport pickup?",
        latestAssistantMessage: "Direct booking saves around 15%.",
      }).map((item) => item.id),
    ).toEqual(["tour", "couple"]);
  });

  it("detects exact localized suggestion text", () => {
    const germanCandidates: ChatSuggestionCandidate[] = [
      { id: "couple", text: "Welche Villa ist am besten für ein Paar?" },
      { id: "direct", text: "Was ist bei Direktbuchung enthalten?" },
      { id: "tour", text: "Kann ich die Villa in 360° sehen?" },
    ];

    expect(
      selectChatSuggestions({
        candidates: germanCandidates,
        latestUserMessage: "Was ist bei Direktbuchung enthalten?",
      }).map((item) => item.text),
    ).toEqual(["Kann ich die Villa in 360° sehen?", "Welche Villa ist am besten für ein Paar?"]);
  });
});
