import { describe, expect, it } from "vitest";
import { initials } from "@/lib/staff-bookings";

describe("initials", () => {
  it("uses the first letter of the first two words", () => {
    expect(initials("Nok")).toBe("N");
    expect(initials("somchai jaidee")).toBe("SJ");
  });

  it("skips tag words like [AI-EVAL] or (VIP)", () => {
    expect(initials("Nok [AI-EVAL]")).toBe("N");
    expect(initials("(VIP) Mali Chan")).toBe("MC");
    expect(initials("  ")).toBe("");
  });
});
