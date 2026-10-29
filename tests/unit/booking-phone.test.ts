import { describe, expect, it } from "vitest";
import { normalizeGuestPhone } from "@/lib/booking/phone";

describe("returning guest phone input", () => {
  it.each([
    ["0812345678", "+66812345678"],
    ["66812345678", "+66812345678"],
    ["+66 81 234 5678", "+66812345678"],
    ["+44 7700 900123", "+447700900123"],
    ["", undefined],
    ["0044 7700 900123", "+447700900123"],
    ["812345678", "+66812345678"],
    ["(202) 555-0123", undefined],
    ["07700 900123", undefined],
    ["081-234-5678 ext 2", undefined],
  ])("normalizes %s for the country input", (input, expected) => {
    expect(normalizeGuestPhone(input)).toBe(expected);
  });
});
