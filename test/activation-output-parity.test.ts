import { describe, expect, it } from "vitest";
import { applyActivationOutput, applyBatchRecords, boundDomainFingerprint, initialNetwork } from "../src/solution-lod/reducer.js";
import { DomainGenerationOutputSchema, ImplementationOutputSchema, RefinementOutputSchema, SolutionDeltaSchema, VerificationOutputSchema, type Activation, type ActivationOutput, type ActivationTaskResult, type SolutionNetwork } from "../src/solution-lod/types.js";

const usage = { turns: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };

function activation(network: SolutionNetwork, capability: Activation["capability"], operation?: Activation["operation"]): Activation {
  const item: Activation = { id: "a1", capability, operation, regionId: "r1", request: capability, expectedDelta: capability, contextRefs: ["r1"], status: "running", basisRevision: network.revision };
  network.activations = [item]; network.regions[0]!.activationIds = [item.id];
  return item;
}

function withoutTelemetry(network: SolutionNetwork): unknown {
  const copy = structuredClone(network); delete copy.telemetry; return copy;
}

function expectParity(network: SolutionNetwork, item: Activation, output: ActivationOutput, changedFiles: string[] = []): void {
  const before = structuredClone(network);
  const preview = applyActivationOutput(network, item, output, changedFiles);
  expect(network).toEqual(before);
  const delta: ActivationTaskResult["networkDelta"] = item.operation ? { kind: "synthesis", output: output as any }
    : item.capability === "inspect" ? { kind: "delta", delta: output as any }
    : item.capability === "refine" ? { kind: "refinement", output: output as any }
    : item.capability === "implement" ? { kind: "implementation", output: output as any, changedFiles }
    : item.capability === "verify" ? { kind: "verification", output: output as any }
    : { kind: "presentation", output: output as any };
  const committed = applyBatchRecords(network, [{ activationId: item.id, regionId: item.regionId, capability: item.capability, operation: item.operation, basisRevision: item.basisRevision, startedAt: 0, finishedAt: 1, usage, outcome: "applied", networkDelta: delta }]);
  expect(committed.failed).toEqual([]);
  expect(withoutTelemetry(committed.network)).toEqual(withoutTelemetry(preview));
}

describe("activation output transition parity", () => {
  it("applies every output family identically in preview and batch commit", () => {
    let network = initialNetwork("inspect"); let item = activation(network, "inspect");
    expectParity(network, item, SolutionDeltaSchema.parse({ evidence: [], activations: [] }));

    network = initialNetwork("synthesize"); network.regions[0]!.status = "superposed"; network.regions[0]!.domainPhase = "ungenerated"; network.regions[0]!.decisionBoundary = { fingerprint: "empty", variables: [], permittedPairs: [] };
    item = activation(network, "synthesize", "generate-domain");
    expectParity(network, item, DomainGenerationOutputSchema.parse({ outcome: "candidates", evidence: [], candidates: [{ key: "only", proposition: "Use the only approach", evidenceRefs: [], coordinates: [] }] }));

    network = initialNetwork("refine"); network.regions[0]!.status = "unrefined"; network.regions[0]!.criterionIds = ["criterion:scope:r1:0"]; network.regions[0]!.acceptanceCriteria = ["works"];
    item = activation(network, "refine");
    expectParity(network, item, RefinementOutputSchema.parse({ outcome: "leaf", evidence: [], certifiedLeaf: { implementationScope: "change src/x.ts", criterionIds: ["criterion:scope:r1:0"], requirementIds: [], evidenceRefs: [], mutationResources: ["src/x.ts"], checks: [{ criterionId: "criterion:scope:r1:0", commandOrObservation: "test works" }], packet: [{ path: "src/x.ts", startLine: 1, endLine: 1, content: "export const works = true;", note: "edit target" }] }, atomicityWitness: { outcome: "change src/x.ts", criterionIds: ["criterion:scope:r1:0"], requirementIds: [], mutationResources: ["src/x.ts"], whySplittingFails: "The source edit and its check are one change." } }));

    network = initialNetwork("implement"); const region = network.regions[0]!; region.status = "actionable"; region.domainPhase = "selected"; region.acceptanceCriteria = ["works"]; region.criterionIds = ["criterion:scope:r1:0"]; region.decisionBoundary = { fingerprint: "empty", variables: [], permittedPairs: [] }; region.mutationResources = ["src/x.ts"]; region.certifiedLeaf = { implementationScope: "change src/x.ts", criterionIds: [...region.criterionIds], evidenceRefs: [], mutationResources: ["src/x.ts"], checks: [{ criterionId: region.criterionIds[0]!, commandOrObservation: "test works" }] }; network.candidates.push({ id: "r1:only", regionId: "r1", key: "only", proposition: "Only", status: "selected", declaredStatus: "selected", evidenceIds: [], eliminationReasons: [], stances: [] }); region.candidateIds = ["r1:only"]; region.selectedCandidateIds = ["r1:only"]; region.boundDomainFingerprint = boundDomainFingerprint(network, "r1"); region.domainFingerprint = region.boundDomainFingerprint; region.acceptedFingerprint = region.boundDomainFingerprint;
    item = activation(network, "implement");
    expectParity(network, item, ImplementationOutputSchema.parse({ outcome: "completed", summary: "changed", changedFiles: ["src/x.ts"], checks: [{ name: "works", passed: true, evidence: "works passed" }] }), ["src/x.ts"]);

    network = initialNetwork("verify"); network.regions[0]!.delivery = "answer"; network.regions[0]!.status = "implemented"; network.regions[0]!.acceptanceCriteria = ["works"]; network.regions[0]!.criterionIds = ["criterion:scope:r1:0"];
    item = activation(network, "verify");
    expectParity(network, item, VerificationOutputSchema.parse({ outcome: "pass", summary: "verified", findings: [], checks: [{ name: "works", passed: true, evidence: "works observed" }] }));

    network = initialNetwork("present"); network.regions[0]!.delivery = "answer"; network.regions[0]!.status = "actionable";
    item = activation(network, "present");
    expectParity(network, item, { outcome: "answer", answer: "The answer." });
  });

  it("rejects the same invalid output before either path can commit it", () => {
    const network = initialNetwork("implement"); network.regions[0]!.status = "actionable";
    const item = activation(network, "implement");
    const output = ImplementationOutputSchema.parse({ outcome: "completed", checks: [] });
    expect(() => applyActivationOutput(network, item, output, [])).toThrow();
    const committed = applyBatchRecords(network, [{ activationId: "a1", regionId: "r1", capability: "implement", basisRevision: 0, startedAt: 0, finishedAt: 1, usage, outcome: "applied", networkDelta: { kind: "implementation", output, changedFiles: [] } }]);
    expect(committed.failed).toEqual(["a1"]);
    expect(committed.network.regions[0]!.status).toBe("actionable");
  });
});
