import { describe, expect, it } from "vitest";
import { completePresentation, completeVerification, ensureRunnableWork, initialNetwork, reopenRegion, validateVerificationOutput } from "../src/solution-lod/reducer.js";
import type { SolutionLodState, VerificationOutput } from "../src/solution-lod/types.js";

const answerNetwork = () => {
  const network = initialNetwork("answer");
  const region = network.regions[0];
  network.activations[0].status = "completed";
  region.delivery = "answer"; region.status = "actionable"; region.acceptanceCriteria = ["exact result"]; region.criterionIds = ["criterion:scope:r1:0"];
  return network;
};

const activation = (network: ReturnType<typeof answerNetwork>, capability: "present" | "verify") => {
  const id = `a${network.nextActivationId++}`;
  network.activations.push({ id, capability, regionId: "r1", request: capability, expectedDelta: capability, contextRefs: ["r1"], status: "running", basisRevision: network.revision });
  return id;
};
const finding = (criterionId: `criterion:${string}`, problem: string, evidence: string) => ({ regionId: "r1", criterionId, severity: "medium" as const, target: { kind: "answer" as const, refs: [] }, problem, regressionCriterion: "exact result", evidence, evidenceRefs: [] });

describe("focused convergence limits", () => {
  it("persists canonical presentation cycles and blocks repeated output", () => {
    let network = answerNetwork();
    network = completePresentation(network, activation(network, "present"), "same answer");
    network.regions[0].status = "actionable";
    network = completePresentation(network, activation(network, "present"), " same   answer ");
    expect(network.regions[0].status).toBe("blocked");
    expect(network.regions[0].convergenceCycles).toHaveLength(2);
    expect(network.regions[0].blockedDetails).toMatchObject({ kind: "present-limit", unresolvedCriterionIds: ["criterion:scope:r1:0"] });
    expect(ensureRunnableWork(network).blocked).toContain("fingerprints=");
  });

  it("blocks answer present-verify-repair without changed evidence or output", () => {
    let network = answerNetwork();
    network = completePresentation(network, activation(network, "present"), "answer");
    network.regions[0].status = "implemented";
    network = completeVerification(network, activation(network, "verify"), { outcome: "repair", summary: "wrong", findings: [finding("criterion:scope:r1:0", "wrong", "observed")], checks: [] });
    expect(network.regions[0].blockedDetails?.kind).toBe("answer-present-verify-repair-loop");
  });

  it("limits identical reopens and reports exact unresolved criteria", () => {
    let network = answerNetwork();
    network = reopenRegion(network, "r1", "same contradiction");
    network = reopenRegion(network, "r1", " same  contradiction ");
    expect(network.regions[0].status).toBe("blocked");
    expect(network.regions[0].blockedDetails).toMatchObject({ kind: "reopen-limit", unresolvedCriterionIds: ["criterion:scope:r1:0"] });
  });

  it.each([
    ["duplicate", { outcome: "repair", summary: "", findings: [finding("criterion:scope:r1:0", "a", "x"), finding("criterion:scope:r1:0", "b", "y")], checks: [] }, /multiple findings/],
    ["invalid criterion", { outcome: "repair", summary: "", findings: [finding("criterion:missing:0", "a", "x")], checks: [] }, /exact criterion identity/],
    ["multiple valid criteria", { outcome: "repair", summary: "", findings: [finding("criterion:scope:r1:0", "a", "x"), finding("criterion:scope:r1:1", "b", "y")], checks: [] }, null],
  ] as const)("verifier finding matrix: %s", (_name, output, error) => {
    const network = answerNetwork(); network.regions[0].acceptanceCriteria.push("second"); network.regions[0].criterionIds.push("criterion:scope:r1:1");
    const state = { originalTask: "answer", network } as SolutionLodState;
    if (error) expect(() => validateVerificationOutput(state, "r1", output as VerificationOutput)).toThrow(error);
    else expect(() => validateVerificationOutput(state, "r1", output as VerificationOutput)).not.toThrow();
  });
});
