import type { ReplyOutcome } from "./inboxLifecycle";

/** Generated prose needs an explicit outcome; missing evidence must never finish staff work. */
export function conciergeReplyOutcome(response: string, model: string): {
  response: string;
  outcome: ReplyOutcome;
} {
  const needsStaff = model === "unknown_fallback" || model === "tool_fallback" ||
    response.includes("[[NEEDS_STAFF]]") ||
    /\b(?:I['’]ll|we['’]ll|I will|we will|let me|let us)\s+(?:(?:just|first|quickly)\s+)?(?:check|investigate|look into|get back|update you)\b/i.test(response) ||
    /\b(?:I['’]ll|we['’]ll|I will|we will|let me|let us)\s+(?:(?:just|first|quickly)\s+)?(?:ask|contact|confirm|connect|put you in touch)\b.{0,60}\b(?:staff|host|team|kitchen)\b/i.test(response);
  const answered = response.includes("[[ANSWERED]]");
  const awaitingGuest = response.includes("[[AWAITING_GUEST]]");
  // Local policy/fallback replies are authored by the application, not inferred model intent.
  const deterministic = model === "guardrail" || model === "fallback";
  const outcome: ReplyOutcome = needsStaff || (!deterministic && !answered && !awaitingGuest)
    ? "needs_staff"
    : awaitingGuest || (deterministic && /[?？]\s*$/.test(response))
      ? "awaiting_guest"
      : "answered";
  return {
    response: response.replace(/\[\[(?:NEEDS_STAFF|AWAITING_GUEST|ANSWERED)\]\]/g, "").trim(),
    outcome,
  };
}
