import { describe, expect, it } from "vitest";
import {
  acceptDomain,
  addCandidate,
  addConstraint,
  attachExplanations,
  attachPatch,
  collapseNode,
  createPlanTask,
  exhaustDomainChallenge,
  generateDomain,
  markPathStale,
  MAX_TASK_EVENTS,
  patchPaths,
  planTree,
  refreshNode,
  refineNode,
  rejectCandidate,
  reopenNode,
  setPathRestriction,
  classifyPatchKind,
} from "../src/augment/state.js";

function task() {
  return createPlanTask({ id: "task:1", objective: "make retries bounded", basisRevision: "commit:1" });
}

function domain() {
  const initial = task();
  return generateDomain(initial, {
    taskId: initial.id,
    expectedRevision: initial.revision,
    nodeId: initial.rootNodeId,
    candidates: [
      { label: "Fixed retry count", rationale: "Smallest behavior change.", confidence: 78, touchedPaths: ["src/auth/session.ts", "test/auth/retry.test.ts"] },
      { label: "Deadline cutoff", rationale: "Honors request deadlines.", confidence: 72, touchedPaths: ["src/auth/deadline.ts"] },
    ],
  });
}

function collapsed() {
  const withDomain = acceptDomain(domain(), { taskId: domain().id, expectedRevision: domain().revision, nodeId: domain().rootNodeId, challengeRound: 1 });
  const candidateId = withDomain.nodes[withDomain.rootNodeId]!.candidateIds[0]!;
  return collapseNode(withDomain, { taskId: withDomain.id, expectedRevision: withDomain.revision, nodeId: withDomain.rootNodeId, candidateId });
}

