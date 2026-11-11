// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Id } from "convex/_generated/dataModel";
import type { CreditRow } from "convex/marketingAffiliates";
import {
  CreditList,
  CreditReview,
  type CreditDetail,
} from "@/components/admin/marketing/AffiliatesView";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});
const id = "credit1" as Id<"affiliateCredits">;
const anna = "anna" as Id<"marketingAffiliates">;
const ben = "ben" as Id<"marketingAffiliates">;
const row: CreditRow = {
  _id: id,
  _creationTime: 0,
  sourceKey: "order:one",
  state: "pending",
  eligible: true,
  eligibleNet: 700,
  approvedNet: 0,
  revision: 4,
  createdAt: 0,
  updatedAt: 0,
  affiliateId: anna,
  label: "Guest",
  ref: "Order #1",
  affiliateName: "Anna",
  snapshot: {
    capturedAt: 0,
    flags: ["affiliate_conflict"],
    affiliateId: anna,
    candidates: [],
  },
  candidates: [
    {
      affiliateId: anna,
      name: "Anna",
      slug: "anna",
      origin: "link",
      eligible: true,
    },
    {
      affiliateId: ben,
      name: "Ben",
      slug: "ben",
      origin: "coupon",
      eligible: true,
    },
  ],
  flags: ["affiliate_conflict"],
};
const detail: CreditDetail = {
  credit: row,
  history: [
    {
      _id: "history1" as Id<"affiliateCreditChanges">,
      _creationTime: 0,
      creditId: id,
      revision: 4,
      actor: "finance@example.com",
      kind: "amount_changed",
      state: "pending",
      eligibleNet: 700,
      approvedNet: 0,
      recordedAt: 0,
    },
  ],
  partial: false,
};
const button = (text: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === text)!;
async function field(selector: string, value: string) {
  const element = document.querySelector<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >(selector)!;
  const proto =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    element.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
}
it("requires a reason and an explicit partner for conflicts, submitting the displayed revision", async () => {
  const review = vi.fn().mockResolvedValue(null);
  await act(async () =>
    root.render(
      createElement(CreditReview, {
        detail,
        canReview: true,
        onReview: review,
        onRefresh: vi.fn(),
        onClose: vi.fn(),
      }),
    ),
  );
  expect(button("Approve referral credit").disabled).toBe(true);
  await field("#credit-reason", "Verified source with guest");
  expect(button("Approve referral credit").disabled).toBe(true);
  await field("#credit-candidate", ben);
  expect(button("Approve referral credit").disabled).toBe(false);
  await act(async () => button("Approve referral credit").click());
  expect(review).toHaveBeenCalledWith({
    creditId: id,
    expectedRevision: 4,
    decision: "approved",
    reason: "Verified source with guest",
    affiliateId: ben,
  });
  expect(document.body.textContent).toContain(
    "Revision 4 · amount changed · pending",
  );
});
it("keeps a refused decision open and reports its server message", async () => {
  const review = vi
    .fn()
    .mockRejectedValue(new Error("Credit changed; refresh before reviewing"));
  await act(async () =>
    root.render(
      createElement(CreditReview, {
        detail,
        canReview: true,
        onReview: review,
        onRefresh: vi.fn(),
        onClose: vi.fn(),
      }),
    ),
  );
  await field("#credit-reason", "Invalid self referral");
  await act(async () => button("Reject referral credit").click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Credit changed; refresh before reviewing",
  );
  expect(
    document.querySelector<HTMLTextAreaElement>("#credit-reason")!.value,
  ).toBe("Invalid self referral");
});
it("shows history without decision controls to viewers, and blocks approval for ineligible sales", async () => {
  await act(async () =>
    root.render(
      createElement(CreditReview, {
        detail,
        canReview: false,
        onReview: vi.fn(),
        onRefresh: vi.fn(),
        onClose: vi.fn(),
      }),
    ),
  );
  expect(button("Approve referral credit")).toBeUndefined();
  expect(button("Refresh eligibility")).toBeUndefined();
  expect(document.body.textContent).toContain("finance@example.com");
  await act(async () =>
    root.render(
      createElement(CreditReview, {
        detail: { ...detail!, credit: { ...row, eligible: false } },
        canReview: true,
        onReview: vi.fn(),
        onRefresh: vi.fn(),
        onClose: vi.fn(),
      }),
    ),
  );
  expect(button("Approve referral credit").disabled).toBe(true);
});
it("flags conflicts and incomplete queue results while showing actual collections", async () => {
  const open = vi.fn();
  await act(async () =>
    root.render(
      createElement(CreditList, {
        credits: [row],
        partial: true,
        state: "pending",
        onState: vi.fn(),
        onOpen: open,
      }),
    ),
  );
  expect(host.textContent).toContain("Link and coupon name different partners");
  expect(host.textContent).toContain("THB");
  expect(host.textContent).toContain("queue is limited");
  await act(async () => button("Review Order #1").click());
  expect(open).toHaveBeenCalledWith(row);
});


it.each([
  ["referral_claimed_slug", "Partner slug claimed without a recorded visit"],
])("shows %s beside self-referral evidence in credit review", async (flag, label) => {
  await act(async () => root.render(createElement(CreditReview, {
    detail: { ...detail!, credit: { ...row, flags: ["self_referral", flag] } },
    canReview: true, onReview: vi.fn(), onRefresh: vi.fn(), onClose: vi.fn(),
  })));
  expect(document.body.textContent).toContain("Guest matches partner contact");
  expect(document.body.textContent).toContain(label);
});

it("renders hidden decision and history reasons for a read-only credit", async () => {
  await act(async () => root.render(createElement(CreditReview, {
    detail: {
      ...detail!,
      credit: { ...row, reason: null, reasonHidden: true },
      history: detail!.history.map(h => ({ ...h, reason: null, reasonHidden: true })),
    },
    canReview: false,
    onReview: vi.fn(), onRefresh: vi.fn(), onClose: vi.fn(),
  })));
  expect(document.body.textContent).toContain("Last decision: Reason hidden");
  expect(document.body.textContent!.match(/Reason hidden/g)).toHaveLength(2);
  expect(document.body.textContent).not.toMatch(/undefined|null/);
  expect(button("Approve referral credit")).toBeUndefined();
});
