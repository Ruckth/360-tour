// @vitest-environment happy-dom
import type { Id } from "convex/_generated/dataModel";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  calls: [] as [string, unknown][],
  people: [] as unknown[],
  branches: [] as unknown[],
  confirm: vi.fn(),
  mutationError: null as Error | null,
}));
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      if (name === "auth/staffAccess:listPeople") return mocks.people;
      if (name === "branches/branches:list") return mocks.branches;
      if (name === "settings/cashierRules:getCashierRules") return { discountLimitPercent: 1000, voidPaidSale: "manager", customPrice: "manager", paymentFix: "manager", refund: "manager", revision: 0 };
      return undefined;
    },
    useMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      return async (args: unknown) => {
        mocks.calls.push([name, args]);
        if (mocks.mutationError) throw mocks.mutationError;
        return null;
      };
    },
  };
});
vi.mock("@/components/admin/ConfirmDialog", () => ({ useConfirm: () => mocks.confirm }));
import { TeamSettings, marketingSignInLink, staffSignInLink } from "@/components/admin/TeamSettings";

const now = Date.now();
const DAY = 86_400_000;
const samuiId = "branch-samui" as Id<"branches">;
const phuketId = "branch-phuket" as Id<"branches">;
const archivedId = "branch-huahin" as Id<"branches">;
const defaultIssuer = { legalName: "360 Tour Co., Ltd.", taxId: "0105560000000", branchCode: "00000", address: "Bophut, Koh Samui" };
const defaultBranches = [
  { _id: samuiId, _creationTime: now, key: "koh-samui", name: "Koh Samui", slug: "koh-samui", state: "active", issuer: defaultIssuer, stateChangedAt: now, stateChangedByEmail: "narin@auraliscove.co", revision: 1, createdAt: now, updatedAt: now },
  { _id: phuketId, _creationTime: now, key: "phuket", name: "Phuket", slug: "phuket", state: "setup", issuer: { ...defaultIssuer, branchCode: "00001" }, stateChangedAt: now, stateChangedByEmail: "narin@auraliscove.co", revision: 1, createdAt: now, updatedAt: now },
  { _id: archivedId, _creationTime: now, key: "hua-hin", name: "Hua Hin", slug: "hua-hin", state: "archived", issuer: { ...defaultIssuer, branchCode: "00002" }, stateChangedAt: now, stateChangedByEmail: "narin@auraliscove.co", revision: 1, createdAt: now, updatedAt: now },
];

const grant = (id: string, role: string, claimed: boolean, expired = false) => ({ id, role, claimed, expiresAt: claimed ? null : now + (expired ? -DAY : 12 * DAY), expired, updatedAt: now });
const pending = { email: "lek@auraliscove.co", role: "cashier", branchIds: [phuketId], staffGrant: grant("grant-lek", "cashier", false), marketingGrant: null };
const expired = { email: "may@auraliscove.co", role: "cashier", branchIds: [samuiId], staffGrant: grant("grant-may", "cashier", false, true), marketingGrant: null };
const active = { email: "mint@auraliscove.co", role: "cashier", branchIds: [samuiId], staffGrant: grant("grant-mint", "cashier", true), marketingGrant: null };
const dual = { email: "niran@auraliscove.co", role: "manager", branchIds: [samuiId, phuketId], staffGrant: grant("grant-niran", "manager", true), marketingGrant: null };
const marketer = { email: "sun@auraliscove.co", role: null, branchIds: [], staffGrant: null, marketingGrant: grant("mkt-sun", "manager", true) };
const owner = { email: "narin@auraliscove.co", role: "owner", branchIds: [], staffGrant: grant("grant-narin", "owner", true), marketingGrant: null };
const secondOwner = { email: "suda@auraliscove.co", role: "owner", branchIds: [], staffGrant: grant("grant-suda", "owner", true), marketingGrant: null };

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.calls = [];
  mocks.mutationError = null;
  mocks.confirm.mockReset().mockResolvedValue(true);
  mocks.branches = [...defaultBranches];
  mocks.people = [pending, expired, active, dual, marketer, owner, secondOwner];
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

