// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ calls: [] as [string, unknown][], people: [] as unknown[], confirm: vi.fn() }));
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      if (name === "staffAccess:listPeople") return mocks.people;
      if (name === "staffAccess:getCashierRules") return { discountLimitPercent: 10, voidPaidSale: "manager", customPrice: "manager", paymentFix: "manager", refund: "manager", revision: 0 };
      return undefined;
    },
    useMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      return async (args: unknown) => {
        mocks.calls.push([name, args]);
        return null;
      };
    },
  };
});
vi.mock("@/components/admin/ConfirmDialog", () => ({ useConfirm: () => mocks.confirm }));
import { TeamSettings, marketingSignInLink, staffSignInLink } from "@/components/admin/TeamSettings";

const now = Date.now();
const DAY = 86_400_000;
const grant = (id: string, role: string, claimed: boolean, expired = false) => ({ id, role, claimed, expiresAt: claimed ? null : now + (expired ? -DAY : 12 * DAY), expired, updatedAt: now });
const pending = { email: "lek@auraliscove.co", role: "cashier", staffGrant: grant("grant-lek", "cashier", false), marketingGrant: null };
const expired = { email: "may@auraliscove.co", role: "cashier", staffGrant: grant("grant-may", "cashier", false, true), marketingGrant: null };
const active = { email: "mint@auraliscove.co", role: "cashier", staffGrant: grant("grant-mint", "cashier", true), marketingGrant: null };
const marketer = { email: "sun@auraliscove.co", role: null, staffGrant: null, marketingGrant: grant("mkt-sun", "manager", true) };
const owner = { email: "narin@auraliscove.co", role: "owner", staffGrant: null, marketingGrant: null };

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.calls = [];
  mocks.confirm.mockReset().mockResolvedValue(true);
  mocks.people = [pending, expired, active, marketer, owner];
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
const buttonsIn = (el: HTMLElement) => [...el.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim());
const select = (el: HTMLElement, name: string) => el.querySelector<HTMLButtonElement>(`button[role="combobox"][aria-label^="${name}"]`)!;
const pick = async (node: HTMLButtonElement, value: string) => {
  await act(async () => { node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  const label = ({ marketer: "Editor", manager: "Manager", viewer: "Viewer", "": "None" } as Record<string, string>)[value];
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((el) => el.textContent === label || (value === "" && el.textContent?.startsWith("No desk")))!;
  await act(async () => { option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
};
const render = () => act(async () => root.render(createElement(TeamSettings)));
/** Roles show as text; Change opens the person's two selects. */
const change = (el: HTMLElement) => act(async () => el.querySelector<HTMLButtonElement>('button[aria-label^="Change roles for"]')!.click());

it("gives each person a Desk and a Marketing role, with Marketing Manager shown as Lead", async () => {
  await render();
  const sun = row(marketer.email);
  expect(sun.querySelector("select")).toBeNull();
  expect(sun.querySelector('[data-testid="team-roles"]')!.textContent).toBe("Marketing Lead");
  expect(row(active.email).querySelector('[data-testid="team-roles"]')!.textContent).toBe("Cashier");
  await change(sun);
  expect(select(sun, "Desk role").textContent).toBe("None");
  expect(select(sun, "Marketing role").textContent).toBe("Lead");
  expect(sun.querySelectorAll('[role="combobox"]')).toHaveLength(2);
  expect(row(owner.email).textContent).toContain("Owner");
  expect(row(owner.email).querySelector("select")).toBeNull();
  expect(host.textContent).not.toMatch(/Resend|Expire\b|Revoke|Manage\b/);
});

it("grants Marketing access from the row, through the unchanged Marketing mutation", async () => {
  await render();
  await change(row(active.email));
  await pick(select(row(active.email), "Marketing role"), "marketer");
  expect(mocks.calls).toEqual([["marketingAccess:setGrant", { email: active.email, role: "marketer" }]]);
  expect(host.querySelector('[role="status"]')!.textContent).toBe("Invited Mint to Marketing as Editor.");
  expect(mocks.confirm).not.toHaveBeenCalled();
});

it("asks before removing either role, and leaves the other alone", async () => {
  await render();
  mocks.confirm.mockResolvedValueOnce(false);
  await change(row(marketer.email));
  await pick(select(row(marketer.email), "Marketing role"), "");
  expect(mocks.calls).toEqual([]);
  await change(row(active.email));
  await pick(select(row(active.email), "Desk role"), "");
  expect(mocks.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Remove Mint from the desk?", cancelLabel: "Keep access", destructive: true }));
  expect(mocks.calls).toEqual([["staffAccess:setGrant", { email: active.email, role: null }]]);
});

it("keeps invite actions in ⋯, and shows Renew only when the invite has expired", async () => {
  await render();
  expect(buttonsIn(row(pending.email))).toEqual(["Change roles for Lek", "More for Lek"]);
  expect(buttonsIn(row(expired.email))).toEqual(["Renew", "Change roles for May"]);
  expect(buttonsIn(row(active.email))).toEqual(["Change roles for Mint"]);
  await act(async () => [...row(expired.email).querySelectorAll("button")][0].click());
  expect(mocks.calls).toEqual([["staffAccess:updateInvitation", { grantId: "grant-may", action: "resend" }]]);
  expect(host.querySelector('[role="status"]')!.textContent).toBe("Invite renewed for May.");
});

it("invites with a Desk role, a Marketing role, or both", async () => {
  await render();
  await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Invite")!.click());
  const form = host.querySelector<HTMLFormElement>('form[aria-label="Invite"]')!;
  const email = form.querySelector<HTMLInputElement>('input[type="email"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(email, "Fon@AuralisCove.co");
    email.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const [desk, marketing] = form.querySelectorAll<HTMLButtonElement>('[role="combobox"]');
  await pick(desk, "");
  await act(async () => form.requestSubmit());
  expect(form.querySelector('[role="alert"]')!.textContent).toBe("Pick a Desk or Marketing role.");
  await pick(desk, "manager");
  await pick(marketing, "viewer");
  await act(async () => form.requestSubmit());
  expect(mocks.calls).toEqual([
    ["staffAccess:setGrant", { email: "fon@auraliscove.co", role: "manager" }],
    ["marketingAccess:setGrant", { email: "fon@auraliscove.co", role: "viewer" }],
  ]);
});

it("signs desk invites in at /admin and Marketing-only invites at /admin/marketing", () => {
  expect(staffSignInLink("https://desk.example")).toBe("https://desk.example/admin");
  expect(marketingSignInLink("https://desk.example")).toBe("https://desk.example/admin/marketing");
});
