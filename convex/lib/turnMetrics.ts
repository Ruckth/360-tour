/**
 * Pure turn-metrics helpers for the concierge.
 *
 * This module is deliberately NOT a Convex function module: it exports plain functions and
 * types, has no `query`/`mutation`/`action`, touches no `ctx`, and performs no I/O beyond a
 * single structured `console.info` line when asked. It can be unit-tested directly.
 *
 * Its one safety job: a turn log carries counts, durations, model id, outcome and a turn
 * correlation id — and NEVER guest text, names, phones, emails, tokens or credentials.
 * `serializeConciergeTurnLog` strips free-text fields and scrubs any residual PII before the
 * payload is stringified, so a message containing a phone/email cannot leak into logs.
 */

export type TurnStageName =
  | "guardrail"
  | "context"
  | "model"
  | "tools"
  | "claim"
  | "generation"
  | "delivery"
  | "total";

export type ToolTiming = {
  name: string;
  ms: number;
  ok: boolean;
};

export type TurnMetrics = {
  turnId: string;
  channel?: string;
  stages: Partial<Record<TurnStageName, number>>;
  tools: ToolTiming[];
  modelRequests: number;
  /**
   * Approximate prompt size in characters. A COUNT only — never the prompt text itself.
   */
  promptChars: number;
};

export type ConciergeTurnLog = {
  event: "concierge_turn";
  turnId: string;
  channel?: string;
  model?: string;
  outcome: string;
  stages: Partial<Record<TurnStageName, number>>;
  tools: ToolTiming[];
  modelRequests: number;
  promptChars: number;
};

/** Generate a correlation id for a turn. Uses crypto.randomUUID when available. */
export function createTurnId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Start a fresh metrics collector for one turn. */
export function startTurnMetrics(turnId: string, channel?: string): TurnMetrics {
  return {
    turnId,
    ...(channel ? { channel } : {}),
    stages: {},
    tools: [],
    modelRequests: 0,
    promptChars: 0,
  };
}

/** Record a stage duration (ms). Repeated calls for the same stage accumulate. */
export function recordStage(metrics: TurnMetrics, stage: TurnStageName, ms: number): void {
  const current = metrics.stages[stage] ?? 0;
  metrics.stages[stage] = current + Math.max(0, Math.round(ms));
}

/** Time an async step, record its duration under `stage`, and return its result. */
export async function timeStage<T>(
  metrics: TurnMetrics,
  stage: TurnStageName,
  fn: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    return await fn();
  } finally {
    recordStage(metrics, stage, Date.now() - started);
  }
}

/** Record one model request (count + its latency in ms). */
export function recordModelRequest(metrics: TurnMetrics, ms: number): void {
  metrics.modelRequests += 1;
  recordStage(metrics, "model", ms);
}

/** Record one tool call: name, duration and whether it succeeded. */
export function recordTool(metrics: TurnMetrics, name: string, ms: number, ok: boolean): void {
  metrics.tools.push({ name, ms: Math.max(0, Math.round(ms)), ok: Boolean(ok) });
  recordStage(metrics, "tools", ms);
}

/** Add to the prompt character count (a size, never the text). */
export function addPromptChars(metrics: TurnMetrics, chars: number): void {
  metrics.promptChars += Math.max(0, Math.round(chars));
}

/**
 * Characters allowed in a tool/stage/outcome name once sanitized. Anything else is dropped.
 * Tool names in this codebase are ASCII identifiers (prepare_booking, get_my_bookings…),
 * so this cannot discard a legitimate name while it DOES neutralize an injected value.
 */
const SAFE_NAME = /[^a-zA-Z0-9_./:-]/g;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 7+ consecutive digits (optionally grouped by spaces/dashes/dots/parens): phone-like runs.
const PHONE_RE = /\+?\d(?:[\d\s().-]{5,}\d)/g;

/** Scrub any residual PII that could appear in a name-ish field. */
function scrubValue(value: string): string {
  return value.replace(EMAIL_RE, "[redacted-email]").replace(PHONE_RE, "[redacted-number]");
}

function sanitizeName(value: string): string {
  return scrubValue(value).replace(SAFE_NAME, "").slice(0, 64) || "unknown";
}

/**
 * Build the structured, leak-free turn-log payload. Only counts, durations, enum-like names,
 * the model id, the outcome and the correlation id survive — never any guest-supplied text.
 */
export function serializeConciergeTurnLog(input: {
  metrics: TurnMetrics;
  outcome: string;
  model?: string;
}): ConciergeTurnLog {
  const { metrics } = input;
  return {
    event: "concierge_turn",
    turnId: sanitizeName(metrics.turnId),
    ...(metrics.channel ? { channel: sanitizeName(metrics.channel) } : {}),
    ...(input.model ? { model: sanitizeName(input.model) } : {}),
    outcome: sanitizeName(input.outcome),
    stages: metrics.stages,
    tools: metrics.tools.map((tool) => ({
      name: sanitizeName(tool.name),
      ms: Math.max(0, Math.round(tool.ms)),
      ok: Boolean(tool.ok),
    })),
    modelRequests: metrics.modelRequests,
    promptChars: Math.max(0, Math.round(metrics.promptChars)),
  };
}

/** Serialize to a single JSON string, scrubbing PII one more time as a belt-and-braces pass. */
export function conciergeTurnLogLine(input: {
  metrics: TurnMetrics;
  outcome: string;
  model?: string;
}): string {
  return scrubValue(JSON.stringify(serializeConciergeTurnLog(input)));
}

/** Emit exactly one structured console line for the turn. */
export function emitConciergeTurnLog(input: {
  metrics: TurnMetrics;
  outcome: string;
  model?: string;
}): void {
  console.info(conciergeTurnLogLine(input));
}
