// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ mutation: vi.fn(), people: [] as unknown[] }));
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      if (name === "staffAccess:listPeople") return mocks.people;
      if (name === "staffAccess:getCashierRules") return { discountLimitPercent: 10, voidPaidSale: "manager", customPrice: "manager", paymentFix: "manager", refund: "manager", revision: 0 };
      return undefined;
    },
    useMutation: () => mocks.mutation,
  };
});
vi.mock("next/link", () => ({ default: ({ children, ...props }: { children: ReactNode }) => createElement("a", props, children) }));
vi.mock("@/components/admin/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
import { TeamSettings, staffSignInLink } from "@/components/admin/TeamSettings";

const now = Date.now();
const DAY = 86_400_000;
const pending = { email: "lek@auraliscove.co", role: "cashier", staffGrant: { id: "grant-lek", role: "cashier", claimed: false, expiresAt: now + 12 * DAY, expired: false, updatedAt: now }, marketingGrant: null };
const expired = { email: "may@auraliscove.co", role: "cashier", staffGrant: { id: "grant-may", role: "cashier", claimed: false, expiresAt: now - DAY, expired: true, updatedAt: now }, marketingGrant: null };
const active = { email: "mint@auraliscove.co", role: "cashier", staffGrant: { id: "grant-mint", role: "cashier", claimed: true, expiresAt: null, expired: false, updatedAt: now }, marketingGrant: null };

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.mutation.mockReset();
  mocks.mutation.mockResolvedValue({ expiresAt: now + 14 * DAY });
  mocks.people = [pending, expired, active];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const row = (email: string) => [...host.querySelectorAll<HTMLElement>('[data-testid="team-person"]')].find((li) => li.textContent?.includes(email))!;
const buttonsIn = (el: HTMLElement) => [...el.querySelectorAll("button")].map((b) => b.textContent?.trim());
const press = (el: HTMLElement, text: string) =>
  act(async () => [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!.click());
const render = () => act(async () => root.render(createElement(TeamSettings)));

it("offers Renew and Copy sign-in link on a pending invite, and no Resend or Expire", async () => {
  await render();
  expect(buttonsIn(row(pending.email))).toEqual(["Renew", "Copy sign-in link", "Revoke"]);
  // An expired invite's link won't work until it is renewed.
  expect(buttonsIn(row(expired.email))).toEqual(["Renew", "Revoke"]);
  expect(buttonsIn(row(active.email))).toEqual(["Revoke"]);
  expect(host.textContent).not.toMatch(/Resend|Expire\b/);
});

it("Renew renews the invite through the unchanged backend action", async () => {
  await render();
  await press(row(pending.email), "Renew");
  expect(mocks.mutation).toHaveBeenCalledExactlyOnceWith({ grantId: "grant-lek", action: "resend" });
  expect(host.querySelector('[role="status"]')!.textContent).toBe("Invite renewed for lek@auraliscove.co.");
});

it("copies the sign-in link", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  await render();
  await press(row(pending.email), "Copy sign-in link");
  expect(writeText).toHaveBeenCalledExactlyOnceWith(staffSignInLink());
  expect(staffSignInLink("https://desk.example")).toBe("https://desk.example/admin");
  expect(host.querySelector('[role="status"]')!.textContent).toContain("Sign-in link copied.");
  expect(mocks.mutation).not.toHaveBeenCalled();
});

it.each([
  { name: "is missing", clipboard: undefined },
  { name: "refuses", clipboard: { writeText: () => Promise.reject(new Error("denied")) } },
])("shows the link to copy by hand when the clipboard $name", async ({ clipboard }) => {
  vi.stubGlobal("navigator", { ...navigator, clipboard });
  await render();
  await press(row(pending.email), "Copy sign-in link");
  const alert = host.querySelector('[role="alert"]')!;
  expect(alert.textContent).toContain("Couldn’t copy.");
  expect(alert.textContent).toContain(staffSignInLink());
});
