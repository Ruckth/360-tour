import { act } from "../support/checkout-act";
// @vitest-environment happy-dom
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CustomerPage, HistoryEntry } from "@/components/checkout/backend";
import { convexCheckoutBackend } from "@/components/checkout/convex-backend";

/** The live History hook loads its mappers with the History sheet, then draws the staff rows. */
const { usePaginatedQuery, useQueries, useQuery } = vi.hoisted(() => ({ usePaginatedQuery: vi.fn(), useQueries: vi.fn(), useQuery: vi.fn() }));
vi.mock("convex/react", () => ({ usePaginatedQuery, useQueries, useQuery, useMutation: vi.fn() }));

let root: Root;
let page: CustomerPage<HistoryEntry>;
let attempt: unknown;
function Probe() {
  const commerce = convexCheckoutBackend.commerce!;
  page = commerce.useHistory({ targetType: "package", targetId: "pkg" as never }, "staff");
  attempt = commerce.usePaymentAttempt("order" as never);
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

it("reads History and the receipt attempt once the commerce mappers have loaded", async () => {
  const loadMore = vi.fn();
  const row = {
    entryId: "e1", at: 1, fact: { key: "published" }, balance: null,
    before: { contents: [{ contentKey: "massage", kind: "session", serviceIds: ["a"], units: 5, label: "Traditional Thai Massage" }] },
    after: { contents: [{ contentKey: "massage", kind: "session", serviceIds: ["b"], units: 5, label: "Aromatherapy Massage" }] },
    staff: { actorName: "Ploy", reason: "other", reasonText: "Updated eligible treatment" },
  };
  useQueries.mockReturnValue({ "0": { page: [row], isDone: true, continueCursor: "" } });
  usePaginatedQuery.mockReturnValue({ results: [row], status: "Exhausted", loadMore });
  useQuery.mockReturnValue(null);
  await act(async () => root.render(createElement(Probe)));
  for (let i = 0; i < 50 && page.status === "LoadingFirstPage"; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  expect(page.status).toBe("Exhausted");
  expect(page.results).toEqual([expect.objectContaining({ entryId: "e1", fact: { key: "published" }, fields: { before: row.before, after: row.after } })]);
  expect(typeof page.loadMore).toBe("function");
  expect(attempt).toBeNull();
});

it("re-chains page 2's cursor when a live insert shifts page 1's cut boundary, and resets cleanly on InvalidCursor", async () => {
  const entry = (id: string) => ({
    entryId: id, at: Number(id.slice(1)), fact: { key: "published" as const }, balance: null,
    staff: { actorName: "Ploy", reason: "other", reasonText: "Update" },
  });
  let stream = Array.from({ length: 12 }, (_, i) => entry(`e${12 - i}`));
  let invalidAfter: string | null = null;

  useQueries.mockImplementation((requests: Record<string, { args: { paginationOpts: { cursor: string | null } } }>) => {
    const out: Record<string, unknown> = {};
    for (const [key, req] of Object.entries(requests)) {
      const cursor = req.args.paginationOpts.cursor;
      if (cursor && cursor === invalidAfter) {
        out[key] = Object.assign(new Error("InvalidCursor: History has changed."), {
          data: { code: "STALE_HISTORY_CURSOR", isConvexSystemError: true, paginationError: "InvalidCursor" },
        });
        continue;
      }
      const start = cursor ? Number(cursor.replace("cut:", "")) : 0;
      const slice = stream.slice(start, start + 6);
      const next = start + slice.length;
      out[key] = { page: slice, isDone: next >= stream.length, continueCursor: next >= stream.length ? "" : `cut:${next}` };
    }
    return out;
  });
  useQuery.mockReturnValue(null);

  await act(async () => root.render(createElement(Probe)));
  for (let i = 0; i < 50 && page.status === "LoadingFirstPage"; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  expect(page.status).toBe("CanLoadMore");
  expect(page.results.map((r) => r.entryId)).toEqual(["e12", "e11", "e10", "e9", "e8", "e7"]);

  await act(async () => page.loadMore(20));
  expect(page.status).toBe("Exhausted");
  expect(page.results.map((r) => r.entryId)).toEqual(["e12", "e11", "e10", "e9", "e8", "e7", "e6", "e5", "e4", "e3", "e2", "e1"]);

  // Two live inserts prepend to page 0, shifting its continueCursor boundary from cut:6 -> cut:8 (Wait: page 0 now returns 6 items e14..e9, so page 0 ends at index 6 which is e8..e3 on page 1; simulating shifted continueCursor where page 0 changes cursor string).
  stream = [entry("e14"), entry("e13"), ...stream];
  useQueries.mockImplementation((requests: Record<string, { args: { paginationOpts: { cursor: string | null } } }>) => {
    const out: Record<string, unknown> = {};
    for (const [key, req] of Object.entries(requests)) {
      const cursor = req.args.paginationOpts.cursor;
      if (cursor === "cut:6") {
        // Old boundary would have dropped e8,e7 or thrown stale cursor! Verify hook shifts away from cut:6 -> cut:shift:6.
        out[key] = Object.assign(new Error("InvalidCursor"), {
          data: { code: "STALE_HISTORY_CURSOR", isConvexSystemError: true, paginationError: "InvalidCursor" },
        });
        continue;
      }
      const start = cursor === null ? 0 : Number(cursor.split(":").pop());
      const slice = stream.slice(start, start + 6);
      const next = start + slice.length;
      out[key] = { page: slice, isDone: next >= stream.length, continueCursor: next >= stream.length ? "" : `cut:shift:${next}` };
    }
    return out;
  });

  await act(async () => root.render(createElement(Probe)));
  // After page 0's continueCursor changed to cut:shift:6, page 1 re-subscribed to cut:shift:6 with zero drops between e9 and e8.
  expect(page.results.map((r) => r.entryId)).toEqual(["e14", "e13", "e12", "e11", "e10", "e9", "e8", "e7", "e6", "e5", "e4", "e3"]);
  expect(page.status).toBe("CanLoadMore");

  // Load page 2 (e2, e1) -> all 14 entries in exact order with zero duplicates or gaps.
  await act(async () => page.loadMore(20));
  expect(page.results.map((r) => r.entryId)).toEqual([
    "e14", "e13", "e12", "e11", "e10", "e9", "e8", "e7", "e6", "e5", "e4", "e3", "e2", "e1",
  ]);
  expect(page.status).toBe("Exhausted");

  // If a loaded continuation cursor expires with InvalidCursor, the hook resets cleanly to page 0 without throwing.
  invalidAfter = "cut:shift:12";
  useQueries.mockImplementation((requests: Record<string, { args: { paginationOpts: { cursor: string | null } } }>) => {
    const out: Record<string, unknown> = {};
    for (const [key, req] of Object.entries(requests)) {
      const cursor = req.args.paginationOpts.cursor;
      if (cursor === invalidAfter) {
        out[key] = Object.assign(new Error("InvalidCursor"), {
          data: { code: "STALE_HISTORY_CURSOR", isConvexSystemError: true, paginationError: "InvalidCursor" },
        });
        continue;
      }
      const start = cursor === null ? 0 : Number(cursor.split(":").pop());
      const slice = stream.slice(start, start + 6);
      const next = start + slice.length;
      out[key] = { page: slice, isDone: next >= stream.length, continueCursor: next >= stream.length ? "" : `cut:shift:${next}` };
    }
    return out;
  });
  await act(async () => root.render(createElement(Probe)));
  expect(page.results.map((r) => r.entryId)).toEqual(["e14", "e13", "e12", "e11", "e10", "e9"]);
  expect(page.status).toBe("CanLoadMore");
});
