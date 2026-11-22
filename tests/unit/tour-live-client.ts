import type { useConvex } from "convex/react";

/**
 * A controllable stand-in for the ConvexReactClient surface the tour viewer uses. It mirrors the
 * real client's reconnect contract: the cached value survives a reconnect, and only a server
 * delivery (`deliver`) notifies the query's listeners.
 */
export function fakeTourClient() {
  const queryListeners = new Map<string, Set<() => void>>();
  const connectionListeners = new Set<() => void>();
  const values = new Map<string, unknown>();
  const errors = new Map<string, unknown>();
  let connection = { isWebSocketConnected: true, connectionCount: 1 };
  const subscribed: string[] = [];
  const notifyConnection = () => connectionListeners.forEach((listener) => listener());
  const client = {
    url: "http://127.0.0.1:3210",
    connectionState: () => connection,
    subscribeToConnectionState(listener: () => void) {
      connectionListeners.add(listener);
      return () => connectionListeners.delete(listener);
    },
    watchQuery(_query: unknown, args: { slug: string }) {
      return {
        localQueryResult: () => {
          if (errors.has(args.slug)) throw errors.get(args.slug);
          return values.get(args.slug);
        },
        onUpdate(listener: () => void) {
          subscribed.push(args.slug);
          const set = queryListeners.get(args.slug) ?? new Set();
          set.add(listener);
          queryListeners.set(args.slug, set);
          return () => set.delete(listener);
        },
      };
    },
  };
  return {
    client: client as unknown as ReturnType<typeof useConvex>,
    /** Every subscription ever opened, by slug. */
    subscribed,
    /** Currently open subscriptions, by slug. */
    open: () => [...queryListeners].flatMap(([slug, set]) => [...set].map(() => slug)),
    /** Seed the client cache without a delivery (e.g. a value retained from earlier). */
    cache(slug: string, value: unknown) {
      values.set(slug, value);
    },
    deliver(slug: string, value: unknown) {
      values.set(slug, value);
      queryListeners.get(slug)?.forEach((listener) => listener());
    },
    /** The server reports the query failed. */
    fail(slug: string, error: unknown) {
      errors.set(slug, error);
      queryListeners.get(slug)?.forEach((listener) => listener());
    },
    disconnect() {
      connection = { ...connection, isWebSocketConnected: false };
      notifyConnection();
    },
    reconnect() {
      connection = { isWebSocketConnected: true, connectionCount: connection.connectionCount + 1 };
      notifyConnection();
    },
  };
}
