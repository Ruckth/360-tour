import type { StaffAccessView } from "../admin-access";
import type { Tone } from "../status-tones";

/** A branch the signed-in person may work in, from `auth/staffAccess.myAccess`. */
export type AdminBranchOption = StaffAccessView["branches"][number];
export type AdminBranchId = AdminBranchOption["id"];
type Branch = Pick<AdminBranchOption, "id">;

/** The state pill beside a branch name. Active branches show none. */
export const BRANCH_STATE_PILLS: Partial<Record<AdminBranchOption["state"], { tone: Tone; label: string }>> = {
  setup: { tone: "warning", label: "Setup · hidden from guests" },
  suspended: { tone: "danger", label: "Suspended · no new sales" },
  archived: { tone: "muted", label: "Archived · read only" },
};

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
 * Checkout and receipts show the branch read-only: checkout follows the till (step 4) and a
 * receipt its order. They never switch it, and never ask a first-time person to choose.
 */
export function branchReadOnlyRoute(pathname: string): boolean {
  return /^\/admin\/(checkout|receipt)(\/|$)/.test(pathname);
}

/** Per-person storage keys: this tab's working branch, and the last one used on this device. */
export function branchStorageKeys(email: string | null) {
  const who = email ?? "anonymous";
  return { session: `admin:branch:${who}`, device: `admin:last-branch:${who}` };
}
