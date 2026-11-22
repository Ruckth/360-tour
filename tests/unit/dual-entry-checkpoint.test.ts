import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DUAL_ENTRY_CHECKPOINT_SHA, archivedNextAppFiles, retirementCommit, verifyCheckpointParent } from "../../scripts/dual-entry-checkpoint.mjs";

const repos: string[] = [];
afterEach(() => { for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true }); });

/**
 * main ships both entries; the PR branch adds a checkpoint change, an intermediate dual-entry commit (as in the
 * draft), the retirement deleting src/app and next.config.ts, and a later ordinary change.
 */
function repository() {
  const dir = mkdtempSync(path.join(tmpdir(), "dual-entry-"));
  repos.push(dir);
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "-c", "init.defaultBranch=main", ...args], { cwd: dir, encoding: "utf8" }).trim();
  const write = (file: string, text = `${file}\n`) => { mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); writeFileSync(path.join(dir, file), text); };
  const commit = (message: string) => { git("add", "-A"); git("commit", "-qm", message); return git("rev-parse", "HEAD"); };
  git("init", "-q");
  for (const file of ["src/app/layout.tsx", "src/app/rooms/page.tsx", "next.config.ts", "vite.start.config.ts"]) write(file);
  commit("dual entry");
  git("checkout", "-qb", "pr");
  write("notes.md", "checkpoint\n");
  const checkpoint = commit("checkpoint");
  write("src/components/moved.tsx");
  const intermediate = commit("move shared modules, still dual entry");
  git("rm", "-rq", "src/app", "next.config.ts");
  const retirement = commit("retire next");
  write("later.ts");
  commit("later ordinary change");
  return { dir, git, write, commit, checkpoint, intermediate, retirement };
}

describe("dual-entry checkpoint anchor", () => {
  it("records a full SHA with no git at runtime", () => {
    expect(DUAL_ENTRY_CHECKPOINT_SHA).toMatch(/^[0-9a-f]{40}$/);
    expect(readFileSync(path.resolve("scripts/frontend-target.mjs"), "utf8")).not.toMatch(/child_process|archivedNextAppFiles|verifyCheckpointParent/);
  });

  // The objective check on this repository (CI fetches full history).
  it("is the direct parent of this repository's Start-only retirement commit", () => {
    expect(verifyCheckpointParent(process.cwd()).checkpoint).toBe(DUAL_ENTRY_CHECKPOINT_SHA);
  });

  it("accepts the retirement's direct parent through intermediate commits, later changes and a merge commit", () => {
    const { dir, git, write, commit, checkpoint, intermediate, retirement } = repository();
    expect(retirementCommit(dir)).toBe(retirement);
    expect(verifyCheckpointParent(dir, { sha: intermediate })).toEqual({ retirement, checkpoint: intermediate });
    expect(() => verifyCheckpointParent(dir, { sha: checkpoint })).toThrow(`set it to ${intermediate}`);
    git("checkout", "-q", "main");
    write("main.ts");
    commit("ordinary main change");
    git("merge", "-q", "--no-ff", "-m", "Merge the Phase 4 PR", "pr");
    write("after.ts");
    commit("after merge");
    expect(verifyCheckpointParent(dir, { sha: intermediate }).retirement).toBe(retirement);
  });

  it("fails for a wrong 40-hex SHA, a rebased PR, a squash merge and a second deletion", () => {
    const { dir, git, write, commit, intermediate } = repository();
    expect(() => verifyCheckpointParent(dir, { sha: "f".repeat(40) })).toThrow("is not the parent");
    expect(() => verifyCheckpointParent(dir, { sha: "abc123" })).toThrow("full 40-character");

    git("checkout", "-qb", "rebased", intermediate);
    git("commit", "-q", "--amend", "-m", "move shared modules (rebased)");
    git("rm", "-rq", "src/app", "next.config.ts");
    commit("retire next");
    expect(() => verifyCheckpointParent(dir, { sha: intermediate })).toThrow("is not the parent");

    git("checkout", "-q", "main");
    git("merge", "-q", "--squash", "pr");
    commit("squashed Phase 4 PR");
    expect(() => verifyCheckpointParent(dir, { sha: intermediate })).toThrow("is not the parent");

    write("src/app/layout.tsx");
    write("next.config.ts");
    commit("restore");
    git("rm", "-q", "src/app/layout.tsx", "next.config.ts");
    commit("delete again");
    expect(() => verifyCheckpointParent(dir, { sha: intermediate })).toThrow("exactly one commit deleting");
  });

  it("reads the retired src/app tree from the recorded commit and refuses a Start-only revision", () => {
    const { dir, checkpoint, retirement } = repository();
    expect(archivedNextAppFiles(dir, { DUAL_ENTRY_CHECKPOINT_REF: checkpoint })).toEqual(["src/app/layout.tsx", "src/app/rooms/page.tsx"]);
    expect(() => archivedNextAppFiles(dir, {})).toThrow(`Dual-entry checkpoint ${DUAL_ENTRY_CHECKPOINT_SHA} is not in this checkout's history`);
    expect(() => archivedNextAppFiles(dir, { DUAL_ENTRY_CHECKPOINT_REF: retirement })).toThrow("has no src/app tree");
  });
});
