import { describe, expect, it } from "vitest";
import {
  acceptDomain,
  addConstraint,
  attachPatch,
  collapseNode,
  createPlanTask,
  generateDomain,
  markPathStale,
  planTree,
  refineNode,
  rejectCandidate,
  reopenNode,
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
      { label: "Fixed retry count", rationale: "Smallest behavior change.", touchedPaths: ["src/auth/session.ts", "test/auth/retry.test.ts"] },
      { label: "Deadline cutoff", rationale: "Honors request deadlines.", touchedPaths: ["src/auth/deadline.ts"] },
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
        { label: "Same", rationale: "one", touchedPaths: ["src/a.ts"] },
        { label: "same", rationale: "two", touchedPaths: ["src/b.ts"] },
      ],
    })).toThrow(/Duplicate candidate label/u);
    expect(() => generateDomain(current, {
      taskId: current.id,
      expectedRevision: current.revision,
      nodeId: current.rootNodeId,
      candidates: Array.from({ length: 8 }, (_, index) => ({ label: `Candidate ${index}`, rationale: "why", touchedPaths: ["src/a.ts"] })),
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

  it("projects candidate paths into a recursively unwrapped filesystem tree", () => {
    const current = domain();
    const tree = planTree(current);
    const src = tree.children.find((entry) => entry.path === "src");
    const auth = src?.children.find((entry) => entry.path === "src/auth");
    expect(auth?.children.map((entry) => entry.path)).toContain("src/auth/session.ts");
    expect(tree.children.some((entry) => entry.path === "docs")).toBe(false);
  });

  it("stores user constraints and rejected candidates with explicit reasons", () => {
    const constrained = addConstraint(domain(), { taskId: domain().id, expectedRevision: domain().revision, nodeId: domain().rootNodeId, text: "Preserve the public API." });
    expect(Object.values(constrained.constraints)[0]!).toMatchObject({ source: "user", text: "Preserve the public API." });
    const candidateId = constrained.nodes[constrained.rootNodeId]!.candidateIds[1]!;
    const rejected = rejectCandidate(constrained, { taskId: constrained.id, expectedRevision: constrained.revision, candidateId, reason: "No deadline plumbing." });
    expect(rejected.candidates[candidateId]).toMatchObject({ status: "eliminated", eliminationReason: "No deadline plumbing." });
  });

  it("keeps a file patch immutable by basis revision", () => {
    const current = collapsed();
    const refined = refineNode(current, {
      taskId: current.id,
      expectedRevision: current.revision,
      nodeId: current.rootNodeId,
      children: [{ kind: "file", path: "src/auth/session.ts", lod: "hunk", reason: "implementation" }],
    });
    const child = Object.values(refined.nodes).find((node) => node.path === "src/auth/session.ts")!;
    const patched = attachPatch(refined, { taskId: refined.id, expectedRevision: refined.revision, nodeId: child.id, patch: "--- a/src/auth/session.ts\n+++ b/src/auth/session.ts\n" });
    const diff = Object.values(patched.diffs)[0]!;
    expect(diff).toMatchObject({ nodeId: child.id, path: "src/auth/session.ts", basisRevision: "commit:1" });
  });
});
