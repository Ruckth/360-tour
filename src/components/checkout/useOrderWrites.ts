"use client";

import { useCallback, useEffect, useRef } from "react";
import { errorText } from "@/lib/staff-bookings";
import type { OrderId } from "./backend";

/**
 * Runs an order write in order; the task gets its sale's order id (undefined before the first item).
 * `then` runs after it succeeds, only if that sale is still on screen (e.g. leaving an order after Save & close).
 */
export type Run = (task: (orderId: OrderId | undefined) => Promise<unknown>, then?: () => void) => Promise<boolean>;

/** One sale on screen. A write belongs to the sale that was showing when it was tapped. */
type Sale = { orderId: OrderId | null };

/**
 * Order writes, one after another, so a second tap before the order exists joins the same order.
 * Switching orders starts a new sale: writes tapped earlier still land on their own order, and
 * when they finish they no longer move the screen back to it.
 */
export function useOrderWrites(orderId: OrderId | null, onOrderChange: (orderId: OrderId | null) => void, onError: (message: string) => void) {
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const sale = useRef<Sale>({ orderId });
  useEffect(() => {
    if (sale.current.orderId !== orderId) sale.current = { orderId };
  }, [orderId]);

  const run = useCallback<Run>(
    (task, then) => {
      const mine = sale.current;
      const next = queue.current.then(async () => {
        try {
          onError("");
          const result = await task(mine.orderId ?? undefined);
          const created = result && typeof result === "object" && "orderId" in result ? (result.orderId as OrderId) : undefined;
          if (created && created !== mine.orderId) {
            mine.orderId = created;
            if (sale.current === mine) onOrderChange(created);
          }
          if (then && sale.current === mine) then();
          return true;
        } catch (err) {
          onError(errorText(err, "That didn't save. Try again."));
          return false;
        }
      });
      queue.current = next;
      return next;
    },
    [onOrderChange, onError],
  );

  const switchTo = useCallback(
    (next: OrderId | null) => {
      sale.current = { orderId: next };
      onOrderChange(next);
    },
    [onOrderChange],
  );

  return { run, switchTo };
}
