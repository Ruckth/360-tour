"use client";

import { useCallback, useEffect, useRef } from "react";
import { errorText } from "@/lib/staff-bookings";
import type { BillId } from "./backend";

/** Runs a bill write in order; the task gets its sale's bill id (undefined before the first item). */
export type Run = (task: (billId: BillId | undefined) => Promise<unknown>) => Promise<boolean>;

/** One sale on screen. A write belongs to the sale that was showing when it was tapped. */
type Sale = { billId: BillId | null };

/**
 * Bill writes, one after another, so a second tap before the bill exists joins the same bill.
 * Switching bills starts a new sale: writes tapped earlier still land on their own bill, and
 * when they finish they no longer move the screen back to it.
 */
export function useBillWrites(billId: BillId | null, onBillChange: (billId: BillId | null) => void, onError: (message: string) => void) {
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const sale = useRef<Sale>({ billId });
  useEffect(() => {
    if (sale.current.billId !== billId) sale.current = { billId };
  }, [billId]);

  const run = useCallback<Run>(
    (task) => {
      const mine = sale.current;
      const next = queue.current.then(async () => {
        try {
          onError("");
          const result = await task(mine.billId ?? undefined);
          const created = result && typeof result === "object" && "billId" in result ? (result.billId as BillId) : undefined;
          if (created && created !== mine.billId) {
            mine.billId = created;
            if (sale.current === mine) onBillChange(created);
          }
          return true;
        } catch (err) {
          onError(errorText(err, "That didn't save. Try again."));
          return false;
        }
      });
      queue.current = next;
      return next;
    },
    [onBillChange, onError],
  );

  const switchTo = useCallback(
    (next: BillId | null) => {
      sale.current = { billId: next };
      onBillChange(next);
    },
    [onBillChange],
  );

  return { run, switchTo };
}
