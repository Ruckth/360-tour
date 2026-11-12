"use client";

import { api } from "convex/_generated/api";
import { DRIVER_RENEW_MS } from "convex/lib/displayLease";
import { useMutation } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { newAttemptKey } from "@/components/checkout/backend";
import { errorText } from "@/lib/staff-bookings";
import { useDisplayDriver } from "./useDisplayDriver";

/**
 * Publishes the checkout's open order to the customer display while this tab drives it: on every
 * order change, on becoming the driver, and whenever a display is paired (pairing clears what the
 * display shows). `null` is a new, empty order; `undefined` means the order isn't known yet (a
 * booking link still opening), so nothing is sent. Returns the last failure, for the checkout's
 * banner, and a retry.
 *
 * Each mount publishes under a lease of its own (see convex/pos/displays.ts). It renews the lease while
 * an order is shown and releases it on unmount (another admin page, sign-out), which clears the
 * guest's screen. A crashed or closed tab simply stops renewing and the server clears it. Cleanup
 * names its own lease, so StrictMode's remount, or a newer mount, is never cleared by an older one.
 */
export function useShowOrderOnDisplay(orderId: string | null | undefined) {
  const { clientId, driver, displays } = useDisplayDriver();
  const showOrder = useMutation(api.pos.displays.showOrder);
  const renewLease = useMutation(api.pos.displays.renewDriverLease);
  const releaseDisplay = useMutation(api.pos.displays.releaseDisplay);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Set before the effects below run, in the same commit (effects run in order).
  const lease = useRef<string | null>(null);
  const drives = driver === "here";
  const paired = displays?.map((display) => display._id).join(",");

  useEffect(() => {
    if (!clientId) return;
    const leaseId = newAttemptKey();
    lease.current = leaseId;
    return () => {
      if (lease.current === leaseId) lease.current = null;
      void releaseDisplay({ clientId, leaseId }).catch(() => undefined);
    };
  }, [clientId, releaseDisplay]);

  useEffect(() => {
    const leaseId = lease.current;
    if (!drives || !clientId || !leaseId || orderId === undefined) return;
    let current = true;
    setError(null);
    showOrder({ orderId, clientId, leaseId }).catch((err: unknown) => {
      if (current) setError(`The customer display didn't update. ${errorText(err, "Check the connection and try again.")}`);
    });
    return () => {
      current = false;
    };
  }, [drives, paired, clientId, orderId, showOrder, attempt]);

  // Renewals keep an order on screen but are not customer activity. Back from a hidden tab or
  // sleep, renew at once rather than at the next tick: the order returns if its lease ran out.
  useEffect(() => {
    const leaseId = lease.current;
    if (!drives || !clientId || !leaseId || typeof orderId !== "string") return;
    const renew = () => void renewLease({ clientId, leaseId, orderId }).catch(() => undefined);
    const onVisible = () => {
      if (document.visibilityState === "visible") renew();
    };
    const id = window.setInterval(renew, DRIVER_RENEW_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [drives, clientId, orderId, renewLease]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { error, retry };
}
