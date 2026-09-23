import { describe, expect, it } from "vitest";
import { looksLikeBookingMessage } from "@/lib/chat/ai-booking-route";

describe("looksLikeBookingMessage", () => {
  it("routes booking requests and date messages to the AI booking flow", () => {
    expect(looksLikeBookingMessage("Can I book the pool villa?")).toBe(true);
    expect(looksLikeBookingMessage("2026-10-30 to 2026-11-03")).toBe(true);
    expect(looksLikeBookingMessage("Please cancel CONF-2026-ABC123")).toBe(true);
  });

  it("leaves other messages alone", () => {
    expect(looksLikeBookingMessage("Which villa has the nicest view?")).toBe(false);
    expect(looksLikeBookingMessage("yes")).toBe(false);
    expect(looksLikeBookingMessage(undefined)).toBe(false);
  });
});
