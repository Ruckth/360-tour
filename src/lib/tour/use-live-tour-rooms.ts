import { useConvex } from "convex/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { connectionOf, OFFLINE, watchLiveTourRooms, type LiveTourSnapshot } from "@/lib/tour/live-tour-rooms";

/**
 * Scenes the server has vouched for, and whether they are confirmed fresh.
 *
 * Fresh means the vouching happened on the current, open WebSocket connection: while connected,
 * Convex pushes every change to the live subscription. A disconnect keeps the scenes on screen but
 * unconfirmed; after a reconnect they stay unconfirmed until the server re-sends the result.
 */
export function useLiveTourRooms(slug: string) {
  const convex = useConvex();
  const connection = useSyncExternalStore(
    (onChange) => convex.subscribeToConnectionState(onChange),
    () => connectionOf(convex),
    () => OFFLINE,
  );
  const [snapshot, setSnapshot] = useState<LiveTourSnapshot>();

  useEffect(() => {
    const stop = watchLiveTourRooms(convex, slug, setSnapshot);
    return () => {
      stop();
      setSnapshot(undefined);
    };
  }, [convex, slug]);

  // Same contract as useQuery: a failed query reaches the nearest error boundary.
  if (snapshot && "error" in snapshot) throw snapshot.error;
  const rooms = snapshot?.rooms;
  return {
    rooms,
    fresh: rooms !== undefined && connection !== OFFLINE && snapshot?.connection === connection,
  };
}
