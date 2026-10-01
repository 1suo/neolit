import { describe, expect, it } from "vitest";
import { crystallizeNode, draftPatchWithModel, nextDevelopmentStep, refineWithModel, selectCandidate } from "../src/augment/kernel.js";
import { acceptDomain, createPlanTask } from "../src/augment/state.js";
import type { ModelCallRequest, ModelRuntime, PlanTask } from "../src/augment/types.js";

function runtime(responses: Array<(request: ModelCallRequest) => unknown>): ModelRuntime {
  let calls = 0;
  return {
    async call(request) {
      const responder = responses[calls++] ?? (() => {
        throw new Error(`unexpected model call ${request.operation}`);
      });
      return { value: responder(request) };
    },
  };
}

function task(): PlanTask {
  return createPlanTask({ id: "task:kernel", objective: "make retries bounded", basisRevision: "commit:1" });
}

describe("augment kernel", () => {
  it("generates, challenges, adds one missing candidate, and accepts a domain", async () => {
    const model = runtime([
      () => ({ candidates: [{ label: "Fixed count", rationale: "smallest change", confidence: 78, touchedPaths: ["src/auth/session.ts"] }] }),
      () => ({ kind: "missing-candidate", candidate: { label: "Deadline", rationale: "honor deadline", confidence: 72, touchedPaths: ["src/auth/deadline.ts"] }, reason: "fixed count ignores cancellation" }),
      () => ({ kind: "accept" }),
    ]);
    const result = await crystallizeNode(model, task(), { taskId: "task:kernel", nodeId: "node:root", temperature: "normal", lod: "architecture" });
    const root = result.nodes[result.rootNodeId]!;
    expect(root.acceptedDomain).toBe(true);
    expect(root.candidateIds).toHaveLength(2);
    expect(root.challengeRound).toBe(2);
    expect(root.candidateIds.map((id) => result.candidates[id]!.label)).toEqual(["Fixed count", "Deadline"]);
  });

  it("decides the development frontier as a pure function", async () => {
    const seeded = runtime([
      () => ({ candidates: [{ label: "Only", rationale: "one family", confidence: 75, touchedPaths: ["src/a.ts"] }] }),
      () => ({ kind: "accept" }),
    ]);
    let task = createPlanTask({ id: "task:frontier", objective: "o", basisRevision: "commit:1" });
    expect(nextDevelopmentStep(task, task.rootNodeId)).toEqual({ action: "crystallize" });

    const domain = await crystallizeNode(seeded, task, { taskId: task.id, nodeId: task.rootNodeId, temperature: "normal", lod: "file" });
    expect(nextDevelopmentStep(domain, domain.rootNodeId)).toEqual({ action: "choose", count: 1 });

    const selected = selectCandidate(domain, { taskId: domain.id, expectedRevision: domain.revision, nodeId: domain.rootNodeId, candidateId: domain.nodes[domain.rootNodeId]!.candidateIds[0]! });
    expect(nextDevelopmentStep(selected, selected.rootNodeId)).toEqual({ action: "refine" });
    const refined = await refineWithModel(runtime([
      () => ({ children: [
        { kind: "dir", path: "src/auth", lod: "file", reason: "owns the work" },
        { kind: "file", path: "TODO.md", lod: "file", reason: "track it" },
      ] }),
    ]), selected, { taskId: selected.id, nodeId: selected.rootNodeId, temperature: "normal", lod: "file" });

    const rootStep = nextDevelopmentStep(refined, refined.rootNodeId);
    expect(rootStep).toMatchObject({ action: "descend", path: "TODO.md", step: "draft" });

    const todoNode = Object.values(refined.nodes).find((node) => node.path === "TODO.md")!;
    expect(nextDevelopmentStep(refined, todoNode.id)).toEqual({ action: "draft" });
    const drafted = await draftPatchWithModel(runtime([() => ({ patch: "--- a/TODO.md\\n+++ b/TODO.md\\n", assumptions: [] })]), refined, { taskId: refined.id, nodeId: todoNode.id, temperature: "low" });
    expect(nextDevelopmentStep(drafted, todoNode.id)).toEqual({ action: "already-drafted" });

    const afterTodo = nextDevelopmentStep(drafted, drafted.rootNodeId);
    expect(afterTodo).toMatchObject({ action: "descend", path: "src/auth", step: "crystallize" });

    const authNode = Object.values(drafted.nodes).find((node) => node.path === "src/auth")!;
    expect(nextDevelopmentStep(drafted, authNode.id)).toEqual({ action: "crystallize" });
    expect(nextDevelopmentStep(drafted, "node:missing")).toEqual({ action: "stalled", reason: "Unknown plan node." });
  });

  it("records out-of-scope challenge candidates as constraints instead of failing", async () => {
    const seeded = runtime([
      () => ({ candidates: [{ label: "Only", rationale: "one family", confidence: 75, touchedPaths: ["src/a.ts"] }] }),
      () => ({ kind: "accept" }),
    ]);
    const domain = await crystallizeNode(seeded, task(), { taskId: "task:kernel", nodeId: "node:root", temperature: "normal", lod: "file" });
    const selected = selectCandidate(domain, { taskId: domain.id, expectedRevision: domain.revision, nodeId: domain.rootNodeId, candidateId: domain.nodes[domain.rootNodeId]!.candidateIds[0]! });
    const refined = await refineWithModel(runtime([
      () => ({ children: [{ kind: "file", path: "src/a.ts", lod: "hunk", reason: "tighten the cutoff" }] }),
    ]), selected, { taskId: selected.id, nodeId: selected.rootNodeId, temperature: "normal", lod: "hunk" });
    const fileNode = Object.values(refined.nodes).find((node) => node.kind === "file")!;

    const model = runtime([
      () => ({ candidates: [{ label: "Local fix", rationale: "inside scope", confidence: 70, touchedPaths: ["src/a.ts"] }] }),
      () => ({ kind: "missing-candidate", candidate: { label: "Cover the sibling", rationale: "docs must move too", confidence: 55, touchedPaths: ["src/b.ts"] }, reason: "the change needs src/b.ts as well" }),
      () => ({ kind: "accept" }),
    ]);
    const result = await crystallizeNode(model, refined, { taskId: refined.id, nodeId: fileNode.id, temperature: "normal", lod: "file" });
    expect(result.nodes[fileNode.id]!.status).toBe("domain");
    expect(result.nodes[fileNode.id]!.acceptedDomain).toBe(true);
    expect(result.nodes[fileNode.id]!.candidateIds).toHaveLength(1);
    const note = Object.values(result.constraints).find((constraint) => constraint.text.includes("Out-of-scope dependency"));
    expect(note?.text).toContain("src/b.ts");
    expect(note?.nodeId).toBe(fileNode.id);
  });

  it("reserves challenge capacity and never exceeds seven live candidates", async () => {
    const candidate = (ordinal: number) => ({ label: `Approach ${ordinal}`, rationale: `materially distinct ${ordinal}`, confidence: 60 + ordinal, touchedPaths: [`src/${ordinal}.ts`] });
    const model = runtime([
      () => ({ candidates: [1, 2, 3, 4, 5].map(candidate) }),
      () => ({ kind: "missing-candidate", candidate: candidate(6), reason: "missing family" }),
      () => ({ kind: "missing-candidate", candidate: candidate(7), reason: "another missing family" }),
    ]);
    const result = await crystallizeNode(model, task(), { taskId: "task:kernel", nodeId: "node:root", temperature: "normal", lod: "architecture" });
    const root = result.nodes[result.rootNodeId]!;
    expect(root.candidateIds).toHaveLength(7);
    expect(root.acceptedDomain).toBe(false);
    expect(root.challengeExhausted).toBe(true);
    expect(root.challengeRound).toBe(2);

    const selected = selectCandidate(result, {
      taskId: result.id,
      expectedRevision: result.revision,
      nodeId: result.rootNodeId,
      candidateId: root.candidateIds[0]!,
    });
    expect(selected.nodes[selected.rootNodeId]).toMatchObject({ status: "collapsed", selectedCandidateId: root.candidateIds[0] });
  });

  it("rejects oversized initial domains before touching task state", async () => {
    const initial = task();
    const candidates = Array.from({ length: 6 }, (_, index) => ({
      label: `Approach ${index + 1}`,
      rationale: `materially distinct ${index + 1}`,
      confidence: 70,
      touchedPaths: [`src/${index + 1}.ts`],
    }));
    const model: ModelRuntime = { call: async () => ({ value: { candidates } }) };
    await expect(crystallizeNode(model, initial, { taskId: initial.id, nodeId: initial.rootNodeId, temperature: "normal", lod: "architecture" })).rejects.toThrow(/invalid/u);
    expect(initial.nodes[initial.rootNodeId]!.candidateIds).toHaveLength(0);
  });

  it("does not collapse during crystallization", async () => {
    const model = runtime([
      () => ({ candidates: [{ label: "Only", rationale: "one materially distinct family", confidence: 75, touchedPaths: ["src/a.ts"] }] }),
      () => ({ kind: "accept" }),
    ]);
    const result = await crystallizeNode(model, task(), { taskId: "task:kernel", nodeId: "node:root", temperature: "low", lod: "architecture" });
    expect(result.nodes[result.rootNodeId]!.status).toBe("domain");
  });

  it("allows explicit controller selection only after challenge acceptance", async () => {
    const initial = task();
    const model = runtime([
      () => ({ candidates: [{ label: "Only", rationale: "one family", confidence: 80, touchedPaths: ["src/a.ts"] }] }),
      () => ({ kind: "accept" }),
    ]);
    const generated = await crystallizeNode(model, initial, { taskId: initial.id, nodeId: initial.rootNodeId, temperature: "normal", lod: "architecture" });
    const selected = selectCandidate(generated, { taskId: generated.id, expectedRevision: generated.revision, nodeId: generated.rootNodeId, candidateId: generated.nodes[generated.rootNodeId]!.candidateIds[0]! });
    expect(selected.nodes[selected.rootNodeId]).toMatchObject({ status: "collapsed", selectedCandidateId: generated.nodes[generated.rootNodeId]!.candidateIds[0] });
  });

  it("refines selected nodes through typed model output", async () => {
    const initial = task();
    const generated = await crystallizeNode(runtime([
      () => ({ candidates: [{ label: "Fixed count", rationale: "smallest", confidence: 76, touchedPaths: ["src/auth/session.ts"] }] }),
      () => ({ kind: "accept" }),
    ]), initial, { taskId: initial.id, nodeId: initial.rootNodeId, temperature: "normal", lod: "file" });
    const selected = selectCandidate(generated, { taskId: generated.id, expectedRevision: generated.revision, nodeId: generated.rootNodeId, candidateId: generated.nodes[generated.rootNodeId]!.candidateIds[0]! });
    const refined = await refineWithModel(runtime([
      () => ({ children: [{ kind: "file", path: "src/auth/session.ts", lod: "hunk", reason: "retry cutoff", obligations: [{ kind: "test", description: "focused retry test" }] }] }),
    ]), selected, { taskId: selected.id, nodeId: selected.rootNodeId, temperature: "normal", lod: "hunk" });
    expect(Object.values(refined.nodes).filter((node) => node.parent === refined.rootNodeId).map((node) => node.path)).toEqual(["src/auth/session.ts"]);
  });

  it("attaches a model patch to a refined file node", async () => {
    const initial = task();
    const generated = await crystallizeNode(runtime([
      () => ({ candidates: [{ label: "Fixed count", rationale: "smallest", confidence: 76, touchedPaths: ["src/auth/session.ts"] }] }),
      () => ({ kind: "accept" }),
    ]), initial, { taskId: initial.id, nodeId: initial.rootNodeId, temperature: "normal", lod: "file" });
    const selected = selectCandidate(generated, { taskId: generated.id, expectedRevision: generated.revision, nodeId: generated.rootNodeId, candidateId: generated.nodes[generated.rootNodeId]!.candidateIds[0]! });
    const refined = await refineWithModel(runtime([
      () => ({ children: [{ kind: "file", path: "src/auth/session.ts", lod: "hunk", reason: "retry cutoff" }] }),
    ]), selected, { taskId: selected.id, nodeId: selected.rootNodeId, temperature: "normal", lod: "hunk" });
    const child = Object.values(refined.nodes).find((node) => node.path === "src/auth/session.ts")!;
    const patched = await draftPatchWithModel(runtime([() => ({ patch: "@@ -1 +1 @@\n-bounded\n+bounded", assumptions: [] })]), refined, { taskId: refined.id, nodeId: child.id, temperature: "low" });
    expect(Object.values(patched.diffs)[0]).toMatchObject({ nodeId: child.id, patch: "@@ -1 +1 @@\n-bounded\n+bounded", basisRevision: "commit:1" });
  });

  it("leaves state unchanged when model output violates its schema", async () => {
    const initial = task();
    const model: ModelRuntime = { call: async () => ({ value: { candidates: [] } }) };
    await expect(crystallizeNode(model, initial, { taskId: initial.id, nodeId: initial.rootNodeId, temperature: "normal", lod: "architecture" })).rejects.toThrow(/invalid/u);
    expect(initial.revision).toBe(1);
  });
});
