const MAX_CONFLICT_RETRIES = 2;

export function isStockWriteConflict(error: unknown) {
  return error instanceof Error && (
    error.message.includes("OptimisticConcurrencyControlFailure") ||
    /documents read from or written to .* every subsequent retry/i.test(error.message)
  );
}

/** Retries a refused transaction with the same captured payload and operation key. */
export async function postStockWithRetry<T>(post: () => Promise<T>): Promise<T> {
  for (let retries = 0; ; retries++) {
    try {
      return await post();
    } catch (error) {
      if (retries >= MAX_CONFLICT_RETRIES || !isStockWriteConflict(error)) throw error;
      const delay = 120 * (retries + 1) + Math.floor(Math.random() * 160);
      await new Promise<void>(resolve => setTimeout(resolve, delay));
    }
  }
}
