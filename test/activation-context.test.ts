import { describe, expect, it } from "vitest";
import { compileActivationPrompt, projectActivationContext } from "../src/solution-lod/graph.js";
import { applyBatchRecords, completeImplementation, ensureRunnableWork, initialNetwork, propagateNetwork, queueActivation, resolveContextReference, selectActivationBatch, supersedeStaleQueuedActivations } from "../src/solution-lod/reducer.js";
import type { ActivationTaskResult, SolutionLodState, SolutionNetwork } from "../src/solution-lod/types.js";

const usage = { turns: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
const state = (network: SolutionNetwork): SolutionLodState => ({ stateVersion: 10, runId: "context", directory: "/r", worktree: "/r", phase: "", activeBatch: [], network, results: [], usage, callsUsed: 0, startedAt: 0, result: "" });

function networkWithReferences(): SolutionNetwork {
  const network = initialNetwork("task");
  network.activations[0]!.status = "completed";
  network.regions[0]!.status = "superposed";
  network.regions[0]!.domainPhase = "inspecting";
  network.candidates.push({ id: "r1:c", regionId: "r1", key: "c", proposition: "candidate", status: "possible", evidenceIds: [], eliminationReasons: [], stances: [], createdRevision: 1 });
  network.evidence.push({ id: "e1", text: "fact", source: "inspection", kind: "tool", status: "confirmed", fingerprint: "fact", createdRevision: 1 });
  network.constraints.push({ id: "c1", kind: "supports", subject: "e1", target: "r1:c", reason: "supports", sourceActivationId: "a1", sourceKind: "repo-evidence", evidenceRefs: ["e1"], createdRevision: 1 });
  network.artifacts.push({ id: "x1", regionId: "r1", kind: "check", summary: "passed", passed: true, activationId: "a1", fingerprint: "passed", createdRevision: 1 });
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
    const projection = projectActivationContext(state(network), activation);
    expect(projection.referencedContext.map(({ ref, kind }) => [ref, kind])).toEqual(activation.readRefs!.filter((read) => !["activation", "artifact", "candidate"].includes(read.kind)).map(({ ref, kind }) => [ref, kind]));
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

  it("supersedes a region activation when exact authority changes", () => {
    let network = initialNetwork("task");
    network = queueActivation(network, "inspect", "r1", "inspect", "authority-sensitive", []);
    const activation = network.activations.at(-1)!;
    network.authority.task.exactText = "changed task";
    network = supersedeStaleQueuedActivations(network);
    expect(network.activations.find((item) => item.id === activation.id)).toMatchObject({ status: "superseded" });
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
      networkDelta: { kind: "delta", delta: { region: {}, evidence: [{ text: `${activation.regionId} fact`, source: `${activation.regionId}:1`, kind: "inference" }], candidates: [], constraints: [], select: [], activations: [] } },
    }));
    const applied = applyBatchRecords(network, records);
    expect(applied.applied).toEqual(activations.map((item) => item.id));
    expect(applied.superseded).toEqual([]);
    expect(applied.network.evidence.map((item) => item.text)).toEqual(["fact", "r2 fact", "r3 fact"]);
  });

  it("rejects concurrent sibling generation without controller-admitted boundaries", () => {
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
    const records: ActivationTaskResult[] = network.activations.map((activation) => ({ activationId: activation.id, regionId: activation.regionId, capability: "synthesize", operation: "generate-domain", basisRevision: 0, startedAt: 0, finishedAt: 1, usage, outcome: "applied", networkDelta: { kind: "synthesis", output: { outcome: "candidates", candidates: [{ key: "choice", proposition: `${activation.regionId} choice`, evidenceRefs: [], coordinates: [] }] } } }));
    const applied = applyBatchRecords(network, records);
    expect(applied.failed).toEqual(["a2", "a3"]);
    expect(applied.network.activations.find((item) => item.id === "a3")?.error).toContain("controller-admitted decision boundary");
  });

  it("recovers a current-state missing-boundary rejection through inspection", () => {
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
    const record: ActivationTaskResult = { activationId: "a2", regionId: "r2", capability: "synthesize", operation: "generate-domain", basisRevision: prepared.revision, startedAt: 0, finishedAt: 1, usage, outcome: "applied", networkDelta: { kind: "synthesis", output: { outcome: "candidates", candidates: [{ key: "cycle", proposition: "cycle", evidenceRefs: [], coordinates: [] }] } } };
    const stale = structuredClone(prepared);
    stale.activations[0]!.basisRevision = prepared.revision - 1;
    const staleRejected = applyBatchRecords(stale, [{ ...record, basisRevision: prepared.revision - 1 }]);
    expect(staleRejected.failed).toEqual(["a2"]);
    expect(staleRejected.superseded).toEqual([]);
    const rejected = applyBatchRecords(prepared, [record]);
    expect(rejected.failed).toEqual(["a2"]);
    expect(rejected.network.activations[0]).toMatchObject({ status: "failed", error: expect.stringContaining("controller-admitted decision boundary") });
    rejected.network.activations.push({ ...rejected.network.activations[0]!, id: "a3" }, { ...rejected.network.activations[0]!, id: "a4" });
    const scheduled = ensureRunnableWork(rejected.network);
    expect(scheduled.network.activations).toHaveLength(4);
    expect(scheduled.network.activations.at(-1)).toMatchObject({ capability: "inspect", regionId: "r2", status: "queued" });
    expect(scheduled.blocked).toBeUndefined();
  });

  it("returns rejected implementation work without mutations to an actionable retry", () => {
    const network = initialNetwork("implement");
    const region = network.regions[0]!;
    region.status = "implementing";
    region.domainPhase = "selected";
    network.activations = [{ id: "a2", capability: "implement", regionId: "r1", request: "implement", expectedDelta: "implementation", contextRefs: ["r1"], status: "running", basisRevision: network.revision }];
    const record: ActivationTaskResult = { activationId: "a2", regionId: "r1", capability: "implement", basisRevision: network.revision, startedAt: 0, finishedAt: 1, usage, outcome: "applied", networkDelta: { kind: "implementation", changedFiles: [], output: { outcome: "blocked", summary: "need fact", changedFiles: [], checks: [], blocker: "need fact" } } };
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
    network.evidence.push({ id: "e1", text: "before", source: "inspection", kind: "tool", fingerprint: "before" });
    network = queueActivation(network, "implement", "r1", "implement", "implementation", ["e1"]);
    const activation = network.activations.at(-1)!;
    activation.status = "running";
    network.regions[0]!.status = "implementing";
    network.evidence[0]!.text = "after";
    const record: ActivationTaskResult = { activationId: activation.id, regionId: "r1", capability: "implement", basisRevision: activation.basisRevision, startedAt: 0, finishedAt: 1, usage, outcome: "applied", networkDelta: { kind: "implementation", changedFiles: ["src/x.ts"], output: { outcome: "completed", summary: "changed", changedFiles: ["src/x.ts"], checks: [{ name: "test", passed: true, evidence: "passed" }] } } };
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

  it("projects the complete task lineage, sibling ownership, and unresolved root coverage as typed reads", () => {
    let network = initialNetwork("update core and CLI");
    network.activations = [];
    const root = network.regions[0]!;
    Object.assign(root, { status: "collapsed", acceptanceCriteria: ["core complete", "CLI complete"], criterionIds: ["criterion:scope:r1:0", "criterion:scope:r1:1"], requirementIds: ["requirement:core", "requirement:cli"] });
    const core = { ...structuredClone(root), id: "r2", key: "core", scopeId: "scope:r2" as const, parentId: "r1", parentCandidateId: "r1:selected", edge: "partOf" as const, lod: 1, objective: "update core", acceptanceCriteria: ["core passes"], criterionIds: ["criterion:scope:r2:0" as const], coveredCriteria: [0], requirementIds: ["requirement:core" as const], mutationResources: ["src/core.ts"], status: "collapsed" as const, activationIds: [] };
    const cli = { ...structuredClone(core), id: "r3", key: "cli", scopeId: "scope:r3" as const, objective: "update CLI", acceptanceCriteria: ["CLI passes"], criterionIds: ["criterion:scope:r3:0" as const], coveredCriteria: [1], requirementIds: ["requirement:cli" as const], mutationResources: ["src/cli.ts"], status: "unformed" as const };
    const leaf = { ...structuredClone(core), id: "r4", key: "core-leaf", scopeId: "scope:r4" as const, parentId: "r2", parentCandidateId: "r2:selected", lod: 2, objective: "edit core implementation", acceptanceCriteria: ["core passes"], criterionIds: ["criterion:scope:r4:0" as const], coveredCriteria: [0], status: "unformed" as const };
    network.regions.push(core, cli, leaf);
    network.materialRequirements = [
      { id: "requirement:core", key: "core", text: "core remains compatible", scopeId: core.scopeId, criterionId: core.criterionIds[0]!, evidenceRefs: ["task"] },
      { id: "requirement:cli", key: "cli", text: "CLI remains compatible", scopeId: cli.scopeId, criterionId: cli.criterionIds[0]!, evidenceRefs: ["task"] },
    ];
    network = queueActivation(network, "inspect", leaf.id, "inspect leaf", "leaf facts", [leaf.id]);
    const activation = network.activations.at(-1)!;
    const projection = projectActivationContext(state(network), activation);

    expect(projection.taskLineage.map((item) => item.regionId)).toEqual(["r1", "r2", "r4"]);
    expect(projection.taskLineage[1]).toMatchObject({ objective: "update core", requirementIds: ["requirement:core"], decomposition: { parentCandidateId: "r1:selected", coveredParentCriterionIds: ["criterion:scope:r1:0"] }, siblings: [{ regionId: "r3", requirementIds: ["requirement:cli"], mutationResources: ["src/cli.ts"] }] });
    expect(projection.unresolvedRootCoverage.map((item) => item.requirementId)).toEqual(["requirement:core", "requirement:cli"]);
    expect(activation.readRefs!.map((item) => item.ref)).toEqual(expect.arrayContaining(["r4", "requirement:core", "requirement:cli"]));

    network.regions.find((item) => item.id === "r1")!.objective = "changed root objective";
    network = supersedeStaleQueuedActivations(network);
    expect(network.activations.find((item) => item.id === activation.id)?.status).toBe("superseded");
  });

  it("projects immutable root requirement keys and defers their partitioning to refinement", () => {
    let network = initialNetwork("update core");
    const root = network.regions[0]!;
    root.acceptanceCriteria = ["core complete"];
    root.criterionIds = ["criterion:scope:r1:0"];
    root.requirementIds = ["requirement:core"];
    network.materialRequirements = [{ id: "requirement:core", key: "core", text: "core remains compatible", scopeId: root.scopeId, criterionId: root.criterionIds[0]!, evidenceRefs: ["task"] }];
    network.activations = [];
    network = queueActivation(network, "inspect", "r1", "form boundary", "boundary", ["requirement:core"]);
    const activation = network.activations[0]!;
    const projection = projectActivationContext(state(network), activation);

    expect(projection.requirements).toEqual([{ requirementId: "requirement:core", requirementKey: "core", requirement: "core remains compatible", ownerScopeId: "scope:r1", criterionId: "criterion:scope:r1:0", evidenceRefs: ["task"] }]);
    expect(compileActivationPrompt(state(network), activation)).toContain("Return a boundary without taskScopes");
  });

  it("retains measured files from an implementation superseded before admission", () => {
    const network = initialNetwork("implement");
    network.regions[0]!.status = "implementing";
    network.activations[0] = { ...network.activations[0]!, capability: "implement", status: "superseded" };
    const record: ActivationTaskResult = { activationId: "a1", regionId: "r1", capability: "implement", basisRevision: network.revision, startedAt: 0, finishedAt: 1, usage, outcome: "applied", networkDelta: { kind: "implementation", changedFiles: ["src/x.ts"], output: { outcome: "completed", summary: "changed", changedFiles: ["src/x.ts"], checks: [] } } };
    const applied = applyBatchRecords(network, [record]);
    expect(applied.failed).toEqual(["a1"]);
    expect(applied.network.regions[0]).toMatchObject({ status: "blocked", blockedReason: expect.stringContaining("superseded") });
    expect(applied.network.artifacts).toContainEqual(expect.objectContaining({ activationId: "a1", kind: "file", path: "src/x.ts" }));
  });

  it("retains late implementation mutations at the root after their region disappears", () => {
    const network = initialNetwork("implement");
    const record: ActivationTaskResult = { activationId: "a2", regionId: "r2", capability: "implement", basisRevision: network.revision, startedAt: 0, finishedAt: 1, usage, outcome: "applied", networkDelta: { kind: "implementation", changedFiles: ["src/orphan.ts"], output: { outcome: "completed", summary: "changed", changedFiles: ["src/orphan.ts"], checks: [] } } };
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
      network = completeImplementation(network, activation.id, { outcome: "completed", summary: "done", changedFiles: [], checks: [{ name: "test", passed: true, evidence: "passed" }] }, []);
    }
    const scheduled = ensureRunnableWork(network);
    expect(scheduled.network.activations.filter((item) => item.capability === "implement")).toHaveLength(3);
    expect(scheduled.blocked).toContain("Could not schedule implement");
  });

  it("retries verification with the exact prior validation failure", () => {
    const network = initialNetwork("verify");
    network.regions[0]!.status = "implemented";
    network.regions[0]!.domainPhase = "selected";
    network.activations = Array.from({ length: 2 }, (_, index) => ({ ...network.activations[0]!, id: `a${index + 1}`, capability: "verify" as const, status: "failed" as const, error: "missing criterion-specific evidence", contextRefs: ["r1"], readRefs: undefined }));
    network.nextActivationId = 3;
    const scheduled = ensureRunnableWork(network);
    expect(scheduled.blocked).toBeUndefined();
    expect(scheduled.network.activations.at(-1)).toMatchObject({ id: "a3", capability: "verify", status: "queued", request: expect.stringContaining("missing criterion-specific evidence") });
  });

});
