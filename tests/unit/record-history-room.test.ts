import { expect, it } from "vitest";
import { historyChanges } from "@/components/admin/RecordHistoryPanel";

it("displays bounded room history values and distinguishes matching previews", () => {
  const base = { roomAuditPreview: "Same prefix…", auditBytes: 650000 };
  expect(historyChanges({
    before: { name: { ...base, auditSha256: "a".repeat(64) } },
    after: { name: { ...base, auditSha256: "b".repeat(64) } },
  })).toEqual([{
    field: "name",
    label: "Name",
    before: `Same prefix… · 650,000 bytes · SHA-256 ${"a".repeat(64)}`,
    after: `Same prefix… · 650,000 bytes · SHA-256 ${"b".repeat(64)}`,
  }]);
});
