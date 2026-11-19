import { act } from "../support/checkout-act";
// @vitest-environment happy-dom
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CustomerPage, HistoryEntry } from "@/components/checkout/backend";
import { convexCheckoutBackend } from "@/components/checkout/convex-backend";

/** The live History hook loads its mappers with the History sheet, then draws the staff rows. */
const { usePaginatedQuery, useQuery } = vi.hoisted(() => ({ usePaginatedQuery: vi.fn(), useQuery: vi.fn() }));
vi.mock("convex/react", () => ({ usePaginatedQuery, useQuery, useMutation: vi.fn() }));

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
  usePaginatedQuery.mockReturnValue({ results: [row], status: "Exhausted", loadMore });
  useQuery.mockReturnValue(null);
  await act(async () => root.render(createElement(Probe)));
  for (let i = 0; i < 50 && page.status === "LoadingFirstPage"; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  expect(page.status).toBe("Exhausted");
  expect(page.results).toEqual([expect.objectContaining({ entryId: "e1", fact: { key: "published" }, fields: { before: row.before, after: row.after } })]);
  expect(page.loadMore).toBe(loadMore);
  expect(attempt).toBeNull();
});
