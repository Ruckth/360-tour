import { describe, expect, it } from "vitest";
import {
  dateToIso,
  dateValueProblem,
  isTimeValue,
  isoToDate,
  parseLocalDateTime,
  timeMinuteOptions,
  timeValueProblem,
} from "@/lib/dates/values";
import { formatPickerDate, getCalendarFormatters } from "@/lib/dates/format";

describe("calendar values", () => {
  it.each([
    "2026-02-31",
    "2026-02-29",
    "2026-13-01",
    "2026-00-10",
    "2026-04-31",
    "0000-01-01",
    "2026-01-00",
    "2026-1-01",
  ])("rejects impossible date %s", (value) => {
    expect(isoToDate(value)).toBeUndefined();
  });

  it.each(["2024-02-29", "2026-12-31", "0099-01-02"])(
    "round-trips %s without Date's short-year adjustment",
    (value) => {
      expect(dateToIso(isoToDate(value))).toBe(value);
    },
  );

  it("serializes local selection rather than shifting it through UTC", () => {
    expect(dateToIso(new Date(2026, 9, 1, 0, 15))).toBe("2026-10-01");
    expect(dateToIso(new Date(NaN))).toBe("");
  });

  it("shares required and inclusive min/max validation", () => {
    expect(dateValueProblem("", { required: true })).toBeTruthy();
    expect(dateValueProblem("")).toBe("");
    expect(dateValueProblem("2026-02-31")).toBeTruthy();
    expect(
      dateValueProblem("2026-10-01", { min: "2026-10-01", max: "2026-10-01" }),
    ).toBe("");
    expect(dateValueProblem("2026-09-30", { min: "2026-10-01" })).toBeTruthy();
    expect(dateValueProblem("2026-10-02", { max: "2026-10-01" })).toBeTruthy();
  });

  it("keeps Buddhist display separate from Gregorian storage", () => {
    const date = isoToDate("2026-10-01")!;
    expect(formatPickerDate("2026-10-01", "th")).toContain("2569");
    expect(getCalendarFormatters("th").formatCaption!(date, {})).toContain(
      "2569",
    );
    expect(dateToIso(date)).toBe("2026-10-01");
  });
});

describe("time and wall-clock values", () => {
  it.each(["24:00", "12:60", "9:00", "00:00:00", "-1:00"])(
    "rejects invalid time %s",
    (value) => {
      expect(isTimeValue(value)).toBe(false);
    },
  );

  it("validates whole date-time values without normalizing invalid parts", () => {
    expect(parseLocalDateTime("2026-10-01T23:59")).toEqual({
      date: "2026-10-01",
      time: "23:59",
    });
    for (const value of [
      "2026-02-31T09:00",
      "2026-10-01T24:00",
      "2026-10-01T09:00T",
      "2026-10-01T09:00Z",
      "",
    ]) {
      expect(parseLocalDateTime(value)).toBeUndefined();
    }
  });

  it("keeps optional empty times and validates required step values", () => {
    expect(timeValueProblem("")).toBe("");
    expect(timeValueProblem("", { required: true })).toBeTruthy();
    expect(timeValueProblem("00:00", { minuteStep: 15 })).toBe("");
    expect(timeValueProblem("12:17", { minuteStep: 15 })).toBeTruthy();
  });

  it("offers the saved off-step minute without silently changing it", () => {
    expect(timeMinuteOptions(15, "12:17")).toEqual([
      "00",
      "15",
      "17",
      "30",
      "45",
    ]);
    expect(timeMinuteOptions(5)).toHaveLength(12);
    expect(timeMinuteOptions(1)).toHaveLength(60);
    expect(() => timeMinuteOptions(7)).toThrow();
  });
});
