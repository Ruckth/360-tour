import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GenerationToken } from "@/components/chat/session/generation-token";
import { BrowserHandoffClaimGate } from "@/components/chat/session/browser-handoff";
import {
  recoverPersistedAssistantMessage,
  reconcilePersistedAssistantMessage,
  findAssistantReplyAfter,
  type RecoveryDeps,
  type RecoveryTranscriptRow,
} from "@/components/chat/session/transport-recovery";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

/** A fake convex transcript loader whose answers can change over successive polls. */
function makeLoader(sequence: RecoveryTranscriptRow[][]) {
  let call = 0;
  const loadTranscript = vi.fn(async () => {
    const rows = sequence[Math.min(call, sequence.length - 1)];
    call += 1;
    return rows;
  });
  return { loadTranscript, calls: () => call };
}

function depsFor(
  loadTranscript: RecoveryDeps["loadTranscript"],
  token: GenerationToken,
): RecoveryDeps {
  return {
    loadTranscript,
    // Real timer-free wait driven by fake timers.
    wait: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    isStale: (generation) => token.isStale(generation),
  };
}

describe("findAssistantReplyAfter", () => {
  it("returns the assistant reply following the matching user message", () => {
    const rows: RecoveryTranscriptRow[] = [
      { role: "user", content: "old" },
      { role: "assistant", content: "old reply" },
      { role: "user", content: "my question" },
      { role: "assistant", content: "fresh reply" },
    ];
    expect(findAssistantReplyAfter(rows, "my question")).toBe("fresh reply");
  });

  it("returns null when no assistant follows the question", () => {
    const rows: RecoveryTranscriptRow[] = [{ role: "user", content: "my question" }];
    expect(findAssistantReplyAfter(rows, "my question")).toBeNull();
  });
});

describe("recoverPersistedAssistantMessage", () => {
  it("recovers a reply that appears after a few polls, then stops", async () => {
    const token = new GenerationToken();
    const { loadTranscript, calls } = makeLoader([
      [{ role: "user", content: "q" }],
      [{ role: "user", content: "q" }],
      [
        { role: "user", content: "q" },
        { role: "assistant", content: "late reply" },
      ],
    ]);
    const promise = recoverPersistedAssistantMessage(
      depsFor(loadTranscript, token),
      "sess",
      "q",
      token.value,
    );
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe("late reply");
    // Stops once the reply is found — does not keep polling the full budget.
    expect(calls()).toBe(3);
  });

  it("drops a late reply once the generation has moved on (restart)", async () => {
    const token = new GenerationToken();
    const startGeneration = token.value;
    const { loadTranscript, calls } = makeLoader([
      [{ role: "user", content: "q" }],
      [
        { role: "user", content: "q" },
        { role: "assistant", content: "stale reply" },
      ],
    ]);
    const promise = recoverPersistedAssistantMessage(
      depsFor(loadTranscript, token),
      "sess",
      "q",
      startGeneration,
    );
    // Simulate a restart between polls: bump the generation.
    token.next();
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeNull();
    // Bailed early rather than exhausting the attempt budget.
    expect(calls()).toBeLessThanOrEqual(1);
  });

  it("gives up after the attempt budget when nothing lands and leaves no timers", async () => {
    const token = new GenerationToken();
    const { loadTranscript } = makeLoader([[{ role: "user", content: "q" }]]);
    const promise = recoverPersistedAssistantMessage(
      depsFor(loadTranscript, token),
      "sess",
      "q",
      token.value,
    );
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("reconcilePersistedAssistantMessage", () => {
  it("swaps the placeholder for the real reply when it arrives", async () => {
    const token = new GenerationToken();
    const { loadTranscript } = makeLoader([
      [{ role: "user", content: "q" }],
      [
        { role: "user", content: "q" },
        { role: "assistant", content: "the real reply" },
      ],
    ]);
    const applyRecoveredMessage = vi.fn();
    const promise = reconcilePersistedAssistantMessage(
      depsFor(loadTranscript, token),
      { applyRecoveredMessage },
      "sess",
      "q",
      "placeholder fallback",
      token.value,
    );
    await vi.runAllTimersAsync();
    await promise;
    expect(applyRecoveredMessage).toHaveBeenCalledWith("the real reply");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not apply a reply equal to the placeholder", async () => {
    const token = new GenerationToken();
    const { loadTranscript } = makeLoader([
      [
        { role: "user", content: "q" },
        { role: "assistant", content: "placeholder fallback" },
      ],
    ]);
    const applyRecoveredMessage = vi.fn();
    const promise = reconcilePersistedAssistantMessage(
      depsFor(loadTranscript, token),
      { applyRecoveredMessage },
      "sess",
      "q",
      "placeholder fallback",
      token.value,
    );
    await vi.runAllTimersAsync();
    await promise;
    expect(applyRecoveredMessage).not.toHaveBeenCalled();
  });

  it("stops immediately when the generation is superseded", async () => {
    const token = new GenerationToken();
    const start = token.value;
    const { loadTranscript } = makeLoader([
      [
        { role: "user", content: "q" },
        { role: "assistant", content: "reply" },
      ],
    ]);
    const applyRecoveredMessage = vi.fn();
    const promise = reconcilePersistedAssistantMessage(
      depsFor(loadTranscript, token),
      { applyRecoveredMessage },
      "sess",
      "q",
      "placeholder",
      start,
    );
    token.next();
    await vi.runAllTimersAsync();
    await promise;
    expect(applyRecoveredMessage).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("GenerationToken", () => {
  it("marks only the current generation as current", () => {
    const token = new GenerationToken();
    const g0 = token.value;
    expect(token.isCurrent(g0)).toBe(true);
    const g1 = token.next();
    expect(token.isCurrent(g0)).toBe(false);
    expect(token.isStale(g0)).toBe(true);
    expect(token.isCurrent(g1)).toBe(true);
  });
});

describe("BrowserHandoffClaimGate", () => {
  it("claims a token exactly once", () => {
    const gate = new BrowserHandoffClaimGate();
    expect(gate.shouldClaim("tok-1")).toBe(true);
    expect(gate.shouldClaim("tok-1")).toBe(false);
  });

  it("rejects empty tokens and resets on a new token", () => {
    const gate = new BrowserHandoffClaimGate();
    expect(gate.shouldClaim(null)).toBe(false);
    expect(gate.shouldClaim(undefined)).toBe(false);
    expect(gate.shouldClaim("tok-a")).toBe(true);
    expect(gate.shouldClaim("tok-b")).toBe(true);
    expect(gate.claimed).toBe("tok-b");
  });
});
