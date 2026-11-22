// The Phase 4 PR carries two independently buildable commits: the audited, Preview-accepted
// Start-default checkpoint that still ships the Next entry, then the Start-only retirement. Once the PR
// merges, both are ordinary main history. The checkpoint was never the public production alias (the
// verified Stage 0 Next deployment stays production until the Phase 4 cutover). This module records the checkpoint SHA as the
// retired Next entry's final source; runtime callers never run git.
import { execFileSync } from "node:child_process";

/**
 * Full SHA of the dual-entry checkpoint: the first parent of the Start-only retirement commit.
 * Packaged value: the permanent checkpoint C of the Phase 4 PR (docs/architecture/phase4-cutover-runbook.md §7).
 * verifyCheckpointParent fails if the retirement commit's first parent is anything else.
 */
export const DUAL_ENTRY_CHECKPOINT_SHA = "93b08fd084679fba52431ab2abed0afabcc4abe2";

/** Retired paths whose deletion identifies the retirement commit. Both are deleted together, once. */
export const RETIRED_MARKERS = /** @type {const} */ (["src/app/layout.tsx", "next.config.ts"]);

/** @param {string} rootDir @param {string[]} args */
const git = (rootDir, args) => execFileSync("git", args, { cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/**
 * The commit that deleted every retired marker, searched through full history from `head` (both sides of
 * merge commits; a merge itself records no deletion). Exactly one such commit must exist.
 * @param {string} rootDir @param {string} [head]
 */
export function retirementCommit(rootDir, head = "HEAD") {
  const deleting = RETIRED_MARKERS.map((marker) => {
    const commits = git(rootDir, ["log", "--full-history", "--diff-filter=D", "--format=%H", head, "--", marker]).split("\n").filter(Boolean);
    if (commits.length !== 1) throw new Error(`Expected exactly one commit deleting ${marker} in ${head}'s history, found ${commits.length}`);
    return commits[0];
  });
  if (new Set(deleting).size !== 1) throw new Error(`The retired markers ${RETIRED_MARKERS.join(", ")} were deleted by different commits`);
  return deleting[0];
}

/**
 * Tooling and CI check: the stored SHA is the direct (first) parent of the Start-only retirement commit and
 * still ships both entries. A wrong SHA, a rebase of the PR, or a squash/rebase merge that drops the
 * checkpoint all fail; a merge commit that keeps both PR commits passes.
 * @param {string} rootDir @param {{ sha?: string, head?: string }} [options]
 */
export function verifyCheckpointParent(rootDir, { sha = DUAL_ENTRY_CHECKPOINT_SHA, head = "HEAD" } = {}) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("The dual-entry checkpoint must be a full 40-character commit SHA");
  const retirement = retirementCommit(rootDir, head);
  const parent = git(rootDir, ["rev-parse", `${retirement}^1`]);
  if (parent !== sha) {
    throw new Error(`DUAL_ENTRY_CHECKPOINT_SHA ${sha} is not the parent of retirement commit ${retirement}; set it to ${parent} if that commit is the accepted dual-entry checkpoint`);
  }
  const tree = git(rootDir, ["ls-tree", "-r", "--name-only", sha, "--", ...RETIRED_MARKERS, "vite.start.config.ts"]).split("\n");
  for (const file of [...RETIRED_MARKERS, "vite.start.config.ts"]) {
    if (!tree.includes(file)) throw new Error(`Checkpoint ${sha} lacks ${file}; it must ship both entries`);
  }
  return { retirement, checkpoint: parent };
}

/**
 * Tracked `src/app` files of the retired Next entry at the dual-entry checkpoint (tooling and CI only;
 * CI checks out full history). `DUAL_ENTRY_CHECKPOINT_REF` substitutes another dual-entry candidate for
 * an isolated rehearsal.
 * @param {string} rootDir
 * @param {Record<string, string | undefined>} [env]
 * @returns {string[]}
 */
export function archivedNextAppFiles(rootDir, env = process.env) {
  const ref = env.DUAL_ENTRY_CHECKPOINT_REF || DUAL_ENTRY_CHECKPOINT_SHA;
  let output;
  try {
    output = git(rootDir, ["ls-tree", "-r", "--name-only", `${ref}^{commit}`, "--", "src/app"]);
  } catch {
    throw new Error(`Dual-entry checkpoint ${ref} is not in this checkout's history; fetch full history (git fetch --unshallow)`);
  }
  const files = output.split("\n").filter(Boolean).sort();
  if (!files.length) throw new Error(`Dual-entry checkpoint ${ref} has no src/app tree; it must be a revision that ships both entries`);
  return files;
}
