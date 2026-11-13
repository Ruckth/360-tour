import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PAYMENT_LABELS, formatTimeOff, timeOffInput, timeOffRange } from "@/lib/staff-bookings";

const at = (date: string, time: string) => Date.parse(`${date}T${time}:00+07:00`);

describe("time off ranges", () => {
  // Shown dates add the year outside the current one; pin "now" to the fixtures' year.
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(at("2026-09-20", "12:00")); });
  afterAll(() => { vi.useRealTimers(); });

  it("treats blank times as whole resort days", () => {
    const range = timeOffRange({ from: "2026-09-28", to: "2026-09-30", startTime: "", endTime: "" });
    expect(range).toEqual({ start: at("2026-09-28", "00:00"), end: at("2026-10-01", "00:00") });
    expect(timeOffInput(range)).toEqual({ from: "2026-09-28", to: "2026-09-30", startTime: "", endTime: "" });
    expect(formatTimeOff(range)).toBe("Mon 28 Sep – Wed 30 Sep");
  });

  it("supports partial days and defaults the end date to the start date", () => {
    const range = timeOffRange({ from: "2026-09-28", to: "", startTime: "09:00", endTime: "12:30" });
    expect(range).toEqual({ start: at("2026-09-28", "09:00"), end: at("2026-09-28", "12:30") });
    expect(timeOffInput(range)).toEqual({ from: "2026-09-28", to: "2026-09-28", startTime: "09:00", endTime: "12:30" });
    expect(formatTimeOff(range)).toBe("Mon 28 Sep, 09:00 – 12:30");
    expect(formatTimeOff(timeOffRange({ from: "2026-09-28", to: "", startTime: "", endTime: "" }))).toBe("Mon 28 Sep (all day)");
  });
});

describe("payment labels", () => {
  it("shows human text", () => {
    expect(PAYMENT_LABELS).toEqual({ unpaid: "Unpaid", paid: "Paid", refunded: "Refunded" });
  });
});
