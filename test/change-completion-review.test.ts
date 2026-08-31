import { describe, expect, it } from "vitest";
import { completeImplementation, completeVerification, domainFingerprint, enumerationFingerprint, ensureRunnableWork, initialNetwork, validateImplementationOutput, validateVerificationOutput } from "../src/solution-lod/reducer.js";
import type { SolutionLodState, SolutionNetwork, VerificationOutput } from "../src/solution-lod/types.js";

const usage = { turns: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
const state = (network: SolutionNetwork, task = "change it"): SolutionLodState => {
  network.authority.task.exactText = task;
  return { stateVersion: 10, runId: "review", directory: "/r", worktree: "/r", phase: "", activeBatch: [], network, results: [], usage, callsUsed: 0, startedAt: 0, result: "" };
};
const ready = () => {
  const network = initialNetwork("change it");
  const region = network.regions[0]!;
  region.status = "implemented";
  region.acceptanceCriteria = ["behavior works"];
  region.criterionIds = ["criterion:scope:r1:0"];
  region.certifiedLeaf = { criterionIds: [...region.criterionIds], implementationScope: "change src/x.ts", evidenceRefs: [] };
  region.candidateIds = ["r1:chosen"];
  region.selectedCandidateIds = ["r1:chosen"];
  network.candidates.push({ id: "r1:chosen", regionId: "r1", key: "chosen", proposition: "change it", status: "selected", declaredStatus: "selected", evidenceIds: [], eliminationReasons: [], stances: [] });
  region.domainPhase = "selected";
  region.enumerationFingerprint = enumerationFingerprint(network, "r1");
  region.boundDomainFingerprint = domainFingerprint(network, "r1");
  region.domainFingerprint = region.boundDomainFingerprint;
  region.acceptedFingerprint = region.boundDomainFingerprint;
  region.challengeVerdict = "accept";
  network.activations.push({ id: "a2", capability: "verify", regionId: "r1", request: "verify", expectedDelta: "verify", contextRefs: ["r1"], status: "running", basisRevision: 0 });
  return network;
};
const pass = (overrides: Partial<NonNullable<VerificationOutput["completionEvidence"]>> = {}): VerificationOutput => ({ outcome: "pass", summary: "verified", findings: [], checks: [{ name: "behavior works", passed: true, evidence: "behavior works in focused test" }], completionEvidence: { implementationOutcome: "changed", implementation: "measured implementation", directTest: "focused passed", correctnessReview: "reviewed before completion", releaseGate: "configured gates passed", changedFiles: ["src/x.ts"], focusedTests: ["focused test passed"], fullChecks: ["npm test passed", "tsc passed"], criterionIds: ["criterion:scope:r1:0"], inspectionEvidenceRefs: [], ...overrides } });

describe("change completion correctness review", () => {
  it("requires measured mutation, focused evidence, all criteria, release gates, and TODO disposition", () => {
    const network = ready();
    network.artifacts.push({ id: "x1", regionId: "r1", kind: "file", path: "src/x.ts", summary: "Changed src/x.ts", activationId: "a1", fingerprint: "src-x" });
    network.regions[0]!.artifactIds = ["x1"];
    expect(() => validateVerificationOutput(state(network, "Implement TODO item"), "r1", pass())).toThrow(/TODO disposition/);
    const output = pass({ todoDisposition: "Removed the completed TODO entry" });
    expect(() => validateVerificationOutput(state(network, "Implement TODO item"), "r1", output)).not.toThrow();
    const completed = completeVerification(network, "a2", output);
    expect(completed.regions[0]!.status).toBe("verified");
  });

  it("accepts already-satisfied only with confirmed inspection evidence and every exact criterion", () => {
    const network = ready();
    network.evidence.push({ id: "e1", text: "behavior already exists", source: "inspection", kind: "tool", fingerprint: "e1" });
    const output = pass({ implementationOutcome: "already-satisfied", implementation: "already satisfied", changedFiles: [], inspectionEvidenceRefs: ["e1"] });
    expect(() => validateVerificationOutput(state(network), "r1", output)).not.toThrow();
    expect(completeVerification(network, "a2", output).regions[0]!.status).toBe("verified");
    expect(() => validateVerificationOutput(state(network), "r1", pass({ implementationOutcome: "already-satisfied", changedFiles: [], inspectionEvidenceRefs: ["missing"] }))).toThrow(/confirmed inspection evidence/);
  });

  it("keeps preexisting and out-of-scope failures visible but outside certificate proof", () => {
    const network = ready();
    network.evidence.push({ id: "e1", text: "docs check already failed", source: "baseline", kind: "tool", status: "confirmed", fingerprint: "baseline" });
    network.artifacts.push({ id: "x1", regionId: "r1", kind: "file", path: "src/x.ts", summary: "Changed src/x.ts", activationId: "a1", fingerprint: "src-x" });
    network.regions[0]!.artifactIds = ["x1"];
    network.nextArtifactId = 2;
    const output: VerificationOutput = {
      ...pass(),
      checks: [
        { name: "behavior", passed: true, evidence: "focused behavior passed", disposition: "criterion-gating", criterionIds: ["criterion:scope:r1:0"], baselineEvidenceRefs: [], requiredEvidence: [] },
        { name: "docs", passed: false, evidence: "broken historical link", disposition: "preexisting", criterionIds: [], reason: "failed before this change", baselineEvidenceRefs: ["e1"], requiredEvidence: [] },
        { name: "other package", passed: false, evidence: "outside certified files", disposition: "out-of-scope", criterionIds: [], reason: "owned by another scope", baselineEvidenceRefs: [], requiredEvidence: [] },
      ],
    };
    expect(() => validateVerificationOutput(state(network), "r1", output)).not.toThrow();
    const completed = completeVerification(network, "a2", output);
    const certificate = completed.certificates[0]!;
    expect(certificate.focusedCheckArtifactIds).toHaveLength(1);
    expect(certificate.releaseCheckArtifactIds).toHaveLength(0);
    expect(completed.artifacts.filter((item) => item.checkDisposition === "preexisting" || item.checkDisposition === "out-of-scope")).toHaveLength(2);
  });

  it("stores typed repair findings and schedules high-severity repair before terminal audit", () => {
    const network = ready();
    const finding = { regionId: "r1", criterionId: "criterion:scope:r1:0", severity: "high" as const, target: { kind: "files" as const, refs: ["src/x.ts"] }, problem: "regression", regressionCriterion: "focused regression test passes", evidence: "focused test failed", evidenceRefs: [] };
    const repaired = completeVerification(network, "a2", { outcome: "repair", summary: "repair", findings: [finding], checks: [] });
    expect(repaired.findings[0]).toMatchObject({ ...finding, id: "f1", status: "open", route: { kind: "local-repair", regionId: "r1" } });
    repaired.activations.forEach((activation) => { activation.status = "completed"; });
    const scheduled = ensureRunnableWork(repaired);
    expect(scheduled.done).toBe(false);
    expect(scheduled.blocked).toBeUndefined();
    expect(scheduled.network.activations.at(-1)).toMatchObject({ capability: "implement", regionId: "r1", status: "queued", findingIds: ["f1"] });
  });

  it("requires TODO disposition at implementation time", () => {
    const network = ready();
    const region = network.regions[0]!;
    region.status = "actionable";
    region.domainFingerprint = null;
    region.acceptedFingerprint = null;
    region.candidateIds = [];
    region.selectedCandidateIds = [];
    network.candidates = [];
    network.activations = [];
    region.certifiedLeaf = { criterionIds: [...region.criterionIds], implementationScope: "already present", evidenceRefs: [] };
    network.candidates.push({ id: "r1:chosen", regionId: "r1", key: "chosen", proposition: "already present", status: "selected", declaredStatus: "selected", evidenceIds: [], eliminationReasons: [], stances: [] });
    region.candidateIds = ["r1:chosen"];
    region.selectedCandidateIds = ["r1:chosen"];
    region.domainFingerprint = domainFingerprint(network, "r1");
    region.acceptedFingerprint = region.domainFingerprint;
    expect(() => validateImplementationOutput(state(network, "Implement TODO item"), "r1", { outcome: "already-satisfied", summary: "already satisfied", changedFiles: [], checks: [{ name: "focused", passed: true, evidence: "passed" }] })).toThrow(/TODO disposition/);
  });

  it("rejects already-satisfied when the workspace actually changed", () => {
    const network = ready();
    network.regions[0]!.status = "actionable";
    network.activations[1]!.capability = "implement";
    const completed = completeImplementation(network, "a2", { outcome: "already-satisfied", summary: "already present", changedFiles: [], checks: [{ name: "focused", passed: true, evidence: "passed" }] }, ["src/x.ts"]);
    expect(completed.activations[1]).toMatchObject({ status: "failed", error: expect.stringContaining("conflicts with a measured workspace change") });
    expect(completed.regions[0]).toMatchObject({ status: "blocked" });
  });
});
