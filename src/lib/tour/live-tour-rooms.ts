import { api } from "convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import type { ConvexReactClient } from "convex/react";
import { markTourBench } from "@/lib/tour/bench";
import type { DbTourRooms } from "@/lib/tour/rooms";

const tourRoomsQuery = api.catalog.properties.getTourRooms;
export const OFFLINE = -1;
/** Waits before re-checking after a failed confirming read; together they fit the viewer's 3 s timeout. */
export const CONFIRM_RETRY_MS = [400, 1_000] as const;

type Client = Pick<ConvexReactClient, "watchQuery" | "connectionState" | "url">;

/**
 * `rooms` is undefined until the server has vouched for a result: either delivered it to this
 * subscription, or (for a value the client already held) matched it in a separate server read.
 * `connection` is the WebSocket connection that vouched for it, or OFFLINE.
 */
export type LiveTourSnapshot =
  | { rooms: DbTourRooms | undefined; connection: number }
  | { error: unknown };

/** One server read of the current scenes, outside the WebSocket query set (adds no subscription). */
export function readTourRooms(convex: Client, slug: string) {
  return new ConvexHttpClient(convex.url, { logger: false }).query(tourRoomsQuery, { slug });
}

/**
 * The viewer's single live `getTourRooms` watch.
 *
 * The client may already hold a value for this query: retained after a viewer closed, or held by
 * another watch on the same query. Such a value is never shown on its own. If another watch keeps
 * the query alive, the server re-sends nothing until the data changes, so the held value is
 * confirmed by a separate read and shown only if it matches. A different read result means a
 * delivery is on its way; the viewer waits for it.
 *
 * The read only vouches on the open connection it started on. After a reconnect the client keeps
 * the old value until the server re-sends the query, so a read issued before the drop could match
 * a value the server has since changed. A mount while offline does not read at all: reconnecting
 * resubscribes the query, and that delivery decides.
 *
 * A failed read (not a mismatch) is retried a limited number of times, and only while nothing else
 * has decided: still mounted, same open connection, no delivery, no query error, value still held.
 */
export function watchLiveTourRooms(
  convex: Client,
  slug: string,
  onChange: (snapshot: LiveTourSnapshot) => void,
  read: typeof readTourRooms = readTourRooms,
) {
  const watch = convex.watchQuery(tourRoomsQuery, { slug });
  let rooms: DbTourRooms | undefined;
  let stopped = false;
  let failed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const vouch = (value: DbTourRooms, connection: number) => {
    if (rooms === undefined) markTourBench("rooms_resolved");
    rooms = value;
    onChange({ rooms: value, connection });
  };

  const unsubscribe = watch.onUpdate(() => {
    let value: DbTourRooms | undefined;
    try {
      value = watch.localQueryResult();
    } catch (error) {
      failed = true;
      onChange({ error });
      return;
    }
    // The client dropped its server result (reconnecting): keep the confirmed scenes, unconfirmed.
    if (value === undefined) {
      if (rooms !== undefined) onChange({ rooms, connection: OFFLINE });
      return;
    }
    vouch(value, connectionOf(convex));
    markTourBench("rooms_update");
  });

  const started = connectionOf(convex);
  const undecided = () =>
    !stopped && !failed && rooms === undefined && connectionOf(convex) === started && held(watch) !== undefined;
  const confirm = (attempt: number) => {
    read(convex, slug).then((truth) => {
      if (!undecided()) return;
      const current = held(watch)!;
      if (JSON.stringify(current) !== JSON.stringify(truth)) return;
      vouch(current, started);
      markTourBench("rooms_verified");
    }, () => {
      const wait = CONFIRM_RETRY_MS[attempt];
      if (wait === undefined || !undecided()) return;
      retry = setTimeout(() => {
        retry = undefined;
        if (undecided()) confirm(attempt + 1);
      }, wait);
    });
  };
  if (started !== OFFLINE && held(watch) !== undefined) confirm(0);

  return () => {
    stopped = true;
    clearTimeout(retry);
    unsubscribe();
  };
}

function held(watch: { localQueryResult(): DbTourRooms | undefined }) {
  try {
    return watch.localQueryResult();
  } catch {
    return undefined;
  }
}

export function connectionOf(convex: Pick<Client, "connectionState">) {
  const state = convex.connectionState();
  return state.isWebSocketConnected ? state.connectionCount : OFFLINE;
}
