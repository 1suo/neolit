import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PlannedDiff } from "../augment/types.js";

/**
 * Host-side apply transaction for drafted patches: preflights every selected
 * patch together with `git apply --check`, then applies them as one unit, so a
 * conflict anywhere leaves the working tree untouched. Only the working tree
 * changes; nothing is staged or committed.
 */
export function preflightPatches(directory: string, patches: string[]): string | undefined {
  const staging = mkdtempSync(path.join(tmpdir(), "augment-preflight-"));
  try {
    const files = patches.map((patch, index) => {
      const file = path.join(staging, `patch-${index}.diff`);
      writeFileSync(file, patch.endsWith("\n") ? patch : `${patch}\n`, "utf8");
      return file;
    });
    try {
      git(directory, ["apply", "--check", "--whitespace=nowarn", ...files]);
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
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
    git(directory, ["apply", "--whitespace=nowarn", ...files]);
    return patches.map((diff) => diff.path || diff.id);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function git(directory: string, args: string[]): void {
  try {
    execFileSync("git", ["-C", directory, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const stderr = error && typeof error === "object" && typeof (error as { stderr?: unknown }).stderr === "string"
      ? (error as { stderr: string }).stderr.trim()
      : "";
    const fallback = error instanceof Error ? error.message : String(error);
    throw new Error(`git ${args.join(" ")} failed: ${stderr || fallback}`);
  }
}
