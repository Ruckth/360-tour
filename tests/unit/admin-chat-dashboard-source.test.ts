import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("admin chat dashboard source", () => {
  it("defaults the admin chat filters to open, needs-reply, not-empty chats", () => {
    const dashboardSource = readFileSync(
      new URL("../../src/components/admin/ChatsView.tsx", import.meta.url),
      "utf8",
    );

    expect(dashboardSource).toContain('type EmptyChatFilter = "non_empty" | "empty"');
    expect(dashboardSource).toContain('view: "needs_reply"');
    expect(dashboardSource).toContain('state: "open"');
    expect(dashboardSource).toContain('empty: "non_empty"');
    expect(dashboardSource).toContain("Message status");
    expect(dashboardSource).toContain("Not empty");
    expect(dashboardSource).toContain("Latest message start");
    expect(dashboardSource).toContain("Latest message end");
    expect(dashboardSource).toContain("relativeTime(session.latestMessageAt, now)");
    expect(dashboardSource).not.toContain("session.latestMessageAt ?? session.lastSeenAt");
  });

  it("does not expose the old Fill Thai backfill action in the knowledge UI", () => {
    const knowledgeSource = [
      "ChatsView.tsx",
      "BusinessFactsView.tsx",
      "BusinessFactsPanel.tsx",
      "BusinessFactFormDialog.tsx",
      "MissingInformationPanel.tsx",
      "LegacyArchivePanel.tsx",
    ]
      .map((file) => readFileSync(new URL(`../../src/components/admin/${file}`, import.meta.url), "utf8"))
      .join("\n");
    const suggestionsSource = readFileSync(
      new URL("../../convex/chatSuggestions.ts", import.meta.url),
      "utf8",
    );

    expect(knowledgeSource).not.toContain("Fill Thai");
    expect(knowledgeSource).not.toContain("backfill-thai");
    expect(knowledgeSource).not.toContain("adminBackfillThaiGeneratedSuggestions");
    expect(suggestionsSource).not.toContain("adminBackfillThaiGeneratedSuggestions");
  });

  it("replaces Q&A authoring with Business facts, Missing information and a read-only Legacy archive", () => {
    const view = readFileSync(
      new URL("../../src/components/admin/BusinessFactsView.tsx", import.meta.url),
      "utf8",
    );
    const legacy = readFileSync(
      new URL("../../src/components/admin/LegacyArchivePanel.tsx", import.meta.url),
      "utf8",
    );

    // The three tabs the spec requires, by their exact labels.
    expect(view).toContain('facts: "Business facts"');
    expect(view).toContain('missing: "Missing information"');
    expect(view).toContain('legacy: "Legacy archive"');

    // The legacy archive is read-only: no create/edit/approve/restore/generate/translate/delete writers.
    for (const mutation of [
      "adminCreateAnswer",
      "adminUpdateAnswer",
      "adminDeleteAnswer",
      "adminSetAnswersStatus",
      "adminGenerateSimilarQuestions",
      "useMutation",
      "useAction",
    ]) {
      expect(legacy, mutation).not.toContain(mutation);
    }
  });

  it("never renders an empty resolve dropdown in Missing information", () => {
    const panelSource = readFileSync(
      new URL("../../src/components/admin/MissingInformationPanel.tsx", import.meta.url),
      "utf8",
    );
    const selectSource = readFileSync(
      new URL("../../src/components/ui/select.tsx", import.meta.url),
      "utf8",
    );

    // Structured sources are always offered, so SelectContent always has at least one item.
    expect(panelSource).toContain("STRUCTURED_SOURCES.map");
    expect(panelSource).toContain("resolveOptions(reportPropertyId)");
    expect(selectSource).not.toContain("h-[var(--radix-select-trigger-height)]");
  });
});
