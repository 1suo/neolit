import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { patchPaths } from "../augment/state.js";
import type { PlannedDiff } from "../augment/types.js";

/**
 * Host-side apply transaction for drafted patches: preflights every selected
 * patch together with `git apply --check`, then applies them as one unit, so a
 * conflict anywhere leaves the working tree untouched. Only the working tree
 * changes; nothing is staged or committed.
 */
export function preflightPatches(directory: string, patches: string[]): string | undefined {
  const nonEmpty = patches.filter((patch) => patch.trim().length > 0);
  if (!nonEmpty.length) return undefined;
  const staging = mkdtempSync(path.join(tmpdir(), "augment-preflight-"));
  const worktree = path.join(staging, "wt");
  try {
    const files = nonEmpty.map((patch, index) => {
      const file = path.join(staging, `patch-${index}.diff`);
      writeFileSync(file, patch.endsWith("\n") ? patch : `${patch}\n`, "utf8");
      return file;
    });
    try {
      // git cannot compose several patches for one file in a single call, so
      // verification applies the patches sequentially inside a throwaway
      // worktree — exactly how the real apply will run, order included.
      git(directory, ["worktree", "add", "--detach", "--quiet", worktree]);
      mirrorPatchedPaths(directory, worktree, nonEmpty);
      for (const file of files) git(worktree, ["apply", "--whitespace=nowarn", file]);
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  } finally {
    try {
      git(directory, ["worktree", "remove", "--force", worktree]);
    } catch {
      // the worktree may never have been created
    }
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * Drafts are generated from the CURRENT working tree — the file content the
 * one-shot prompt embeds and the tool-session agent reads — but
 * `git worktree add` checks out HEAD, which silently drops uncommitted edits,
 * untracked files, and working-tree deletions. Without mirroring, every draft
 * against a dirty target fails verification here while applying cleanly for
 * real, and no retry can fix it. Copy each touched path's live bytes in (or
 * remove it when the working tree no longer has it) so verification and the
 * eventual apply see identical content.
 */
function mirrorPatchedPaths(directory: string, worktree: string, patches: string[]): void {
  const targets = new Set(patches.flatMap((patch) => patchPaths(patch)));
  for (const target of targets) {
    if (!target || target.includes("..") || path.isAbsolute(target)) continue;
    const source = path.join(directory, target);
    const destination = path.join(worktree, target);
    let live = false;
    try {
      live = statSync(source).isFile();
    } catch {
      live = false;
    }
    if (live) {
      mkdirSync(path.dirname(destination), { recursive: true });
      copyFileSync(source, destination);
    } else {
      rmSync(destination, { force: true });
    }
  }
}

export function applyPlannedDiffs(directory: string, diffs: PlannedDiff[]): string[] {
  const patches = diffs.filter((diff) => diff.patch.trim().length > 0);
  if (!patches.length) throw new Error("The selected path has no drafted patch content. Press D to draft it first.");
  const failure = preflightPatches(directory, patches.map((diff) => diff.patch));
  if (failure) throw new Error(failure);
  const staging = mkdtempSync(path.join(tmpdir(), "augment-apply-"));
  try {
    const files = patches.map((diff, index) => {
      const file = path.join(staging, `patch-${index}.diff`);
      writeFileSync(file, diff.patch.endsWith("\n") ? diff.patch : `${diff.patch}\n`, "utf8");
      return file;
    });
    for (const file of files) git(directory, ["apply", "--whitespace=nowarn", file]);
    return patches.map((diff) => diff.path || diff.id);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * Commits exactly the session-applied paths: -A stages their deletions and
 * additions, and the commit pathspec keeps unrelated staged or dirty files
 * out of the commit.
 */
export function commitAppliedPaths(directory: string, paths: string[], message: string): string {
  const unique = [...new Set(paths.filter((path) => path && path !== "."))];
  if (!unique.length) throw new Error("Nothing applied this session to commit.");
  git(directory, ["add", "-A", "--", ...unique]);
  git(directory, ["commit", "-m", message, "--", ...unique]);
  return git(directory, ["rev-parse", "--short", "HEAD"]).trim();
}

function git(directory: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", directory, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const stderr = error && typeof error === "object" && typeof (error as { stderr?: unknown }).stderr === "string"
      ? (error as { stderr: string }).stderr.trim()
      : "";
    const fallback = error instanceof Error ? error.message : String(error);
    throw new Error(`git ${args.join(" ")} failed: ${stderr || fallback}`);
  }
}
