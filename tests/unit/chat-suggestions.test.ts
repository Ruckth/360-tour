import { describe, expect, it } from "vitest";
import { selectChatSuggestions, type ChatSuggestionCandidate } from "@/lib/chat/suggestions";

const candidates: ChatSuggestionCandidate[] = [
  { id: "availability", text: "Can I check my dates?" },
  { id: "totalPrice", text: "What will my stay cost?" },
  { id: "direct", text: "What do I get when I book direct?" },
  { id: "tour", text: "Can I view the villas in 360°?" },
  { id: "guests", text: "How many guests can each villa sleep?" },
  { id: "contact", text: "How can I contact the host?" },
  { id: "couple", text: "Which villa is best for two people?" },
  { id: "family", text: "Which villa is best for a family or group?" },
  { id: "cancellation", text: "What is the cancellation policy?" },
  { id: "airport", text: "Can you help with airport pickup?" },
  { id: "amenitiesIncluded", text: "What is included with the villa?" },
  { id: "location", text: "How close is it to the beach and restaurants?" },
];

describe("selectChatSuggestions", () => {
  it("shows six curated suggestions on general pages", () => {
    expect(selectChatSuggestions({ candidates }).map((item) => item.id)).toEqual([
      "availability",
      "totalPrice",
      "direct",
      "tour",
      "guests",
      "contact",
    ]);
  });

  it("starts with tour and booking helpers but still shows six suggestions on property pages", () => {
    expect(
      selectChatSuggestions({ candidates, activePropertySlug: "garden-suite" }).map(
        (item) => item.id,
      ),
    ).toEqual(["tour", "availability", "totalPrice", "direct", "guests", "contact"]);
  });

  it("does not repeat a clicked couple suggestion", () => {
    expect(
      selectChatSuggestions({
        candidates,
        latestUserMessage: "Which villa is best for two people?",
        latestAssistantMessage: "Mossbell Garden Suite is the calmest choice for two.",
        clickedSuggestionId: "couple",
      }).map((item) => item.id),
    ).toEqual(["availability", "totalPrice"]);
  });

  it("routes direct booking questions to price and availability follow-ups", () => {
    expect(
      selectChatSuggestions({
        candidates,
        latestUserMessage: "Do direct booking discounts include airport pickup?",
        latestAssistantMessage: "Direct booking saves around 15%.",
      }).map((item) => item.id),
    ).toEqual(["totalPrice", "availability"]);
  });

  it("uses the full question pool for follow-ups", () => {
    expect(
      selectChatSuggestions({
        candidates,
        latestUserMessage: "Can you help with airport pickup?",
        latestAssistantMessage: "Private airport transfer is included.",
      }).map((item) => item.id),
    ).toEqual(["direct", "availability"]);
  });

  it("detects exact localized suggestion text", () => {
    const germanCandidates: ChatSuggestionCandidate[] = [
      { id: "couple", text: "Welche Villa passt am besten für zwei Personen?" },
      { id: "direct", text: "Welche Vorteile habe ich bei Direktbuchung?" },
      { id: "tour", text: "Kann ich die Villen in 360° ansehen?" },
    ];

    expect(
      selectChatSuggestions({
        candidates: germanCandidates,
        latestUserMessage: "Welche Vorteile habe ich bei Direktbuchung?",
      }).map((item) => item.text),
    ).toEqual([
      "Kann ich die Villen in 360° ansehen?",
      "Welche Villa passt am besten für zwei Personen?",
    ]);
  });
});
