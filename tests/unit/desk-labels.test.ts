import { describe, expect, it } from "vitest";
import { isPastEntry } from "@/components/admin/appointment-entry";
import { MONEY_METHOD_LABELS, cancelConfirmOptions, staffLabel } from "@/components/admin/admin-bookings-shared";

describe("desk naming glossary", () => {
  it("names methods PromptPay and Transfer", () => {
    expect(MONEY_METHOD_LABELS.promptpay).toBe("PromptPay");
    expect(MONEY_METHOD_LABELS.transfer).toBe("Transfer");
  });

  it("cancels a stay with Keep stay as the safe button", () => {
    expect(cancelConfirmOptions({ notifyByDefault: false })).toMatchObject({ title: "Cancel this stay?", confirmLabel: "Cancel stay", cancelLabel: "Keep stay" });
  });

  it("shows who did something without their full email", () => {
    expect(staffLabel("ploy@auraliscove.co")).toBe("ploy");
    expect(staffLabel("Guest, in chat")).toBe("Guest, in chat");
    expect(staffLabel(undefined)).toBe("");
  });
});

describe("past work on the appointment form", () => {
  const now = Date.parse("2026-11-12T10:00:00+07:00");
  const minute = 60_000;

  it("treats today as a normal booking until a chosen time starts before now", () => {
    expect(isPastEntry("2026-11-12", null, now)).toBe(false);
    expect(isPastEntry("2026-11-12", now, now)).toBe(false);
    expect(isPastEntry("2026-11-12", now + minute, now)).toBe(false);
    expect(isPastEntry("2026-11-12", now - 1, now)).toBe(true);
    expect(isPastEntry("2026-11-12", now - 30 * minute, now)).toBe(true);
  });

  it("treats an earlier day as past work and a later day as a booking", () => {
    expect(isPastEntry("2026-11-11", null, now)).toBe(true);
    expect(isPastEntry("2026-11-13", null, now)).toBe(false);
  });
});
