import { ConvexError } from 'convex/values';

const retryDelays = [650, 1_350, 2_500];

function isWriteRateLimited(error: unknown) {
  const data: unknown = error instanceof ConvexError ? error.data : error;
  if (data && typeof data === 'object' && 'code' in data && data.code === 'TooManyWrites') return true;
  return error instanceof Error &&
    (/"code"\s*:\s*"TooManyWrites"/.test(error.message) || /too many writes per second/i.test(error.message));
}

function waitForWriteBudget(delay: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
    const timer = setTimeout(finish, delay);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}

/** A snapshot publication can consume this deployment's current write allowance. Retry its same scope. */
export async function retryTransactionPreparation<T>(prepare: () => Promise<T>, signal: AbortSignal) {
  for (let attempt = 0; !signal.aborted; attempt++) {
    try {
      return await prepare();
    } catch (error) {
      const delay = retryDelays[attempt];
      if (delay === undefined || !isWriteRateLimited(error)) throw error;
      await waitForWriteBudget(delay, signal);
    }
  }
  return undefined;
}
