import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HEARTBEAT_MS,
  startSessionHeartbeat,
  type HeartbeatClock,
} from "@/components/chat/session/heartbeat";

/**
 * A fake heartbeat clock backed by vi fake timers, with a toggleable hidden state
 * and inspectable listener registration so we can assert cleanup.
 */
function makeFakeClock() {
  let hidden = false;
  const visibility = new Set<() => void>();
  const focus = new Set<() => void>();
  const clock: HeartbeatClock = {
    setInterval: (handler, ms) => setInterval(handler, ms) as unknown as number,
    clearInterval: (id) => clearInterval(id as unknown as NodeJS.Timeout),
    isHidden: () => hidden,
    addVisibilityListener: (h) => visibility.add(h),
    removeVisibilityListener: (h) => visibility.delete(h),
    addFocusListener: (h) => focus.add(h),
    removeFocusListener: (h) => focus.delete(h),
  };
  return {
    clock,
    setHidden: (value: boolean) => {
      hidden = value;
    },
    fireVisibility: () => visibility.forEach((h) => h()),
    fireFocus: () => focus.forEach((h) => h()),
    listenerCount: () => visibility.size + focus.size,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("startSessionHeartbeat", () => {
  it("touches once per interval while the tab is visible", () => {
    const touch = vi.fn();
    const fake = makeFakeClock();
    const stop = startSessionHeartbeat({ touch, clock: fake.clock });

    vi.advanceTimersByTime(HEARTBEAT_MS * 3);
    expect(touch).toHaveBeenCalledTimes(3);
    stop();
  });

  it("suppresses heartbeats while the tab is hidden", () => {
    const touch = vi.fn();
    const fake = makeFakeClock();
    const stop = startSessionHeartbeat({ touch, clock: fake.clock });

    fake.setHidden(true);
    vi.advanceTimersByTime(HEARTBEAT_MS * 5);
    expect(touch).not.toHaveBeenCalled();

    // Resuming visibility ages back in and ticks continue.
    fake.setHidden(false);
    vi.advanceTimersByTime(HEARTBEAT_MS);
    expect(touch).toHaveBeenCalledTimes(1);
    stop();
  });

  it("sends an immediate touch when the tab becomes visible again", () => {
    const touch = vi.fn();
    const fake = makeFakeClock();
    const stop = startSessionHeartbeat({ touch, clock: fake.clock });

    fake.setHidden(true);
    vi.advanceTimersByTime(HEARTBEAT_MS * 2);
    expect(touch).not.toHaveBeenCalled();

    fake.setHidden(false);
    fake.fireVisibility();
    expect(touch).toHaveBeenCalledTimes(1); // immediate, not waiting for next tick
    stop();
  });

  it("sends an immediate touch on window focus", () => {
    const touch = vi.fn();
    const fake = makeFakeClock();
    const stop = startSessionHeartbeat({ touch, clock: fake.clock });

    fake.fireFocus();
    expect(touch).toHaveBeenCalledTimes(1);
    stop();
  });

  it("does not touch on a visibility event that fires while still hidden", () => {
    const touch = vi.fn();
    const fake = makeFakeClock();
    const stop = startSessionHeartbeat({ touch, clock: fake.clock });

    fake.setHidden(true);
    fake.fireVisibility();
    expect(touch).not.toHaveBeenCalled();
    stop();
  });

  it("cleanup clears the interval and removes every listener — no leaks", () => {
    const touch = vi.fn();
    const fake = makeFakeClock();
    const stop = startSessionHeartbeat({ touch, clock: fake.clock });
    expect(fake.listenerCount()).toBe(2);

    stop();
    expect(fake.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    // No further ticks after stop.
    vi.advanceTimersByTime(HEARTBEAT_MS * 3);
    expect(touch).not.toHaveBeenCalled();
  });
});
