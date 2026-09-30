import { describe, expect, it } from "vitest";
import { avatarInk } from "@/components/admin/StaffAvatar";
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

describe("avatarInk", () => {
  it("puts navy initials on light staff colours and white on dark ones", () => {
    expect(avatarInk("#8EAB8B")).toBe("text-navy");
    expect(avatarInk("#fde68a")).toBe("text-navy");
    expect(avatarInk("#1e3a8a")).toBe("text-white");
    expect(avatarInk("#000")).toBe("text-white");
    expect(avatarInk("not-a-colour")).toBe("text-white");
  });
});
