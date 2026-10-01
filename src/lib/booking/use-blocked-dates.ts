"use client";

import type { ConvexReactClient } from "convex/react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { BlockedMonthsStore, type BlockedMonthsView } from "@/lib/booking/blocked-months-store";
import { monthBounds, villaBatches } from "@/lib/booking/blocked-months";
import { addDaysIso, nightsBetweenIso } from "@/lib/booking/dates";
import { getBlockedDates, getBlockedDatesByProperty } from "@/lib/react/convex-api";

const EMPTY_VIEW: BlockedMonthsView = { blockedDates: [], pendingMonths: [], failedMonths: [] };
const noSubscription = () => () => {};
const noVersion = () => 0;

/**
 * Blocked nights of one villa, fetched a month at a time as `months` changes (see
 * BlockedMonthsStore). Months still loading are in `pendingMonths` and failed ones in
 * `failedMonths`: callers must treat both as unavailable, never free, and offer `retry`.
 */
export function useVillaBlockedMonths(
  client: ConvexReactClient | null,
  propertyId: string | undefined,
  months: string[],
) {
  const store = useMemo(
    () =>
      client
        ? new BlockedMonthsStore((id, month) => getBlockedDates(client, { propertyId: id, ...monthBounds(month) }))
        : null,
    [client],
  );
  const version = useSyncExternalStore(
    store?.subscribe ?? noSubscription,
    store?.getVersion ?? noVersion,
    noVersion,
  );
  const monthsKey = months.join(",");

  useEffect(() => {
    if (store && propertyId && monthsKey) store.request(propertyId, monthsKey.split(","));
  }, [store, propertyId, monthsKey]);

  return useMemo(() => {
    const list = monthsKey ? monthsKey.split(",") : [];
    // `version` changes whenever the store does; reading it keeps this memo fresh.
    const view = store && propertyId && version >= 0 ? store.view(propertyId, list) : EMPTY_VIEW;
    return { ...view, retry: () => (store && propertyId ? store.retry(propertyId, list) : undefined) };
  }, [store, propertyId, monthsKey, version]);
}

/**
 * Blocked nights of each listed villa within the chosen stay, so a villa picker can grey out
 * villas that are taken. `null` while loading, with no stay, or if it failed (unknown: the booking
 * itself is re-checked on the server).
 */
export function useStayBlockedDates(
  client: ConvexReactClient | null,
  propertyIds: string[],
  checkIn: string,
  checkOut: string,
) {
  const [result, setResult] = useState<{ key: string; blocked: Record<string, string[]> } | null>(null);
  const nights = nightsBetweenIso(checkIn, checkOut);
  const idsKey = propertyIds.join(",");
  const key = client && idsKey && nights > 0 ? `${checkIn}:${checkOut}:${idsKey}` : "";

  useEffect(() => {
    if (!client || !key) return;
    let active = true;
    const ids = idsKey.split(",");
    const lastNight = addDaysIso(checkOut, -1);
    Promise.all(
      villaBatches(ids, nights).map((batch) =>
        getBlockedDatesByProperty(client, { startDate: checkIn, endDate: lastNight, propertyIds: batch }),
      ),
    )
      .then((maps) => {
        if (active) setResult({ key, blocked: Object.assign({}, ...maps) });
      })
      .catch(() => {
        if (active) setResult(null);
      });
    return () => {
      active = false;
    };
  }, [checkIn, checkOut, client, idsKey, key, nights]);

  return result && result.key === key ? result.blocked : null;
}
