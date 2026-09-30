import { describe, expect, it } from "vitest";
import { BlockedMonthsStore } from "@/lib/booking/blocked-months-store";

/** A fetch whose calls stay pending until the test resolves or rejects them, in any order. */
function controllableFetch() {
  const calls: Array<{
    propertyId: string;
    month: string;
    resolve: (dates: string[]) => void;
    reject: (error: Error) => void;
  }> = [];
  const fetchMonth = (propertyId: string, month: string) =>
    new Promise<string[]>((resolve, reject) => calls.push({ propertyId, month, resolve, reject }));
  const find = (propertyId: string, month: string, nth = 0) =>
    calls.filter((call) => call.propertyId === propertyId && call.month === month)[nth];
  return { calls, fetchMonth, find };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("BlockedMonthsStore", () => {
  it("keeps months unknown until they load, and loads each month once as the calendar moves", async () => {
    const api = controllableFetch();
    const store = new BlockedMonthsStore(api.fetchMonth);
    let changes = 0;
    store.subscribe(() => changes++);

    store.request("villa-a", ["2030-05", "2030-06"]);
    expect(store.view("villa-a", ["2030-05", "2030-06"])).toEqual({
      blockedDates: [],
      pendingMonths: ["2030-05", "2030-06"],
      failedMonths: [],
    });

    api.find("villa-a", "2030-05").resolve(["2030-05-10"]);
    await flush();
    expect(store.view("villa-a", ["2030-05", "2030-06"])).toMatchObject({
      blockedDates: ["2030-05-10"],
      pendingMonths: ["2030-06"],
    });

    // Moving forward a month only fetches the new month.
    store.request("villa-a", ["2030-06", "2030-07"]);
    expect(api.calls.map((call) => call.month)).toEqual(["2030-05", "2030-06", "2030-07"]);
    expect(changes).toBeGreaterThan(0);
  });

  it("keeps villas apart when the guest switches villa mid-load", async () => {
    const api = controllableFetch();
    const store = new BlockedMonthsStore(api.fetchMonth);
    store.request("villa-a", ["2030-05"]);
    store.request("villa-b", ["2030-05"]);
    api.find("villa-b", "2030-05").resolve([]);
    api.find("villa-a", "2030-05").resolve(["2030-05-01"]);
    await flush();
    expect(store.view("villa-b", ["2030-05"]).blockedDates).toEqual([]);
    expect(store.view("villa-a", ["2030-05"]).blockedDates).toEqual(["2030-05-01"]);
  });

  it("treats a failed month as unknown until retried, and ignores a stale attempt", async () => {
    const api = controllableFetch();
    const store = new BlockedMonthsStore(api.fetchMonth);
    store.request("villa-a", ["2030-05"]);
    api.find("villa-a", "2030-05").reject(new Error("offline"));
    await flush();
    expect(store.view("villa-a", ["2030-05"])).toEqual({ blockedDates: [], pendingMonths: [], failedMonths: ["2030-05"] });

    // Asking again doesn't silently retry; only `retry` does.
    store.request("villa-a", ["2030-05"]);
    expect(api.calls).toHaveLength(1);

    store.retry("villa-a", ["2030-05"]);
    expect(store.view("villa-a", ["2030-05"]).pendingMonths).toEqual(["2030-05"]);
    api.find("villa-a", "2030-05", 1).resolve(["2030-05-20"]);
    await flush();
    expect(store.view("villa-a", ["2030-05"])).toEqual({ blockedDates: ["2030-05-20"], pendingMonths: [], failedMonths: [] });

    // A late answer from the first attempt can't overwrite the retry's result.
    api.find("villa-a", "2030-05", 0).resolve([]);
    await flush();
    expect(store.view("villa-a", ["2030-05"]).blockedDates).toEqual(["2030-05-20"]);
  });

  it("does not retry months that loaded", async () => {
    const api = controllableFetch();
    const store = new BlockedMonthsStore(api.fetchMonth);
    store.request("villa-a", ["2030-05"]);
    api.find("villa-a", "2030-05").resolve([]);
    await flush();
    store.retry("villa-a", ["2030-05"]);
    expect(api.calls).toHaveLength(1);
  });
});