const row = (email: string) => [...host.querySelectorAll<HTMLElement>('[data-testid="team-person"]')].find((li) => li.dataset.personEmail === email)!;
const buttonsIn = (el: HTMLElement) => [...el.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim());
const select = (el: HTMLElement, name: string) => el.querySelector<HTMLButtonElement>(`button[role="combobox"][aria-label^="${name}"]`)!;
const chipIn = (el: HTMLElement, branchName: string) => [...el.querySelectorAll<HTMLButtonElement>('button[role="checkbox"]')].find((b) => b.textContent?.includes(branchName));
const pick = async (node: HTMLButtonElement, value: string) => {
  await act(async () => { node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  const label = ({ marketer: "Editor", manager: "Manager", viewer: "Viewer", "": "None" } as Record<string, string>)[value];
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((el) => el.textContent === label || (value === "" && el.textContent?.startsWith("No desk")))!;
  await act(async () => { option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
};
const render = () => act(async () => root.render(createElement(TeamSettings)));
/** Roles show as text; Change opens the person's selects and branch chips. */
const change = (el: HTMLElement) => act(async () => el.querySelector<HTMLButtonElement>('button[aria-label^="Change roles for"]')!.click());

it("gives each person a Desk and a Marketing role, with branch chips and Marketing Manager shown as Lead", async () => {
  await render();
  const sun = row(marketer.email);
  expect(sun.querySelector("select")).toBeNull();
  expect(sun.querySelector('[data-testid="team-roles"]')!.textContent).toBe("Marketing Lead");
  expect(row(active.email).querySelector('[data-testid="team-roles"]')!.textContent).toBe("Cashier");
  expect(row(active.email).querySelector('[data-testid="person-branch-chips"]')!.textContent).toContain("Koh Samui");
  expect(row(dual.email).querySelector('[data-testid="person-branch-chips"]')!.textContent).toContain("Koh Samui");
  expect(row(dual.email).querySelector('[data-testid="person-branch-chips"]')!.textContent).toContain("Phuket");
  await change(sun);
  expect(select(sun, "Desk role").textContent).toBe("None");
  expect(select(sun, "Marketing role").textContent).toBe("Lead");
  expect(sun.querySelectorAll('[role="combobox"]')).toHaveLength(2);
  expect(host.textContent).not.toMatch(/Resend|Expire\b|Revoke|Manage\b/);
});

it("renders owner rows as read-only with deployment-admin copy and an Owners & recovery section", async () => {
  await render();
  const ownerRow = row(owner.email);
  expect(ownerRow.querySelector('[data-testid="team-roles"]')!.textContent).toBe("Owner · Company");
  expect(ownerRow.textContent).toContain("Managed by the deployment admin");
  expect(ownerRow.querySelectorAll("button")).toHaveLength(0);
  expect(ownerRow.querySelector("select")).toBeNull();

  const recoverySection = host.querySelector<HTMLElement>('[aria-label="Owners and recovery"]')!;
  expect(recoverySection).not.toBeNull();
  expect(recoverySection.textContent).toContain("2 company owners");
  expect(recoverySection.textContent).toContain(owner.email);
  expect(recoverySection.textContent).toContain(secondOwner.email);
  expect(recoverySection.textContent).toContain("Recovery is a command for the deployment admin");
  expect(recoverySection.textContent).toContain("no screen here");
  expect(recoverySection.querySelectorAll("button")).toHaveLength(0);
});

it("grants Marketing access from the row, through the unchanged Marketing mutation", async () => {
  await render();
  await change(row(active.email));
  await pick(select(row(active.email), "Marketing role"), "marketer");
  expect(mocks.calls).toEqual([["marketing/access:setGrant", { email: active.email, role: "marketer" }]]);
  expect(host.querySelector('[role="status"]')!.textContent).toBe("Invited Mint to Marketing as Editor.");
  expect(mocks.confirm).not.toHaveBeenCalled();
});

it("asks before removing either role with the consequence on every device, and leaves the other alone", async () => {
  await render();
  mocks.confirm.mockResolvedValueOnce(false);
  await change(row(marketer.email));
  await pick(select(row(marketer.email), "Marketing role"), "");
  expect(mocks.calls).toEqual([]);
  await change(row(active.email));
  await pick(select(row(active.email), "Desk role"), "");
  expect(mocks.confirm).toHaveBeenLastCalledWith(
    expect.objectContaining({
      title: "Remove Mint from the desk?",
      description: expect.stringContaining("Koh Samui"),
      cancelLabel: "Keep access",
      destructive: true,
    }),
  );
  const lastConfirm = mocks.confirm.mock.calls.at(-1)?.[0] as { description?: string };
  expect(lastConfirm.description).toContain("every device");
  expect(lastConfirm.description).toContain("within seconds");
  expect(mocks.calls).toEqual([["auth/staffAccess:setGrant", { email: active.email, role: null, branchIds: [] }]]);
});

it("keeps invite actions in ⋯, and shows Renew only when the invite has expired", async () => {
  await render();
  expect(buttonsIn(row(pending.email))).toEqual(["Change roles for Lek", "More for Lek"]);
  expect(buttonsIn(row(expired.email))).toEqual(["Change roles for May", "Renew invitation for May"]);
  expect(buttonsIn(row(active.email))).toEqual(["Change roles for Mint"]);
  await act(async () => row(expired.email).querySelector<HTMLButtonElement>('button[aria-label="Renew invitation for May"]')!.click());
  expect(mocks.calls).toEqual([["auth/staffAccess:updateInvitation", { grantId: "grant-may", action: "resend" }]]);
  expect(host.querySelector('[role="status"]')!.textContent).toBe("Invite renewed for May.");
});

it("validates branch multi-select in the invite form and excludes archived branches", async () => {
  await render();
  await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Invite")!.click());
  const form = host.querySelector<HTMLFormElement>('form[aria-label="Invite"]')!;
  const email = form.querySelector<HTMLInputElement>('input[type="email"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(email, "Fon@AuralisCove.co");
    email.dispatchEvent(new Event("input", { bubbles: true }));
  });

  // Archived branch is not selectable; active Koh Samui is preselected.
  expect(chipIn(form, "Hua Hin")).toBeUndefined();
  const samuiChip = chipIn(form, "Koh Samui")!;
  const phuketChip = chipIn(form, "Phuket")!;
  expect(samuiChip.getAttribute("aria-checked")).toBe("true");
  expect(phuketChip.getAttribute("aria-checked")).toBe("false");

  // Unchecking the only branch triggers validation and blocks submission.
  await act(async () => samuiChip.click());
  expect(samuiChip.getAttribute("aria-checked")).toBe("false");
  await act(async () => form.requestSubmit());
  expect(form.querySelector('[role="alert"]')!.textContent).toBe("Select at least one branch.");
  expect(mocks.calls).toEqual([]);

  // Selecting no roles at all shows role validation.
  const [desk, marketing] = form.querySelectorAll<HTMLButtonElement>('[role="combobox"]');
  await pick(desk, "");
  await act(async () => form.requestSubmit());
  expect(form.querySelector('[role="alert"]')!.textContent).toBe("Pick a Desk or Marketing role.");

  // Selecting Manager + Viewer + both non-archived branches submits both branchIds.
  await pick(desk, "manager");
  await pick(marketing, "viewer");
  await act(async () => chipIn(form, "Koh Samui")!.click());
  await act(async () => chipIn(form, "Phuket")!.click());
  await act(async () => form.requestSubmit());
  expect(mocks.calls).toEqual([
    ["auth/staffAccess:setGrant", { email: "fon@auraliscove.co", role: "manager", branchIds: [samuiId, phuketId] }],
    ["marketing/access:setGrant", { email: "fon@auraliscove.co", role: "viewer" }],
  ]);
});

it("validates branch removal in row edit and keeps existing assignment and invite expiry", async () => {
  await render();
  const lekRow = row(pending.email);
  await change(lekRow);

  // Archived branch isn't offered.
  expect(chipIn(lekRow, "Hua Hin")).toBeUndefined();

  // Removing the last assigned branch shows inline validation and makes no mutation call.
  await act(async () => chipIn(lekRow, "Phuket")!.click());
  expect(lekRow.querySelector('[role="alert"]')!.textContent).toBe("Select at least one branch.");
  expect(mocks.calls).toEqual([]);

  // Adding Koh Samui saves both branches and notes the invite still expires on the existing date.
  await act(async () => chipIn(lekRow, "Koh Samui")!.click());
  expect(mocks.calls).toEqual([
    ["auth/staffAccess:setGrant", { email: pending.email, role: "cashier", branchIds: [phuketId, samuiId] }],
  ]);
  expect(lekRow.querySelector('[role="status"]')!.textContent).toContain("still expires");

  // Changing role from Cashier to Manager preserves existing branchIds.
  mocks.calls = [];
  await pick(select(lekRow, "Desk role"), "manager");
  expect(mocks.calls).toEqual([
    ["auth/staffAccess:setGrant", { email: pending.email, role: "manager", branchIds: [phuketId] }],
  ]);
});

it("signs desk invites in at /admin and Marketing-only invites at /admin/marketing", () => {
  expect(staffSignInLink("https://desk.example")).toBe("https://desk.example/admin");
  expect(marketingSignInLink("https://desk.example")).toBe("https://desk.example/admin/marketing");
});
