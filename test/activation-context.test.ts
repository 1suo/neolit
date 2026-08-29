import { describe, expect, it } from "vitest";
import { projectActivationContext } from "../src/solution-lod/graph.js";
import { applyBatchRecords, completeImplementation, ensureRunnableWork, initialNetwork, propagateNetwork, queueActivation, resolveContextReference, selectActivationBatch, supersedeStaleQueuedActivations } from "../src/solution-lod/reducer.js";
import type { ActivationTaskResult, SolutionLodState, SolutionNetwork } from "../src/solution-lod/types.js";

const usage = { turns: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
const state = (network: SolutionNetwork): SolutionLodState => ({ stateVersion: 8, runId: "context", originalTask: "task", conversationContext: "", directory: "/r", worktree: "/r", phase: "", activeBatch: [], network, results: [], usage, callsUsed: 0, startedAt: 0, result: "" });

function networkWithReferences(): SolutionNetwork {
  const network = initialNetwork("task");
  network.activations[0]!.status = "completed";
  network.regions[0]!.status = "superposed";
  network.regions[0]!.domainPhase = "inspecting";
  network.candidates.push({ id: "r1:c", regionId: "r1", key: "c", proposition: "candidate", status: "possible", evidenceIds: [], eliminationReasons: [], stances: [], createdRevision: 1 });
  network.evidence.push({ id: "e1", text: "fact", source: "src/x.ts:1", kind: "repository", status: "confirmed", fingerprint: "fact", createdRevision: 1 });
  network.constraints.push({ id: "c1", kind: "supports", subject: "e1", target: "r1:c", reason: "supports", sourceActivationId: "a1", sourceKind: "repo-evidence", evidenceRefs: ["e1"], createdRevision: 1 });
  network.artifacts.push({ id: "x1", regionId: "r1", kind: "check", summary: "passed", passed: true, activationId: "a1", createdRevision: 1 });
  network.variables.push({ id: "v1", name: "mode", ownerRegionId: "r1", seedLabels: ["fast"] });
  network.regions[0]!.candidateIds = ["r1:c"];
  network.regions[0]!.evidenceIds = ["e1"];
  network.regions[0]!.constraintIds = ["c1"];
  network.regions[0]!.artifactIds = ["x1"];
  return network;
}

describe("activation context", () => {
  it("resolves and projects every accepted typed context reference through one resolver", () => {
    let network = networkWithReferences();
    const refs = ["task", "r1", "r1:c", "e1", "c1", "x1", "a1", "v1:fast"];
    network = queueActivation(network, "inspect", "r1", "inspect refs", "refs", refs);
    const activation = network.activations.at(-1)!;
    expect(activation.readRefs!.map(({ ref, kind }) => [ref, kind])).toEqual([...activation.readRefs!].sort((left, right) => left.ref.localeCompare(right.ref)).map(({ ref, kind }) => [ref, kind]));
    expect(activation.readRefs!.map((read) => read.kind).sort()).toEqual(["activation", "artifact", "candidate", "constraint", "coordinate", "evidence", "region", "task"]);
    expect(activation.readRefs!.every((read) => Number.isInteger(read.revision) && read.fingerprint.length > 0)).toBe(true);
    const projection = projectActivationContext(state(network), activation) as { referencedContext: Array<{ ref: string; kind: string }> };
    expect(projection.referencedContext.map(({ ref, kind }) => [ref, kind])).toEqual(activation.readRefs!.map(({ ref, kind }) => [ref, kind]));
  });

  it("uses deterministic intent idempotency while allowing a fresh request after supersession", () => {
    let network = networkWithReferences();
    network = queueActivation(network, "inspect", "r1", "first wording", "same delta", ["e1"]);
    const first = network.activations.at(-1)!;
    network = queueActivation(network, "inspect", "r1", "different wording", "same delta", ["e1"]);
    expect(network.activations).toHaveLength(2);
    network.evidence[0]!.text = "changed fact";
    network = supersedeStaleQueuedActivations(network);
    expect(network.activations.find((item) => item.id === first.id)?.status).toBe("superseded");
    network = queueActivation(network, "inspect", "r1", "fresh wording", "same delta", ["e1"]);
    const fresh = network.activations.at(-1)!;
    expect(fresh.idempotencyKey).toBe(first.idempotencyKey);
    expect(fresh.readRefs!.find((item) => item.ref === "e1")?.fingerprint).not.toBe(first.readRefs!.find((item) => item.ref === "e1")?.fingerprint);
  });

  it("keeps unrelated sibling changes local but supersedes a stale queued read and stale result", () => {
    let network = networkWithReferences();
    network.regions.push({ ...structuredClone(network.regions[0]!), id: "r2", key: "sibling", scopeId: "scope:r2", candidateIds: [], constraintIds: [], evidenceIds: [], artifactIds: [], activationIds: [], criterionIds: [] });
    network = queueActivation(network, "inspect", "r1", "inspect fact", "fact", ["e1"]);
    const activation = network.activations.at(-1)!;
    network.regions.find((item) => item.id === "r2")!.objective = "changed sibling";
    expect(selectActivationBatch(network, 1).map((item) => item.id)).toEqual([activation.id]);
    network.evidence[0]!.text = "stale fact";
    const result: ActivationTaskResult = { activationId: activation.id, regionId: "r1", capability: "inspect", basisRevision: activation.basisRevision, startedAt: 0, finishedAt: 1, usage, outcome: "applied", networkDelta: { kind: "delta", delta: { region: {}, evidence: [], candidates: [], constraints: [], select: [], activations: [] } } };
    const applied = applyBatchRecords(network, [result]);
    expect(applied.superseded).toEqual([activation.id]);
    expect(applied.network.activations.find((item) => item.id === activation.id)?.status).toBe("superseded");
  });

  it("admits both production-created sibling results when neither typed read changes", () => {
    let network = networkWithReferences();
    network.regions.push(
      { ...structuredClone(network.regions[0]!), id: "r2", key: "left", scopeId: "scope:r2", parentId: "r1", edge: "partOf", candidateIds: [], constraintIds: [], evidenceIds: [], artifactIds: [], activationIds: [], criterionIds: [] },
      { ...structuredClone(network.regions[0]!), id: "r3", key: "right", scopeId: "scope:r3", parentId: "r1", edge: "partOf", candidateIds: [], constraintIds: [], evidenceIds: [], artifactIds: [], activationIds: [], criterionIds: [] },
    );
    network = propagateNetwork(network);
    network = queueActivation(network, "inspect", "r2", "inspect left", "left facts", ["r2"]);
    network = queueActivation(network, "inspect", "r3", "inspect right", "right facts", ["r3"]);
    const activations = network.activations.filter((item) => item.status === "queued");
    for (const activation of activations) activation.status = "running";
    const records: ActivationTaskResult[] = activations.map((activation) => ({
      activationId: activation.id, regionId: activation.regionId, capability: "inspect", basisRevision: activation.basisRevision, startedAt: 0, finishedAt: 1, usage, outcome: "applied",
      networkDelta: { kind: "delta", delta: { region: {}, evidence: [{ text: `${activation.regionId} fact`, source: `${activation.regionId}:1`, kind: "repository" }], candidates: [], constraints: [], select: [], activations: [] } },
    }));
    const applied = applyBatchRecords(network, records);
    expect(applied.applied).toEqual(activations.map((item) => item.id));
    expect(applied.superseded).toEqual([]);
    expect(applied.network.evidence.map((item) => item.text)).toEqual(["fact", "r2 fact", "r3 fact"]);
  });

  it("retains a production-reachable reducer rejection from concurrent sibling merges", () => {
    const network = initialNetwork("choose compatible modes");
    network.activations = [];
    network.variables.push(
      { id: "v1", name: "one", ownerRegionId: "r1", seedLabels: [] },
      { id: "v2", name: "two", ownerRegionId: "r1", seedLabels: [] },
      { id: "v3", name: "three", ownerRegionId: "r1", seedLabels: [] },
    );
    network.candidates.push({ id: "r1:base", regionId: "r1", key: "base", proposition: "base", status: "possible", evidenceIds: [], eliminationReasons: [], stances: [{ variableId: "v1", relation: "requires", valueLabel: "a" }, { variableId: "v2", relation: "requires", valueLabel: "b" }] });
    network.regions[0]!.candidateIds = ["r1:base"];
    const pairs = { r2: ["two", "three"], r3: ["one", "three"] } as const;
    for (const [id] of Object.entries(pairs) as Array<[keyof typeof pairs, readonly string[]]>) {
      network.regions.push({ ...structuredClone(network.regions[0]!), id, key: id, parentId: "r1", edge: "partOf", scopeId: `scope:${id}`, status: "superposed", domainPhase: "ungenerated", candidateIds: [], activationIds: [`a${id.slice(1)}`] });
      network.activations.push({ id: `a${id.slice(1)}`, capability: "synthesize", operation: "generate-domain", regionId: id, request: id, expectedDelta: id, contextRefs: [id], status: "running", basisRevision: 0 });
    }
    network.revision = 1;
    const records: ActivationTaskResult[] = network.activations.map((activation) => ({ activationId: activation.id, regionId: activation.regionId, capability: "synthesize", operation: "generate-domain", basisRevision: 0, startedAt: 0, finishedAt: 1, usage, outcome: "applied", networkDelta: { kind: "synthesis", output: { operation: "generate-domain", evidence: [], variables: [], constraints: [], candidates: [{ key: "choice", proposition: `${activation.regionId} choice`, evidenceRefs: [], stances: pairs[activation.regionId as keyof typeof pairs].map((variable) => ({ variable, relation: "requires" as const, valueLabel: "on" })) }] } } }));
    const applied = applyBatchRecords(network, records);
    expect(applied.superseded).toEqual(["a3"]);
    expect(applied.network.activations.find((item) => item.id === "a3")?.error).toContain("close a coupling cycle");
  });

  it("counts a current-state reducer rejection against the retry bound", () => {
    const network = initialNetwork("choose compatible modes");
    network.activations = [{ id: "a2", capability: "synthesize", operation: "generate-domain", regionId: "r2", request: "generate", expectedDelta: "generate", contextRefs: ["r2"], status: "running", basisRevision: 0 }];
    network.variables.push(
      { id: "v1", name: "one", ownerRegionId: "r1", seedLabels: [] },
      { id: "v2", name: "two", ownerRegionId: "r1", seedLabels: [] },
      { id: "v3", name: "three", ownerRegionId: "r1", seedLabels: [] },
    );
    network.candidates.push({ id: "r1:base", regionId: "r1", key: "base", proposition: "base", status: "possible", evidenceIds: [], eliminationReasons: [], stances: [{ variableId: "v1", relation: "requires", valueLabel: "a" }, { variableId: "v2", relation: "requires", valueLabel: "b" }] });
    network.regions[0]!.candidateIds = ["r1:base"];
    network.regions.push({ ...structuredClone(network.regions[0]!), id: "r2", key: "child", parentId: "r1", edge: "partOf", scopeId: "scope:r2", status: "superposed", domainPhase: "ungenerated", candidateIds: [], activationIds: ["a2"] });
    const prepared = propagateNetwork(network);
    prepared.activations[0]!.basisRevision = prepared.revision;
    const record: ActivationTaskResult = { activationId: "a2", regionId: "r2", capability: "synthesize", operation: "generate-domain", basisRevision: prepared.revision, startedAt: 0, finishedAt: 1, usage, outcome: "applied", networkDelta: { kind: "synthesis", output: { operation: "generate-domain", evidence: [], variables: [], constraints: [], candidates: [{ key: "cycle", proposition: "cycle", evidenceRefs: [], stances: ["one", "two", "three"].map((variable) => ({ variable, relation: "requires" as const, valueLabel: "on" })) }] } } };
    const stale = structuredClone(prepared);
    stale.activations[0]!.basisRevision = prepared.revision - 1;
    const staleRejected = applyBatchRecords(stale, [{ ...record, basisRevision: prepared.revision - 1 }]);
    expect(staleRejected.failed).toEqual(["a2"]);
    expect(staleRejected.superseded).toEqual([]);
    const rejected = applyBatchRecords(prepared, [record]);
    expect(rejected.failed).toEqual(["a2"]);
    expect(rejected.network.activations[0]).toMatchObject({ status: "failed", error: expect.stringContaining("close a coupling cycle") });
    rejected.network.activations.push({ ...rejected.network.activations[0]!, id: "a3" }, { ...rejected.network.activations[0]!, id: "a4" });
    const scheduled = ensureRunnableWork(rejected.network);
    expect(scheduled.network.activations).toHaveLength(3);
    expect(scheduled.blocked).toContain("No activation can make a novel state delta");
  });

  it("returns rejected implementation work without mutations to an actionable retry", () => {
    const network = initialNetwork("implement");
    const region = network.regions[0]!;
    region.status = "implementing";
    region.domainPhase = "selected";
    network.activations = [{ id: "a2", capability: "implement", regionId: "r1", request: "implement", expectedDelta: "implementation", contextRefs: ["r1"], status: "running", basisRevision: network.revision }];
    const record: ActivationTaskResult = { activationId: "a2", regionId: "r1", capability: "implement", basisRevision: network.revision, startedAt: 0, finishedAt: 1, usage, outcome: "applied", networkDelta: { kind: "implementation", changedFiles: [], output: { status: "blocked", summary: "need fact", changedFiles: [], checks: [], blocker: "need fact", activations: [{ capability: "inspect", request: "inspect", expectedDelta: "fact", contextRefs: ["missing"] }] } } };
    const rejected = applyBatchRecords(network, [record]);
    expect(rejected.failed).toEqual(["a2"]);
    expect(rejected.network.regions[0]!.status).toBe("actionable");
    const scheduled = ensureRunnableWork(rejected.network);
    expect(scheduled.blocked).toBeUndefined();
    expect(scheduled.network.activations).toContainEqual(expect.objectContaining({ capability: "implement", regionId: "r1", status: "queued" }));
  });

  it("retains measured files and blocks an implementation whose reads became stale", () => {
    let network = initialNetwork("implement");
    network.regions[0]!.status = "actionable";
    network.regions[0]!.domainPhase = "selected";
    network.evidence.push({ id: "e1", text: "before", source: "src/x.ts", kind: "repository", fingerprint: "before" });
    network = queueActivation(network, "implement", "r1", "implement", "implementation", ["e1"]);
    const activation = network.activations.at(-1)!;
    activation.status = "running";
    network.regions[0]!.status = "implementing";
    network.evidence[0]!.text = "after";
    const record: ActivationTaskResult = { activationId: activation.id, regionId: "r1", capability: "implement", basisRevision: activation.basisRevision, startedAt: 0, finishedAt: 1, usage, outcome: "applied", networkDelta: { kind: "implementation", changedFiles: ["src/x.ts"], output: { status: "completed", summary: "changed", changedFiles: ["src/x.ts"], checks: [{ name: "test", passed: true, evidence: "passed" }], activations: [] } } };
    const applied = applyBatchRecords(network, [record]);
    expect(applied.failed).toEqual([activation.id]);
    expect(applied.network.regions[0]!.status).toBe("blocked");
    expect(applied.network.artifacts).toContainEqual(expect.objectContaining({ kind: "file", path: "src/x.ts" }));
  });

  it("supersedes a result when an implicit shared-choice prompt input changes", () => {
    let network = initialNetwork("inspect");
    network.activations = [];
    network.variables.push({ id: "v1", name: "runtime", ownerRegionId: "r1", seedLabels: ["node"] });
    network.candidates.push({ id: "r1:node", regionId: "r1", key: "node", proposition: "Use Node", status: "selected", evidenceIds: [], eliminationReasons: [], stances: [{ variableId: "v1", relation: "requires", valueLabel: "node" }] });
    network.regions[0]!.candidateIds = ["r1:node"];
    network.regions[0]!.selectedCandidateIds = ["r1:node"];
    network = queueActivation(network, "inspect", "r1", "inspect", "facts", []);
    const activation = network.activations[0]!;
    activation.status = "running";
    network.candidates[0]!.proposition = "Use Node 22";
    const record: ActivationTaskResult = { activationId: activation.id, regionId: "r1", capability: "inspect", basisRevision: activation.basisRevision, startedAt: 0, finishedAt: 1, usage, outcome: "applied", networkDelta: { kind: "delta", delta: { region: {}, evidence: [], candidates: [], constraints: [], select: [], activations: [] } } };
    const applied = applyBatchRecords(network, [record]);
    expect(applied.superseded).toEqual([activation.id]);
  });

  it("retains measured files from an implementation superseded before admission", () => {
    const network = initialNetwork("implement");
    network.regions[0]!.status = "implementing";
    network.activations[0] = { ...network.activations[0]!, capability: "implement", status: "superseded" };
    const record: ActivationTaskResult = { activationId: "a1", regionId: "r1", capability: "implement", basisRevision: network.revision, startedAt: 0, finishedAt: 1, usage, outcome: "applied", networkDelta: { kind: "implementation", changedFiles: ["src/x.ts"], output: { status: "completed", summary: "changed", changedFiles: ["src/x.ts"], checks: [], activations: [] } } };
    const applied = applyBatchRecords(network, [record]);
    expect(applied.failed).toEqual(["a1"]);
    expect(applied.network.regions[0]).toMatchObject({ status: "blocked", blockedReason: expect.stringContaining("superseded") });
    expect(applied.network.artifacts).toContainEqual(expect.objectContaining({ activationId: "a1", kind: "file", path: "src/x.ts" }));
  });

  it("retains late implementation mutations at the root after their region disappears", () => {
    const network = initialNetwork("implement");
    const record: ActivationTaskResult = { activationId: "a2", regionId: "r2", capability: "implement", basisRevision: network.revision, startedAt: 0, finishedAt: 1, usage, outcome: "applied", networkDelta: { kind: "implementation", changedFiles: ["src/orphan.ts"], output: { status: "completed", summary: "changed", changedFiles: ["src/orphan.ts"], checks: [], activations: [] } } };
    const applied = applyBatchRecords(network, [record]);
    expect(applied.failed).toEqual(["a2"]);
    expect(applied.network.regions[0]).toMatchObject({ status: "blocked", blockedReason: expect.stringContaining("Original region r2 no longer exists") });
    expect(applied.network.artifacts).toContainEqual(expect.objectContaining({ activationId: "a2", regionId: "r1", kind: "file", path: "src/orphan.ts" }));
  });

  it("bounds repeated no-change implementations across revision changes", () => {
    let network = initialNetwork("implement");
    network.regions[0]!.status = "actionable";
    network.regions[0]!.domainPhase = "selected";
    for (let attempt = 0; attempt < 3; attempt++) {
      network = ensureRunnableWork(network).network;
      const activation = network.activations.findLast((item) => item.status === "queued")!;
      activation.status = "running";
      network.regions[0]!.status = "implementing";
      network = completeImplementation(network, activation.id, { status: "completed", summary: "done", changedFiles: [], checks: [{ name: "test", passed: true, evidence: "passed" }], activations: [] }, []);
    }
    const scheduled = ensureRunnableWork(network);
    expect(scheduled.network.activations.filter((item) => item.capability === "implement")).toHaveLength(3);
    expect(scheduled.blocked).toContain("Could not schedule implement");
  });

  it("retries verification with the exact prior validation failure", () => {
    const network = initialNetwork("verify");
    network.regions[0]!.status = "implemented";
    network.regions[0]!.domainPhase = "selected";
    network.activations = Array.from({ length: 3 }, (_, index) => ({ ...network.activations[0]!, id: `a${index + 1}`, capability: "verify" as const, status: "failed" as const, error: "missing criterion-specific evidence", contextRefs: ["r1"], readRefs: undefined }));
    network.nextActivationId = 4;
    const scheduled = ensureRunnableWork(network);
    expect(scheduled.blocked).toBeUndefined();
    expect(scheduled.network.activations.at(-1)).toMatchObject({ id: "a4", capability: "verify", status: "queued", request: expect.stringContaining("missing criterion-specific evidence") });
  });

});
