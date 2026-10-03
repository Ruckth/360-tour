/** A stable cohort switch rolls back fact lookup without reopening retired Q&A. */
export function factRetrievalEnabled(sessionId: string): boolean {
  const raw = process.env.AI_FACT_RETRIEVAL_PERCENT;
  const percent = raw === undefined || raw === "" ? 100 : Number(raw);
  if (!Number.isFinite(percent) || percent <= 0) return false;
  if (percent >= 100) return true;
  let hash = 2166136261;
  for (const char of sessionId)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % 100 < percent;
}
