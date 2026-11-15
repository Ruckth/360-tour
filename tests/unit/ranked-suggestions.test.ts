import { describe, expect, it } from "vitest";
import {
  normalizeSuggestedQuestion,
  selectRankedSuggestedQuestions,
} from "convex/shared/chatSuggestions";

const createdAt = 1_700_000_000_000;

describe("selectRankedSuggestedQuestions", () => {
  it("returns the top two highest scoring questions after removing previous asks", () => {
    const selected = selectRankedSuggestedQuestions({
      candidates: [
        { _id: "low", question: "Can I see the villa in 360?", score: 60, createdAt },
        { _id: "asked", question: "What is included when booking direct?", score: 100, createdAt },
        { _id: "top", question: "Can I check availability for my dates?", score: 95, createdAt },
        { _id: "second", question: "Which villa fits my group best?", score: 82, createdAt },
      ],
      askedQuestions: ["what is included when booking direct"],
      limit: 2,
    });

    expect(selected.map((item) => item._id)).toEqual(["top", "second"]);
  });

  it("dedupes by normalized question text before ranking the final list", () => {
    const selected = selectRankedSuggestedQuestions({
      candidates: [
        { _id: "one", question: "Can I see the villa in 360?", score: 90, createdAt },
        { _id: "duplicate", question: "can I see the villa in 360?!", score: 80, createdAt: createdAt + 1 },
        { _id: "other", question: "Can I check availability?", score: 70, createdAt },
      ],
      limit: 2,
    });

    expect(selected.map((item) => item._id)).toEqual(["one", "other"]);
  });

  it("normalizes punctuation and casing for repeat checks", () => {
    expect(normalizeSuggestedQuestion("  What's included when booking direct?! ")).toBe(
      "what is included when booking direct",
    );
  });
});
