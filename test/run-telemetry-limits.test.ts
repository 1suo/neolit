import { describe, expect, it } from "vitest";
import { MemorySaver } from "@langchain/langgraph";
import { solutionLodGraph } from "../src/solution-lod/graph.js";
import { applyBatchRecords, boundDomainFingerprint, domainFingerprint, initialNetwork } from "../src/solution-lod/reducer.js";
import type { ActivationTaskResult } from "../src/solution-lod/types.js";
import type { AgentRuntime } from "../src/types.js";

const usage = { turns: 1, input: 10, output: 2, reasoning: 0, cacheRead: 3, cacheWrite: 0, cost: 0.25 };
const contextTelemetry = { repositoryReadChars: 40, otherToolOutputChars: 5, bashOutputChars: 0, duplicateReadCharsAvoided: 7, accumulatedSessionInput: 60, cacheReadInput: 11, structuredRepairAttempts: 2 };
const initialInput = (task: string, runId: string) => ({ task: { id: `task-${runId}`, exactText: task }, authoritativeMessages: [], directory: ".", worktree: ".", runId });
const record = (overrides: Partial<ActivationTaskResult> = {}): ActivationTaskResult => ({ activationId: "a1", regionId: "r1", capability: "inspect", basisRevision: 0, startedAt: 20, finishedAt: 50, usage, outcome: "error", error: "test", networkDelta: null, promptChars: 120, schemaChars: 30, projectedSectionChars: { "CURRENT ACTIVATION": 20, OUTPUT: 10, "OUTPUT SCHEMA": 30 }, validationFailures: ["bad"], retries: 2, contextTelemetry, ...overrides });

