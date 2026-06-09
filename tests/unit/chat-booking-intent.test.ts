import { describe, expect, it } from "vitest";
import {
  extractChatBookingContext,
  getBookingPromptKey,
  getMissingChatBookingFields,
  hasChatBookingIntent,
  inferChatGuestCount,
  inferChatPropertySlug,
  parseChatDateRange,
} from "@/lib/chat/booking-intent";

const now = new Date(2026, 4, 21);

describe("chat booking intent helpers", () => {
  it("detects booking intent in English and Thai text", () => {
    expect(hasChatBookingIntent("Can I book these dates?")).toBe(true);
    expect(hasChatBookingIntent("Tideglass Pool Residence ยังว่างไหม")).toBe(true);
    expect(hasChatBookingIntent("Which villa has the nicest view?")).toBe(false);
    expect(hasChatBookingIntent("How many guests can stay comfortably?")).toBe(false);
  });

  it("parses ISO date ranges", () => {
    expect(parseChatDateRange("Book 2026-10-30 to 2026-11-03", now)).toEqual({
      checkIn: "2026-10-30",
      checkOut: "2026-11-03",
    });
  });

  it("converts Buddhist years in ISO date ranges", () => {
    expect(parseChatDateRange("จอง 2569-10-30 ถึง 2569-11-03", now)).toEqual({
      checkIn: "2026-10-30",
      checkOut: "2026-11-03",
    });
  });

  it("parses English day-month ranges and infers nearest future year", () => {
    expect(parseChatDateRange("Tideglass Pool Residence from 30 October to 3 November", now)).toEqual({
      checkIn: "2026-10-30",
      checkOut: "2026-11-03",
    });
  });

  it("parses English month-day ranges", () => {
    expect(parseChatDateRange("Is Oct 30 to Nov 3 available?", now)).toEqual({
      checkIn: "2026-10-30",
      checkOut: "2026-11-03",
    });
  });

  it("parses Thai date ranges", () => {
    expect(parseChatDateRange("30 ตุลาคม ถึง 3 พฤศจิกายน", now)).toEqual({
      checkIn: "2026-10-30",
      checkOut: "2026-11-03",
    });
  });

  it("handles cross-year named month ranges", () => {
    expect(parseChatDateRange("30 December to 2 January", now)).toEqual({
      checkIn: "2026-12-30",
      checkOut: "2027-01-02",
    });
  });

  it("rejects invalid or reversed ranges", () => {
    expect(parseChatDateRange("Book 2026-11-03 to 2026-10-30", now)).toEqual({
      checkIn: "",
      checkOut: "",
    });
    expect(parseChatDateRange("31 November to 3 December", now)).toEqual({
      checkIn: "",
      checkOut: "",
    });
  });

  it("infers property from active context or text", () => {
    expect(inferChatPropertySlug("Can I book Mossbell Garden Suite?")).toBe("garden-suite");
    expect(inferChatPropertySlug("Can I book Tideglass Pool Residence?", "penthouse")).toBe("penthouse");
  });

  it("infers guest count near guest wording", () => {
    expect(inferChatGuestCount("for 4 guests")).toBe(4);
    expect(inferChatGuestCount("อันที่อยู่ได้ 4 คน")).toBe(4);
    expect(inferChatGuestCount("30 October to 3 November")).toBeUndefined();
  });

  it("returns a complete context for Thai booking messages", () => {
    expect(
      extractChatBookingContext({
        latestUserMessage: "Tideglass Pool Residence สำหรับ 4 คน 30 ตุลาคม ถึง 3 พฤศจิกายน จองเลยครับ",
        latestAssistantMessage: "Tideglass Pool Residence ว่างสำหรับเช็คอิน 30 ตุลาคม ถึงเช็คเอาท์ 3 พฤศจิกายน",
        now,
      }),
    ).toEqual({
      hasBookingIntent: true,
      checkIn: "2026-10-30",
      checkOut: "2026-11-03",
      propertySlug: "pool-villa",
      guests: 4,
    });
  });

  it("does not show a booking context for non-booking chat", () => {
    expect(
      extractChatBookingContext({
        latestUserMessage: "Which villa is best for a couple?",
        latestAssistantMessage: "The Mossbell Garden Suite is quiet and romantic.",
        now,
      }),
    ).toMatchObject({ hasBookingIntent: false, checkIn: "", checkOut: "" });
  });

  it("reports only missing booking fields", () => {
    expect(
      getMissingChatBookingFields({
        propertySlug: "pool-villa",
        checkIn: "2026-10-30",
        checkOut: "2026-11-03",
      }),
    ).toEqual([]);
    expect(
      getMissingChatBookingFields({
        propertySlug: undefined,
        checkIn: "2026-10-30",
        checkOut: "",
      }),
    ).toEqual(["villa", "checkOut"]);
  });

  it("chooses localized prompt keys from missing fields", () => {
    expect(
      getBookingPromptKey({
        propertySlug: undefined,
        checkIn: "",
        checkOut: "",
      }),
    ).toBe("bookingPromptMissingVillaAndDates");
    expect(
      getBookingPromptKey({
        propertySlug: "pool-villa",
        checkIn: "2026-10-30",
        checkOut: "",
      }),
    ).toBe("bookingPromptMissingCheckOut");
    expect(
      getBookingPromptKey({
        propertySlug: "pool-villa",
        checkIn: "2026-10-30",
        checkOut: "2026-11-03",
      }),
    ).toBe("bookingPromptReady");
  });
});
