import { ConvexError } from 'convex/values';
import { afterEach, expect, it, vi } from 'vitest';
import { retryTransactionPreparation } from '@/components/admin/profitability/prepare-transaction-retry';

afterEach(() => vi.useRealTimers());

it('retries the same preparation on a native write rate limit until it succeeds', async () => {
  vi.useFakeTimers();
  const prepare = vi.fn<() => Promise<string>>()
    .mockRejectedValueOnce(new ConvexError({ code: 'TooManyWrites' }))
    .mockRejectedValueOnce(new Error('Convex: {"code":"TooManyWrites","message":"Wait for the write budget."}'))
    .mockResolvedValueOnce('prepared');
  const result = retryTransactionPreparation(prepare, new AbortController().signal);
  await vi.runAllTimersAsync();
  await expect(result).resolves.toBe('prepared');
  expect(prepare).toHaveBeenCalledTimes(3);
});

it('does not retry a changed access scope', async () => {
  const prepare = vi.fn(async () => { throw new ConvexError('Report access changed.'); });
  await expect(retryTransactionPreparation(prepare, new AbortController().signal)).rejects.toThrow('access changed');
  expect(prepare).toHaveBeenCalledOnce();
});

it('cancels a queued retry as soon as the source or filter changes', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const prepare = vi.fn(async () => { throw new ConvexError({ code: 'TooManyWrites' }); });
  const result = retryTransactionPreparation(prepare, controller.signal);
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  await expect(result).resolves.toBeUndefined();
  expect(prepare).toHaveBeenCalledOnce();
});
