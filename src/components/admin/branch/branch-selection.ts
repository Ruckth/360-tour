import type { StaffAccessView } from "../admin-access";

/** A branch the signed-in person may work in, from `auth/staffAccess.myAccess`. */
export type AdminBranchOption = StaffAccessView["branches"][number];
export type AdminBranchId = AdminBranchOption["id"];
type Branch = Pick<AdminBranchOption, "id">;

/**
 * The working branch, from what this tab and this device remember. A remembered id counts only
 * while it is still in `branches`, so a stored preference never grants access.
 *
 * - `current`: the branch this tab was already working in. If it has gone (access removed), the
 *   person moves to their last branch on this device, else the first remaining one, and
 *   `revokedId` names the branch they lost.
 * - `session` (this tab), then `device` (last used on this device), then the only branch.
 * - Two or more branches and nothing valid remembered: the person chooses.
 */
export type WorkingBranch =
  | { kind: "none" }
  | { kind: "choose" }
  | { kind: "selected"; id: AdminBranchId; revokedId?: AdminBranchId };

export function resolveWorkingBranch(
  branches: readonly Branch[],
  remembered: { current?: string | null; session?: string | null; device?: string | null },
): WorkingBranch {
  if (!branches.length) return { kind: "none" };
  const find = (id: string | null | undefined) => (id ? branches.find((branch) => branch.id === id)?.id : undefined);
  const current = find(remembered.current);
  if (current) return { kind: "selected", id: current };
  const device = find(remembered.device);
  if (remembered.current) {
    return { kind: "selected", id: device ?? branches[0].id, revokedId: remembered.current as AdminBranchId };
  }
  const chosen = find(remembered.session) ?? device ?? (branches.length === 1 ? branches[0].id : undefined);
  return chosen ? { kind: "selected", id: chosen } : { kind: "choose" };
}

/**
 * Checkout and receipts show no branch control: checkout sells for the till's branch (step 4) and
 * a receipt belongs to its order. They never switch it, and never ask a first-time person to choose.
 */
export function branchReadOnlyRoute(pathname: string): boolean {
  return /^\/admin\/(checkout|receipt)(\/|$)/.test(pathname);
}

/**
 * Whose data a route shows. Settings and Marketing are company-wide: they show "Company" instead
 * of the working branch and never ask a first-time person to choose. Every other route is a branch's.
 */
export type AdminBranchScope = "company" | "branch";

export function branchRouteScope(pathname: string): AdminBranchScope {
  return /^\/admin\/(settings|marketing)(\/|$)/.test(pathname) ? "company" : "branch";
}

/** URL parameters that survive a branch switch; the rest (open record, search, filters) belong to the old branch. */
const SWITCH_KEPT_PARAMS = ["tab"] as const;

/**
 * The same page without the old branch's URL state, or null when nothing needs dropping. A switch
 * replaces the URL with it, so `?session=`, `?q=` or a `?booking=` from the old branch never loads.
 */
export function branchSwitchHref(pathname: string, search: URLSearchParams): string | null {
  if (branchReadOnlyRoute(pathname) || branchRouteScope(pathname) === "company") return null;
  const destination = /^\/admin\/properties\/[^/]+\/?$/.test(pathname) ? "/admin/properties" : pathname;
  const kept = new URLSearchParams();
  for (const key of SWITCH_KEPT_PARAMS) {
    const value = search.get(key);
    if (value !== null) kept.set(key, value);
  }
  if (destination === pathname && kept.toString() === search.toString()) return null;
  const query = kept.toString();
  return query ? `${destination}?${query}` : destination;
}

/** Per-person storage keys: this tab's working branch, and the last one used on this device. */
export function branchStorageKeys(email: string | null) {
  const who = email ?? "anonymous";
  return { session: `admin:branch:${who}`, device: `admin:last-branch:${who}` };
}
