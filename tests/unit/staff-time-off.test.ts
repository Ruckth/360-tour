import { describe, expect, it } from "vitest";
import { PAYMENT_LABELS, formatTimeOff, timeOffInput, timeOffRange } from "@/lib/staff-bookings";

const at = (date: string, time: string) => Date.parse(`${date}T${time}:00+07:00`);

describe("time off ranges", () => {
  it("treats blank times as whole resort days", () => {
    const range = timeOffRange({ from: "2026-09-28", to: "2026-09-30", startTime: "", endTime: "" });
    expect(range).toEqual({ start: at("2026-09-28", "00:00"), end: at("2026-10-01", "00:00") });
    expect(timeOffInput(range)).toEqual({ from: "2026-09-28", to: "2026-09-30", startTime: "", endTime: "" });
    expect(formatTimeOff(range)).toBe("Mon, Sep 28 – Wed, Sep 30");
  });

  it("supports partial days and defaults the end date to the start date", () => {
    const range = timeOffRange({ from: "2026-09-28", to: "", startTime: "09:00", endTime: "12:30" });
    expect(range).toEqual({ start: at("2026-09-28", "09:00"), end: at("2026-09-28", "12:30") });
    expect(timeOffInput(range)).toEqual({ from: "2026-09-28", to: "2026-09-28", startTime: "09:00", endTime: "12:30" });
    expect(formatTimeOff(range)).toBe("Mon, Sep 28, 9:00 AM – 12:30 PM");
    expect(formatTimeOff(timeOffRange({ from: "2026-09-28", to: "", startTime: "", endTime: "" }))).toBe("Mon, Sep 28 (all day)");
  });
});

describe("payment labels", () => {
  it("shows human text", () => {
    expect(PAYMENT_LABELS).toEqual({ unpaid: "Unpaid", paid: "Paid", refunded: "Refunded" });
  });
});
