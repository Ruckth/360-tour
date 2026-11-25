// @vitest-environment happy-dom
import type { Id } from "convex/_generated/dataModel";
import { ConvexError } from "convex/values";
import { mergeSiteSettings } from "convex/shared/siteSettings";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { staffAccessFor } from "./admin-shell-convex";

const mocks = vi.hoisted(() => ({
  calls: [] as [string, unknown][],
  branches: [] as unknown[],
  tab: "branches",
  replace: vi.fn(),
  mutationError: null as unknown,
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      if (name === "branches/branches:list") return mocks.branches;
      if (name === "settings/settings:get") return { ...mergeSiteSettings(null), revision: 1 };
      return undefined;
    },
    useMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      return async (args: unknown) => {
        mocks.calls.push([name, args]);
        if (mocks.mutationError) throw mocks.mutationError;
        return { revision: 2 };
      };
    },
  };
});
vi.mock("@/platform/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(mocks.tab ? `tab=${mocks.tab}` : ""),
}));
vi.mock("@/components/admin/SetupChecklist", () => ({ SetupChecklistCard: () => null }));

import { AdminSettingsView } from "@/components/admin/AdminSettingsView";
import { BranchesSettings } from "@/components/admin/branches/BranchesSettings";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { StaffAccessProvider } from "@/components/admin/staff-access";

const now = Date.parse("2026-12-01T08:00:00Z");
const issuer = (branchCode: string, address: string) => ({
  legalName: "360 Tour Co., Ltd.",
  taxId: "0105560000000",
  branchCode,
  address,
});

const samui = {
  _id: "branch-samui" as Id<"branches">,
  _creationTime: now,
  key: "koh-samui",
  name: "Koh Samui",
  slug: "koh-samui",
  state: "active" as const,
  issuer: issuer("00000", "88/8 Moo 3, Bophut, Koh Samui 84320"),
  stateChangedAt: now,
  stateChangedByEmail: "arun@360tour.co.th",
  revision: 3,
  createdAt: now,
  updatedAt: now,
};
const phuket = {
  _id: "branch-phuket" as Id<"branches">,
  _creationTime: now + 1000,
  key: "phuket",
  name: "Phuket",
  slug: "phuket",
  state: "setup" as const,
  issuer: issuer("00001", "88 Rawai Rd, Phuket 83130"),
  stateChangedAt: now + 1000,
  stateChangedByEmail: "arun@360tour.co.th",
  revision: 1,
  createdAt: now + 1000,
  updatedAt: now + 1000,
};
const krabi = {
  _id: "branch-krabi" as Id<"branches">,
  _creationTime: now + 2000,
  key: "krabi",
  name: "Krabi",
  slug: "krabi",
  state: "suspended" as const,
  stateReason: "Monsoon closure, reopen in March",
  issuer: issuer("00002", "12 Ao Nang, Krabi 81180"),
  stateChangedAt: now + 2000,
  stateChangedByEmail: "arun@360tour.co.th",
  revision: 2,
  createdAt: now + 2000,
  updatedAt: now + 2000,
};
const huaHin = {
  _id: "branch-huahin" as Id<"branches">,
  _creationTime: now + 3000,
  key: "hua-hin",
  name: "Hua Hin",
  slug: "hua-hin",
  state: "archived" as const,
  issuer: issuer("00003", "5 Phetkasem Rd, Hua Hin 77110"),
  stateChangedAt: now + 3000,
  stateChangedByEmail: "arun@360tour.co.th",
  revision: 4,
  createdAt: now + 3000,
  updatedAt: now + 3000,
};

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.calls = [];
  mocks.mutationError = null;
  mocks.tab = "branches";
  mocks.replace.mockReset();
  mocks.branches = [samui, phuket, krabi, huaHin];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const renderBranches = () => act(async () => root.render(createElement(BranchesSettings)));
