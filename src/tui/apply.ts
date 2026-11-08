import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, rmdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
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
function safePatchPaths(directory: string, patches: string[]): string[] {
  const root = path.resolve(directory);
  const targets = [...new Set(patches.flatMap((patch) => patchPaths(patch)))].sort();
  for (const target of targets) {
    if (!target || target.split("/").includes("..") || path.isAbsolute(target)) throw new Error("Unsafe patch path: " + target);
    const absolute = path.resolve(root, target);
    const relative = path.relative(root, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Patch path escapes repository: " + target);
    const components = target.split("/");
    let parent = root;
    let missingParent = false;
    for (const component of components.slice(0, -1)) {
      parent = path.join(parent, component);
      if (missingParent) continue;
      try {
        const stat = lstatSync(parent);
        if (stat.isSymbolicLink()) throw new Error("Patch path traverses a symlink directory: " + target);
        if (!stat.isDirectory()) throw new Error("Patch parent is not a directory: " + parent);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") missingParent = true;
        else throw error;
      }
    }
    try {
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error("Patch target is a symlink: " + target);
      if (!stat.isFile()) throw new Error("Patch target is not a regular file: " + target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return targets;
}

export function preflightPatches(directory: string, patches: string[]): string | undefined {
  const nonEmpty = patches.filter((patch) => patch.trim().length > 0);
  if (!nonEmpty.length) return undefined;
  try { safePatchPaths(directory, nonEmpty); }
  catch (error) { return error instanceof Error ? error.message : String(error); }
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
    if (!target || target.split("/").includes("..") || path.isAbsolute(target)) continue;
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

export interface PatchApplyTransaction {
  paths: string[];
  rollback(): void;
}

type FileSnapshot =
  | { kind: "missing" }
  | { kind: "file"; bytes: Buffer; mode: number }
  | { kind: "symlink"; target: string };

/** Apply a group of diffs with rollback if git or subsequent core persistence fails. */
export function applyPlannedDiffsTransaction(directory: string, diffs: PlannedDiff[]): PatchApplyTransaction {
  const patches = diffs.filter((diff) => diff.patch.trim().length > 0);
  if (!patches.length) throw new Error("The selected path has no drafted patch content. Press D to draft it first.");
  const paths = safePatchPaths(directory, patches.map((diff) => diff.patch));
  const failure = preflightPatches(directory, patches.map((diff) => diff.patch));
  if (failure) throw new Error(failure);
  const snapshots = new Map<string, FileSnapshot>();
  const createdDirectories = new Set<string>();
  for (const target of paths) {
    if (!target || target.split("/").includes("..") || path.isAbsolute(target)) throw new Error(`Unsafe patch path: ${target}`);
    let parent = path.dirname(target);
    while (parent !== ".") {
      try {
        const parentStat = lstatSync(path.resolve(directory, parent));
        if (parentStat.isSymbolicLink()) throw new Error(`Patch path traverses a symlink directory: ${parent}`);
        if (!parentStat.isDirectory()) throw new Error(`Patch parent is not a directory: ${parent}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") createdDirectories.add(parent);
        else throw error;
      }
      const next = path.dirname(parent);
      if (next === parent) break;
      parent = next;
    }
    const absolute = path.resolve(directory, target);
    const relative = path.relative(path.resolve(directory), absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Patch path escapes repository: ${target}`);
    try {
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) snapshots.set(target, { kind: "symlink", target: readlinkSync(absolute) });
      else if (stat.isFile()) snapshots.set(target, { kind: "file", bytes: readFileSync(absolute), mode: stat.mode & 0o777 });
      else throw new Error(`Patch target is not a regular file: ${target}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") snapshots.set(target, { kind: "missing" });
      else throw error;
    }
  }

  let rolledBack = false;
  const rollback = (): void => {
    if (rolledBack) return;
    const failures: string[] = [];
    for (const [target, snapshot] of [...snapshots].reverse()) {
      const absolute = path.resolve(directory, target);
      try {
        rmSync(absolute, { recursive: true, force: true });
        if (snapshot.kind === "file") {
          mkdirSync(path.dirname(absolute), { recursive: true });
          writeFileSync(absolute, snapshot.bytes, { mode: snapshot.mode });
          chmodSync(absolute, snapshot.mode);
        } else if (snapshot.kind === "symlink") {
          mkdirSync(path.dirname(absolute), { recursive: true });
          symlinkSync(snapshot.target, absolute);
        }
      } catch (error) {
        failures.push(`${target}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    for (const directoryPath of [...createdDirectories].sort((left, right) => right.length - left.length)) {
      try { rmdirSync(path.resolve(directory, directoryPath)); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as NodeJS.ErrnoException).code !== "ENOTEMPTY") {
          failures.push(`${directoryPath}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    rolledBack = true;
    if (failures.length) throw new Error(failures.join("; "));
  };

  const staging = mkdtempSync(path.join(tmpdir(), "augment-apply-"));
  try {
    const files = patches.map((diff, index) => {
      const file = path.join(staging, `patch-${index}.diff`);
      writeFileSync(file, diff.patch.endsWith("\n") ? diff.patch : `${diff.patch}\n`, "utf8");
      return file;
    });
    try {
      for (const file of files) git(directory, ["apply", "--whitespace=nowarn", file]);
    } catch (error) {
      try { rollback(); } catch (rollbackError) {
        throw new Error(`Patch apply failed: ${error instanceof Error ? error.message : String(error)}; rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      }
      throw error;
    }
    return { paths: patches.map((diff) => diff.path || diff.id), rollback };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export function applyPlannedDiffs(directory: string, diffs: PlannedDiff[]): string[] {
  return applyPlannedDiffsTransaction(directory, diffs).paths;
}

/** Verify that applied diffs remain reverse-applicable and pass git's whitespace checks. */
export function verifyAppliedDiffs(directory: string, diffs: PlannedDiff[]): { passed: boolean; summary: string } {
  const patches = diffs.filter((diff) => diff.patch.trim().length > 0);
  if (!patches.length) return { passed: false, summary: "No applied patches were supplied for verification." };
  const staging = mkdtempSync(path.join(tmpdir(), "augment-verify-"));
  const worktree = path.join(staging, "wt");
  try {
    const paths = [...new Set(patches.flatMap((diff) => patchPaths(diff.patch)))];
    git(directory, ["diff", "--check", "--", ...paths]);
    git(directory, ["worktree", "add", "--detach", "--quiet", worktree]);
    mirrorPatchedPaths(directory, worktree, patches.map((diff) => diff.patch));
    const files = patches.map((diff, index) => {
      const file = path.join(staging, `patch-${index}.diff`);
      writeFileSync(file, diff.patch.endsWith("\n") ? diff.patch : `${diff.patch}\n`, "utf8");
      return file;
    });
    // The original patches were applied in order; undo them in reverse order
    // against a mirror of the current worktree to validate the whole series.
    for (const file of [...files].reverse()) {
      git(worktree, ["apply", "--reverse", "--check", "--whitespace=nowarn", file]);
      git(worktree, ["apply", "--reverse", "--whitespace=nowarn", file]);
    }
    return { passed: true, summary: `Verified ${patches.length} applied patch(es): the full patch series reverses cleanly and passes git diff --check.` };
  } catch (error) {
    return { passed: false, summary: error instanceof Error ? error.message : String(error) };
  } finally {
    try { git(directory, ["worktree", "remove", "--force", worktree]); } catch { /* no worktree was created */ }
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
