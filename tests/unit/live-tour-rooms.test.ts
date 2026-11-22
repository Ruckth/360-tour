import { afterEach, describe, expect, it, vi } from "vitest";
import { CONFIRM_RETRY_MS, watchLiveTourRooms, type LiveTourSnapshot } from "@/lib/tour/live-tour-rooms";
import { fakeTourClient } from "./tour-live-client";

const v1 = [{ slug: "living", name: "Living", imagePath: "/tour/living.webp", hotspots: [] }];

/** A server read the test resolves by hand, recording when it started. */
function delayedRead() {
  const pending: { slug: string; resolve: (value: unknown) => void; reject: (error: unknown) => void }[] = [];
  const read = (_convex: unknown, slug: string) =>
    new Promise<never>((resolve, reject) => pending.push({ slug, resolve: resolve as (value: unknown) => void, reject }));
  return { read, pending };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("confirming a value another watch already holds", () => {
  it("ignores a read that started on a connection that has since been replaced", async () => {
    const convex = fakeTourClient();
    convex.cache("villa", v1); // another watch keeps the query alive on connection 1
    const { read, pending } = delayedRead();
    const snapshots: LiveTourSnapshot[] = [];
    const stop = watchLiveTourRooms(convex.client, "villa", (s) => snapshots.push(s), read as never);
    expect(pending).toHaveLength(1);

    convex.disconnect();
    // The villa is archived meanwhile. Connection 2 opens; the client still holds v1 until the
    // server re-sends the query on it (held here).
    convex.reconnect();
    pending[0].resolve(v1); // the read ran before the archive, so it still matches v1
    await flush();
    expect(snapshots, "no scenes from a read that predates the current connection").toEqual([]);

    convex.deliver("villa", null);
    expect(snapshots).toEqual([{ rooms: null, connection: 2 }]);
    stop();
  });

  it("ignores a read that resolves while disconnected", async () => {
    const convex = fakeTourClient();
    convex.cache("villa", v1);
    const { read, pending } = delayedRead();
    const snapshots: LiveTourSnapshot[] = [];
    const stop = watchLiveTourRooms(convex.client, "villa", (s) => snapshots.push(s), read as never);
    convex.disconnect();
    pending[0].resolve(v1);
    await flush();
    expect(snapshots).toEqual([]);
    stop();
  });

  it("does not read, and shows nothing, when mounted offline", async () => {
    const convex = fakeTourClient();
    convex.cache("villa", v1);
    convex.disconnect();
    const { read, pending } = delayedRead();
    const snapshots: LiveTourSnapshot[] = [];
    const stop = watchLiveTourRooms(convex.client, "villa", (s) => snapshots.push(s), read as never);
    await flush();
    expect(pending).toEqual([]);
    expect(snapshots).toEqual([]);
    // Reconnecting resubscribes every query, so the server re-sends this one.
    convex.reconnect();
    convex.deliver("villa", v1);
    expect(snapshots).toEqual([{ rooms: v1, connection: 2 }]);
    stop();
  });

  it("still confirms a matching read on the connection it started on", async () => {
    const convex = fakeTourClient();
    convex.cache("villa", v1);
    const { read, pending } = delayedRead();
    const snapshots: LiveTourSnapshot[] = [];
    const stop = watchLiveTourRooms(convex.client, "villa", (s) => snapshots.push(s), read as never);
    pending[0].resolve(v1);
    await flush();
    expect(snapshots).toEqual([{ rooms: v1, connection: 1 }]);
    stop();
  });

  it("drops a read that resolves after the watch stopped (route or identity change)", async () => {
    const convex = fakeTourClient();
    convex.cache("villa", v1);
    const { read, pending } = delayedRead();
    const old: LiveTourSnapshot[] = [];
    const stopOld = watchLiveTourRooms(convex.client, "villa", (s) => old.push(s), read as never);
    stopOld();
    const next: LiveTourSnapshot[] = [];
    const stopNext = watchLiveTourRooms(convex.client, "villa", (s) => next.push(s), read as never);
    pending[0].resolve(v1);
    await flush();
    expect(old).toEqual([]);
    expect(next, "the new watch waits for its own read").toEqual([]);
    pending[1].resolve(v1);
    await flush();
    expect(next).toEqual([{ rooms: v1, connection: 1 }]);
    stopNext();
  });
});

describe("re-checking after a failed confirming read", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A viewer sharing an unchanged live query: the server will send it nothing. */
  function shared() {
    vi.useFakeTimers();
    const convex = fakeTourClient();
    convex.cache("villa", v1);
    const { read, pending } = delayedRead();
    const snapshots: LiveTourSnapshot[] = [];
    const stop = watchLiveTourRooms(convex.client, "villa", (s) => snapshots.push(s), read as never);
    return { convex, pending, snapshots, stop };
  }
  const fail = async (pending: ReturnType<typeof delayedRead>["pending"], index: number) => {
    pending[index].reject(new Error("transient"));
    await vi.advanceTimersByTimeAsync(0);
  };

  it("recovers from a transient failure within the viewer's 3 s timeout, on one subscription", async () => {
    const { convex, pending, snapshots, stop } = shared();
    await fail(pending, 0);
    await vi.advanceTimersByTimeAsync(CONFIRM_RETRY_MS[0] - 1);
    expect(pending).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(pending).toHaveLength(2);
    pending[1].resolve(v1);
    await vi.advanceTimersByTimeAsync(0);
    expect(snapshots).toEqual([{ rooms: v1, connection: 1 }]);
    expect(convex.subscribed).toEqual(["villa"]);
    expect(CONFIRM_RETRY_MS.reduce((sum, wait) => sum + wait, 0)).toBeLessThan(3_000);
    stop();
  });

  it("stops after the limited re-checks, and a later delivery still decides", async () => {
    const { convex, pending, snapshots, stop } = shared();
    for (const [index, wait] of CONFIRM_RETRY_MS.entries()) {
      await fail(pending, index);
      await vi.advanceTimersByTimeAsync(wait);
    }
    await fail(pending, CONFIRM_RETRY_MS.length);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pending).toHaveLength(CONFIRM_RETRY_MS.length + 1);
    expect(snapshots).toEqual([]);
    convex.deliver("villa", v1);
    expect(snapshots).toEqual([{ rooms: v1, connection: 1 }]);
    expect(convex.open()).toEqual(["villa"]);
    stop();
  });

  it("cancels the re-check when the viewer closes or changes route", async () => {
    const { convex, pending, snapshots, stop } = shared();
    await fail(pending, 0);
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pending).toHaveLength(1);
    expect(snapshots).toEqual([]);
    expect(convex.open()).toEqual([]);
  });

  it("cancels the re-check when the connection changes", async () => {
    const { convex, pending, snapshots, stop } = shared();
    await fail(pending, 0);
    convex.disconnect();
    convex.reconnect();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pending).toHaveLength(1);
    expect(snapshots, "the retained value is not replayed").toEqual([]);
    convex.deliver("villa", null);
    expect(snapshots).toEqual([{ rooms: null, connection: 2 }]);
    stop();
  });

  it("cancels the re-check after a query error", async () => {
    const { convex, pending, snapshots, stop } = shared();
    await fail(pending, 0);
    const error = new Error("query failed");
    convex.fail("villa", error);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pending).toHaveLength(1);
    expect(snapshots).toEqual([{ error }]);
    stop();
  });

  it("does not re-check, or replay the held value, after a fresher delivery", async () => {
    const { convex, pending, snapshots, stop } = shared();
    await fail(pending, 0);
    convex.deliver("villa", null);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pending).toHaveLength(1);
    expect(snapshots).toEqual([{ rooms: null, connection: 1 }]);
    stop();
  });

  it("ignores a re-check answer that arrives after a fresher delivery", async () => {
    const { convex, pending, snapshots, stop } = shared();
    await fail(pending, 0);
    await vi.advanceTimersByTimeAsync(CONFIRM_RETRY_MS[0]);
    convex.deliver("villa", null);
    pending[1].resolve(v1);
    await vi.advanceTimersByTimeAsync(0);
    expect(snapshots).toEqual([{ rooms: null, connection: 1 }]);
    stop();
  });

  it("does not retry a mismatch: a delivery is on its way", async () => {
    const { pending, snapshots, stop } = shared();
    pending[0].resolve(null);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pending).toHaveLength(1);
    expect(snapshots).toEqual([]);
    stop();
  });
});
