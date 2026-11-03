"use client";

import { api } from "convex/_generated/api";
import { useMutation } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { errorText } from "@/lib/staff-bookings";
import { useDisplayDriver } from "./useDisplayDriver";

/**
 * Publishes the checkout's open order to the customer display while this tab drives it: on every
 * order change, on becoming the driver, and whenever a display is paired (pairing clears what the
 * display shows). `null` is a new, empty order; `undefined` means the order isn't known yet (a
 * booking link still opening), so nothing is sent. Returns the last failure, for the checkout's
 * banner, and a retry.
 */
export function useShowOrderOnDisplay(orderId: string | null | undefined) {
  const { clientId, driver, displays } = useDisplayDriver();
  const showOrder = useMutation(api.displays.showOrder);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const drives = driver === "here";
  const paired = displays?.map((display) => display._id).join(",");

  useEffect(() => {
    if (!drives || !clientId || orderId === undefined) return;
    let current = true;
    setError(null);
    showOrder({ orderId, clientId }).catch((err: unknown) => {
      if (current) setError(`The customer display didn't update. ${errorText(err, "Check the connection and try again.")}`);
    });
    return () => {
      current = false;
    };
  }, [drives, paired, clientId, orderId, showOrder, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { error, retry };
}
