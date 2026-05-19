import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  dateToIso,
  formatDisplayDate,
  isoToDate,
  nightsBetweenIso,
  rangeIntersectsDates,
} from "@/lib/booking/dates";

describe("booking date helpers", () => {
  it("round-trips local ISO dates", () => {
    const date = new Date(2026, 4, 19);

    expect(dateToIso(date)).toBe("2026-05-19");
    expect(dateToIso(undefined)).toBe("");
    const parsed = isoToDate("2026-05-19");
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(4);
    expect(parsed?.getDate()).toBe(19);
  });

  it("rejects malformed dates", () => {
    expect(isoToDate("2026-5-19")).toBeUndefined();
    expect(isoToDate("not-a-date")).toBeUndefined();
  });

  it("calculates valid and invalid night ranges", () => {
    expect(nightsBetweenIso("2026-05-19", "2026-05-22")).toBe(3);
    expect(nightsBetweenIso("2026-05-19", "2026-05-19")).toBe(0);
    expect(nightsBetweenIso("2026-05-22", "2026-05-19")).toBe(0);
    expect(nightsBetweenIso("", "2026-05-19")).toBe(0);
  });

  it("adds days and detects blocked-date intersections", () => {
    expect(addDaysIso("2026-05-19", 2)).toBe("2026-05-21");
    expect(addDaysIso("invalid", 2)).toBe("");

    expect(rangeIntersectsDates(["2026-05-20"], "2026-05-19", "2026-05-21")).toBe(true);
    expect(rangeIntersectsDates(["2026-05-21"], "2026-05-19", "2026-05-21")).toBe(false);
    expect(rangeIntersectsDates(["2026-05-18"], "2026-05-19", "2026-05-21")).toBe(false);
  });

  it("formats display dates with a fallback", () => {
    expect(formatDisplayDate("2026-05-19")).toContain("May");
    expect(formatDisplayDate("bad")).toBe("Select date");
  });
});
