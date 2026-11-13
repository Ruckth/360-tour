import { describe, expect, it } from "vitest";
import { staffDate, staffDateTime, staffTime } from "@/lib/staff-time";

// 14 Nov 2026, 13:07 in Bangkok (06:07 UTC).
const now = Date.parse("2026-11-14T06:07:00Z");

describe("staff date and time", () => {
  it("shows a moment as d MMM, HH:mm in Bangkok", () => {
    expect(staffDateTime(now, { now })).toBe("14 Nov, 13:07");
    expect(staffDate(now, { now })).toBe("14 Nov");
    expect(staffTime(now)).toBe("13:07");
    expect(staffDate(now, { weekday: true, now })).toBe("Sat 14 Nov");
  });

  it("uses Bangkok's day, not UTC's or the device's", () => {
    // 20:30 UTC on 14 Nov is already 03:30 on 15 Nov in Bangkok.
    const late = Date.parse("2026-11-14T20:30:00Z");
    expect(staffDateTime(late, { now })).toBe("15 Nov, 03:30");
    // 23:59 Bangkok on 14 Nov is 16:59 UTC the same day.
    expect(staffDateTime(Date.parse("2026-11-14T16:59:00Z"), { now })).toBe("14 Nov, 23:59");
  });

  it("writes midnight as 00:00", () => {
    const midnight = Date.parse("2026-11-14T00:00:00+07:00");
    expect(staffTime(midnight)).toBe("00:00");
    expect(staffDateTime(midnight, { now })).toBe("14 Nov, 00:00");
    expect(staffTime(midnight - 60_000)).toBe("23:59");
  });

  it("adds the year only outside the current Bangkok year", () => {
    const lastYear = Date.parse("2025-12-28T09:30:00+07:00");
    expect(staffDateTime(lastYear, { now })).toBe("28 Dec 2025, 09:30");
    expect(staffDate(lastYear, { weekday: true, now })).toBe("Sun 28 Dec 2025");
    expect(staffDate(Date.parse("2027-01-02T10:00:00+07:00"), { now })).toBe("2 Jan 2027");
  });

  it("decides the year at the Bangkok year boundary", () => {
    // 31 Dec 2026, 17:30 UTC is 1 Jan 2027, 00:30 in Bangkok.
    const newYear = Date.parse("2026-12-31T17:30:00Z");
    expect(staffDateTime(newYear, { now })).toBe("1 Jan 2027, 00:30");
    // Seen on 1 Jan 2027 in Bangkok, that moment is this year and the evening before is last year's.
    expect(staffDateTime(newYear, { now: newYear })).toBe("1 Jan, 00:30");
    expect(staffDateTime(newYear - 3_600_000, { now: newYear })).toBe("31 Dec 2026, 23:30");
  });
});