describe("planned diff state", () => {
  it("gates collapse behind an accepted challenged domain", () => {
    const current = domain();
    const candidateId = current.nodes[current.rootNodeId]!.candidateIds[0]!;
    expect(() => collapseNode(current, { taskId: current.id, expectedRevision: current.revision, nodeId: current.rootNodeId, candidateId })).toThrow(/challenged and accepted/u);
  });

  it("records rejected siblings when a candidate collapses", () => {
    const current = collapsed();
    const root = current.nodes[current.rootNodeId]!;
    const candidates = root.candidateIds.map((id) => current.candidates[id]!);
    expect(candidates.filter((candidate) => candidate.status === "selected")).toHaveLength(1);
    expect(candidates.filter((candidate) => candidate.status === "eliminated").map((candidate) => candidate.eliminationReason)).toEqual([`superseded by selected candidate ${candidates[0]!.id}`]);
    expect(root.status).toBe("collapsed");
  });

  it("rejects duplicate and unbounded candidate domains", () => {
    const current = task();
    expect(() => generateDomain(current, {
      taskId: current.id,
      expectedRevision: current.revision,
      nodeId: current.rootNodeId,
      candidates: [
        { label: "Same", rationale: "one", confidence: 50, touchedPaths: ["src/a.ts"] },
        { label: "same", rationale: "two", confidence: 50, touchedPaths: ["src/b.ts"] },
      ],
    })).toThrow(/Duplicate candidate label/u);
    expect(() => generateDomain(current, {
      taskId: current.id,
      expectedRevision: current.revision,
      nodeId: current.rootNodeId,
      candidates: Array.from({ length: 8 }, (_, index) => ({ label: `Candidate ${index}`, rationale: "why", confidence: 50, touchedPaths: ["src/a.ts"] })),
    })).toThrow(/at most 7/u);
  });

  it("refines only a collapsed node inside its filesystem scope", () => {
    const current = collapsed();
    const refined = refineNode(current, {
      taskId: current.id,
      expectedRevision: current.revision,
      nodeId: current.rootNodeId,
      children: [
        { kind: "file", path: "src/auth/session.ts", lod: "hunk", reason: "retry cutoff", obligations: [{ kind: "test", description: "focused retry test" }] },
        { kind: "file", path: "test/auth/retry.test.ts", lod: "hunk", reason: "verify bounded retry" },
      ],
    });
    const children = Object.values(refined.nodes).filter((node) => node.parent === refined.rootNodeId);
    expect(children.map((node) => node.path).sort()).toEqual(["src/auth/session.ts", "test/auth/retry.test.ts"]);
    expect(children.every((node) => node.candidateIds.length === 0)).toBe(true);
    expect(() => refineNode(refined, { taskId: refined.id, expectedRevision: refined.revision, nodeId: refined.rootNodeId, children: [{ kind: "file", path: "src/other.ts", lod: "hunk", reason: "duplicate" }] })).toThrow(/already has a refinement/u);
  });

  it("reopens a collapsed subtree while retaining rejected alternatives", () => {
    const current = collapsed();
    const refined = refineNode(current, {
      taskId: current.id,
      expectedRevision: current.revision,
      nodeId: current.rootNodeId,
      children: [{ kind: "file", path: "src/auth/session.ts", lod: "hunk", reason: "implementation" }],
    });
    const child = Object.values(refined.nodes).find((node) => node.path === "src/auth/session.ts")!;
    const reopened = reopenNode(refined, { taskId: refined.id, expectedRevision: refined.revision, nodeId: refined.rootNodeId, reason: "Deadline policy is better." });
    expect(reopened.nodes[child.id]).toBeUndefined();
    expect(reopened.nodes[reopened.rootNodeId]).toMatchObject({ status: "unresolved", selectedCandidateId: undefined, acceptedDomain: false });
    const candidates = reopened.nodes[reopened.rootNodeId]!.candidateIds.map((id) => reopened.candidates[id]!);
    expect(candidates.find((candidate) => candidate.label === "Fixed retry count")?.status).toBe("possible");
    expect(candidates.find((candidate) => candidate.label === "Deadline cutoff")?.status).toBe("eliminated");
  });

  it("marks only the smallest overlapping planned subtree stale", () => {
    const current = collapsed();
    const refined = refineNode(current, {
      taskId: current.id,
      expectedRevision: current.revision,
      nodeId: current.rootNodeId,
      children: [
        { kind: "file", path: "src/auth/session.ts", lod: "hunk", reason: "implementation" },
        { kind: "file", path: "src/auth/token.ts", lod: "hunk", reason: "dependent token refresh" },
      ],
    });
    const child = Object.values(refined.nodes).find((node) => node.path === "src/auth/session.ts")!;
    const staled = markPathStale(refined, { taskId: refined.id, expectedRevision: refined.revision, path: "src/auth/session.ts" });
    expect(staled.nodes[child.id]!.status).toBe("stale");
    expect(Object.values(staled.nodes).find((node) => node.path === "src/auth/token.ts")!.status).not.toBe("stale");
    expect(staled.revision).toBeGreaterThan(refined.revision);
  });

  it("projects only the selected candidate into the filesystem tree", () => {
    const unchosen = planTree(domain());
    expect(unchosen.children).toHaveLength(0);

    const tree = planTree(collapsed());
    const src = tree.children.find((entry) => entry.path === "src");
    const auth = src?.children.find((entry) => entry.path === "src/auth");
    expect(auth?.children.map((entry) => entry.path)).toContain("src/auth/session.ts");
    expect(auth?.children.map((entry) => entry.path)).not.toContain("src/auth/deadline.ts");
    expect(tree.children.some((entry) => entry.path === "docs")).toBe(false);
  });

  it("stores user constraints and rejected candidates with explicit reasons", () => {
    const constrained = addConstraint(domain(), { taskId: domain().id, expectedRevision: domain().revision, nodeId: domain().rootNodeId, text: "Preserve the public API." });
    expect(Object.values(constrained.constraints)[0]!).toMatchObject({ source: "user", text: "Preserve the public API." });
    const candidateId = constrained.nodes[constrained.rootNodeId]!.candidateIds[1]!;
    const rejected = rejectCandidate(constrained, { taskId: constrained.id, expectedRevision: constrained.revision, candidateId, reason: "No deadline plumbing." });
    expect(rejected.candidates[candidateId]).toMatchObject({ status: "eliminated", eliminationReason: "No deadline plumbing." });
  });

  it("locks paths against candidates, refinement, and patches", () => {
    const locked = setPathRestriction(task(), { taskId: "task:1", expectedRevision: 1, path: "src/auth", mode: "lock", marked: true });
    expect(locked.lockedPaths).toEqual(["src/auth"]);
    expect(() => generateDomain(locked, {
      taskId: locked.id,
      expectedRevision: locked.revision,
      nodeId: locked.rootNodeId,
      candidates: [{ label: "Forbidden", rationale: "touches lock", confidence: 90, touchedPaths: ["src/auth/session.ts"] }],
    })).toThrow(/touches locked path/u);

    const unlocked = setPathRestriction(locked, { taskId: locked.id, expectedRevision: locked.revision, path: "src/auth", mode: "lock", marked: false });
    expect(unlocked.lockedPaths).toEqual([]);
  });

  it("classifies planned patches as new, modify, or delete", () => {
    expect(classifyPatchKind("new file mode 100644\n--- /dev/null\n+++ b/new.ts")).toBe("new");
    expect(classifyPatchKind("deleted file mode 100644\n--- a/old.ts\n+++ /dev/null")).toBe("delete");
    expect(classifyPatchKind("diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts")).toBe("modify");
    expect(classifyPatchKind("replace this file")).toBe("unknown");
  });

  it("reads the concrete paths a patch header claims to touch", () => {
    expect(patchPaths("diff --git a/src/a.ts b/src/b.ts\n--- a/src/a.ts\n+++ b/src/b.ts\n@@ -1 +1 @@\n-x\n+y")).toEqual(["src/b.ts"]);
    expect(patchPaths("--- /dev/null\n+++ b/new.ts")).toEqual(["new.ts"]);
    expect(patchPaths("--- a/old.ts\n+++ /dev/null")).toEqual(["old.ts"]);
    expect(patchPaths("rename from src/old.ts\nrename to src/new.ts")).toEqual(["src/old.ts", "src/new.ts"]);
    expect(patchPaths("@@ -1 +1 @@\n-a\n+b")).toEqual([]);
  });

  it("marks a drafted node ready regardless of open obligations", () => {
    const current = collapsed();
    const refined = refineNode(current, {
      taskId: current.id,
      expectedRevision: current.revision,
      nodeId: current.rootNodeId,
      children: [{ kind: "file", path: "src/auth/session.ts", lod: "hunk", reason: "cutoff", obligations: [{ kind: "test", description: "focused retry test" }] }],
    });
    const child = Object.values(refined.nodes).find((node) => node.path === "src/auth/session.ts")!;
    const patched = attachPatch(refined, { taskId: refined.id, expectedRevision: refined.revision, nodeId: child.id, patch: "--- a/src/auth/session.ts\n+++ b/src/auth/session.ts\n@@ -1 +1 @@\n-x\n+y" });
    expect(patched.nodes[child.id]!.status).toBe("ready");
    expect(patched.nodes[patched.rootNodeId]!.status).toBe("ready");
  });

  it("rejects patch content that escapes its file node", () => {
    const current = collapsed();
    const refined = refineNode(current, {
      taskId: current.id,
      expectedRevision: current.revision,
      nodeId: current.rootNodeId,
      children: [{ kind: "file", path: "src/auth/session.ts", lod: "hunk", reason: "cutoff" }],
    });
    const child = Object.values(refined.nodes).find((node) => node.path === "src/auth/session.ts")!;
    const smuggled = "diff --git a/src/auth/session.ts b/src/auth/session.ts\n--- a/src/auth/session.ts\n+++ b/src/auth/session.ts\n@@ -1 +1 @@\n-x\n+y\ndiff --git a/src/other.ts b/src/other.ts\n--- a/src/other.ts\n+++ b/src/other.ts\n@@ -1 +1 @@\n-x\n+y";
    expect(() => attachPatch(refined, { taskId: refined.id, expectedRevision: refined.revision, nodeId: child.id, patch: smuggled }))
      .toThrow(/touches src\/other\.ts but belongs to src\/auth\/session\.ts/u);
    expect(refined.diffs).toEqual({});
    expect(refined.revision).toBe(collapsed().revision + 1);
  });

  it("keeps headerless patches on the node path alone", () => {
    const current = collapsed();
    const refined = refineNode(current, {
      taskId: current.id,
      expectedRevision: current.revision,
      nodeId: current.rootNodeId,
      children: [{ kind: "file", path: "src/auth/session.ts", lod: "hunk", reason: "cutoff" }],
    });
    const child = Object.values(refined.nodes).find((node) => node.path === "src/auth/session.ts")!;
    const patched = attachPatch(refined, { taskId: refined.id, expectedRevision: refined.revision, nodeId: child.id, patch: "@@ -1 +1 @@\n-x\n+y" });
    expect(Object.values(patched.diffs)[0]).toMatchObject({ nodeId: child.id, path: "src/auth/session.ts" });
  });

  it("validates and projects virtual-node patches at their real path", () => {
    const current = collapsed();
    const refined = refineNode(current, {
      taskId: current.id,
      expectedRevision: current.revision,
      nodeId: current.rootNodeId,
      children: [{ kind: "virtual", lod: "hunk", reason: "cross-cutting work", diff: { patch: "--- /dev/null\n+++ b/src/generated.ts\n@@ -0,0 +1 @@\n+made" } }],
    });
    const diff = Object.values(refined.diffs)[0]!;
    expect(diff.path).toBe("src/generated.ts");
    const tree = planTree(refined);
    const src = tree.children.find((entry) => entry.path === "src")!;
    expect(src.children.map((entry) => entry.path)).toContain("src/generated.ts");

    const locked = setPathRestriction(collapsed(), { taskId: "task:1", expectedRevision: collapsed().revision, path: "src/generated.ts", mode: "lock", marked: true });
    expect(() => refineNode(locked, {
      taskId: locked.id,
      expectedRevision: locked.revision,
      nodeId: locked.rootNodeId,
      children: [{ kind: "virtual", lod: "hunk", reason: "cross-cutting work", diff: { patch: "--- /dev/null\n+++ b/src/generated.ts\n@@ -0,0 +1 @@\n+made" } }],
    })).toThrow(/locked/u);
  });

  it("refuses to resurrect explicitly rejected candidates under the same label", () => {
    const current = domain();
    const rejectedId = current.nodes[current.rootNodeId]!.candidateIds[1]!;
    const rejected = rejectCandidate(current, { taskId: current.id, expectedRevision: current.revision, candidateId: rejectedId, reason: "No deadline plumbing." });

    expect(() => generateDomain(rejected, {
      taskId: rejected.id,
      expectedRevision: rejected.revision,
      nodeId: rejected.rootNodeId,
      replace: true,
      candidates: [{ label: "Deadline cutoff", rationale: "try again", confidence: 60, touchedPaths: ["src/auth/deadline.ts"] }],
    })).toThrow(/was previously rejected: No deadline plumbing\./u);

    const regenerated = generateDomain(rejected, {
      taskId: rejected.id,
      expectedRevision: rejected.revision,
      nodeId: rejected.rootNodeId,
      replace: true,
      candidates: [{ label: "Fixed retry count", rationale: "same family, still live history", confidence: 80, touchedPaths: ["src/auth/session.ts"] }],
    });
    expect(regenerated.candidates[regenerated.nodes[regenerated.rootNodeId]!.candidateIds[0]!]!.label).toBe("Fixed retry count");

    expect(() => addCandidate(regenerated, {
      taskId: regenerated.id,
      expectedRevision: regenerated.revision,
      nodeId: regenerated.rootNodeId,
      candidate: { label: "fixed retry count", rationale: "duplicate of the live label", confidence: 50, touchedPaths: ["src/auth/session.ts"] },
      reason: "challenge",
    })).toThrow(/Duplicate candidate label/u);
  });

  it("refreshes a stale subtree back to its live lifecycle", () => {
    const current = collapsed();
    const refined = refineNode(current, {
      taskId: current.id,
      expectedRevision: current.revision,
      nodeId: current.rootNodeId,
      children: [{ kind: "file", path: "src/auth/session.ts", lod: "hunk", reason: "cutoff" }],
    });
    const child = Object.values(refined.nodes).find((node) => node.path === "src/auth/session.ts")!;
    const drafted = attachPatch(refined, { taskId: refined.id, expectedRevision: refined.revision, nodeId: child.id, patch: "@@ -1 +1 @@\n-x\n+y" });
    expect(drafted.nodes[drafted.rootNodeId]!.status).toBe("ready");

    const staled = markPathStale(drafted, { taskId: drafted.id, expectedRevision: drafted.revision, path: "src/auth/session.ts" });
    expect(staled.nodes[child.id]!.status).toBe("stale");

    const refreshed = refreshNode(staled, { taskId: staled.id, expectedRevision: staled.revision, nodeId: child.id, basisRevision: "commit:2" });
    expect(refreshed.nodes[child.id]!.status).toBe("ready");
    expect(refreshed.nodes[refreshed.rootNodeId]!.status).toBe("ready");
    expect(refreshed.basisRevision).toBe("commit:2");
    expect(Object.values(refreshed.diffs)[0]!.basisRevision).toBe("commit:1");
    expect(refreshed.events.at(-1)).toMatchObject({ type: "node-refreshed", nodeId: child.id });
    expect(() => refreshNode(refreshed, { taskId: refreshed.id, expectedRevision: refreshed.revision, nodeId: child.id })).toThrow(/not stale/u);
  });

  it("clears challenge exhaustion when a subtree goes stale", () => {
    const refined = refineNode(collapsed(), {
      taskId: collapsed().id,
      expectedRevision: collapsed().revision,
      nodeId: collapsed().rootNodeId,
      children: [{ kind: "dir", path: "src/auth", lod: "file", reason: "owns the retry work" }],
    });
    const dir = Object.values(refined.nodes).find((node) => node.path === "src/auth")!;
    const withDomain = generateDomain(refined, {
      taskId: refined.id,
      expectedRevision: refined.revision,
      nodeId: dir.id,
      candidates: [{ label: "Inline fix", rationale: "local change", confidence: 70, touchedPaths: ["src/auth/session.ts"] }],
    });
    const exhausted = exhaustDomainChallenge(withDomain, { taskId: withDomain.id, expectedRevision: withDomain.revision, nodeId: dir.id, challengeRound: 2 });
    expect(exhausted.nodes[dir.id]!.challengeExhausted).toBe(true);

    const staled = markPathStale(exhausted, { taskId: exhausted.id, expectedRevision: exhausted.revision, path: "src/auth/session.ts" });
    expect(staled.nodes[dir.id]!.status).toBe("stale");
    expect(staled.nodes[dir.id]!.challengeExhausted).toBe(false);
    expect(staled.nodes[dir.id]!.acceptedDomain).toBe(false);
  });

  it("re-propagates readiness to ancestors after a subtree reopens", () => {
    const refined = refineNode(collapsed(), {
      taskId: collapsed().id,
      expectedRevision: collapsed().revision,
      nodeId: collapsed().rootNodeId,
      children: [{ kind: "dir", path: "src/auth", lod: "file", reason: "owns the retry work" }],
    });
    const dir = Object.values(refined.nodes).find((node) => node.path === "src/auth")!;
    const withDomain = generateDomain(refined, {
      taskId: refined.id,
      expectedRevision: refined.revision,
      nodeId: dir.id,
      candidates: [{ label: "Inline fix", rationale: "local change", confidence: 70, touchedPaths: ["src/auth/session.ts"] }],
    });
    const accepted = acceptDomain(withDomain, { taskId: withDomain.id, expectedRevision: withDomain.revision, nodeId: dir.id, challengeRound: 1 });
    const dirCollapsed = collapseNode(accepted, { taskId: accepted.id, expectedRevision: accepted.revision, nodeId: dir.id, candidateId: accepted.nodes[dir.id]!.candidateIds[0]! });
    const dirRefined = refineNode(dirCollapsed, {
      taskId: dirCollapsed.id,
      expectedRevision: dirCollapsed.revision,
      nodeId: dir.id,
      children: [{ kind: "file", path: "src/auth/session.ts", lod: "hunk", reason: "cutoff" }],
    });
    const file = Object.values(dirRefined.nodes).find((node) => node.path === "src/auth/session.ts")!;
    const drafted = attachPatch(dirRefined, { taskId: dirRefined.id, expectedRevision: dirRefined.revision, nodeId: file.id, patch: "@@ -1 +1 @@\n-x\n+y" });
    expect(drafted.nodes[file.id]!.status).toBe("ready");
    expect(drafted.nodes[dir.id]!.status).toBe("ready");
    expect(drafted.nodes[drafted.rootNodeId]!.status).toBe("ready");

    const reopened = reopenNode(drafted, { taskId: drafted.id, expectedRevision: drafted.revision, nodeId: dir.id, reason: "Rethink the directory." });
    expect(reopened.nodes[dir.id]!.status).toBe("unresolved");
    expect(reopened.nodes[reopened.rootNodeId]!.status).not.toBe("ready");
  });

  it("keeps explanations for distinct topics and replaces one topic at a time", () => {
    const base = domain();
    const first = attachExplanations(base, {
      taskId: base.id,
      expectedRevision: base.revision,
      topic: "retry policy",
      entries: [{ path: "src/auth/session.ts", role: "primary", summary: "owns retries", detail: "session loop", confidence: 80 }],
    });
    const second = attachExplanations(first, {
      taskId: first.id,
      expectedRevision: first.revision,
      topic: "token refresh",
      entries: [{ path: "src/auth/token.ts", role: "primary", summary: "owns refresh", detail: "refresh loop", confidence: 70 }],
    });
    const topics = new Set(Object.values(second.explanations).map((explanation) => explanation.topic));
    expect(topics).toEqual(new Set(["retry policy", "token refresh"]));

    const replaced = attachExplanations(second, {
      taskId: second.id,
      expectedRevision: second.revision,
      topic: "retry policy",
      entries: [{ path: "src/retry.ts", role: "primary", summary: "moved", detail: "new home", confidence: 90 }],
    });
    expect(Object.values(replaced.explanations).map((explanation) => explanation.path).sort()).toEqual(["src/auth/token.ts", "src/retry.ts"]);
  });

  // Exercises 2000+ whole-task clones on purpose; it needs more than the
  // default per-test timeout under load.
  it("bounds the task event log", { timeout: 30_000 }, () => {
    let current = task();
    for (let index = 0; index < MAX_TASK_EVENTS + 50; index++) {
      current = addConstraint(current, { taskId: current.id, expectedRevision: current.revision, text: `note ${index}` });
    }
    expect(current.events.length).toBe(MAX_TASK_EVENTS);
    expect(current.events.at(-1)).toMatchObject({ type: "constraint-added" });
  });
});
