import { describe, expect, it, vi } from "vitest";
import {
  addPromptChars,
  conciergeTurnLogLine,
  createTurnId,
  emitConciergeTurnLog,
  recordModelRequest,
  recordStage,
  recordTool,
  serializeConciergeTurnLog,
  startTurnMetrics,
  timeStage,
} from "convex/lib/turnMetrics";

describe("turnMetrics", () => {
  it("creates a non-empty correlation id", () => {
    expect(createTurnId().length).toBeGreaterThan(8);
    expect(createTurnId()).not.toBe(createTurnId());
  });

  it("keeps generated UUID correlation unchanged when the UUID contains phone-like digits", () => {
    const uuid = vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValue("4658ee01-1a4d-4688-bce6-58bfc8559311");
    try {
      const turnId = createTurnId();
      const metrics = startTurnMetrics(turnId, "line");
      expect(turnId).toMatch(/^turn_[a-p-]+$/);
      expect(serializeConciergeTurnLog({ metrics, outcome: "ai" }).turnId).toBe(turnId);
      expect(JSON.parse(conciergeTurnLogLine({ metrics, outcome: "ai" })).turnId).toBe(turnId);
    } finally {
      uuid.mockRestore();
    }
  });

  it("accumulates stage, model and tool timings", () => {
    const m = startTurnMetrics("turn_a", "line");
    recordStage(m, "guardrail", 5);
    recordStage(m, "context", 12);
    recordModelRequest(m, 100);
    recordModelRequest(m, 50);
    recordTool(m, "get_property_details", 30, true);
    recordTool(m, "calculate_price", 40, false);
    addPromptChars(m, 1234);

    expect(m.stages.guardrail).toBe(5);
    expect(m.stages.context).toBe(12);
    expect(m.modelRequests).toBe(2);
    expect(m.stages.model).toBe(150);
    expect(m.stages.tools).toBe(70);
    expect(m.tools).toEqual([
      { name: "get_property_details", ms: 30, ok: true },
      { name: "calculate_price", ms: 40, ok: false },
    ]);
    expect(m.promptChars).toBe(1234);
  });

  it("times an async stage", async () => {
    const m = startTurnMetrics("turn_b");
    const value = await timeStage(m, "delivery", async () => 42);
    expect(value).toBe(42);
    expect(m.stages.delivery).toBeGreaterThanOrEqual(0);
  });

  it("the serialized log carries counts and names but NEVER guest text / PII", () => {
    const m = startTurnMetrics("turn_c", "whatsapp");
    recordModelRequest(m, 200);
    // Even if a tool name were somehow polluted with PII, it is scrubbed + stripped.
    recordTool(m, "contact john.doe@example.com +66 81 234 5678", 10, true);
    addPromptChars(m, "Hi, my email is john.doe@example.com and phone +66812345678".length);

    const line = conciergeTurnLogLine({ metrics: m, outcome: "ai", model: "openai/gpt-6-luna" });

    // No email, phone, or free-text leaks into the log line.
    expect(line).not.toContain("john.doe@example.com");
    expect(line).not.toMatch(/\+?66[\s-]?8[\s-]?1/);
    expect(line).not.toContain("my email is");

    const parsed = JSON.parse(line);
    expect(parsed.event).toBe("concierge_turn");
    expect(parsed.turnId).toBe("turn_c");
    expect(parsed.channel).toBe("whatsapp");
    expect(parsed.model).toBe("openai/gpt-6-luna");
    expect(parsed.modelRequests).toBe(1);
    expect(typeof parsed.promptChars).toBe("number");
    // The polluted tool name is sanitized down to safe identifier characters only.
    expect(parsed.tools[0].name).not.toContain("@");
    expect(parsed.tools[0].name).not.toContain(" ");
  });

  it("feeding a message containing a phone/email into the metrics cannot leak it", () => {
    const guestMessage = "Please call me at (415) 555-0132 or email me@test.co";
    const m = startTurnMetrics("turn_d", "facebook");
    // The ONLY message-derived value we ever record is a size, never the text.
    addPromptChars(m, guestMessage.length);
    const serialized = serializeConciergeTurnLog({ metrics: m, outcome: "unknown_fallback" });
    const asString = JSON.stringify(serialized);
    expect(asString).not.toContain("555-0132");
    expect(asString).not.toContain("me@test.co");
    expect(asString).not.toContain("call me");
    expect(serialized.promptChars).toBe(guestMessage.length);
  });

  it("emits exactly one console.info line", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const m = startTurnMetrics("turn_e", "line");
    emitConciergeTurnLog({ metrics: m, outcome: "guardrail", model: "guardrail" });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
