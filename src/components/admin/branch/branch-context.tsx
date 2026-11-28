"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { adminAccessRedirect } from "@/components/admin/admin-access";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { useStaffAccess } from "@/components/admin/staff-access";
import { hasDirtyUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { hasUnsavedChanges } from "@/lib/react/use-unsaved-changes";
import { usePathname, useRouter, useSearchParams } from "@/platform/navigation";
import {
  branchReadOnlyRoute,
  branchRouteScope,
  branchReturnHref,
  branchStorageKeys,
  branchSwitchHref,
  resolveWorkingBranch,
  type AdminBranchId,
  type AdminBranchOption,
  type AdminBranchScope,
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
  /** Branch-scoped pages remount when this changes. Company and till pages keep their state. */
  scopeKey: string;
  /** Checkout and receipts: no branch control, and the branch is never switched there. */
  readOnly: boolean;
  /** "company" on Settings and Marketing: the shell shows "Company" and never asks to choose. */
  scope: AdminBranchScope;
  /** A first-time person with two or more branches hasn't chosen yet (branch routes only). */
  needsChoice: boolean;
  /**
   * Set when working branch access ends mid-session.
   * `discarded`: a form had unsaved changes, which the move threw away.
   */
  revoked: { from: string | null; to: string | null; discarded: boolean } | null;
  dismissRevoked: () => void;
  /** After a switch closed a record: the branch to go back to (offered on the page it landed on). */
  returnTo: { name: string } | null;
  /** Switches back and reopens the record, through the same unsaved-changes and access checks. */
  returnToPrevious: () => Promise<boolean>;
  dismissReturn: () => void;
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
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const readOnly = branchReadOnlyRoute(pathname);
  const scope = branchRouteScope(pathname);
  const branches = access.branches;
  const keys = useMemo(() => branchStorageKeys(access.email), [access.email]);
  const [remembered, setRemembered] = useState<{ session: string | null; device: string | null }>(() =>
    typeof window === "undefined" ? { session: null, device: null } : { session: readStorage(session, keys.session), device: readStorage(local, keys.device) },
  );
  const [currentId, setCurrentId] = useState<AdminBranchId | null>(null);
  const [revoked, setRevoked] = useState<(NonNullable<AdminBranch["revoked"]> & { href: string | null }) | null>(null);
  // The branches as last seen, so a branch removed mid-session can still be named.
  const [seen, setSeen] = useState(branches);

  const working = resolveWorkingBranch(branches, { current: currentId, ...remembered });
  const resolvedId = working.kind === "selected" ? working.id : null;
  const switchable = scope === "branch" && !readOnly;
  const redirect = adminAccessRedirect(pathname, search.get("tab"), access);
  const lostLastDeskAssignment = working.kind === "none" && seen.length > 0 && access.role === null && access.capabilities.marketing;
  const revokedId = working.kind === "selected" ? working.revokedId : working.kind === "none" ? currentId : null;

  // Resolve the working preference before children render. Company and till pages keep their drafts.
  if (resolvedId !== currentId) setCurrentId(resolvedId);
  if (revokedId || lostLastDeskAssignment) {
    const from = seen.find((branch) => branch.id === revokedId)?.name ?? null;
    const to = switchable ? branches.find((branch) => branch.id === resolvedId)?.name ?? null : null;
    const discarded = (switchable || redirect !== null) && (hasDirtyUnsavedGuard() || hasUnsavedChanges());
    // If the shell redirects to a page the remaining grants allow, that already drops the URL.
    setRevoked({ from, to, discarded, href: redirect ? null : branchSwitchHref(pathname, search) });
  } else if (resolvedId !== null && currentId === null && revoked?.to === null) {
    setRevoked(null);
  }
  if (branchListKey(seen) !== branchListKey(branches)) setSeen(branches);

  // Read-only routes never ask: they show the first branch until the person picks one elsewhere.
  const provisional = working.kind === "choose" && readOnly;
  const currentBranch = resolvedId ? branches.find((branch) => branch.id === resolvedId) ?? null : provisional ? branches[0] : null;

  // This tab keeps its working branch; only an explicit choice becomes the device's default.
  useEffect(() => {
    if (resolvedId) writeStorage(session, keys.session, resolvedId);
  }, [resolvedId, keys]);

  const cleanedFor = useRef<AdminBranch["revoked"]>(null);
  useEffect(() => {
    if (!revoked || cleanedFor.current === revoked) return;
    cleanedFor.current = revoked;
    if (revoked.href) router.replace(revoked.href);
  }, [revoked, router]);

  // The assignment and route may change while a confirmation dialog is open.
  const selectionContext = useMemo(
    () => ({ branches, currentId, switchable, pathname, search, keys }),
    [branches, currentId, switchable, pathname, search, keys],
  );
  const latest = useRef<typeof selectionContext | null>(null);
  useLayoutEffect(() => {
    latest.current = selectionContext;
    return () => { latest.current = null; };
  }, [selectionContext]);

  // Keep the closed record on the landing page. A switch from a record route may render
  // once on the original pathname before the router reaches the list.
  const [previous, setPrevious] = useState<{
    id: AdminBranchId; href: string; landedOn: string; departingFrom?: string;
  } | null>(null);
  const previousBranch = previous ? branches.find((branch) => branch.id === previous.id) : undefined;
  if (previous) {
    if (!previousBranch || (pathname !== previous.landedOn && pathname !== previous.departingFrom)) {
      setPrevious(null);
    } else if (pathname === previous.landedOn && previous.departingFrom) {
      setPrevious({ ...previous, departingFrom: undefined });
    }
  }

  const select = useCallback(
    async (id: AdminBranchId) => {
      const target = branches.find((branch) => branch.id === id);
      if (!target || id === currentId || !switchable) return false;
      if (hasDirtyUnsavedGuard() || hasUnsavedChanges()) {
        const discard = await confirm({
          title: `Discard unsaved changes and switch to ${target.name}?`,
          description: `Your changes${currentBranch ? ` for ${currentBranch.name}` : ""} haven’t been saved. Switching also closes the open record and clears filters, search and selection.`,
          cancelLabel: "Stay here",
          confirmLabel: "Discard and switch",
          destructive: true,
        });
        if (!discard) return false;
        const live = latest.current;
        if (
          !live?.switchable || live.currentId !== currentId || live.pathname !== pathname ||
          live.search.toString() !== search.toString() || live.keys !== keys ||
          !live.branches.some((branch) => branch.id === id)
        ) return false;
      }
      // Keep a first-time Stock bookmark until its branch-aware view can check access.
      const firstStockChoice = !currentId && (pathname === "/admin/stock" || pathname.startsWith("/admin/stock/"));
      const href = firstStockChoice ? null : branchSwitchHref(pathname, search);
      const back = currentId ? branchReturnHref(pathname, search) : null;
      if (back && href && currentId) {
        const landedOn = href.split("?")[0];
        setPrevious({ id: currentId, href: back, landedOn, departingFrom: landedOn === pathname ? undefined : pathname });
      } else {
        setPrevious(null);
      }
      if (href) router.replace(href);
      setRevoked(null);
      setCurrentId(id);
      setRemembered({ session: id, device: id });
      writeStorage(session, keys.session, id);
      writeStorage(local, keys.device, id);
      return true;
    },
    [branches, currentBranch, currentId, switchable, confirm, keys, pathname, search, router],
  );

  const dismissRevoked = useCallback(() => setRevoked(null), []);
  const returnBranch = previous && pathname === previous.landedOn ? previousBranch : undefined;
  const returnToPrevious = useCallback(async () => {
    const target = previous;
    // Access is re-read from myAccess: a branch removed since the switch can't be restored.
    if (!target || !returnBranch) {
      setPrevious(null);
      return false;
    }
    if (!(await select(target.id))) return false;
    setPrevious(null);
    router.replace(target.href);
    return true;
  }, [previous, returnBranch, select, router]);
  const dismissReturn = useCallback(() => setPrevious(null), []);
  const value = useMemo<AdminBranch>(
    () => ({
      branches,
      current: currentBranch,
      select,
      scopeKey: switchable ? currentBranch?.id ?? "none" : readOnly ? "till" : scope,
      readOnly,
      scope,
      needsChoice: working.kind === "choose" && !readOnly && scope === "branch",
      revoked,
      dismissRevoked,
      returnTo: returnBranch && switchable ? { name: returnBranch.name } : null,
      returnToPrevious,
      dismissReturn,
    }),
    [branches, currentBranch, select, readOnly, scope, switchable, working.kind, revoked, dismissRevoked, returnBranch, returnToPrevious, dismissReturn],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

const NO_BRANCH: AdminBranch = {
  branches: [],
  current: null,
  select: async () => false,
  scopeKey: "none",
  readOnly: true,
  scope: "branch",
  needsChoice: false,
  revoked: null,
  dismissRevoked: () => {},
  returnTo: null,
  returnToPrevious: async () => false,
  dismissReturn: () => {},
};

/**
 * The admin's working branch. Later steps scope their queries with `current.id` and reset local
 * state on `scopeKey`. Outside the shell (isolated fixtures) there is no branch.
 */
export function useAdminBranch(): AdminBranch {
  return useContext(Context) ?? NO_BRANCH;
}
