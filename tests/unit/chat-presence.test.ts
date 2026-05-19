import { describe, expect, it } from "vitest";
import { ACTIVE_CHAT_WINDOW_MS, isChatSessionActive } from "convex/lib/chatPresence";

describe("isChatSessionActive", () => {
  const now = 1_000_000;

  it("marks a recently opened and seen session as active", () => {
    expect(
      isChatSessionActive(
        {
          lastOpenedAt: now - 10_000,
          lastClosedAt: now - 20_000,
          lastSeenAt: now - 5_000,
        },
        now,
      ),
    ).toBe(true);
  });

  it("marks closed sessions inactive", () => {
    expect(
      isChatSessionActive(
        {
          lastOpenedAt: now - 20_000,
          lastClosedAt: now - 10_000,
          lastSeenAt: now - 5_000,
        },
        now,
      ),
    ).toBe(false);
  });

  it("marks stale sessions inactive after the active window", () => {
    expect(
      isChatSessionActive(
        {
          lastOpenedAt: now - 10_000,
          lastClosedAt: 0,
          lastSeenAt: now - ACTIVE_CHAT_WINDOW_MS - 1,
        },
        now,
      ),
    ).toBe(false);
  });

  it("treats missing timestamps as inactive", () => {
    expect(isChatSessionActive({}, now)).toBe(false);
  });
});
