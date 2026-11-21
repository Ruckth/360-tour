// @vitest-environment happy-dom
import { act } from "../support/checkout-act";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OrderView, ReturnRecord } from "@/components/checkout/backend";
import { ReturnPayout } from "@/components/checkout/ReturnPayout";

/*
 * Audit Minor 5: a payout's "Return completed" notice follows the server's answer, not the claims
 * the screen showed before it was recorded.
 */
const recordPayout = vi.hoisted(() => vi.fn());
vi.mock("@/components/admin/staff-access", () => ({ useStaffAccess: () => ({ role: "cashier", capabilities: {} }) }));
vi.mock("@/components/checkout/backend", async (original) => ({
  ...await original<typeof import("@/components/checkout/backend")>(),
  useReturnsDesk: () => ({ useActions: () => ({ recordPayout }) }),
}));

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  recordPayout.mockReset();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const claim = { key: "card", method: "card", amount: 120000, state: "instructed", dueAt: Date.now() + 86_400_000, instructedAt: 1_000 };
// The screen knows one claim, so it looks final: the server's answer decides.
const record = {
  returnId: "return1", status: "authorized", operatorRevision: 2, isOperatorTill: true, isOperator: true, claimed: true,
  claims: [claim], parts: [], voucherCredits: [], giftSlips: [],
} as unknown as ReturnRecord;
const view = { order: { _id: "order1" }, lines: [] } as unknown as OrderView;

async function recordGiven(answer: { status: string }) {
  recordPayout.mockResolvedValue({ ...record, ...answer });
  const onCompleted = vi.fn();
  await act(async () => root.render(createElement(ReturnPayout, {
    view, record, tillId: "till1", fresh: { key: "card", instructedAt: 1_000, operatorRevision: 2 }, onFresh: () => {},
    autoArm: false, codes: new Map(), onBusyChange: () => {}, onCompleted,
  })));
  const given = document.querySelector<HTMLButtonElement>("[data-return-given]")!;
  expect(given.textContent).toBe("Money given back · Record");
  await act(async () => given.click());
  expect(recordPayout).toHaveBeenCalledWith(expect.objectContaining({ returnId: "return1", destinationKey: "card", outcome: "given" }));
  return onCompleted;
}

it("shows Return completed only when the server says the return completed", async () => {
  expect(await recordGiven({ status: "completed" })).toHaveBeenCalledWith("Return completed · refund recorded.");
});

it("shows nothing when the server still has the return open, whatever the screen's claims looked like", async () => {
  expect(await recordGiven({ status: "authorized" })).not.toHaveBeenCalled();
});
