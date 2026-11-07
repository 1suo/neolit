import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { loadPlanningWorkspace } from "../src/planning/workspace.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "neolit-planning-"));
  roots.push(root);
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Planning Test"], { cwd: root });
  await mkdir(path.join(root, "src", "auth"), { recursive: true });
  await writeFile(path.join(root, "README.md"), "# Project\n\n[Auth](src/auth/README.md)\n");
  await writeFile(path.join(root, "src/auth/README.md"), "# Auth\n\n[SPEC](SPEC.md) [TODO](TODO.md)\n");
  await writeFile(path.join(root, "src/auth/SPEC.md"), "# Auth\n\n## Requirements\n- **R-01** Refresh sessions.\n");
  await writeFile(path.join(root, "src/auth/TODO.md"), "# Auth tasks\n\n- [ ] Implement refresh\n  - SPEC: `SPEC.md#R-01`\n  - File: `src/auth/session.ts`\n");
  await writeFile(path.join(root, "src/auth/session.ts"), "export const refresh = () => true;\n");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-qm", "fixture"], { cwd: root });
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("loadPlanningWorkspace", () => {
  it("follows linked README documents and joins TODO requirements to real Git changes", async () => {
    const root = await fixture();
    await writeFile(path.join(root, "src/auth/session.ts"), "export const refresh = () => false;\n");
    await writeFile(path.join(root, "unplanned.ts"), "export const extra = true;\n");

    const workspace = await loadPlanningWorkspace(root);
    expect(workspace.readmes).toEqual(["README.md", "src/auth/README.md"]);
    expect(workspace.tasks).toHaveLength(1);
    expect(workspace.tasks[0]!.resolvedRequirements.map((item) => item.id)).toEqual(["R-01"]);
    expect(workspace.git.changedFiles.map((item) => item.path).sort()).toEqual(["src/auth/session.ts", "unplanned.ts"]);
    expect(workspace.git.associations.find((item) => item.path === "src/auth/session.ts")).toMatchObject({
      requirementIds: ["R-01"],
      state: "planned",
    });
    expect(workspace.git.associations.find((item) => item.path === "unplanned.ts")).toMatchObject({ state: "unplanned" });
  });


  it("opens an unborn repository and reports untracked files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "neolit-unborn-"));
    roots.push(root);
    await execFileAsync("git", ["init", "-q"], { cwd: root });
    await writeFile(path.join(root, "README.md"), "# Empty project\n");
    await writeFile(path.join(root, "first.ts"), "export const first = true;\n");
    const workspace = await loadPlanningWorkspace(root);
    expect(workspace.git.head).toBe("");
    expect(workspace.git.changedFiles.map((file) => file.path).sort()).toEqual(["README.md", "first.ts"]);
  });

  it("keeps repository reads read-only", async () => {
    const root = await fixture();
    const before = await readFile(path.join(root, "src/auth/session.ts"), "utf8");
    await loadPlanningWorkspace(root);
    expect(await readFile(path.join(root, "src/auth/session.ts"), "utf8")).toBe(before);
    const status = await execFileAsync("git", ["status", "--porcelain"], { cwd: root });
    expect(status.stdout).toBe("");
  });
  it("preserves staged, unstaged, deleted, renamed, and untracked Git status", async () => {
    const root = await fixture();

    await writeFile(path.join(root, "src/auth/session.ts"), "export const refresh = () => 'staged';\n");
    await execFileAsync("git", ["add", "src/auth/session.ts"], { cwd: root });
    await writeFile(path.join(root, "src/auth/session.ts"), "export const refresh = () => 'unstaged too';\n");

    await writeFile(path.join(root, "README.md"), "# Project changed\n");
    await execFileAsync("git", ["add", "README.md"], { cwd: root });

    await execFileAsync("git", ["mv", "src/auth/SPEC.md", "src/auth/SPEC-renamed.md"], { cwd: root });
    await rm(path.join(root, "src/auth/TODO.md"));
    await writeFile(path.join(root, "new file café.ts"), "export const fresh = true;\n");

    const workspace = await loadPlanningWorkspace(root);
    const status = new Map(workspace.git.status.map((entry) => [entry.path, entry]));

    expect(status.get("src/auth/session.ts")).toMatchObject({ index: "M", worktree: "M" });
    expect(status.get("README.md")).toMatchObject({ index: "M", worktree: " " });
    expect(status.get("src/auth/TODO.md")).toMatchObject({ index: " ", worktree: "D" });
    expect(status.get("src/auth/SPEC-renamed.md")).toMatchObject({
      index: "R",
      originalPath: "src/auth/SPEC.md",
    });
    expect(status.get("new file café.ts")).toMatchObject({ index: "?", worktree: "?" });

    expect(workspace.git.changedFiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "src/auth/session.ts", status: "modified" }),
      expect.objectContaining({ path: "README.md", status: "modified" }),
      expect.objectContaining({ path: "src/auth/TODO.md", status: "deleted" }),
      expect.objectContaining({
        path: "src/auth/SPEC-renamed.md",
        previousPath: "src/auth/SPEC.md",
        status: "renamed",
      }),
      expect.objectContaining({ path: "new file café.ts", status: "added", hunks: [] }),
    ]));
  });

});
