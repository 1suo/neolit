import { describe, expect, it } from "vitest";
import { compileActivationPrompt } from "../src/solution-lod/graph.js";
import { activationContextFingerprint, ensureRunnableWork, initialNetwork, inspectionOutputToDelta, MAX_SCHEMA_ATTEMPTS, mergeSolutionDelta, validateInspectionOutputProgress, validateSolutionDelta } from "../src/solution-lod/reducer.js";
import { InspectionOutputSchema } from "../src/solution-lod/types.js";
import type { AgentToolTrace, SolutionLodState, SolutionNetwork } from "../src/types.js";

const usage = { turns: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
const state = (network: SolutionNetwork): SolutionLodState => ({ stateVersion: 10, runId: "recovery", directory: "/repo", worktree: "/repo", phase: "", activeBatch: [], network, results: [], usage, callsUsed: 0, startedAt: 0, result: "" });

const location = { canonicalPath: "TODO-process-designer.md", range: [1, 40] as [number, number], fileDigest: "todo-digest", snapshotEpoch: 3 };
const chunkId = "83b392c17df44f025df87776";
const tools: AgentToolTrace[] = [{ tool: "graph_read", status: "completed", metadata: { repositoryDescriptor: { chunkId, ...location } } }];

describe("inspection schema-failure recovery (regression: run 1cd79e7f)", () => {
  it("supplies the canonical non-decomposed root requirement binding", () => {
    const network = initialNetwork("check TODO-process-designer.md");
    const prompt = compileActivationPrompt(state(network), network.activations[0]!);
    expect(prompt).toContain("first define observable region.acceptanceCriteria");
    expect(prompt).toContain('bind every materialRequirement with scopeKey "r1" and the zero-based criterionIndex');
    expect(prompt).toContain("Do not omit criterionIndex");
  });

  it("keeps factIds durable-only and resolves same-result chunk references to evidence ids", () => {
    const network = initialNetwork("check TODO-process-designer.md");
    network.activations[0]!.status = "running";
    const output = InspectionOutputSchema.parse({
      outcome: "boundary",
      region: { allowedVariables: ["solution family"], acceptanceCriteria: ["worktrees reconciled"] },
      evidence: [{ text: "The current process-designer ledger is WAITING, not READY.", source: "TODO-process-designer.md", kind: "repository", chunkId }],
      factIds: [],
      criterionEvidence: [{ criterionIndex: 0, evidenceRefs: [chunkId] }],
      decisionBoundary: { basisRevision: 0, variables: [], permittedPairs: [] },
    });
    const delta = inspectionOutputToDelta(output, tools);
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", delta, tools)).not.toThrow();
    const merged = mergeSolutionDelta(state(network), "a1", delta, tools);
    const region = merged.regions[0]!;
    expect(region.evidenceIds.length).toBeGreaterThan(0);
    for (const id of region.evidenceIds) expect(merged.evidence.some((item) => item.id === id)).toBe(true);
    expect(region.evidenceIds.some((id) => id.includes("TODO") || id.includes(chunkId))).toBe(false);

    const invalid = inspectionOutputToDelta(InspectionOutputSchema.parse({ ...output, factIds: [chunkId] }), tools);
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", invalid, tools)).toThrow(/factIds accepts only confirmed FACTS-section referenceIds/);
  });

  it("still rejects unknown fact references that no supplied evidence can resolve", () => {
    const network = initialNetwork("check TODO-process-designer.md");
    network.activations[0]!.status = "running";
    const delta = inspectionOutputToDelta(InspectionOutputSchema.parse({
      outcome: "facts",
      evidence: [{ text: "observation", source: "TODO-process-designer.md", kind: "repository", chunkId }],
      factIds: ["some-made-up-fact-id"],
    }), tools);
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", delta, tools)).toThrow(/Unknown, stale, or unprojected graph fact ID some-made-up-fact-id/);
  });

  it("rejects criterion-free fact collection that would manufacture another inspection pass", () => {
    const network = initialNetwork("add the requested behavior");
    network.activations[0]!.status = "running";
    const output = InspectionOutputSchema.parse({
      outcome: "facts",
      evidence: [
        { text: "The current implementation lacks the requested export.", source: "TODO-process-designer.md", kind: "repository", chunkId },
        { text: "A new test is probably required.", source: "model", kind: "inference", assertion: "other-claim" },
      ],
    });
    expect(() => validateInspectionOutputProgress(state(network), network.activations[0]!, output)).toThrow(/Facts-only inspection may not author inference claims[\s\S]*decision boundary/);
  });

  it("rejects a boundary that leaves newly proposed criteria unclosed, with corrective guidance", () => {
    const network = initialNetwork("check TODO-process-designer.md");
    network.activations[0]!.status = "running";
    const delta = inspectionOutputToDelta(InspectionOutputSchema.parse({
      outcome: "boundary",
      region: { allowedVariables: ["solution family"], acceptanceCriteria: ["worktrees reconciled", "wrong work discarded", "remaining items done"] },
      evidence: [{ text: "ledger is WAITING", source: "TODO-process-designer.md", kind: "repository", chunkId }],
      factIds: [],
      criterionEvidence: [],
      decisionBoundary: { basisRevision: 0, variables: [], permittedPairs: [] },
    }), tools);
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", delta, tools)).toThrow(/decision boundary requires evidence closure[\s\S]*criterionEvidence/);
  });

  it("surfaces the exhausting failure when blocked and re-queues failure-aware inspection once context changes", () => {
    const network = initialNetwork("check TODO-process-designer.md");
    const a1 = network.activations[0]!;
    a1.status = "failed";
    a1.error = "inspect:r1 returned invalid structured output after 3 attempts: Unknown graph fact ID TODO-process-designer.md.";
    const logicalActivationId = activationContextFingerprint(a1);
    network.schemaRetries[logicalActivationId] = { logicalActivationId, contextFingerprint: logicalActivationId, attempts: MAX_SCHEMA_ATTEMPTS, retries: 2, repairs: 2, reservedAttempts: 0, trace: [] };
    const blocked = ensureRunnableWork(network, 1);
    expect(blocked.blocked).toContain("No activation can make a novel state delta");
    expect(blocked.blocked).toContain("Last failure: inspect:r1 returned invalid structured output after 3 attempts");
    const changed = structuredClone(network);
    changed.regions[0]!.objective = "check @TODO-process-designer.md and reconcile its worktrees against current HEAD";
    const scheduled = ensureRunnableWork(changed, 1);
    expect(scheduled.blocked).toBeUndefined();
    const retry = scheduled.network.activations.find((item) => item.status === "queued");
    expect(retry).toBeDefined();
    expect(retry!.request).toContain("previous inspection output was rejected");
    expect(retry!.logicalActivationId).not.toBe(logicalActivationId);
  });

  it("re-queues a closed-boundary inspection when its repository evidence becomes stale", () => {
    const network = initialNetwork("check TODO-process-designer.md");
    const region = network.regions[0]!;
    network.activations[0]!.status = "completed";
    region.status = "superposed";
    region.domainPhase = "inspecting";
    region.acceptanceCriteria = ["worktrees reconciled"];
    region.inspectionObligationIds = [];
    region.evidenceIds = ["e1"];
    network.evidence.push({ id: "e1", text: "ledger is WAITING", source: "TODO-process-designer.md", kind: "repository", status: "stale", fingerprint: "stale-ledger" });
    network.activations.push({ id: "a2", capability: "inspect", regionId: "r1", request: "boundary", expectedDelta: "inspection:r1:boundary", contextRefs: ["r1", "e1"], status: "completed", basisRevision: network.revision });
    region.activationIds.push("a2");
    network.nextActivationId = 3;

    const scheduled = ensureRunnableWork(network, 1);
    expect(scheduled.blocked).toBeUndefined();
    expect(scheduled.network.activations.find((item) => item.status === "queued")?.expectedDelta).toMatch(/^inspection:r1:boundary:/);
  });
});
