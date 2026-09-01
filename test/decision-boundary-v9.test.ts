import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DomainGenerationOutputSchema, InspectionOutputSchema, SolutionDeltaSchema, type Activation, type SolutionLodState, type SolutionNetwork } from "../src/solution-lod/types.js";
import { admitDecisionBoundary, applyActivationOutput, boundDomainFingerprint, ensureRunnableWork, enumerationFingerprint, initialNetwork, inspectionOutputToDelta, invalidateEvidenceDigestMismatches, invalidateStaleEvidence, mergeSolutionDelta, mergeSynthesisOutput, validateSolutionDelta, validateSynthesisOutput } from "../src/solution-lod/reducer.js";
import { repositoryEvidenceDigests } from "../src/solution-lod/graph.js";

const usage = { turns: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
const state = (network: SolutionNetwork): SolutionLodState => ({ stateVersion: 10, runId: "boundary", directory: "/r", worktree: "/r", phase: "", activeBatch: [], network, results: [], usage, callsUsed: 0, startedAt: 0, result: "" });
const proposal = (network: SolutionNetwork) => ({ basisRevision: network.revision, variables: [
  { key: "runtime", name: "Runtime", ownerRegionId: "r1", seedLabels: ["Node", "Bun"], evidenceRefs: ["task"] },
  { key: "transport", name: "Transport", ownerRegionId: "r1", seedLabels: ["native", "adapter"], evidenceRefs: ["task"] },
], permittedPairs: [{ leftVariableKey: "runtime", rightVariableKey: "transport", evidenceRefs: ["task"] }] });

it("does not invalidate worktree evidence when repository observation is unavailable", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "unavailable-worktree-observer-"));
  try {
    const network = initialNetwork("inspect worktrees");
    network.evidence.push({ id: "e1", text: "inventory", source: "worktrees", kind: "repository", status: "confirmed", fingerprint: "inventory-v1", location: { canonicalPath: ".git/worktrees", range: [0, 0], fileDigest: "inventory-v1", snapshotEpoch: 0, observation: "worktrees" }, controllerVerified: { activationId: "a1", tool: "graph_inspect_worktrees" } });
    expect(repositoryEvidenceDigests(directory, network)).toEqual({});
    expect(invalidateEvidenceDigestMismatches(network, repositoryEvidenceDigests(directory, network)).evidence.at(-1)?.status).toBe("confirmed");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

function bounded(): SolutionNetwork {
  const network = initialNetwork("choose");
  network.activations[0]!.status = "running";
  const delta = SolutionDeltaSchema.parse({ decisionBoundary: proposal(network), region: { acceptanceCriteria: ["works"] }, criterionEvidence: [{ criterionIndex: 0, evidenceRefs: ["task"] }], evidence: [], activations: [] });
  validateSolutionDelta(state(network), "r1", "inspect", delta);
  return mergeSolutionDelta(state(network), "a1", delta);
}

function generation(network: SolutionNetwork) {
  const variables = network.regions[0]!.decisionBoundary!.variables;
  return DomainGenerationOutputSchema.parse({ outcome: "candidates", evidence: [], candidates: [
    { key: "native", proposition: "Use native Node", evidenceRefs: [], coordinates: variables.map((variable) => ({ variableId: variable.id, applicability: "applies", stances: [{ relation: "requires", valueLabel: variable.seedLabels[0] }] })) },
    { key: "other", proposition: "Use another route", evidenceRefs: [], coordinates: variables.map((variable) => ({ variableId: variable.id, applicability: "not-applicable", reason: "not used" })) },
  ] });
}

describe("v9 admitted decision boundaries", () => {
  it("allows typed requirements to replace controller-generated root placeholders", () => {
    const network = initialNetwork("choose");
    network.regions[0]!.acceptanceCriteria = ["works"];
    network.regions[0]!.criterionIds = ["criterion:scope:r1:0"];
    network.regions[0]!.inspectionObligationIds = ["criterion:scope:r1:0"];
    network.materialRequirements = [{ id: "requirement:root-criterion-0", key: "root-criterion-0", text: "works", scopeId: "scope:r1", criterionId: "criterion:scope:r1:0", evidenceRefs: ["task"] }];
    const delta = SolutionDeltaSchema.parse({ decisionBoundary: proposal(network), criterionEvidence: [{ criterionIndex: 0, evidenceRefs: ["task"] }], materialRequirements: [{ key: "runtime-contract", text: "Runtime contract works", scopeKey: "r1", criterionIndex: 0, evidenceRefs: ["task"] }] });
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", delta)).not.toThrow();
  });

  it("assigns collision-free internal names across independently owned boundaries", () => {
    const network = initialNetwork("choose");
    network.variables.push({ id: "v99", name: "runtime", ownerRegionId: "r2", seedLabels: [] });
    const admitted = admitDecisionBoundary(network, "r1", proposal(network));
    expect(admitted.regions[0]!.decisionBoundary!.variables.map((item) => item.name)).toEqual(["runtime-r1", "transport"]);
  });

  it("does not revise or reschedule empty and replayed inspection output", () => {
    const empty = initialNetwork("inspect"); empty.activations[0]!.status = "running";
    const emptyResult = applyActivationOutput(state(empty), empty.activations[0]!, SolutionDeltaSchema.parse({}));
    expect(emptyResult).toMatchObject({ revision: 0, regions: [{ status: "unformed", domainPhase: "inspecting" }] });
    for (let attempt = 0; attempt < 3; attempt++) {
      const stopped = ensureRunnableWork(emptyResult);
      expect(stopped.network).toMatchObject({ revision: 0, activations: [{ id: "a1", status: "completed" }] });
      expect(stopped.blocked).toMatch(/No activation can make a novel state delta/);
    }

    const fresh = initialNetwork("inspect"); fresh.activations[0]!.status = "running";
    const fact = SolutionDeltaSchema.parse({ evidence: [{ text: "one hypothesis", source: "fixture", kind: "inference" }] });
    const first = applyActivationOutput(state(fresh), fresh.activations[0]!, fact);
    expect(first.revision).toBe(1);
    const scheduled = ensureRunnableWork(first).network;
    expect(scheduled.activations).toHaveLength(2);
    scheduled.activations[1]!.status = "running";
    const replay = applyActivationOutput(state(scheduled), scheduled.activations[1]!, fact);
    expect(replay.revision).toBe(1);
    expect(ensureRunnableWork(replay).network.activations).toHaveLength(2);
  });

  it("keeps fact-only inspection inspecting and preserves a requested follow-up inspection", () => {
    const network = initialNetwork("inspect first");
    network.activations[0]!.status = "running";
    const output = SolutionDeltaSchema.parse({
      evidence: [{ text: "controller supplied one fact", source: "configured fixture", kind: "inference" }],
      activations: [{ capability: "inspect", request: "inspect the named configuration", expectedDelta: "configured-value", contextRefs: [], requiredCapabilities: ["repository-observe"] }],
    });
    const landed = applyActivationOutput(state(network), network.activations[0]!, output);
    expect(landed.regions[0]).toMatchObject({ decisionBoundary: undefined, domainPhase: "inspecting" });
    expect(landed.activations.at(-1)).toMatchObject({ capability: "inspect", status: "queued", request: "inspect the named configuration" });
    const scheduled = ensureRunnableWork(landed);
    expect(scheduled.blocked).toBeUndefined();
    expect(scheduled.network.activations.at(-1)).toMatchObject({ capability: "inspect", status: "queued", request: "inspect the named configuration" });

    const ordinary = initialNetwork("inspect only"); ordinary.activations[0]!.status = "running";
    const factOnly = applyActivationOutput(state(ordinary), ordinary.activations[0]!, SolutionDeltaSchema.parse({ evidence: [{ text: "ordinary fact", source: "fixture", kind: "inference" }] }));
    expect(factOnly.regions[0]).toMatchObject({ decisionBoundary: undefined, domainPhase: "inspecting" });
  });

  it("admits repository evidence only from an exact successful graph_read descriptor", () => {
    const location = { canonicalPath: "src/x.ts", range: [1, 4] as [number, number], fileDigest: "real", snapshotEpoch: 2 };
    const output = SolutionDeltaSchema.parse({ evidence: [{ text: "fact", source: "src/x.ts:1-4", kind: "repository", location }] });
    const trace = { tool: "graph_read", status: "completed" as const, metadata: { repositoryDescriptor: location } };
    const fresh = initialNetwork("inspect"); fresh.activations[0]!.status = "running";
    expect(() => applyActivationOutput(state(fresh), fresh.activations[0]!, output, [], [{ ...trace, metadata: { repositoryDescriptor: { ...location, fileDigest: "fake" } } }])).toThrow(/does not exactly match/);
    expect(() => applyActivationOutput(state(fresh), fresh.activations[0]!, output, [], [{ ...trace, metadata: { repositoryDescriptor: { ...location, canonicalPath: "src/fake.ts" } } }])).toThrow(/does not exactly match/);
    expect(() => SolutionDeltaSchema.parse({ evidence: [{ text: "missing", source: "src/x.ts", kind: "repository" }] })).toThrow(/requires a controller-verifiable/);
    const landed = applyActivationOutput(state(fresh), fresh.activations[0]!, output, [], [trace]);
    expect(landed.evidence[0]).toMatchObject({ location, status: "confirmed", controllerVerified: { activationId: "a1", tool: "graph_read" } });
    const forged = SolutionDeltaSchema.parse({ evidence: [{ text: "fact", source: "shell", kind: "tool" }] });
    expect(() => validateSolutionDelta(state(fresh), "r1", "inspect", forged)).toThrow(/cannot author confirmed tool evidence/i);
    expect(() => mergeSolutionDelta(state(fresh), "a1", forged)).toThrow(/cannot author confirmed tool evidence/i);
  });

  it("derives repository provenance from a successful graph_read chunk ID", () => {
    const location = { canonicalPath: "src/x.ts", range: [1, 4] as [number, number], fileDigest: "real", snapshotEpoch: 2 };
    const output = InspectionOutputSchema.parse({ outcome: "facts", evidence: [{ text: "fact", source: "src/x.ts:1-4", kind: "repository", chunkId: "chunk-x" }], validations: [{ claimRef: "e-hypothesis", verdict: "confirmed", evidenceRefs: ["chunk-x"], reason: "observed" }] });
    const tools = [{ tool: "graph_read", status: "completed" as const, metadata: { repositoryDescriptor: { chunkId: "chunk-x", ...location } } }];
    expect(inspectionOutputToDelta(output, tools).evidence[0]).toEqual({ text: "fact", source: "src/x.ts:1-4", kind: "repository", assertion: "repository-presence", location });
    expect(inspectionOutputToDelta(output, tools).validations).toEqual([{ claimRef: "e-hypothesis", verdict: "confirmed", evidenceRefs: ["chunk-x"], reason: "observed" }]);
    expect(() => inspectionOutputToDelta(output, [{ ...tools[0], metadata: { repositoryDescriptor: { chunkId: "other", ...location } } }])).toThrow(/does not match a successful repository observation/);
  });

  it("validates a hypothesis through a repository chunk authored in the same inspection", () => {
    const network = initialNetwork("inspect"); network.activations[0]!.status = "running";
    network.evidence.push({ id: "e1", text: "The ledger may be complete", source: "model", kind: "inference", status: "hypothesis", fingerprint: "claim" });
    network.nextEvidenceId = 2;
    network.regions[0]!.evidenceIds.push("e1");
    const location = { canonicalPath: "TODO.md", range: [1, 4] as [number, number], fileDigest: "todo", snapshotEpoch: 2 };
    const tools = [{ tool: "graph_read", status: "completed" as const, metadata: { repositoryDescriptor: { chunkId: "chunk-proof", ...location } } }];
    const output = InspectionOutputSchema.parse({
      outcome: "facts",
      evidence: [{ text: "The ledger is complete", source: "TODO.md:1-4", kind: "repository", chunkId: "chunk-proof" }],
      validations: [{ claimRef: "e1", verdict: "confirmed", evidenceRefs: ["chunk-proof"], reason: "observed in the ledger" }],
    });
    const delta = inspectionOutputToDelta(output, tools);
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", delta, tools)).not.toThrow();
    const landed = applyActivationOutput(state(network), network.activations[0]!, delta, [], tools);
    expect(landed.evidence.find((item) => item.id === "e1")).toMatchObject({ status: "confirmed", validationEvidenceRefs: ["e2"] });
  });

  it("requires an authored observation for a repository chunk cited by criterion evidence", () => {
    const location = { canonicalPath: "TODO.md", range: [4, 8] as [number, number], fileDigest: "todo", snapshotEpoch: 1 };
    const tools = [{ tool: "graph_read", status: "completed" as const, metadata: { repositoryDescriptor: { chunkId: "todo-chunk", ...location } } }];
    const output = InspectionOutputSchema.parse({ outcome: "facts", region: { acceptanceCriteria: ["work is inventoried"] }, evidence: [], criterionEvidence: [{ criterionIndex: 0, evidenceRefs: ["todo-chunk"] }] });
    expect(() => inspectionOutputToDelta(output, tools)).toThrow(/requires a matching evidence entry/);
  });

  it("requires an authored observation for repository chunks cited by material requirements", () => {
    const location = { canonicalPath: "TODO.md", range: [10, 12] as [number, number], fileDigest: "todo", snapshotEpoch: 1 };
    const tools = [{ tool: "graph_read", status: "completed" as const, metadata: { repositoryDescriptor: { chunkId: "requirement-chunk", ...location } } }];
    const output = InspectionOutputSchema.parse({ outcome: "boundary", evidence: [], decisionBoundary: { basisRevision: 0, variables: [], permittedPairs: [] }, materialRequirements: [{ key: "required", text: "Complete required work", evidenceRefs: ["requirement-chunk"] }] });
    expect(() => inspectionOutputToDelta(output, tools)).toThrow(/requires a matching evidence entry/);
  });

  it("resolves same-source repository chunks to their distinct evidence ids", () => {
    const network = initialNetwork("inspect"); network.activations[0]!.status = "running";
    const first = { canonicalPath: "TODO.md", range: [1, 2] as [number, number], fileDigest: "todo", snapshotEpoch: 1 };
    const second = { canonicalPath: "TODO.md", range: [4, 5] as [number, number], fileDigest: "todo", snapshotEpoch: 1 };
    const tools = [
      { tool: "graph_read", status: "completed" as const, metadata: { repositoryDescriptor: { chunkId: "chunk-one", ...first } } },
      { tool: "graph_read", status: "completed" as const, metadata: { repositoryDescriptor: { chunkId: "chunk-two", ...second } } },
    ];
    const output = InspectionOutputSchema.parse({
      outcome: "boundary",
      region: { allowedVariables: ["solution family"], acceptanceCriteria: ["one", "two"] },
      evidence: [
        { text: "first fact", source: "TODO.md", kind: "repository", chunkId: "chunk-one" },
        { text: "second fact", source: "TODO.md", kind: "repository", chunkId: "chunk-two" },
      ],
      criterionEvidence: [{ criterionIndex: 0, evidenceRefs: ["chunk-one"] }, { criterionIndex: 1, evidenceRefs: ["chunk-two"] }],
      decisionBoundary: { basisRevision: 0, variables: [{ key: "solution-family", name: "solution family", ownerRegionId: "r1", seedLabels: [], evidenceRefs: ["chunk-one", "chunk-two"] }], permittedPairs: [] },
    });
    const delta = inspectionOutputToDelta(output, tools);
    const landed = applyActivationOutput(state(network), network.activations[0]!, delta, [], tools);
    expect(landed.evidence).toHaveLength(2);
    expect(landed.regions[0]!.decisionBoundary!.variables[0]!.evidenceRefs).toEqual(landed.evidence.map((item) => item.id));
  });

  it("resolves same-output boundary evidence and rejects the whole transaction on failure", () => {
    const network = initialNetwork("choose"); network.activations[0]!.status = "running";
    const location = { canonicalPath: "src/x.ts", range: [1, 2] as [number, number], fileDigest: "digest", snapshotEpoch: 0 };
    const tools = [{ tool: "graph_read", status: "completed" as const, metadata: { repositoryDescriptor: location } }];
    const delta = SolutionDeltaSchema.parse({
      evidence: [{ text: "runtime is Node", source: "src/x.ts:1-2", kind: "repository", location }],
      decisionBoundary: { basisRevision: 0, variables: [{ key: "runtime", name: "runtime", ownerRegionId: "r1", seedLabels: ["Node"], evidenceRefs: ["src/x.ts:1-2"] }], permittedPairs: [] },
    });
    validateSolutionDelta(state(network), "r1", "inspect", delta, tools);
    const merged = mergeSolutionDelta(state(network), "a1", delta, tools);
    expect(merged.regions[0]!.decisionBoundary!.variables[0]!.evidenceRefs).toEqual([merged.evidence[0]!.id]);

    const original = JSON.stringify(network);
    const cyclic = SolutionDeltaSchema.parse({
      evidence: [{ text: "runtime is Node", source: "src/x.ts:1-2", kind: "repository", location }],
      decisionBoundary: { basisRevision: 0, variables: ["a", "b", "c"].map((key) => ({ key, name: key, ownerRegionId: "r1", seedLabels: [], evidenceRefs: ["src/x.ts:1-2"] })), permittedPairs: [["a", "b"], ["b", "c"], ["c", "a"]].map(([leftVariableKey, rightVariableKey]) => ({ leftVariableKey, rightVariableKey, evidenceRefs: ["src/x.ts:1-2"] })) },
    });
    expect(() => mergeSolutionDelta(state(network), "a1", cyclic, tools)).toThrow(/cycle/);
    expect(JSON.stringify(network)).toBe(original);
  });

  it("admits a boundary backed by a hypothesis confirmed in the same inspection", () => {
    const network = initialNetwork("choose"); network.activations[0]!.status = "running";
    network.evidence.push({ id: "e1", text: "Node is supported", source: "prior inference", kind: "inference", status: "hypothesis", fingerprint: "hypothesis" });
    network.nextEvidenceId = 2;
    const location = { canonicalPath: "src/x.ts", range: [1, 2] as [number, number], fileDigest: "digest", snapshotEpoch: 0 };
    const tools = [{ tool: "graph_read", status: "completed" as const, metadata: { repositoryDescriptor: location } }];
    const delta = SolutionDeltaSchema.parse({
      evidence: [{ text: "Node is configured", source: "src/x.ts:1-2", kind: "repository", location }],
      validations: [{ claimRef: "e1", verdict: "confirmed", evidenceRefs: ["src/x.ts:1-2"], reason: "configured" }],
      decisionBoundary: { basisRevision: 0, variables: [{ key: "runtime", name: "runtime", ownerRegionId: "r1", seedLabels: ["Node"], evidenceRefs: ["e1"] }], permittedPairs: [] },
    });
    validateSolutionDelta(state(network), "r1", "inspect", delta, tools);
    const merged = mergeSolutionDelta(state(network), "a1", delta, tools);
    expect(merged.evidence.find((item) => item.id === "e1")).toMatchObject({ status: "confirmed", validationEvidenceRefs: ["e2"] });
    expect(merged.regions[0]!.decisionBoundary!.variables[0]!.evidenceRefs).toEqual(["e1"]);
  });
  it("assigns IDs, canonicalizes labels, and validates the complete forest atomically", () => {
    const network = bounded();
    expect(network.regions[0]!.decisionBoundary).toMatchObject({ variables: [{ id: "v1", name: "runtime", seedLabels: ["Bun", "Node"] }, { id: "v2", name: "transport" }], permittedPairs: [{ leftVariableId: "v1", rightVariableId: "v2" }] });
    const cyclic = initialNetwork("cycle");
    const bad = { basisRevision: 0, variables: ["a", "b", "c"].map((key) => ({ key, name: key, ownerRegionId: "r1", seedLabels: [], evidenceRefs: [] })), permittedPairs: [["a", "b"], ["b", "c"], ["c", "a"]].map(([leftVariableKey, rightVariableKey]) => ({ leftVariableKey, rightVariableKey, evidenceRefs: [] })) };
    expect(() => admitDecisionBoundary(cyclic, "r1", bad)).toThrow(/cycle/);
    expect(cyclic.variables).toEqual([]);
  });

  it("requires complete admitted coordinates and separates enumeration from bound semantics", () => {
    let network = bounded();
    const activation: Activation = { id: "a2", capability: "synthesize", operation: "generate-domain", regionId: "r1", request: "generate", expectedDelta: "domain", contextRefs: ["r1"], status: "running", basisRevision: network.revision };
    network.activations.push(activation); network.regions[0]!.activationIds.push("a2");
    const output = generation(network);
    validateSynthesisOutput(state(network), activation, output);
    network = mergeSynthesisOutput(state(network), "a2", output);
    const enumeration = enumerationFingerprint(network, "r1");
    const bound = boundDomainFingerprint(network, "r1");
    network.candidates[0]!.stances[0]!.valueLabel = "Node";
    expect(enumerationFingerprint(network, "r1")).toBe(enumeration);
    expect(boundDomainFingerprint(network, "r1")).not.toBe(bound);
    expect(() => DomainGenerationOutputSchema.parse({ ...output, variables: [] })).toThrow();
  });

  it("rejects a candidate spanning more than two variables with actionable topology guidance", () => {
    let network = initialNetwork("reconcile");
    network = admitDecisionBoundary(network, "r1", { basisRevision: 0, variables: ["ledger", "worktree", "capability"].map((key) => ({ key, name: key, ownerRegionId: "r1", seedLabels: [key], evidenceRefs: ["task"] })), permittedPairs: [
      { leftVariableKey: "ledger", rightVariableKey: "worktree", evidenceRefs: ["task"] },
      { leftVariableKey: "ledger", rightVariableKey: "capability", evidenceRefs: ["task"] },
    ] });
    const activation: Activation = { id: "a2", capability: "synthesize", operation: "generate-domain", regionId: "r1", request: "generate", expectedDelta: "domain", contextRefs: ["r1"], status: "running", basisRevision: network.revision };
    const variables = network.regions[0]!.decisionBoundary!.variables;
    const output = DomainGenerationOutputSchema.parse({ outcome: "candidates", evidence: [], candidates: [{ key: "reconcile", proposition: "Reconcile verified work", evidenceRefs: ["task"], coordinates: variables.map((variable) => ({ variableId: variable.id, applicability: "applies", stances: [{ relation: "requires", valueLabel: variable.seedLabels[0] }] })) }] });
    expect(() => validateSynthesisOutput(state(network), activation, output)).toThrow(/more than two shared variables.*composite variable or decompose/);
  });

  it("rejects multiple required options for one categorical shared choice before selection", () => {
    let network = initialNetwork("reconcile");
    network = admitDecisionBoundary(network, "r1", { basisRevision: 0, variables: [{ key: "solution-family", name: "solution family", ownerRegionId: "r1", seedLabels: ["current-head", "replacement"], evidenceRefs: ["task"] }], permittedPairs: [] });
    const activation: Activation = { id: "a2", capability: "synthesize", operation: "generate-domain", regionId: "r1", request: "generate", expectedDelta: "domain", contextRefs: ["r1"], status: "running", basisRevision: network.revision };
    const variable = network.regions[0]!.decisionBoundary!.variables[0]!;
    const output = DomainGenerationOutputSchema.parse({ outcome: "candidates", evidence: [], candidates: [{ key: "combined", proposition: "Reconcile and replace", evidenceRefs: ["task"], coordinates: [{ variableId: variable.id, applicability: "applies", stances: [{ relation: "requires", valueLabel: "current-head" }, { relation: "requires", valueLabel: "replacement" }] }] }] });
    expect(() => validateSynthesisOutput(state(network), activation, output)).toThrow(/requires multiple options.*composite option or decompose/);
  });

  it("keeps a fixed boundary to one family without reopening inspection", () => {
    let network = initialNetwork("apply the fixed change");
    network.regions[0]!.allowedVariables = [];
    network = admitDecisionBoundary(network, "r1", { basisRevision: 0, variables: [], permittedPairs: [] });
    const activation: Activation = { id: "a2", capability: "synthesize", operation: "generate-domain", regionId: "r1", request: "generate", expectedDelta: "domain", contextRefs: ["r1"], status: "running", basisRevision: network.revision };
    const two = DomainGenerationOutputSchema.parse({ outcome: "candidates", candidates: [
      { key: "fixed", proposition: "Apply the fixed change", coordinates: [] },
      { key: "sequence", proposition: "Apply the same change in another order", coordinates: [] },
    ] });
    expect(() => validateSynthesisOutput(state(network), activation, two)).toThrow(/exactly one implementation family/);

    network.activations.push(activation);
    network.regions[0]!.activationIds.push(activation.id);
    network = mergeSynthesisOutput(state(network), activation.id, DomainGenerationOutputSchema.parse({ outcome: "candidates", candidates: [{ key: "fixed", proposition: "Apply the fixed change", coordinates: [] }] }));
    const challenge: Activation = { ...activation, id: "a3", operation: "challenge-domain", basisRevision: network.revision, boundDomainFingerprint: network.regions[0]!.boundDomainFingerprint };
    network.activations.push(challenge);
    network.regions[0]!.activationIds.push(challenge.id);
    expect(() => validateSynthesisOutput(state(network), challenge, { outcome: "boundary-counterexample", boundDomainFingerprint: network.regions[0]!.boundDomainFingerprint ?? "", missingFamily: { key: "other", proposition: "Invent another tactic" }, defect: { kind: "missing-variable", description: "No tactic variable" }, evidenceRefs: [] })).toThrow(/no alternative family/);

    network.regions[0]!.acceptedFingerprint = network.regions[0]!.boundDomainFingerprint;
    const selection: Activation = { ...activation, id: "a4", operation: "select-candidate", basisRevision: network.revision, boundDomainFingerprint: network.regions[0]!.boundDomainFingerprint };
    expect(() => validateSynthesisOutput(state(network), selection, { outcome: "hard-constraint", boundDomainFingerprint: network.regions[0]!.boundDomainFingerprint ?? "", comparisons: [{ candidateId: "r1:fixed", userPreference: "neutral", repositoryCompatibility: "neutral", changeScope: "neutral", irreversibleRisk: "neutral", evidenceRefs: [] }], hardConstraints: [{ kind: "refutes", subject: "task", target: "r1:fixed", reason: "temporary prerequisite", sourceKind: "repo-evidence", evidenceRefs: ["task"] }] })).toThrow(/fixed boundary/);
  });

  it("preserves controller-locked allowed variables during inspection", () => {
    const network = initialNetwork("reconcile");
    const region = network.regions[0]!;
    region.allowedVariables = ["verified reconciliation disposition"];
    region.allowedVariablesLocked = true;
    network.activations[0]!.status = "running";
    const rewritten = SolutionDeltaSchema.parse({ region: { allowedVariables: ["ledger", "worktree"] } });
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", rewritten)).toThrow(/controller-locked allowed variables/);
    const splitBoundary = SolutionDeltaSchema.parse({ decisionBoundary: { basisRevision: 0, variables: ["ledger", "worktree"].map((key) => ({ key, name: key, ownerRegionId: "r1", seedLabels: [], evidenceRefs: ["task"] })), permittedPairs: [] } });
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", splitBoundary)).toThrow(/declare exactly the controller-locked allowed variables/);
  });

  it("invalidates a stale boundary premise atomically without touching workspace state", () => {
    const base = initialNetwork("choose");
    base.evidence.push({ id: "e1", text: "fact", source: "inspection", kind: "tool", status: "confirmed", fingerprint: "fact" });
    base.evidence.push({ id: "e2", text: "validated runtime", source: "inference", kind: "inference", status: "confirmed", fingerprint: "validated", validationEvidenceRefs: ["e1"] });
    const admitted = admitDecisionBoundary(base, "r1", { basisRevision: 0, variables: [{ key: "runtime", name: "runtime", ownerRegionId: "r1", seedLabels: ["node"], evidenceRefs: ["e2"] }], permittedPairs: [] });
    admitted.constraints.push({ id: "c1", kind: "supports", subject: "e2", target: "task", reason: "validated", sourceActivationId: "a1", sourceKind: "repo-evidence", evidenceRefs: ["e2"] }); admitted.regions[0]!.constraintIds.push("c1");
    admitted.regions[0]!.artifactIds.push("x1"); admitted.artifacts.push({ id: "x1", regionId: "r1", kind: "file", path: "src/x.ts", summary: "changed", activationId: "a1", fingerprint: "changed" });
    const invalidated = invalidateStaleEvidence(admitted, ["e1"]);
    expect(invalidated.evidence[0]!.status).toBe("stale");
    expect(invalidated.evidence[1]!.status).toBe("stale");
    expect(invalidated.constraints[0]!.historical).toBe(true);
    expect(invalidated.regions[0]).toMatchObject({ decisionBoundary: undefined, domainPhase: "inspecting", candidateIds: [] });
    expect(invalidated.artifacts[0]).toMatchObject({ path: "src/x.ts" });
    expect(invalidated.artifacts[0]!.historical).not.toBe(true);
  });

  it("keeps repository observation lineage and an append-only status timeline", () => {
    const location = { canonicalPath: "src/x.ts", range: [1, 4] as [number, number], fileDigest: "old", snapshotEpoch: 1 };
    const tools = [{ tool: "graph_read", status: "completed" as const, metadata: { repositoryDescriptor: location } }];
    const network = initialNetwork("inspect"); network.activations[0]!.status = "running";
    let current = mergeSolutionDelta(state(network), "a1", SolutionDeltaSchema.parse({ evidence: [{ text: "handler exists", source: "src/x.ts:1-4", kind: "repository", location }] }), tools);
    expect(current.evidence[0]).toMatchObject({ assertion: "repository-presence", status: "confirmed", statusTimeline: [{ status: "confirmed" }] });
    current = invalidateStaleEvidence(current, ["e1"]);
    expect(current.evidence[0]!.statusTimeline!.map((event) => event.status)).toEqual(["confirmed", "stale"]);

    current.activations.push({ id: "a2", capability: "inspect", regionId: "r1", request: "reobserve", expectedDelta: "reobserve", contextRefs: [], status: "running", basisRevision: current.revision });
    current.regions[0]!.activationIds.push("a2");
    current = mergeSolutionDelta(state(current), "a2", SolutionDeltaSchema.parse({ evidence: [{ text: "handler exists", source: "src/x.ts:1-4", kind: "repository", location }] }), tools);
    expect(current.evidence[0]!.statusTimeline!.map((event) => event.status)).toEqual(["confirmed", "stale", "confirmed"]);

    const changed = { ...location, fileDigest: "new", snapshotEpoch: 2 };
    current.activations.push({ id: "a3", capability: "inspect", regionId: "r1", request: "changed", expectedDelta: "changed", contextRefs: [], status: "running", basisRevision: current.revision });
    current.regions[0]!.activationIds.push("a3");
    current = mergeSolutionDelta(state(current), "a3", SolutionDeltaSchema.parse({ evidence: [{ text: "handler exists", source: "src/x.ts:1-4", kind: "repository", location: changed }] }), [{ tool: "graph_read", status: "completed", metadata: { repositoryDescriptor: changed } }]);
    expect(current.evidence[1]).toMatchObject({ supersedesEvidenceId: "e1", lineageKey: current.evidence[0]!.lineageKey, status: "confirmed" });
    expect(() => SolutionDeltaSchema.parse({ evidence: [{ text: "architecture is correct", source: "src/x.ts", kind: "repository", assertion: "correctness-claim", location }] })).toThrow(/establish presence/);
  });

  it("stores repository locations and invalidates digest mismatches without mutating the input", () => {
    const location = { canonicalPath: "src/x.ts", range: [1, 4] as [number, number], fileDigest: "old", snapshotEpoch: 2 };
    expect(() => SolutionDeltaSchema.parse({ evidence: [{ text: "fact", source: "tool", kind: "tool", location }] })).toThrow(/Only repository evidence/);

    const base = initialNetwork("choose");
    base.evidence.push({ id: "e1", text: "fact", source: "src/x.ts:1-4", kind: "repository", status: "confirmed", fingerprint: "fact", location, controllerVerified: { activationId: "a1", tool: "graph_read" } });
    const admitted = admitDecisionBoundary(base, "r1", { basisRevision: 0, variables: [{ key: "runtime", name: "runtime", ownerRegionId: "r1", seedLabels: ["node"], evidenceRefs: ["e1"] }], permittedPairs: [] });
    admitted.regions.push({ ...structuredClone(admitted.regions[0]!), id: "r2", key: "unrelated", scopeId: "scope:r2", parentId: undefined, edge: "root", status: "verified", decisionBoundary: undefined, candidateIds: [], selectedCandidateIds: [], constraintIds: [], evidenceIds: [], activationIds: [], artifactIds: [] });
    const before = structuredClone(admitted);
    const unchanged = invalidateEvidenceDigestMismatches(admitted, { "src/x.ts": "old" });
    expect(unchanged).toEqual(admitted);
    const invalidated = invalidateEvidenceDigestMismatches(admitted, { "src/x.ts": "new" });
    expect(admitted).toEqual(before);
    expect(invalidated.evidence[0]!.status).toBe("stale");
    expect(invalidated.regions.find((item) => item.id === "r1")).toMatchObject({ decisionBoundary: undefined, domainPhase: "inspecting" });
    expect(invalidated.regions.find((item) => item.id === "r2")?.status).toBe("verified");
    expect(invalidateEvidenceDigestMismatches(invalidated, { "src/x.ts": "new" })).toEqual(invalidated);
  });

  it("rolls stale candidate and refinement premises back only to their earliest phase", () => {
    const candidateNetwork = initialNetwork("choose");
    candidateNetwork.evidence.push({ id: "e1", text: "candidate fact", source: "inspection", kind: "tool", status: "confirmed", fingerprint: "candidate" });
    candidateNetwork.regions[0]!.status = "superposed"; candidateNetwork.regions[0]!.domainPhase = "challenging"; candidateNetwork.regions[0]!.decisionBoundary = { fingerprint: "empty", variables: [], permittedPairs: [] }; candidateNetwork.regions[0]!.candidateIds = ["r1:a"];
    candidateNetwork.candidates.push({ id: "r1:a", regionId: "r1", key: "a", proposition: "A", status: "possible", evidenceIds: ["e1"], eliminationReasons: [], stances: [] });
    const candidateRollback = invalidateStaleEvidence(candidateNetwork, ["e1"]);
    expect(candidateRollback.regions[0]).toMatchObject({ decisionBoundary: { fingerprint: "empty" }, candidateIds: ["r1:a"], domainPhase: "challenging" });

    const refinementNetwork = initialNetwork("choose");
    refinementNetwork.evidence.push({ id: "e1", text: "leaf fact", source: "inspection", kind: "tool", status: "confirmed", fingerprint: "leaf" });
    refinementNetwork.regions[0]!.status = "actionable"; refinementNetwork.regions[0]!.domainPhase = "selected"; refinementNetwork.regions[0]!.criterionIds = ["criterion:scope:r1:0"]; refinementNetwork.regions[0]!.certifiedLeaf = { implementationScope: "src/x.ts", criterionIds: ["criterion:scope:r1:0"], evidenceRefs: ["e1"], mutationResources: ["src/x.ts"], checks: [{ criterionId: "criterion:scope:r1:0", commandOrObservation: "test" }] };
    const refinementRollback = invalidateStaleEvidence(refinementNetwork, ["e1"]);
    expect(refinementRollback.regions[0]).toMatchObject({ status: "unrefined", domainPhase: "selected", certifiedLeaf: undefined });
  });

  it("rolls selection, implementation, and verification premises to distinct frontiers while retaining worktree history", () => {
    const selected = bounded();
    selected.evidence.push({ id: "e1", text: "selection fact", source: "tool", kind: "tool", status: "confirmed", fingerprint: "selection" });
    selected.regions[0]!.candidateIds = ["r1:a"]; selected.regions[0]!.selectedCandidateIds = ["r1:a"]; selected.regions[0]!.status = "actionable"; selected.regions[0]!.domainPhase = "selected";
    selected.candidates.push({ id: "r1:a", regionId: "r1", key: "a", proposition: "A", status: "selected", declaredStatus: "selected", evidenceIds: [], eliminationReasons: [], stances: [] });
    selected.regions[0]!.boundDomainFingerprint = boundDomainFingerprint(selected, "r1"); selected.regions[0]!.acceptedFingerprint = selected.regions[0]!.boundDomainFingerprint; selected.regions[0]!.challengeVerdict = "accept"; selected.regions[0]!.selectionPremiseRefs = ["e1"];
    selected.regions[0]!.certifiedLeaf = { implementationScope: "src/x.ts", criterionIds: [], evidenceRefs: [], mutationResources: ["src/x.ts"], checks: [] };
    const selectionRollback = invalidateStaleEvidence(selected, ["e1"]);
    expect(selectionRollback.regions[0]).toMatchObject({ domainPhase: "selecting", acceptedFingerprint: selected.regions[0]!.acceptedFingerprint, selectedCandidateIds: [], certifiedLeaf: undefined });

    const implemented = structuredClone(selected);
    implemented.evidence[0]!.status = "confirmed"; implemented.regions[0]!.selectionPremiseRefs = []; implemented.regions[0]!.implementationPremiseRefs = ["e1"]; implemented.regions[0]!.verificationPremiseRefs = ["e2"]; implemented.regions[0]!.status = "verified";
    implemented.activations.push({ id: "a-impl", capability: "implement", regionId: "r1", request: "implement", expectedDelta: "impl", contextRefs: [], status: "completed", basisRevision: 0 }, { id: "a-verify", capability: "verify", regionId: "r1", request: "verify", expectedDelta: "verify", contextRefs: [], status: "completed", basisRevision: 0 });
    implemented.artifacts.push({ id: "x-impl", regionId: "r1", activationId: "a-impl", kind: "file", path: "src/x.ts", summary: "changed", fingerprint: "changed" }, { id: "x-verify", regionId: "r1", activationId: "a-verify", kind: "check", summary: "passed", passed: true, fingerprint: "passed" }); implemented.regions[0]!.artifactIds.push("x-impl", "x-verify");
    implemented.regions.push({ ...structuredClone(implemented.regions[0]!), id: "r-sibling", key: "sibling", parentId: undefined, parentCandidateId: undefined, edge: "root", scopeId: "scope:sibling", status: "verified", selectionPremiseRefs: [], implementationPremiseRefs: [], verificationPremiseRefs: [], certifiedLeaf: undefined, artifactIds: [], activationIds: [] });
    const implementationRollback = invalidateStaleEvidence(implemented, ["e1"]);
    expect(implementationRollback.regions.find((item) => item.id === "r1")).toMatchObject({ status: "actionable", certifiedLeaf: implemented.regions[0]!.certifiedLeaf });
    expect(implementationRollback.artifacts.filter((item) => item.regionId === "r1")).toEqual(expect.arrayContaining([expect.objectContaining({ id: "x-impl", path: "src/x.ts", historical: true }), expect.objectContaining({ id: "x-verify", historical: true })]));
    expect(implementationRollback.regions.find((item) => item.id === "r-sibling")?.status).toBe("verified");

    const verified = structuredClone(implemented); verified.evidence[0]!.status = "confirmed"; verified.regions[0]!.implementationPremiseRefs = []; verified.regions[0]!.verificationPremiseRefs = ["e1"];
    const verificationRollback = invalidateStaleEvidence(verified, ["e1"]);
    expect(verificationRollback.regions[0]!.status).toBe("implemented");
    expect(verificationRollback.artifacts.find((item) => item.id === "x-impl")?.historical).not.toBe(true);
    expect(verificationRollback.artifacts.find((item) => item.id === "x-verify")?.historical).toBe(true);
  });

  it("consumes CEGAR and retires the old domain on a boundary counterexample", () => {
    let network = bounded();
    const generationActivation: Activation = { id: "a2", capability: "synthesize", operation: "generate-domain", regionId: "r1", request: "generate", expectedDelta: "domain", contextRefs: ["r1"], status: "running", basisRevision: network.revision };
    network.activations.push(generationActivation); network.regions[0]!.activationIds.push("a2");
    network = mergeSynthesisOutput(state(network), "a2", generation(network));
    const fingerprint = network.regions[0]!.boundDomainFingerprint!;
    const challenge: Activation = { id: "a3", capability: "synthesize", operation: "challenge-domain", domainFingerprint: fingerprint, boundDomainFingerprint: fingerprint, regionId: "r1", request: "challenge", expectedDelta: "challenge", contextRefs: ["r1"], status: "running", basisRevision: network.revision };
    network.activations.push(challenge); network.regions[0]!.activationIds.push("a3");
    network = mergeSynthesisOutput(state(network), "a3", { outcome: "boundary-counterexample", boundDomainFingerprint: fingerprint, missingFamily: { key: "remote", proposition: "Use a remote runtime" }, defect: { kind: "missing-variable", description: "deployment location is absent" }, evidenceRefs: [] });
    expect(network.regions[0]).toMatchObject({ progress: { cegarRounds: { count: 1 } }, domainPhase: "inspecting", candidateIds: [], decisionBoundary: undefined });
    expect(network.candidates.every((item) => item.historical)).toBe(true);
  });
});
