import { describe, expect, it } from "vitest";
import {
  ageLabel, historyChangeText, historyFieldLabel, historyRevision, itemSummaryLabel, latenessLabel, relativeDate, visibleHistoryChanges,
} from "@/components/stock/purchasing-display";

describe("purchasing history display (P19/P45)", () => {
  it("never shows raw dotted keys or bracket syntax", () => {
    const fields = [
      "issuedRevision", "lines[Aloe after-sun gel · 120 mL (SPA-ALOE-120)].quantity", "changes.omitted", "remainderCancelled",
      "followUp.quantity", "lines[Aloe after-sun gel · 120 mL (SPA-ALOE-120)]", "someNewField",
    ];
    for (const field of fields) {
      const text = historyChangeText({ field, before: 1, after: 2 });
      expect(text).not.toMatch(/\[|\]|\w\.\w/);
    }
    expect(historyFieldLabel("lines[Aloe gel · 120 mL].quantity")).toBe("Quantity — Aloe gel · 120 mL");
    expect(historyChangeText({ field: "changes.omitted", before: null, after: 3 })).toBe("+3 more changes");
    expect(historyChangeText({ field: "lines[Aloe gel]", before: null, after: 4 })).toBe("Added Aloe gel: 4");
    expect(historyChangeText({ field: "lines[Aloe gel]", before: 4, after: null })).toBe("Removed Aloe gel (was 4)");
  });

  it("renders an approval as requested → approved per line", () => {
    expect(historyChangeText({ field: "lines[Aloe gel · 120 mL (ALOE-120)].approved", before: 20, after: 12 }))
      .toBe("Aloe gel · 120 mL (ALOE-120): 20 → 12 approved");
  });

  it("moves the revision into the event row", () => {
    const changes = [{ field: "issuedRevision", before: 1, after: 2 }, { field: "expectedDate", before: "2026-12-01", after: "2026-12-04" }];
    expect(historyRevision(changes)).toBe(2);
    expect(visibleHistoryChanges(changes).map(change => change.field)).toEqual(["expectedDate"]);
    expect(historyRevision(undefined)).toBeNull();
  });
});

describe("purchasing dates and summaries (P04/P11/P42)", () => {
  const today = "2026-11-28";
  it("labels need-by and expected dates relative to resort today with urgency", () => {
    expect(relativeDate("2026-12-05", today)).toMatchObject({ label: "in 7 days", urgency: "later" });
    expect(relativeDate("2026-11-30", today)).toMatchObject({ label: "in 2 days", urgency: "soon" });
    expect(relativeDate("2026-11-28", today)).toMatchObject({ label: "Today", urgency: "soon" });
    expect(relativeDate("2026-11-26", today)).toMatchObject({ label: "2 d overdue", urgency: "overdue", days: -2 });
    expect(relativeDate(undefined, today)).toMatchObject({ label: "—", urgency: "none" });
  });
  it("summarises items and ages", () => {
    expect(itemSummaryLabel(["Aloe gel", "Sunscreen", "Towels"], 5)).toBe("Aloe gel, Sunscreen +3 more");
    expect(itemSummaryLabel(undefined, 2)).toBe("2 lines");
    expect(ageLabel(Date.parse("2026-11-26T05:00:00Z"), Date.parse("2026-11-28T05:00:00Z"))).toBe("2 d ago");
  });
  it("labels receipt lateness", () => {
    expect(latenessLabel(0)).toBe("On time");
    expect(latenessLabel(2)).toBe("2 d late");
    expect(latenessLabel(-1)).toBe("1 d early");
    expect(latenessLabel(null)).toBe("No expected date");
  });
});
