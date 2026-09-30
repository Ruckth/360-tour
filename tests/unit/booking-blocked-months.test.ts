import { describe, expect, it } from "vitest";
import {
  calendarMonths,
  monthBounds,
  shiftMonth,
  stayMonths,
  villaBatches,
} from "@/lib/booking/blocked-months";

describe("blocked-night months", () => {
  it("bounds months, including leap Februaries and year ends", () => {
    expect(monthBounds("2028-02")).toEqual({ startDate: "2028-02-01", endDate: "2028-02-29" });
    expect(monthBounds("2030-12")).toEqual({ startDate: "2030-12-01", endDate: "2030-12-31" });
    expect(shiftMonth("2030-12", 1)).toBe("2031-01");
    expect(shiftMonth("2031-01", -1)).toBe("2030-12");
  });

  it("covers every night of a stay, but not the checkout day", () => {
    expect(stayMonths("2030-01-30", "2030-03-01")).toEqual(["2030-01", "2030-02"]);
    expect(stayMonths("2030-01-30", "2030-03-02")).toEqual(["2030-01", "2030-02", "2030-03"]);
    expect(stayMonths("2030-01-30", "")).toEqual([]);
  });

  it("loads the visible month, the next one and the stay, never past months", () => {
    expect(
      calendarMonths({ visibleMonth: "2030-05", checkIn: "2030-08-30", checkOut: "2030-09-02", today: "2030-05-20" }),
    ).toEqual(["2030-05", "2030-06", "2030-08", "2030-09"]);
    expect(calendarMonths({ visibleMonth: "2030-04", checkIn: "", checkOut: "", today: "2030-05-20" })).toEqual([
      "2030-05",
    ]);
  });

  it("splits villas so each call stays inside the villa-nights budget", () => {
    const ids = Array.from({ length: 100 }, (_, index) => index);
    expect(villaBatches(ids, 3)).toHaveLength(1);
    const yearLong = villaBatches(ids, 365);
    expect(yearLong.every((batch) => batch.length * 365 <= 3100)).toBe(true);
    expect(yearLong.flat()).toEqual(ids);
  });
});
