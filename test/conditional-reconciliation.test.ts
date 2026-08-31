import { describe, expect, it } from "vitest";
import { initialNetwork, mergeRefinementOutput, mergeSolutionDelta, propagateNetwork, reopenRegion, resetPrunedRegion, resolveContextReference, validateRefinementOutput } from "../src/solution-lod/reducer.js";
import type { Activation, RefinementOutput, SolutionLodState, SolutionNetwork } from "../src/solution-lod/types.js";

const child = (key: string, objective = key): RefinementOutput["children"][number] => ({ key, objective, edge: "partOf", delivery: "change", allowedVariables: ["mode"], acceptanceCriteria: [`${key} done`], coveredCriteria: [0], requirementIds: ["requirement:one"], dependencyScopeIds: ["scope:dependency"], mutationResources: [`src/${key}.ts`] });
const state = (network: SolutionNetwork): SolutionLodState => ({ stateVersion: 10, runId: "refine", directory: "/r", worktree: "/r", phase: "", activeBatch: [], network, results: [], usage: { turns: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }, callsUsed: 0, startedAt: 0, result: "" });

function refined(definitions: RefinementOutput["children"]): SolutionNetwork {
  const network = initialNetwork("change");
  const root = network.regions[0]!;
  root.status = "unrefined"; root.domainPhase = "selected"; root.acceptanceCriteria = ["done"]; root.criterionIds = ["criterion:scope:r1:0"];
  network.activations.push({ id: "a2", capability: "refine", regionId: "r1", request: "split", expectedDelta: "split", contextRefs: ["r1"], status: "running", basisRevision: 0 });
  root.activationIds.push("a2");
  return mergeRefinementOutput(network, "a2", { outcome: "children", evidence: [], children: definitions });
}

function populate(network: SolutionNetwork, regionId: string): void {
  const region = network.regions.find((item) => item.id === regionId)!;
  region.status = "verified"; region.domainPhase = "selected"; region.domainFingerprint = "old"; region.acceptedFingerprint = "old"; region.challengeVerdict = "accept";
  region.candidateIds = [`${regionId}:choice`]; region.selectedCandidateIds = [`${regionId}:choice`]; region.constraintIds = ["c-old"]; region.activationIds.push("a-old"); region.artifactIds = ["x-old"];
  network.candidates.push({ id: `${regionId}:choice`, regionId, key: "choice", proposition: "old", status: "selected", declaredStatus: "selected", evidenceIds: [], eliminationReasons: [], stances: [] });
  network.variables.push({ id: "v-old", name: "old-coordinate", ownerRegionId: regionId, seedLabels: ["yes"] });
  network.constraints.push({ id: "c-old", kind: "requires", subject: `${regionId}:choice`, target: "v-old:yes", reason: "old", sourceActivationId: "a-old", sourceKind: "model-inference", evidenceRefs: [] });
  const activation: Activation = { id: "a-old", capability: "inspect", regionId, request: "old", expectedDelta: "old", contextRefs: [regionId, `${regionId}:choice`, "v-old:yes"], status: "queued", basisRevision: 0 };
  network.activations.push(activation);
  network.artifacts.push({ id: "x-old", regionId, kind: "file", path: "src/old.ts", summary: "old output", activationId: "a-old", fingerprint: "old" });
}

function reconcile(network: SolutionNetwork, definitions: RefinementOutput["children"]): SolutionNetwork {
  network.activations.push({ id: "a3", capability: "refine", regionId: "r1", request: "reconcile", expectedDelta: "reconcile", contextRefs: ["r1"], status: "running", basisRevision: network.revision });
  network.regions[0]!.activationIds.push("a3");
  return mergeRefinementOutput(network, "a3", { outcome: "children", evidence: [], children: definitions });
}

