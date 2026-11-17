import { describe, expect, it } from "vitest";
import { groupUnknownQuestions } from "../../convex/concierge/knowledgeGrouping";

describe("groupUnknownQuestions", () => {
  it("groups by normalized question, counts statuses and sorts most-asked first", () => {
    const groups = groupUnknownQuestions([
      { id: 1, normalizedQuestion: "gym", status: "new" as const, createdAt: 50 },
      { id: 2, normalizedQuestion: "dog", status: "new" as const, createdAt: 10 },
      { id: 3, normalizedQuestion: "dog", status: "ignored" as const, createdAt: 30 },
      { id: 4, normalizedQuestion: "dog", status: "new" as const, createdAt: 20 },
    ]);

    expect(groups.map((group) => [group.normalizedQuestion, group.count])).toEqual([
      ["dog", 3],
      ["gym", 1],
    ]);
    expect(groups[0].counts).toEqual({ new: 2, resolved: 0, ignored: 1 });
    expect(groups[0].latestAt).toBe(30);
    // The representative row is the newest one still waiting for an answer.
    expect(groups[0].latest.id).toBe(4);
  });

  it("breaks count ties by most recent", () => {
    const groups = groupUnknownQuestions([
      { normalizedQuestion: "old", status: "new" as const, createdAt: 1 },
      { normalizedQuestion: "recent", status: "new" as const, createdAt: 2 },
    ]);
    expect(groups.map((group) => group.normalizedQuestion)).toEqual(["recent", "old"]);
  });
});
