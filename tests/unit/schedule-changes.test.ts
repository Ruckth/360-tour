import { describe, expect, it } from "vitest";
import type { Id } from "convex/_generated/dataModel";
import { breakFromDrag, moveProposal, scheduleRows, turnaroundFromTail } from "@/lib/schedule-changes";
import { resortDateTime } from "@/lib/staff-bookings";

const mali = "staff-mali" as Id<"staff">;
const nok = "staff-nok" as Id<"staff">;
const at = (time: string, date = "2026-10-01") => resortDateTime(date, time);
const appointment = { start: at("10:00"), end: at("11:00"), blockedUntil: at("11:15"), staffId: mali };

describe("moveProposal", () => {
  it("ignores a drop where the appointment already is", () => {
    expect(moveProposal(appointment, { start: at("10:00") })).toBeNull();
    expect(moveProposal(appointment, { start: at("10:00"), staffId: mali })).toBeNull();
  });

  it("proposes a new time or staff member", () => {
    expect(moveProposal(appointment, { start: at("14:00") })).toEqual({ start: at("14:00"), staffId: mali });
    expect(moveProposal(appointment, { start: at("10:00"), staffId: nok })).toEqual({ start: at("10:00"), staffId: nok });
  });
});

describe("turnaroundFromTail", () => {
  it("rounds to 5 minutes and never goes below zero", () => {
    expect(turnaroundFromTail(appointment, at("11:30"))).toBe(30);
    expect(turnaroundFromTail(appointment, at("11:07"))).toBe(5);
    expect(turnaroundFromTail(appointment, at("10:45"))).toBe(0);
  });
});

describe("breakFromDrag", () => {
  const block = { date: "2026-10-01", original: { start: "12:00", end: "13:00", label: "Lunch" } };

  it("reads resort-local times", () => {
    expect(breakFromDrag(block, at("12:30"), at("13:30"))).toEqual({ start: "12:30", end: "13:30" });
  });

  it("rejects no-op and cross-date drags", () => {
    expect(breakFromDrag(block, at("12:00"), at("13:00"))).toBeNull();
    expect(breakFromDrag(block, at("12:00", "2026-10-02"), at("13:00", "2026-10-02"))).toBeNull();
  });
});

describe("scheduleRows", () => {
  it("shows date, time, staff and occupied-until in resort time", () => {
    const rows = scheduleRows({ ...appointment, staffName: "Mali" }, { start: at("14:00", "2026-10-02"), end: at("15:00", "2026-10-02"), blockedUntil: at("15:15", "2026-10-02"), staffName: "Nok" });
    expect(rows).toEqual([
      { label: "Date", before: "Thu, Oct 1, 2026", after: "Fri, Oct 2, 2026" },
      { label: "Service time", before: "10:00 AM – 11:00 AM", after: "2:00 PM – 3:00 PM" },
      { label: "Staff", before: "Mali", after: "Nok" },
      { label: "Occupied until", before: "11:15 AM (15 min turnaround)", after: "3:15 PM (15 min turnaround)" },
    ]);
  });
});

it("shows the following date when cleanup crosses midnight", () => {
  const before = { start: at("22:45"), end: at("23:45"), blockedUntil: at("00:15", "2026-10-02"), staffName: "Mali" };
  const row = scheduleRows(before, before).find((r) => r.label === "Occupied until");
  expect(row?.before).toBe("Fri, Oct 2, 2026, 12:15 AM (30 min turnaround)");
});
