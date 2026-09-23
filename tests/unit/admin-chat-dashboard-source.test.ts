import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("admin chat dashboard source", () => {
  it("defaults the admin chat filters to not-empty latest-message mode", () => {
    const dashboardSource = readFileSync(
      new URL("../../src/components/admin/AdminChatDashboard.tsx", import.meta.url),
      "utf8",
    );

    expect(dashboardSource).toContain('type EmptyChatFilter = "non_empty" | "empty"');
    expect(dashboardSource).toContain('useState<EmptyChatFilter>("non_empty")');
    expect(dashboardSource).toContain("Message status");
    expect(dashboardSource).toContain("Not empty");
    expect(dashboardSource).toContain("Latest message start");
    expect(dashboardSource).toContain("Latest message end");
    expect(dashboardSource).toContain("relativeTime(session.latestMessageAt, now)");
    expect(dashboardSource).not.toContain("session.latestMessageAt ?? session.lastSeenAt");
  });

  it("does not expose the old Fill Thai backfill action", () => {
    const dashboardSource = readFileSync(
      new URL("../../src/components/admin/AdminChatDashboard.tsx", import.meta.url),
      "utf8",
    );
    const suggestionsSource = readFileSync(
      new URL("../../convex/chatSuggestions.ts", import.meta.url),
      "utf8",
    );

    expect(dashboardSource).not.toContain("Fill Thai");
    expect(dashboardSource).not.toContain("backfill-thai");
    expect(dashboardSource).not.toContain("adminBackfillThaiGeneratedSuggestions");
    expect(suggestionsSource).not.toContain("adminBackfillThaiGeneratedSuggestions");
  });

  it("does not show an empty link-answer select when no approved answers exist", () => {
    const dashboardSource = readFileSync(
      new URL("../../src/components/admin/AdminChatDashboard.tsx", import.meta.url),
      "utf8",
    );
    const selectSource = readFileSync(
      new URL("../../src/components/ui/select.tsx", import.meta.url),
      "utf8",
    );

    expect(dashboardSource).toContain("No approved answers");
    expect(dashboardSource).toContain("disabled={linkableAnswersLoading || !hasLinkableAnswers}");
    expect(dashboardSource).toContain("{hasLinkableAnswers ? (");
    expect(selectSource).not.toContain("h-[var(--radix-select-trigger-height)]");
  });
});
