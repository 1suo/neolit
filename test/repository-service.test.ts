import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { RepositoryServiceRegistry, ScopedRepositoryService } from "../src/repository-service.js";

const roots: string[] = [];
function repository(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "neolit-repository-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "alpha.ts"), "first\nconst target = 1;\nlast\n");
  fs.writeFileSync(path.join(root, "README.md"), "target docs\n");
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("exported scoped repository service", () => {
  it("enforces admitted scope and returns descriptors before one content-addressed body", () => {
    const service = new ScopedRepositoryService(repository());
    expect(service.discover("alpha").value).toEqual({ descriptors: [{ path: "src/alpha.ts", kind: "file" }], truncated: false });
    expect(() => service.search("target", ["src"])).toThrow(/outside admitted scopes/);
    service.requestScope(["src"], "inspect source", ["task"]);
    const search = service.search("target", ["src"]);
    expect(JSON.stringify(search.value)).not.toContain("const target");
    const descriptor = (search.value as { descriptors: Array<{ chunkId: string; fileDigest: string }> }).descriptors[0]!;
    expect(descriptor.chunkId).toMatch(/^[a-f0-9]{24}$/);
    expect(descriptor.fileDigest).toMatch(/^[a-f0-9]{64}$/);
    const first = service.read(descriptor.chunkId);
    const second = service.read(descriptor.chunkId);
    expect(first.value).toMatchObject({ content: "first\nconst target = 1;\nlast\n", bodyReturned: true });
    expect(second.value).toMatchObject({ reference: { chunkId: descriptor.chunkId }, bodyReturned: false });
    expect(second.duplicateReadCharsAvoided).toBe(first.repositoryReadChars);
  });

  it("invalidates changed paths while reusing unchanged chunks", () => {
    const root = repository();
    const service = new ScopedRepositoryService(root);
    service.requestScope(["."], "inspect repository", []);
    const descriptors = (service.search("target", ["."]).value as { descriptors: Array<{ chunkId: string; canonicalPath: string; snapshotEpoch: number }> }).descriptors;
    const alpha = descriptors.find((item) => item.canonicalPath === "src/alpha.ts")!;
    const readme = descriptors.find((item) => item.canonicalPath === "README.md")!;
    service.read(alpha.chunkId);
    service.read(readme.chunkId);
    fs.writeFileSync(path.join(root, "src", "alpha.ts"), "first\nconst target = 2;\nlast\n");
    expect(service.reconcileChangedPaths(["src/alpha.ts"])).toBe(1);
    expect(() => service.read(alpha.chunkId)).toThrow(/stale/);
    expect(service.read(readme.chunkId).value).toMatchObject({ reference: { chunkId: readme.chunkId, snapshotEpoch: 0 }, bodyReturned: false });
    const replacement = (service.search("target", ["."]).value as { descriptors: Array<{ chunkId: string; canonicalPath: string; snapshotEpoch: number }> }).descriptors.find((item) => item.canonicalPath === "src/alpha.ts")!;
    expect(replacement).toMatchObject({ snapshotEpoch: 1 });
    expect(replacement.chunkId).not.toBe(alpha.chunkId);
  });

  it("rejects traversal and symlink escapes and cleans registry sessions", () => {
    const root = repository();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "neolit-repository-outside-"));
    roots.push(outside);
    fs.writeFileSync(path.join(outside, "secret"), "secret");
    fs.symlinkSync(path.join(outside, "secret"), path.join(root, "escape"));
    const registry = new RepositoryServiceRegistry();
    const service = registry.get("session", root);
    expect(() => service.requestScope(["src/../README.md"], "traversal", [])).toThrow(/traversal-free/);
    expect(() => service.requestScope(["escape"], "symlink", [])).toThrow(/symlink/);
    expect(registry.size).toBe(1);
    registry.delete("session");
    expect(registry.size).toBe(0);
  });

  it("returns every changed path when worktree inspection has no query", () => {
    const root = repository();
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "base"], { cwd: root });
    fs.writeFileSync(path.join(root, "README.md"), "changed docs\n");
    const inventory = new ScopedRepositoryService(root).inspectWorktrees().value as { worktrees: Array<{ changedPaths: string[]; diffChunks: Array<{ path: string }> }> };
    expect(inventory.worktrees[0]).toMatchObject({ changedPaths: ["README.md"], diffChunks: [{ path: "README.md" }] });
  });

  it.each(["README.md", "spaced name.txt"])("detects successive dirty content changes in %s with identical diff statistics", (file) => {
    const root = repository();
    fs.writeFileSync(path.join(root, file), "original\n");
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "base"], { cwd: root });
    const observe = () => new ScopedRepositoryService(root).inspectWorktrees().value as { observationDigest: string; worktrees: Array<{ diffStat: string; status: string; diffChunks: Array<{ chunkId: string }> }> };
    fs.writeFileSync(path.join(root, file), "changed1\n");
    const first = observe();
    fs.writeFileSync(path.join(root, file), "changed2\n");
    const second = observe();
    expect(second.worktrees[0]!.diffStat).toBe(first.worktrees[0]!.diffStat);
    expect(second.worktrees[0]!.status).toBe(first.worktrees[0]!.status);
    expect(second.observationDigest).not.toBe(first.observationDigest);
    expect(second.worktrees[0]!.diffChunks[0]!.chunkId).not.toBe(first.worktrees[0]!.diffChunks[0]!.chunkId);
    fs.unlinkSync(path.join(root, file));
    expect(observe().observationDigest).not.toBe(second.observationDigest);
  });

  it("keeps valid worktrees inspectable when a registered worktree path is missing", () => {
    const root = repository();
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "base"], { cwd: root });
    const stale = `${root}-stale`;
    roots.push(stale);
    execFileSync("git", ["worktree", "add", "--detach", "-q", stale], { cwd: root });
    fs.rmSync(stale, { recursive: true, force: true });
    fs.writeFileSync(path.join(root, "README.md"), "changed docs\n");

    const inventory = new ScopedRepositoryService(root).inspectWorktrees().value as { worktreeCount: number; worktrees: Array<{ path: string; available: boolean; unavailableReason: string | null; changedPaths: string[] }> };

    expect(inventory.worktreeCount).toBe(2);
    expect(inventory.worktrees.find((worktree) => worktree.path === root)).toMatchObject({ available: true, changedPaths: ["README.md"] });
    expect(inventory.worktrees.find((worktree) => worktree.path === stale)).toMatchObject({ available: false, unavailableReason: "registered worktree path does not exist", changedPaths: [] });
  });
});