describe("run telemetry and limits", () => {
  it("durably aggregates activation telemetry after the result log clears", () => {
    const network = initialNetwork("task"); network.activations[0].queuedAt = 10; network.activations[0].status = "running";
    const applied = applyBatchRecords(network, [record({ roleOutcome: "need-fact" })]).network;
    expect(applied.telemetry).toMatchObject({ activations: 1, retries: 2, promptChars: 120, schemaChars: 30, projectedContextChars: 90, validationFailures: 1, queueMs: 10, operationCalls: { inspect: 1 }, usage, contextTelemetry });
    expect(applied.telemetry?.regions.r1).toMatchObject({ elapsedMs: 30, queueMs: 10, schemaChars: 30, roleMs: { inspect: 30 }, contextTelemetry });
    expect(applied.telemetry?.activationRecords).toEqual([{ activationId: "a1", physicalActivationId: "a1", logicalActivationId: network.activations[0]!.logicalActivationId, regionId: "r1", role: "inspect", operation: "inspect", outcome: "error", roleOutcome: "need-fact", promptChars: 120, schemaChars: 30, projectedSectionChars: { "CURRENT ACTIVATION": 20, OUTPUT: 10, "OUTPUT SCHEMA": 30 }, repositoryReadChars: 40, otherToolOutputChars: 5, bashOutputChars: 0, duplicateReadCharsAvoided: 7, accumulatedSessionInput: 60, cacheReadInput: 11, repairAttempts: 2, promptAttempts: 0, schemaRetries: 0, schemaRepairs: 0, usage }]);
    expect(applyBatchRecords(applied, []).network.telemetry).toEqual(applied.telemetry);
    expect(applyBatchRecords(applied, [record()]).network.telemetry).toEqual(applied.telemetry);
  });

  it("counts deferred repairs without validation failures and records CEGAR diagnostics", () => {
    const network = initialNetwork("task");
    network.regions[0]!.progress.selectionNoProgress.fingerprint = "same-selection";
    const deferred = applyBatchRecords(network, [record({ outcome: "deferred", validationFailures: [], retries: 0 })]).network;
    expect(deferred.telemetry?.regions.r1).toMatchObject({ repairAttempts: 1, progressFingerprints: ["same-selection"] });

    const region = deferred.regions[0]!;
    region.status = "superposed";
    region.domainPhase = "challenging";
    region.decisionBoundary = { fingerprint: "empty", variables: [], permittedPairs: [] };
    region.candidateIds = ["r1:base"];
    deferred.candidates.push({ id: "r1:base", regionId: "r1", key: "base", proposition: "Base family", status: "possible", evidenceIds: [], eliminationReasons: [], stances: [] });
    region.domainFingerprint = domainFingerprint(deferred, "r1");
    region.boundDomainFingerprint = boundDomainFingerprint(deferred, "r1");
    deferred.activations.push({ id: "a2", capability: "synthesize", operation: "challenge-domain", domainFingerprint: region.boundDomainFingerprint, boundDomainFingerprint: region.boundDomainFingerprint, regionId: "r1", request: "challenge", expectedDelta: "challenge", contextRefs: ["r1", "r1:base"], status: "running", basisRevision: deferred.revision });
    const repaired = applyBatchRecords(deferred, [record({
      activationId: "a2",
      capability: "synthesize",
      operation: "challenge-domain",
      outcome: "applied",
      validationFailures: [],
      retries: 0,
      basisRevision: deferred.revision,
      networkDelta: { kind: "synthesis", output: { outcome: "counterexample", boundDomainFingerprint: region.boundDomainFingerprint!, candidate: { key: "missing", proposition: "Missing family", evidenceRefs: [], coordinates: [] }, reason: "missing", evidenceRefs: [] } },
    })]).network;
    expect(repaired.telemetry?.counterexampleRepairs).toBe(1);
  });

  it("exposes telemetry through the progress snapshot", () => {
    const network = initialNetwork("task"); network.telemetry!.retries = 2; network.telemetry!.reopens = 1; network.telemetry!.regionCount = 1; network.telemetry!.candidates = 3; network.telemetry!.promptChars = 99;
    const graph = solutionLodGraph({ agents: { inspect: "inspect", synthesize: "synthesize", refine: "refine", implement: "implement", verify: "verify", present: "present" }, checkpointer: new MemorySaver() });
    const state = { ...graph.initial(initialInput("task", "r")), network };
    const telemetry = graph.progress!(state)?.telemetry;
    expect(telemetry).toMatchObject({ retries: 2, reopens: 1, regionCount: 1, candidates: 3, promptChars: 99 });
    expect(graph.progress!(state)).toMatchObject({ contextTelemetry: network.telemetry!.contextTelemetry, semantic: { contextTelemetry: network.telemetry!.contextTelemetry, activationTelemetryRecords: [] } });
  });

  it.each([
    ["elapsedMs", { maxElapsedMs: 1 }, { startedAt: 0 }],
    ["cost", { maxCost: 0.1 }, { usage: { ...usage } }],
    ["retries", { maxRetries: 2 }, { telemetry: { retries: 2 } }],
    ["reopens", { maxReopens: 1 }, { telemetry: { reopens: 1 } }],
  ] as const)("blocks on exact %s metric", async (metric, runLimits, change) => {
    const runtime: AgentRuntime = { call: async () => { throw new Error("must block before activation"); } };
    const graph = solutionLodGraph({ agents: { inspect: "inspect", synthesize: "synthesize", refine: "refine", implement: "implement", verify: "verify", present: "present" }, runLimits, checkpointer: new MemorySaver() });
    const initial = graph.initial(initialInput("task", `limit-${metric}`));
    if ("startedAt" in change) initial.startedAt = change.startedAt;
    if ("usage" in change) initial.usage = change.usage;
    if ("telemetry" in change) Object.assign(initial.network.telemetry!, change.telemetry);
    const result = await graph.graph.invoke(initial, { recursionLimit: 3, configurable: { thread_id: `limit-${metric}`, langgraphOpenCodeRuntime: runtime } });
    expect(result.phase).toBe("blocked");
    expect(result.result).toContain(`metric=${metric}`);
    expect(result.result).toMatch(/used=.+ limit=/);
  });
});
