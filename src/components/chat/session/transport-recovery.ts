/**
 * Transport recovery.
 *
 * When `askConcierge` errors or times out, the staff/AI reply may still have
 * been persisted server-side. These helpers poll the transcript for the
 * assistant message that follows the guest's last question, so a dropped
 * response can be recovered instead of silently lost.
 *
 * The loops own their own cancellation: every iteration re-checks `isStale(gen)`
 * (the generation/restart token) and bails the moment the generation has moved
 * on, so a restart or unmount leaves no runaway polling. The clock (`wait`) and
 * the transcript loader are injected so the loop is testable with vi fake timers
 * and a fake client, with no real network or React involved.
 */

export const TRANSCRIPT_RECOVERY_ATTEMPTS = 10;
export const TRANSCRIPT_RECOVERY_DELAY_MS = 2_000;
export const BACKGROUND_RECONCILE_ATTEMPTS = 30;
export const BACKGROUND_RECONCILE_DELAY_MS = 2_000;

export type RecoveryTranscriptRow = {
  role: "user" | "assistant";
  content: string;
};

export type RecoveryDeps = {
  /** Load the latest transcript rows for a session (injected convex call). */
  loadTranscript: (sessionId: string, limit: number) => Promise<RecoveryTranscriptRow[]>;
  /** Delay helper (injected so fake timers drive it). */
  wait: (ms: number) => Promise<void>;
  /** True when the captured generation has been superseded — stop immediately. */
  isStale: (generation: number) => boolean;
};

/** Find the assistant reply that follows the guest's `userMessage` in a transcript. */
export function findAssistantReplyAfter(
  transcript: RecoveryTranscriptRow[],
  userMessage: string,
): string | null {
  const matchingUserIndex = transcript.findLastIndex(
    (message) =>
      message.role === "user" && message.content.trim() === userMessage,
  );
  const assistantAfterUser =
    matchingUserIndex >= 0
      ? transcript
          .slice(matchingUserIndex + 1)
          .find((message) => message.role === "assistant")
      : undefined;

  const content = assistantAfterUser?.content.trim();
  return content ? content : null;
}

/**
 * Poll briefly for a persisted assistant reply after a send error. Returns the
 * recovered text, or null if nothing landed within the attempt budget or the
 * generation went stale.
 */
export async function recoverPersistedAssistantMessage(
  { loadTranscript, wait, isStale }: RecoveryDeps,
  sessionId: string,
  userMessage: string,
  generation: number,
  attempts = TRANSCRIPT_RECOVERY_ATTEMPTS,
  delayMs = TRANSCRIPT_RECOVERY_DELAY_MS,
): Promise<string | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (isStale(generation)) return null;
    if (attempt > 0) await wait(delayMs);
    if (isStale(generation)) return null;

    try {
      const transcript = await loadTranscript(sessionId, 25);
      if (isStale(generation)) return null;
      const recovered = findAssistantReplyAfter(transcript, userMessage);
      if (recovered) return recovered;
    } catch {
      // Keep trying briefly before falling back locally.
    }
  }

  return null;
}

export type ReconcileHandlers = {
  /** Apply the recovered reply (replacing the local placeholder). */
  applyRecoveredMessage: (recoveredMessage: string) => void;
};

/**
 * Background reconciliation loop: keeps polling (longer budget) for the real
 * persisted reply after a local fallback placeholder was shown, and swaps it in
 * when found. Stops on a stale generation or when the budget is exhausted.
 */
export async function reconcilePersistedAssistantMessage(
  deps: RecoveryDeps,
  { applyRecoveredMessage }: ReconcileHandlers,
  sessionId: string,
  userMessage: string,
  placeholderMessage: string,
  generation: number,
  attempts = BACKGROUND_RECONCILE_ATTEMPTS,
  delayMs = BACKGROUND_RECONCILE_DELAY_MS,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await deps.wait(delayMs);
    if (deps.isStale(generation)) return;
    const recoveredMessage = await recoverPersistedAssistantMessage(
      deps,
      sessionId,
      userMessage,
      generation,
    );
    if (!recoveredMessage || recoveredMessage === placeholderMessage) continue;
    if (deps.isStale(generation)) return;

    applyRecoveredMessage(recoveredMessage);
    return;
  }
}
