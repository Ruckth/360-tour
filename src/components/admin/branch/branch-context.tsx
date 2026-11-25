"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { useStaffAccess } from "@/components/admin/staff-access";
import { hasDirtyUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { hasUnsavedChanges } from "@/lib/react/use-unsaved-changes";
import { usePathname } from "@/platform/navigation";
import {
  branchReadOnlyRoute,
  branchStorageKeys,
  resolveWorkingBranch,
  type AdminBranchId,
  type AdminBranchOption,
} from "./branch-selection";

export type AdminBranch = {
  /** The branches this person may work in (myAccess, archived excluded). */
  branches: readonly AdminBranchOption[];
  /** The working branch, or null when the person has none (company-only people, empty fixtures). */
  current: AdminBranchOption | null;
  /**
   * Switches the working branch. With unsaved changes it asks first (Stay here / Discard and
   * switch); resolves false when the person stays or the switch isn't allowed here.
   */
  select: (id: AdminBranchId) => Promise<boolean>;
  /** Changes on every switch. The shell remounts the page with it; key filters, selection and search on it. */
  scopeKey: string;
  /** Checkout and receipts: the branch is shown, never switched. */
  readOnly: boolean;
  /** A first-time person with two or more branches hasn't chosen yet (list routes only). */
  needsChoice: boolean;
  /** Set when the working branch was removed mid-session and the shell moved to another. */
  revoked: { from: string; to: string } | null;
  dismissRevoked: () => void;
};

const Context = createContext<AdminBranch | null>(null);

function readStorage(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(storage: () => Storage, key: string, value: string) {
  try {
    storage().setItem(key, value);
  } catch {
    // Private mode or a full quota: the choice lasts for this page only.
  }
}

const session = () => window.sessionStorage;
const branchListKey = (list: readonly AdminBranchOption[]) => list.map((branch) => `${branch.id}:${branch.name}`).join("|");
const local = () => window.localStorage;

/**
 * The working branch for this tab: kept in sessionStorage, seeded from the last branch used on
 * this device (localStorage), and always checked against `myAccess.branches`.
 */
export function AdminBranchProvider({ children }: { children: ReactNode }) {
  const access = useStaffAccess();
  const confirm = useConfirm();
  const readOnly = branchReadOnlyRoute(usePathname());
  const branches = access.branches;
  const keys = useMemo(() => branchStorageKeys(access.email), [access.email]);
  const [remembered] = useState(() =>
    typeof window === "undefined" ? { session: null, device: null } : { session: readStorage(session, keys.session), device: readStorage(local, keys.device) },
  );
  const [currentId, setCurrentId] = useState<AdminBranchId | null>(null);
  const [revoked, setRevoked] = useState<AdminBranch["revoked"]>(null);
  // The branches as last seen, so a branch removed mid-session can still be named.
  const [seen, setSeen] = useState(branches);

  const working = resolveWorkingBranch(branches, { current: currentId, ...remembered });
  const resolvedId = working.kind === "selected" ? working.id : null;
  // Adopt a restored, single or replacement branch while rendering, not in an effect.
  if (resolvedId !== null && resolvedId !== currentId) {
    setCurrentId(resolvedId);
    if (working.kind === "selected" && working.revokedId) {
      const from = seen.find((branch) => branch.id === working.revokedId)?.name ?? "a branch";
      setRevoked({ from, to: branches.find((branch) => branch.id === resolvedId)?.name ?? "" });
    }
  }
  if (branchListKey(seen) !== branchListKey(branches)) setSeen(branches);

  // Read-only routes never ask: they show the first branch until the person picks one elsewhere.
  const provisional = working.kind === "choose" && readOnly;
  const currentBranch = resolvedId ? branches.find((branch) => branch.id === resolvedId) ?? null : provisional ? branches[0] : null;

  // This tab keeps its working branch; only an explicit choice becomes the device's default.
  useEffect(() => {
    if (resolvedId) writeStorage(session, keys.session, resolvedId);
  }, [resolvedId, keys]);

  const select = useCallback(
    async (id: AdminBranchId) => {
      const target = branches.find((branch) => branch.id === id);
      // Checkout and receipts never switch the branch.
      if (!target || id === currentBranch?.id || readOnly) return false;
      if (hasDirtyUnsavedGuard() || hasUnsavedChanges()) {
        const discard = await confirm({
          title: `Discard unsaved changes and switch to ${target.name}?`,
          description: `Your changes${currentBranch ? ` for ${currentBranch.name}` : ""} haven’t been saved. Switching also clears filters, search and selection.`,
          cancelLabel: "Stay here",
          confirmLabel: "Discard and switch",
          destructive: true,
        });
        if (!discard) return false;
      }
      setRevoked(null);
      setCurrentId(id);
      writeStorage(session, keys.session, id);
      writeStorage(local, keys.device, id);
      return true;
    },
    [branches, currentBranch, readOnly, confirm, keys],
  );

  const dismissRevoked = useCallback(() => setRevoked(null), []);
  const value = useMemo<AdminBranch>(
    () => ({
      branches,
      current: currentBranch,
      select,
      scopeKey: currentBranch?.id ?? "none",
      readOnly,
      needsChoice: working.kind === "choose" && !readOnly,
      revoked,
      dismissRevoked,
    }),
    [branches, currentBranch, select, readOnly, working.kind, revoked, dismissRevoked],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

const NO_BRANCH: AdminBranch = {
  branches: [],
  current: null,
  select: async () => false,
  scopeKey: "none",
  readOnly: true,
  needsChoice: false,
  revoked: null,
  dismissRevoked: () => {},
};

/**
 * The admin's working branch. Later steps scope their queries with `current.id` and reset local
 * state on `scopeKey`. Outside the shell (isolated fixtures) there is no branch.
 */
export function useAdminBranch(): AdminBranch {
  return useContext(Context) ?? NO_BRANCH;
}
