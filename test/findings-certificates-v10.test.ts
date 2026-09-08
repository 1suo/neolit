import { describe, expect, it } from "vitest";
import { finalResult, projectActivationContext } from "../src/solution-lod/graph.js";
import { completeImplementation, completeVerification, domainFingerprint, ensureRunnableWork, enumerationFingerprint, initialNetwork, isCompletionCertificateValid, markActivation } from "../src/solution-lod/reducer.js";
import type { Activation, SolutionLodState, SolutionNetwork, SolutionRegion, VerificationOutput } from "../src/solution-lod/types.js";

const usage = { turns: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
const state = (network: SolutionNetwork): SolutionLodState => ({ stateVersion: 10, runId: "v10", directory: "/repo", worktree: "/repo", phase: "", activeBatch: [], network, results: [], usage, callsUsed: 0, startedAt: 0, result: "" });
const finding = { regionId: "r1", criterionId: "criterion:scope:r1:0", severity: "high" as const, target: { kind: "files" as const, refs: ["src/x.ts"] }, problem: "behavior regressed", regressionCriterion: "behavior works", evidence: "focused test failed", evidenceRefs: [] };

function prepareRegion(network: SolutionNetwork, region: SolutionRegion, selectedFamilyIds = [`${region.id}:chosen`]): void {
  region.acceptanceCriteria = ["behavior works"];
  region.criterionIds = [`criterion:${region.scopeId}:0`];
  region.status = "implemented";
  region.domainPhase = "selected";
  region.certifiedLeaf = { criterionIds: [...region.criterionIds], requirementIds: [], implementationScope: "change source", evidenceRefs: [], mutationResources: [`src/${region.id}.ts`], checks: [{ criterionId: region.criterionIds[0]!, commandOrObservation: "run focused test" }], packet: [{ path: `src/${region.id}.ts`, startLine: 1, endLine: 1, content: "export const source = \"before\";", note: "edit target" }] };
  region.mutationResources = [...region.certifiedLeaf.mutationResources];
  region.candidateIds = [...selectedFamilyIds];
  region.selectedCandidateIds = [...selectedFamilyIds];
  for (const id of selectedFamilyIds) if (!network.candidates.some((item) => item.id === id)) network.candidates.push({ id, regionId: region.id, key: id, proposition: id, status: "selected", declaredStatus: "selected", evidenceIds: [], eliminationReasons: [], stances: [] });
  region.enumerationFingerprint = enumerationFingerprint(network, region.id);
  region.boundDomainFingerprint = domainFingerprint(network, region.id);
  region.domainFingerprint = region.boundDomainFingerprint;
  region.acceptedFingerprint = region.boundDomainFingerprint;
}

function addVerifier(network: SolutionNetwork, regionId: string, findingIds: string[] = []): Activation {
  const activation: Activation = { id: `a${network.nextActivationId++}`, capability: "verify", regionId, request: "verify", expectedDelta: `verify:${regionId}`, contextRefs: [regionId], findingIds, status: "running", basisRevision: network.revision };
  network.activations.push(activation);
  network.regions.find((item) => item.id === regionId)!.activationIds.push(activation.id);
  return activation;
}

function pass(region: SolutionRegion, path = `src/${region.id}.ts`): VerificationOutput {
  return { outcome: "pass", summary: "verified", findings: [], checks: [{ name: "behavior works", passed: true, evidence: "behavior works" }], completionEvidence: { implementationOutcome: "changed", implementation: "measured change", directTest: "focused passed", correctnessReview: "reviewed", releaseGate: "suite passed", changedFiles: [path], focusedTests: ["focused passed"], fullChecks: ["suite passed"], criterionIds: [...region.criterionIds], inspectionEvidenceRefs: [] } };
}

function certify(network: SolutionNetwork, region: SolutionRegion, path = `src/${region.id}.ts`): SolutionNetwork {
  prepareRegion(network, region);
  const artifact = { id: `x${network.nextArtifactId++}`, regionId: region.id, kind: "file" as const, path, summary: `Changed ${path}`, activationId: "a-implement", fingerprint: `digest:${path}` };
  network.artifacts.push(artifact); region.artifactIds.push(artifact.id);
  const verifier = addVerifier(network, region.id);
  return completeVerification(network, verifier.id, pass(region, path));
}

describe("v10 findings and completion certificates", () => {
  it("keeps external findings open under a controller-owned blocked route", () => {
    let network = initialNetwork("change external service");
    const region = network.regions[0]!; prepareRegion(network, region);
    const verifier = addVerifier(network, region.id);
    network = completeVerification(network, verifier.id, { outcome: "fail", summary: "external block", checks: [], findings: [{ ...finding, target: { kind: "external", refs: ["payments"] }, problem: "payments is unavailable", resolutionOwner: "payments on-call", requiredEvidence: ["successful health check"] }] });
    expect(network.findings[0]).toMatchObject({ status: "open", route: { kind: "blocked-external", resolutionOwner: "payments on-call", requiredEvidence: ["successful health check"] } });
    expect(ensureRunnableWork(network).blocked).toContain("payments on-call");
  });

  it("records failed attempts, supplies exact repair context, and resolves only after re-verification", () => {
    let network = initialNetwork("fix behavior");
    const region = network.regions[0]!; prepareRegion(network, region); region.mutationResources = ["src/x.ts"]; region.certifiedLeaf!.mutationResources = ["src/x.ts"]; region.certifiedLeaf!.packet = [{ path: "src/x.ts", startLine: 1, endLine: 1, content: "export const source = \"before\";", note: "edit target" }];
    network.activations[0]!.status = "completed";
    network = completeVerification(network, addVerifier(network, "r1").id, { outcome: "repair", summary: "repair", findings: [finding], checks: [] });
    let scheduled = ensureRunnableWork(network);
    const failed = scheduled.network.activations.at(-1)!;
    network = markActivation(scheduled.network, failed.id, "failed", undefined, "attempt failed");
    expect(network.findings[0]).toMatchObject({ status: "open", repairActivationIds: [failed.id] });
    scheduled = ensureRunnableWork(network);
    const repair = scheduled.network.activations.at(-1)!;
    const context = projectActivationContext(state(scheduled.network), repair);
    expect(context.role).toBe("implement");
    expect(context.role === "implement" && context.findings).toEqual([scheduled.network.findings[0]]);
    network = completeImplementation(scheduled.network, repair.id, { outcome: "completed", summary: "fixed", changedFiles: ["src/x.ts"], checks: [{ name: "focused", passed: true, evidence: "passed" }] }, ["src/x.ts"], { "src/x.ts": "digest:new" });
    expect(network.findings[0].status).toBe("repairing");
    scheduled = ensureRunnableWork(network);
    const verifier = scheduled.network.activations.at(-1)!;
    expect(verifier.findingIds).toEqual(["f1"]);
    network = completeVerification(scheduled.network, verifier.id, pass(region, "src/x.ts"));
    expect(network.findings[0].status).toBe("resolved");
    expect(network.regions[0].completionCertificateId).toBeTruthy();
    expect(ensureRunnableWork(network).done).toBe(true);
  });

  it("supersedes findings whose exact criterion disappears", () => {
    let network = initialNetwork("fix behavior"); const region = network.regions[0]!; prepareRegion(network, region);
    network = completeVerification(network, addVerifier(network, "r1").id, { outcome: "repair", summary: "repair", findings: [finding], checks: [] });
    network.regions[0]!.criterionIds = ["criterion:scope:r1:replacement"];
    network = ensureRunnableWork(network).network;
    expect(network.findings[0].status).toBe("superseded");
  });

  it("creates a leaf certificate immediately and accepts only a proved equivalent selected set", () => {
    let network = initialNetwork("equivalent choices"); const region = network.regions[0]!;
    prepareRegion(network, region, ["r1:left", "r1:right"]);
    network.constraints.push({ id: "c-equivalent", kind: "equivalent", subject: "r1:left", target: "r1:right", reason: "same behavior", sourceActivationId: "a1", sourceKind: "model-inference", evidenceRefs: [] });
    const file = { id: "x-file", regionId: "r1", kind: "file" as const, path: "src/r1.ts", summary: "changed", activationId: "a-impl", fingerprint: "digest" };
    network.artifacts.push(file); region.artifactIds.push(file.id);
    network = completeVerification(network, addVerifier(network, "r1").id, pass(region));
    const certificate = network.certificates[0]!;
    expect(certificate).toMatchObject({ selectedFamilyIds: ["r1:left", "r1:right"], equivalenceProofConstraintIds: ["c-equivalent"], verificationActivationId: expect.any(String), createdRevision: expect.any(Number) });
    expect(isCompletionCertificateValid(network, certificate)).toBe(true);
    network.constraints[0]!.historical = true;
    expect(isCompletionCertificateValid(network, certificate)).toBe(false);
  });

  it("invalidates stale exact dependencies locally while unrelated sibling certificates stay valid", () => {
    let network = initialNetwork("two leaves");
    network.activations[0]!.status = "completed";
    const sibling = { ...structuredClone(network.regions[0]!), id: "r2", key: "sibling", edge: "partOf" as const, scopeId: "scope:r2" as const, activationIds: [], artifactIds: [], candidateIds: [], selectedCandidateIds: [] };
    network.regions.push(sibling);
    network = certify(network, network.regions[0]!, "src/one.ts");
    network = certify(network, network.regions.find((item) => item.id === "r2")!, "src/two.ts");
    const [first, second] = network.certificates;
    expect(isCompletionCertificateValid(network, first!)).toBe(true);
    expect(isCompletionCertificateValid(network, second!)).toBe(true);
    network.artifacts.find((item) => first!.measuredArtifactIds?.includes(item.id))!.fingerprint = "changed-content";
    expect(isCompletionCertificateValid(network, first!)).toBe(false);
    expect(isCompletionCertificateValid(network, second!)).toBe(true);
    network = ensureRunnableWork(network).network;
    expect(network.regions[0]).toMatchObject({ completionCertificateId: undefined, status: "actionable" });
    expect(network.regions.find((item) => item.id === "r2")!.completionCertificateId).toBe(second!.id);
  });

  it("invalidates stale evidence, historical artifacts, and reopened resolved findings", () => {
    let network = initialNetwork("certified leaf"); const region = network.regions[0]!;
    network.evidence.push({ id: "e1", text: "premise", source: "inspection", kind: "tool", status: "confirmed", fingerprint: "premise-v1" });
    region.selectionPremiseRefs = ["e1"];
    network = certify(network, region, "src/one.ts");
    const certificate = network.certificates[0]!;
    expect(isCompletionCertificateValid(network, certificate)).toBe(true);
    network.evidence[0]!.status = "stale";
    expect(isCompletionCertificateValid(network, certificate)).toBe(false);
    network.evidence[0]!.status = "confirmed";
    network.artifacts.find((item) => certificate.measuredArtifactIds?.includes(item.id))!.historical = true;
    expect(isCompletionCertificateValid(network, certificate)).toBe(false);
    network.artifacts.find((item) => certificate.measuredArtifactIds?.includes(item.id))!.historical = false;
    network.findings.push({ ...finding, id: "f-resolved", route: { kind: "local-repair", regionId: "r1" }, status: "resolved", sourceActivationId: "a-find", repairActivationIds: ["a-repair"], createdRevision: 1 });
    expect(isCompletionCertificateValid(network, certificate)).toBe(true);
    network.findings.at(-1)!.status = "open";
    expect(isCompletionCertificateValid(network, certificate)).toBe(false);
  });

  it("renders only certificate-backed current file artifacts", () => {
    let network = initialNetwork("change file"); const region = network.regions[0]!;
    network.artifacts.push({ id: "x-old", regionId: "r1", kind: "file", path: "src/old.ts", summary: "old", activationId: "a-old", fingerprint: "old", historical: true }); region.artifactIds.push("x-old");
    network = certify(network, region, "src/current.ts");
    const result = finalResult(state(network));
    expect(result).toContain("src/current.ts");
    expect(result).not.toContain("src/old.ts");
  });
});
