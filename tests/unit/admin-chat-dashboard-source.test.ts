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

  it("does not expose the old Fill Thai backfill action", () => {
    const dashboardSource = [
      "ChatsView.tsx",
      "QuestionsView.tsx",
      "AnswerFormDialog.tsx",
    ]
      .map((file) => readFileSync(new URL(`../../src/components/admin/${file}`, import.meta.url), "utf8"))
      .join("\n");
    const suggestionsSource = readFileSync(
      new URL("../../convex/chatSuggestions.ts", import.meta.url),
      "utf8",
    );

    expect(dashboardSource).not.toContain("Fill Thai");
    expect(dashboardSource).not.toContain("backfill-thai");
    expect(dashboardSource).not.toContain("adminBackfillThaiGeneratedSuggestions");
    expect(suggestionsSource).not.toContain("adminBackfillThaiGeneratedSuggestions");
  });

  it("does not expose legacy answer linking in the missing-information inbox", () => {
    const dashboardSource = readFileSync(
      new URL("../../src/components/admin/UnknownQuestionsPanel.tsx", import.meta.url),
      "utf8",
    );
    const selectSource = readFileSync(
      new URL("../../src/components/ui/select.tsx", import.meta.url),
      "utf8",
    );

    expect(dashboardSource).toContain("No approved facts apply yet.");
    expect(dashboardSource).not.toContain("adminLinkUnknownGroups");
    expect(dashboardSource).toContain("adminResolveMissing");
    expect(selectSource).not.toContain("h-[var(--radix-select-trigger-height)]");
  });
});