describe("conditional subtree reconciliation", () => {
  it("updates changed definitions deterministically and invalidates child domain and acceptance", () => {
    let network = refined([child("work")]); const id = network.regions.find((item) => item.parentId === "r1")!.id; populate(network, id);
    network = reconcile(network, [{ ...child(" work ", "changed objective"), delivery: "answer", allowedVariables: [" z ", "a"], acceptanceCriteria: ["new criterion"], requirementIds: ["requirement:two"], dependencyScopeIds: ["scope:other"], mutationResources: [" src/z.ts "] }]);
    expect(network.regions.find((item) => item.id === id)).toMatchObject({ key: "work", objective: "changed objective", delivery: "answer", allowedVariables: ["a", "z"], acceptanceCriteria: ["new criterion"], requirementIds: ["requirement:two"], dependencyScopeIds: ["scope:other"], mutationResources: ["src/z.ts"], status: "unformed", domainPhase: "inspecting", domainFingerprint: null, acceptedFingerprint: null, candidateIds: [], selectedCandidateIds: [] });
  });

  it("removes abandoned children and cleans stale coordinates and activations", () => {
    let network = refined([child("keep"), child("drop")]); const dropped = network.regions.find((item) => item.key === "drop")!; populate(network, dropped.id);
    network = reconcile(network, [child("keep")]);
    expect(network.regions.some((item) => item.id === dropped.id)).toBe(false);
    expect(resolveContextReference(network, `${dropped.id}:choice`)).toBeUndefined(); expect(resolveContextReference(network, "v-old:yes")).toBeUndefined();
    expect(network.constraints.find((item) => item.id === "c-old")?.historical).toBe(true);
    expect(network.activations.find((item) => item.id === "a-old")).toMatchObject({ status: "superseded", historical: true });
  });

  it("retains retired records as explicit historical artifacts", () => {
    let network = refined([child("work")]); const id = network.regions.find((item) => item.parentId === "r1")!.id; populate(network, id); network = reconcile(network, [child("work", "new work")]);
    expect(network.candidates.find((item) => item.id === `${id}:choice`)?.historical).toBe(true); expect(network.variables.find((item) => item.id === "v-old")?.historical).toBe(true); expect(network.artifacts.find((item) => item.id === "x-old")).toMatchObject({ summary: "old output", historical: true });
  });

  it("keeps retained historical constraints inert during propagation", () => {
    let network = initialNetwork("change");
    const root = network.regions[0]!;
    network.regions.push(
      { ...structuredClone(root), id: "r2", key: "retired", parentId: "r1", edge: "partOf", scopeId: "scope:r2", candidateIds: ["r2:old"], constraintIds: ["c1", "c2"], evidenceIds: ["e1"], activationIds: [], artifactIds: [] },
      { ...structuredClone(root), id: "r3", key: "live", parentId: "r1", edge: "partOf", scopeId: "scope:r3", candidateIds: ["r3:live"], constraintIds: ["c2"], evidenceIds: [], activationIds: [], artifactIds: [] },
    );
    network.candidates.push(
      { id: "r2:old", regionId: "r2", key: "old", proposition: "Retired prerequisite", status: "possible", declaredStatus: "possible", evidenceIds: [], eliminationReasons: [], stances: [] },
      { id: "r3:live", regionId: "r3", key: "live", proposition: "Current solution", status: "possible", declaredStatus: "possible", evidenceIds: [], eliminationReasons: [], stances: [] },
    );
    network.evidence.push({ id: "e1", text: "The retired prerequisite is unavailable", source: "inspection", kind: "tool", status: "confirmed", fingerprint: "e1" });
    network.constraints.push(
      { id: "c1", kind: "refutes", subject: "e1", target: "r2:old", reason: "unavailable", sourceActivationId: "a1", sourceKind: "repo-evidence", evidenceRefs: ["e1"] },
      { id: "c2", kind: "requires", subject: "r3:live", target: "r2:old", reason: "requires retired candidate", sourceActivationId: "a1", sourceKind: "model-inference", evidenceRefs: [] },
    );
    network = propagateNetwork(resetPrunedRegion(network, "r2"));
    expect(network.constraints.filter((item) => item.historical)).toHaveLength(2);
    expect(network.candidates.find((item) => item.id === "r3:live")).toMatchObject({ status: "possible", eliminationReasons: [] });
  });

  it("regenerates a pruned candidate under its stable live identity", () => {
    let network = initialNetwork("choose");
    network.regions[0]!.status = "superposed";
    network.regions[0]!.domainPhase = "ungenerated";
    network.activations[0]!.capability = "synthesize";
    const delta = { region: {}, evidence: [], candidates: [{ key: "native", proposition: "Use native support", outcome: "possible" as const, reasons: [], evidenceRefs: [], stances: [] }], constraints: [], select: [], activations: [] };
    network = mergeSolutionDelta(state(network), "a1", delta);
    network.candidates.find((item) => item.id === "r1:native")!.evidenceIds = ["e-old"];
    network.candidates.find((item) => item.id === "r1:native")!.declaredEvidenceIds = ["e-old"];
    network = resetPrunedRegion(network, "r1");
    network.activations.push({ ...network.activations[0]!, id: "a2", status: "running", basisRevision: network.revision });
    network = mergeSolutionDelta(state(network), "a2", delta);
    expect(network.regions[0]!.candidateIds).toEqual(["r1:native"]);
    expect(network.candidates.filter((item) => item.id === "r1:native")).toHaveLength(1);
    expect(network.candidates.find((item) => item.id === "r1:native")).toMatchObject({ historical: undefined, evidenceIds: [] });
  });

  it("keeps reopen and reselection references sound", () => {
    let network = refined([child("work")]); const id = network.regions.find((item) => item.parentId === "r1")!.id; populate(network, id); network = reconcile(network, [child("work", "new work")]); network = reopenRegion(network, id, "reselect");
    expect(network.regions.find((item) => item.id === id)).toMatchObject({ selectedCandidateIds: [], acceptedFingerprint: null });
    expect(network.activations.filter((item) => !item.historical).every((item) => item.contextRefs.every((ref) => resolveContextReference(network, ref)))).toBe(true);
  });

  it("rejects an atomic one-child wrapper and accepts a witnessed decision refinement", () => {
    const network = initialNetwork("choose mode");
    const root = network.regions[0]!;
    root.status = "unrefined"; root.domainPhase = "selected"; root.allowedVariables = ["mode"]; root.acceptanceCriteria = ["mode works"]; root.criterionIds = ["criterion:scope:r1:0"];
    expect(() => validateRefinementOutput(state(network), "r1", { outcome: "children", evidence: [], children: [{ key: "same", objective: "choose mode", edge: "partOf", allowedVariables: ["mode"], acceptanceCriteria: ["mode works"], coveredCriteria: [0] }] })).toThrow(/repeats ancestor boundary|lone partOf child/);
    expect(() => validateRefinementOutput(state(network), "r1", { outcome: "children", evidence: [], children: [{ key: "protocol", objective: "choose protocol", edge: "refines", unresolvedVariable: "mode", allowedVariables: [], acceptanceCriteria: ["protocol selected"], coveredCriteria: [0] }] })).not.toThrow();
  });

  it("ignores newly bounded resources when an inherited refinement dimension decreases", () => {
    const network = initialNetwork("choose mode");
    const root = network.regions[0]!;
    root.allowedVariables = ["mode"];
    root.acceptanceCriteria = ["mode works"];
    root.criterionIds = ["criterion:scope:r1:0"];
    expect(() => validateRefinementOutput(state(network), "r1", { outcome: "children", evidence: [], children: [{ key: "protocol", objective: "apply protocol", edge: "refines", unresolvedVariable: "mode", allowedVariables: [], acceptanceCriteria: ["protocol works"], coveredCriteria: [0], mutationResources: ["src/protocol.ts"] }] })).not.toThrow();
  });

  it("requires exact criterion and executable check witnesses for a leaf", () => {
    const network = initialNetwork("change");
    const root = network.regions[0]!;
    root.status = "unrefined"; root.domainPhase = "selected"; root.acceptanceCriteria = ["works"]; root.criterionIds = ["criterion:scope:r1:0"];
    expect(() => validateRefinementOutput(state(network), "r1", { outcome: "leaf", evidence: [], certifiedLeaf: { implementationScope: "edit source", criterionIds: ["criterion:wrong"], requirementIds: [...(root.requirementIds ?? [])], evidenceRefs: [], mutationResources: ["src/a.ts"], checks: [{ criterionId: "criterion:wrong", commandOrObservation: "run test" }] }, atomicityWitness: { outcome: "edit source", criterionIds: ["criterion:wrong"], requirementIds: [...(root.requirementIds ?? [])], mutationResources: ["src/a.ts"], whySplittingFails: "The source edit and its check are one change." } })).toThrow(/every exact current criterion ID/);
    expect(() => validateRefinementOutput(state(network), "r1", { outcome: "leaf", evidence: [], certifiedLeaf: { implementationScope: "edit source", criterionIds: [...root.criterionIds], requirementIds: [...(root.requirementIds ?? [])], evidenceRefs: [], mutationResources: ["src/a.ts"], checks: root.criterionIds.map((criterionId) => ({ criterionId, commandOrObservation: "run test" })) }, atomicityWitness: { outcome: "edit source", criterionIds: [...root.criterionIds], requirementIds: [...(root.requirementIds ?? [])], mutationResources: ["src/a.ts"], whySplittingFails: "The source edit and its check are one change." } })).not.toThrow();
  });

  it("rejects cyclic refinement dependencies", () => {
    const network = initialNetwork("split");
    const root = network.regions[0]!;
    root.acceptanceCriteria = ["one", "two"];
    root.criterionIds = ["criterion:scope:r1:0", "criterion:scope:r1:1"];
    const children = [
      { key: "one", objective: "one", edge: "partOf" as const, allowedVariables: [], acceptanceCriteria: ["one"], coveredCriteria: [0], dependencyScopeIds: ["scope:r1:two"] },
      { key: "two", objective: "two", edge: "partOf" as const, allowedVariables: [], acceptanceCriteria: ["two"], coveredCriteria: [1], dependencyScopeIds: ["scope:r1:one"] },
    ];
    expect(() => validateRefinementOutput(state(network), "r1", { outcome: "children", evidence: [], children })).toThrow(/cycle/);
  });

  it("rejects refinement dependencies on an ancestor scope", () => {
    const network = initialNetwork("split");
    const root = network.regions[0]!;
    root.acceptanceCriteria = ["done"];
    root.criterionIds = ["criterion:scope:r1:0"];
    const children = [{ key: "child", objective: "child", edge: "refines" as const, unresolvedVariable: "solution family", allowedVariables: ["solution family"], acceptanceCriteria: ["done"], coveredCriteria: [0], dependencyScopeIds: ["scope:r1"] }];
    expect(() => validateRefinementOutput(state(network), "r1", { outcome: "children", evidence: [], children })).toThrow(/cannot depend on ancestor scope/);
  });
});