const cardFor = (key: string) => host.querySelector<HTMLElement>(`[data-testid="branch-card"][data-branch-key="${key}"]`)!;
const setInputValue = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("Settings › Branches", () => {
  it("renders every branch state with the expected pill copy, tones, and read-only archived treatment", async () => {
    await renderBranches();

    const activeCard = cardFor("koh-samui");
    expect(activeCard.textContent).toContain("Koh Samui");
    expect(activeCard.textContent).toContain("Active");
    expect(activeCard.textContent).toContain("360 Tour Co., Ltd.");
    expect(activeCard.textContent).toContain("00000");

    const setupCard = cardFor("phuket");
    expect(setupCard.textContent).toContain("Setup · hidden from guests");
    expect(setupCard.innerHTML).toContain("amber");

    const suspendedCard = cardFor("krabi");
    expect(suspendedCard.textContent).toContain("Suspended · no new sales");
    expect(suspendedCard.textContent).toContain("Monsoon closure, reopen in March");
    expect(suspendedCard.innerHTML).toContain("red");

    const archivedCard = cardFor("hua-hin");
    expect(archivedCard.textContent).toContain("Archived · read only");
    expect(archivedCard.textContent).toContain("Archived branches are read-only.");
    expect(archivedCard.querySelectorAll("button")).toHaveLength(0);
  });

  it("keeps Archive disabled while Active and explains why", async () => {
    await renderBranches();
    const activeCard = cardFor("koh-samui");
    const archiveButton = activeCard.querySelector<HTMLButtonElement>('button[aria-label="Archive Koh Samui"]')!;
    expect(archiveButton.disabled).toBe(true);
    expect(activeCard.textContent).toContain("Suspend this branch before archiving it.");
    const hintId = archiveButton.getAttribute("aria-describedby")!;
    expect(document.getElementById(hintId)?.textContent).toContain("Suspend this branch before archiving it.");

    // Setup and Suspended branches can open the Archive dialog.
    const setupArchive = cardFor("phuket").querySelector<HTMLButtonElement>('button[aria-label="Archive Phuket"]')!;
    expect(setupArchive.disabled).toBe(false);
    await act(async () => setupArchive.click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Archive Phuket?");
    const submit = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Archive Phuket")!;
    await act(async () => submit.click());
    expect(mocks.calls).toEqual([["branches/branches:setState", { branchId: phuket._id, revision: phuket.revision, state: "archived" }]]);
  });

  it("requires a reason before suspending an Active branch and shows what stops and continues", async () => {
    await renderBranches();
    await act(async () => cardFor("koh-samui").querySelector<HTMLButtonElement>('button[aria-label="Suspend Koh Samui"]')!.click());

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Suspend Koh Samui?");
    expect(dialog.textContent).toContain("Stops now");
    expect(dialog.textContent).toContain("Continues");

    const form = dialog.querySelector<HTMLFormElement>("form")!;
    await act(async () => form.requestSubmit());
    expect(dialog.querySelector('[role="alert"]')!.textContent).toBe("Enter a reason for suspending this branch.");
    expect(mocks.calls).toEqual([]);

    const textarea = dialog.querySelector<HTMLTextAreaElement>("textarea")!;
    await setInputValue(textarea, "Scheduled maintenance closure");
    await act(async () => form.requestSubmit());
    expect(mocks.calls).toEqual([
      ["branches/branches:setState", { branchId: samui._id, revision: samui.revision, state: "suspended", reason: "Scheduled maintenance closure" }],
    ]);
  });

  it("activates a branch from Setup or Suspended via confirm dialog", async () => {
    await renderBranches();
    await act(async () => cardFor("phuket").querySelector<HTMLButtonElement>('button[aria-label="Activate Phuket"]')!.click());
    let dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Activate Phuket?");
    await act(async () => dialog.querySelector<HTMLFormElement>("form")!.requestSubmit());
    expect(mocks.calls).toEqual([["branches/branches:setState", { branchId: phuket._id, revision: phuket.revision, state: "active" }]]);

    mocks.calls = [];
    await act(async () => cardFor("krabi").querySelector<HTMLButtonElement>('button[aria-label="Activate Krabi"]')!.click());
    dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Activate Krabi?");
    await act(async () => dialog.querySelector<HTMLFormElement>("form")!.requestSubmit());
    expect(mocks.calls).toEqual([["branches/branches:setState", { branchId: krabi._id, revision: krabi.revision, state: "active" }]]);
  });

  it("creates a new branch in Setup and validates issuer fields", async () => {
    await renderBranches();
    const addBtn = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("Add branch"))!;
    await act(async () => addBtn.click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const form = dialog.querySelector<HTMLFormElement>("form")!;
    const inputs = [...dialog.querySelectorAll<HTMLInputElement>("input")];
    const [nameInput, keyInput, slugInput, legalInput, taxInput, codeInput, addressInput] = inputs;

    await setInputValue(nameInput, "Chiang Mai");
    expect(keyInput.value).toBe("chiang-mai");
    expect(slugInput.value).toBe("chiang-mai");
    await setInputValue(legalInput, "360 Tour Co., Ltd.");
    await setInputValue(taxInput, "0105560000000");
    await setInputValue(codeInput, "123");
    await setInputValue(addressInput, "10 Nimman Rd, Chiang Mai 50200");

    await act(async () => form.requestSubmit());
    expect(dialog.querySelector('[role="alert"]')!.textContent).toBe("Enter a five-digit issuer branch code.");
    expect(mocks.calls).toEqual([]);

    await setInputValue(codeInput, "00004");
    await act(async () => form.requestSubmit());
    expect(mocks.calls).toEqual([
      [
        "branches/branches:create",
        {
          key: "chiang-mai",
          name: "Chiang Mai",
          slug: "chiang-mai",
          issuer: {
            legalName: "360 Tour Co., Ltd.",
            taxId: "0105560000000",
            branchCode: "00004",
            address: "10 Nimman Rd, Chiang Mai 50200",
          },
        },
      ],
    ]);
  });

  it("passes row revision when editing profile and shows a reload hint on stale revision conflict", async () => {
    await renderBranches();
    await act(async () => cardFor("koh-samui").querySelector<HTMLButtonElement>('button[aria-label="Edit profile for Koh Samui"]')!.click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    // Key is read-only during edit.
    expect(dialog.textContent).toContain("koh-samui");
    expect(dialog.querySelector('input[placeholder="phuket"]')).not.toBeNull();
    expect(dialog.querySelectorAll("input")).toHaveLength(6);

    mocks.mutationError = new ConvexError("This branch changed. Reload it and try again.");
    await act(async () => dialog.querySelector<HTMLFormElement>("form")!.requestSubmit());
    expect(mocks.calls).toEqual([
      [
        "branches/branches:update",
        {
          branchId: samui._id,
          revision: 3,
          name: "Koh Samui",
          slug: "koh-samui",
          issuer: samui.issuer,
        },
      ],
    ]);
    expect(dialog.querySelector('[role="alert"]')!.textContent).toContain("This branch changed. Reload it and try again.");
    expect(dialog.textContent).toContain("Reload latest");
  });

  it("shows the Branches tab only to owners in AdminSettingsView", async () => {
    await act(async () =>
      root.render(
        createElement(
          ConfirmProvider,
          null,
          createElement(
            StaffAccessProvider,
            { access: staffAccessFor("owner", "arun@360tour.co.th") },
            createElement(AdminSettingsView),
          ),
        ),
      ),
    );
    const ownerTabs = [...host.querySelectorAll('[role="tab"]')].map((el) => el.textContent?.trim());
    expect(ownerTabs).toContain("Branches");
    expect(ownerTabs).toContain("Team");
    expect(host.querySelector('[aria-label="Branches"]')).not.toBeNull();

    await act(async () =>
      root.render(
        createElement(
          ConfirmProvider,
          null,
          createElement(
            StaffAccessProvider,
            { access: staffAccessFor("manager", "niran@360tour.co.th") },
            createElement(AdminSettingsView),
          ),
        ),
      ),
    );
    const managerTabs = [...host.querySelectorAll('[role="tab"]')].map((el) => el.textContent?.trim());
    expect(managerTabs).not.toContain("Branches");
    expect(managerTabs).not.toContain("Team");
    expect(host.querySelector('[aria-label="Branches"]')).toBeNull();
  });
});
