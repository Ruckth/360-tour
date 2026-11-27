import { afterEach, expect, it, vi } from "vitest";
import { postStockWithRetry } from "@/lib/stock-posting";

const conflict = new Error('{"code":"OptimisticConcurrencyControlFailure"}');

afterEach(() => vi.useRealTimers());

it("retries the same receipt intent after a transaction conflict", async () => {
  vi.useFakeTimers();
  const args = { operationKey: "one-receipt-operation", lines: [{ accepted: 5 }] };
  const mutate = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce({ id: "receipt" });
  const result = postStockWithRetry(() => mutate(args));
  await vi.runAllTimersAsync();
  await expect(result).resolves.toEqual({ id: "receipt" });
  expect(mutate.mock.calls).toEqual([[args], [args]]);
});

it("bounds retries and leaves other refusals to the caller", async () => {
  vi.useFakeTimers();
  const busy = vi.fn().mockRejectedValue(conflict);
  const rejection = expect(postStockWithRetry(busy)).rejects.toBe(conflict);
  await vi.runAllTimersAsync();
  await rejection;
  expect(busy).toHaveBeenCalledTimes(3);

  const refusal = new Error("OVER_RECEIPT");
  const invalid = vi.fn().mockRejectedValue(refusal);
  await expect(postStockWithRetry(invalid)).rejects.toBe(refusal);
  expect(invalid).toHaveBeenCalledOnce();
});
