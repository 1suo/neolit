import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { MemorySaver } from "@langchain/langgraph";
import { solutionLodGraph } from "../src/solution-lod/graph.js";
import { applyActivationOutput, applyBatchRecords, completeImplementation, completeVerification, ensureRunnableWork, initialNetwork, inspectionOutputToDelta, isCompletionCertificateValid, queueActivation, invalidateEvidenceDigestMismatches, resetPrunedRegion, validateRefinementOutput, validateSolutionDelta } from "../src/solution-lod/reducer.js";
import { InspectionOutputSchema } from "../src/solution-lod/types.js";
import type { RefinementOutput, SolutionLodState } from "../src/solution-lod/types.js";

const agents = { inspect: "inspect", synthesize: "synthesize", refine: "refine", implement: "implement", verify: "verify", present: "present" } as const;
const directories: string[] = [];
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function workspace() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-recovery-"));
  directories.push(directory);
  for (const file of ["code.txt", "helper.txt"]) fs.writeFileSync(path.join(directory, file), "before");
  return directory;
}
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
const snapshot = (directory: string) => new Map(["code.txt", "helper.txt"].map((file) => [file, fs.readFileSync(path.join(directory, file), "utf8")]));
const initial = (directory = "/tmp") => solutionLodGraph({ agents }).initial({ task: { id: "task", exactText: "Correct code and helper values" }, authoritativeMessages: [], directory, worktree: directory, runId: "delivery-recovery" });
const observation = () => ({
  tools: [{ tool: "graph_read", status: "completed" as const, metadata: { repositoryDescriptor: { chunkId: "code-observation", canonicalPath: "code.txt", range: [1, 1], fileDigest: digest("before"), snapshotEpoch: 0 } } }],
  evidence: [{ kind: "repository", text: "code.txt contains before", source: "code.txt:1", chunkId: "code-observation" }],
});

function certifiedNetwork() {
  const state = initial();
  const seen = observation();
  const output = InspectionOutputSchema.parse({ outcome: "certified", region: { acceptanceCriteria: ["both values are fixed"] }, evidence: seen.evidence,
    criterionEvidence: [{ criterionIndex: 0, evidenceRefs: ["code-observation"] }],
    certifiedVerdict: { proposition: "Correct both values", implementationScope: "Set both values to fixed", evidenceRefs: ["code-observation"], mutationResources: ["code.txt", "helper.txt"] },
  });
  const network = applyActivationOutput(state, state.network.activations[0]!, inspectionOutputToDelta(output, seen.tools), [], seen.tools);
  return queueActivation(network, "implement", "r1", "Fix both values", "fixed-values");
}

describe("delivery recovery", () => {
  it.each([false, true])("retains failed writes and verifies cumulative patches with artifact premises=%s", async (citeArtifacts) => {
    const directory = workspace();
    const baseline = workspace();
    const execution = workspace();
    const calls: string[] = [];
    const preparations: Array<{ id: string; resume?: string }> = [];
    let implementationCount = 0;
    const configured = solutionLodGraph({ agents, checkpointer: new MemorySaver() });
    const runtime = { call: async (input: any) => {
      calls.push(input.node);
      const region = input.state.network.regions.find((item: { id: string }) => input.node.endsWith(`:${item.id}`));
      if (input.node === "inspect:r1") {
        const seen = observation();
        return { text: "", tools: seen.tools, structured: { outcome: "decompose", evidence: seen.evidence,
          taskScopes: [
            { key: "fix", objective: "Correct both values", delivery: "change", allowedVariables: [], acceptanceCriteria: ["both values are fixed"], mutationResources: ["code.txt", "helper.txt"] },
            { key: "explain", objective: "Explain the fixed values", delivery: "answer", allowedVariables: [], acceptanceCriteria: ["answer states the fixed value"], dependencyScopeIds: ["fix"], mutationResources: [] },
          ], materialRequirements: [
            { key: "fixed", text: "both values are fixed", scopeKey: "fix", criterionIndex: 0, evidenceRefs: ["code-observation"] },
            { key: "explained", text: "answer states the fixed value", scopeKey: "explain", criterionIndex: 0, evidenceRefs: ["task"] },
          ],
        } };
      }
      if (input.node === "inspect:r3") return { text: "", structured: { outcome: "answer", resolvedAnswer: { answer: "Both values are fixed.", acceptanceCriteria: ["answer states the fixed value"], evidenceRefs: ["task"] } } };
      if (input.node === "verify:r3") return { text: "", structured: { outcome: "pass", summary: "answer correct", findings: [], checks: [{ name: "answer states the fixed value", passed: true, evidence: "answer says fixed", criterionIds: region.criterionIds }] } };
      if (input.node === "inspect:r2") {
        const seen = observation();
        return { text: "", tools: seen.tools, structured: {
          outcome: "certified", region: { acceptanceCriteria: ["both values are fixed"] }, evidence: seen.evidence,
          criterionEvidence: [{ criterionIndex: 0, evidenceRefs: ["code-observation"] }],
          certifiedVerdict: { proposition: "Correct both values", implementationScope: "Set code and helper to fixed", evidenceRefs: ["code-observation"], mutationResources: ["code.txt", "helper.txt"] },
        } };
      }
      if (input.node === "implement:r2") {
        implementationCount++;
        if (implementationCount === 1) {
          fs.writeFileSync(path.join(input.worktree, "code.txt"), "fixed");
          throw new Error("Implementation process interrupted after its first edit");
        }
        expect(fs.readFileSync(path.join(input.worktree, "code.txt"), "utf8")).toBe("fixed");
        fs.writeFileSync(path.join(input.worktree, "helper.txt"), "fixed");
        return { text: "", structured: { outcome: "completed", summary: "corrected both values", changedFiles: ["code.txt", "helper.txt"], checks: [{ name: "both values are fixed", passed: true, evidence: "read both values" }] } };
      }
      if (input.node === "verify:r2") {
        expect(region.integration.changedFiles.sort()).toEqual(["code.txt", "helper.txt"]);
        expect([...snapshot(input.worktree).values()]).toEqual(["fixed", "fixed"]);
        return { text: "", structured: { outcome: "pass", summary: "Both values fixed", findings: [], checks: [{ name: "both values are fixed", passed: true, evidence: "read both values", criterionIds: region.criterionIds }], completionEvidence: { inspectionEvidenceRefs: citeArtifacts ? input.state.network.artifacts.filter((item: { regionId: string; historical?: boolean }) => item.regionId === region.id && !item.historical).map((item: { id: string }) => item.id) : [], implementation: "two measured file edits", directTest: "both value assertions passed", correctnessReview: "reviewed both values", releaseGate: "value checks passed", changedFiles: ["code.txt", "helper.txt"], focusedTests: ["value assertions"], fullChecks: ["value checks"] } } };
      }
      throw new Error(`Unexpected activation ${input.node}`);
    } };
    const result = await configured.graph.invoke(initial(directory), { recursionLimit: 64, configurable: {
      thread_id: "delivery-recovery", langgraphOpenCodeRuntime: runtime, langgraphAcquireWorktree: async () => {}, langgraphSnapshotWorkspace: snapshot,
      langgraphPrepareImplementationWorkspace: async (_run: string, id: string, _worktree: string, resume?: string) => {
        preparations.push({ id, resume });
        return { worktree: execution, baselineWorktree: baseline, baselineFingerprint: "original-baseline" };
      },
      langgraphPrepareVerifierWorkspace: async () => execution,
      langgraphReleaseVerifierWorkspace: async () => {},
      langgraphIntegrateVerifiedWorkspace: async (_run: string, _verify: string, worktree: string, implementationActivationId: string, changedFiles: string[]) => { for (const file of changedFiles) fs.copyFileSync(path.join(execution, file), path.join(directory, file)); return { outcome: "landed", implementationActivationId, changedFiles, baselineFingerprint: "original-baseline", patchFingerprint: "patch", commitId: "commit", treeFingerprint: "tree", preservedRef: "refs/test/landed", landedFileFingerprints: Object.fromEntries([...snapshot(execution)].map(([file, value]) => [file, digest(value)])) }; },
    } }) as SolutionLodState;
    expect(configured.progress?.(result)?.phase, result.result).toBe("completed");
    expect(calls).toEqual(["inspect:r1", "inspect:r2", "implement:r2", "implement:r2", "verify:r2", "inspect:r3", "verify:r3"]);
    expect(preparations).toHaveLength(2);
    expect(preparations[1]!.resume).toBe(preparations[0]!.id);
    expect(result.network.telemetry?.recoveryEvents?.filter((event) => event.kind === "implementation-retry")).toHaveLength(1);
    expect(result.network.repositoryEpochs?.["code.txt"]?.digest).toBe(digest("fixed"));
    if (citeArtifacts) {
      const certificate = result.network.certificates.find((item) => item.regionId === "r2")!;
      const artifactId = certificate.premiseRefs.find((id) => id.startsWith("x"))!;
      expect(artifactId).toBeDefined();
      const mutated = structuredClone(result.network);
      mutated.artifacts.find((item) => item.id === artifactId)!.fingerprint = "replaced-artifact";
      expect(isCompletionCertificateValid(mutated, certificate.id)).toBe(false);
    }
    const landed = invalidateEvidenceDigestMismatches(result.network, { "code.txt": digest("fixed") });
    expect(landed.evidence.filter((item) => item.kind === "repository").every((item) => item.status === "confirmed")).toBe(true);
    expect(landed.regions[0]!.evidenceIds.length).toBeGreaterThan(0);
    expect(ensureRunnableWork(landed).done).toBe(true);
    fs.writeFileSync(path.join(directory, "code.txt"), "external edit");
    const external = invalidateEvidenceDigestMismatches(landed, { "code.txt": digest(fs.readFileSync(path.join(directory, "code.txt"), "utf8")) });
    expect(external.evidence.find((item) => item.kind === "repository")?.status).toBe("stale");
    expect(external.regions[0]!.status).not.toBe("verified");
    expect(external.repositoryEpochs?.["code.txt"]).toBeUndefined();
  });

  it.each(["missing-proof", "e1", "e2"])("retains valid observations when optional claim proof %s is inadmissible", async (proof) => {
    const directory = workspace();
    const configured = solutionLodGraph({ agents, checkpointer: new MemorySaver(), maxActivations: 1 });
    const start = initial(directory);
    // A checkpoint can contain unresolved inferences from an earlier activation.
    start.network.evidence.push(
      { id: "e1", kind: "inference", status: "hypothesis", text: "Both values may already be correct", source: "model", fingerprint: "claim" },
      { id: "e2", kind: "inference", status: "hypothesis", text: "The implementation may match the task", source: "model", fingerprint: "other-claim" },
    );
    start.network.regions[0]!.evidenceIds.push("e1", "e2");
    start.network.nextEvidenceId = 3;
    const runtime = { call: async (input: any) => {
      const seen = observation();
      const output = {
        outcome: "boundary", region: { acceptanceCriteria: ["source value was observed"] }, evidence: seen.evidence,
        criterionEvidence: [{ criterionIndex: 0, evidenceRefs: ["code-observation"] }],
        decisionBoundary: { basisRevision: input.state.network.revision, variables: [], permittedPairs: [] },
        validations: [{ claimRef: "e1", verdict: "confirmed", evidenceRefs: [proof], reason: "optional claim assessment" }],
      };
      return { text: "", tools: seen.tools, structured: input.validateStructured(output, { tools: seen.tools }) };
    } };
    const result = await configured.graph.invoke(start, { recursionLimit: 16, configurable: { thread_id: `optional-${proof}`, langgraphOpenCodeRuntime: runtime } }) as SolutionLodState;
    expect(result.network.evidence.find((item) => item.id === "e1")?.status).toBe("hypothesis");
    expect(result.network.evidence.find((item) => item.kind === "repository")).toMatchObject({ status: "confirmed", location: { canonicalPath: "code.txt" } });
    expect(result.network.regions[0]!.criterionVerdicts).toEqual([expect.objectContaining({ verdict: "satisfied", evidenceRefs: ["e3"] })]);
    expect(result.network.activations).toContainEqual(expect.objectContaining({ capability: "inspect", status: "completed" }));
    expect(result.network.telemetry?.validationFailures).toBeGreaterThan(0);
    expect(result.network.telemetry?.validationFailures).toBe(1);
  });

  it("allows directory subdivision and shared files while rejecting authority widening and traversal", () => {
    const state = initial();
    const root = state.network.regions[0]!;
    // The validator consumes the authored parent boundary before any child exists.
    root.acceptanceCriteria = ["runtime works", "schema works"];
    root.criterionIds = ["criterion:scope:r1:0", "criterion:scope:r1:1"];
    root.mutationResources = ["server"];
    const output: RefinementOutput = { outcome: "children", evidence: [], children: [
      { key: "runtime", edge: "partOf", objective: "Fix runtime", allowedVariables: [], acceptanceCriteria: ["runtime works"], coveredCriteria: [0], mutationResources: ["server/runtime", "server/shared.ts"] },
      { key: "schema", edge: "partOf", objective: "Fix schema", allowedVariables: [], acceptanceCriteria: ["schema works"], coveredCriteria: [1], mutationResources: ["server/schema", "server/shared.ts"] },
    ] };
    expect(() => validateRefinementOutput(state, "r1", output)).not.toThrow();
    for (const resource of ["server-other/file.ts", "client/file.ts", "server/../client/file.ts", "server/.git/config"]) {
      const invalid = structuredClone(output);
      invalid.children[0]!.mutationResources = [resource];
      expect(() => validateRefinementOutput(state, "r1", invalid), resource).toThrow(/outside|Unsafe/);
    }
    const leaf: RefinementOutput = { outcome: "leaf", evidence: [], certifiedLeaf: { implementationScope: "Fix both server contracts", criterionIds: root.criterionIds, requirementIds: [], evidenceRefs: [], mutationResources: ["client"], checks: root.criterionIds.map((criterionId) => ({ criterionId, commandOrObservation: "run contract test" })) }, atomicityWitness: { outcome: "Fix contracts", criterionIds: root.criterionIds, requirementIds: [], mutationResources: ["client"], whySplittingFails: "One coordinated contract update" } };
    expect(() => validateRefinementOutput(state, "r1", leaf)).toThrow(/outside/);
  });

  it.each(["server/", "server\\runtime\\", "./server/"])("retains partial edits under normalized resource %s", (resource) => {
    let network = certifiedNetwork();
    const region = network.regions[0]!;
    // Legacy checkpoints may retain ./ and backslash spellings accepted by completion.
    region.mutationResources = [resource];
    region.certifiedLeaf!.mutationResources = [resource];
    network = queueActivation(network, "implement", "r1", "Fix server value", "server-value");
    const activation = network.activations.at(-1)!;
    const changedFile = resource.includes("runtime") ? "server/runtime/value.ts" : "server/value.ts";
    const failed = applyBatchRecords(network, [{ activationId: activation.id, regionId: "r1", capability: "implement", basisRevision: network.revision, startedAt: 1, finishedAt: 2, outcome: "error", networkDelta: null, changedFiles: [changedFile], error: "interrupted after edit", usage: initial().usage }]).network;
    expect(failed.regions[0]).toMatchObject({ status: "actionable", retainedImplementationActivationId: activation.id });
    expect(failed.telemetry?.recoveryEvents?.map((event) => event.kind)).toEqual(["implementation-retry"]);
  });

  it("retires automatic workspace continuation after pruning a failed partial implementation", () => {
    const network = certifiedNetwork();
    const activation = network.activations.at(-1)!;
    const failed = applyBatchRecords(network, [{ activationId: activation.id, regionId: "r1", capability: "implement", basisRevision: network.revision, startedAt: 1, finishedAt: 2, outcome: "error", networkDelta: null, changedFiles: ["code.txt"], error: "interrupted after edit", usage: initial().usage }]).network;
    expect(failed.regions[0]!.retainedImplementationActivationId).toBe(activation.id);
    const pruned = resetPrunedRegion(failed, "r1");
    expect(pruned.regions[0]!.retainedImplementationActivationId).toBeUndefined();
    expect(pruned.artifacts).toContainEqual(expect.objectContaining({ path: "code.txt", historical: true }));
    expect(pruned.telemetry?.recoveryEvents?.map((event) => event.kind)).toEqual(["implementation-retry", "prune"]);
  });

  it("migrates prior admitted paths when the first post-upgrade verification lands", () => {
    let network = certifiedNetwork();
    const implement = network.activations.at(-1)!;
    network = completeImplementation(network, implement.id, { outcome: "completed", summary: "fixed", changedFiles: ["helper.txt"], checks: [] }, ["helper.txt"], { "helper.txt": digest("fixed") }, "baseline");
    // Existing v11 checkpoints have integration records but predate repositoryEpochs.
    // This models a previous landing followed by a new bounded repair of helper.txt.
    network.regions[0]!.integration = { status: "landed", implementationActivationId: "a0", baselineFingerprint: "earlier", changedFiles: ["code.txt"], landedFileFingerprints: { "code.txt": digest("fixed") } };
    delete network.repositoryEpochs;
    network = queueActivation(network, "verify", "r1", "Verify repair", "repair-verified");
    const verify = network.activations.at(-1)!;
    const landed = completeVerification(network, verify.id, { outcome: "pass", summary: "fixed", findings: [], checks: [{ name: "both values fixed", passed: true, evidence: "observed", disposition: "criterion-gating", baselineEvidenceRefs: [], requiredEvidence: [], criterionIds: network.regions[0]!.criterionIds }] }, { outcome: "landed", implementationActivationId: implement.id, baselineFingerprint: "baseline", patchFingerprint: "helper-patch", changedFiles: ["helper.txt"], landedFileFingerprints: { "helper.txt": digest("fixed") } });
    expect(landed.repositoryEpochs?.["code.txt"]?.digest).toBe(digest("fixed"));
    expect(landed.repositoryEpochs?.["helper.txt"]?.digest).toBe(digest("fixed"));
    expect(invalidateEvidenceDigestMismatches(landed, { "code.txt": digest("fixed") }).evidence[0]!.status).toBe("confirmed");
  });

  it("does not let an empty child resource list erase bounded parent authority", () => {
    const state = initial();
    state.network.regions[0]!.acceptanceCriteria = ["runtime works", "schema works"];
    state.network.regions[0]!.mutationResources = ["server"];
    const output: RefinementOutput = { outcome: "children", evidence: [], children: [
      { key: "runtime", edge: "partOf", objective: "Fix runtime", allowedVariables: [], acceptanceCriteria: ["runtime works"], coveredCriteria: [0], mutationResources: [] },
      { key: "schema", edge: "partOf", objective: "Fix schema", allowedVariables: [], acceptanceCriteria: ["schema works"], coveredCriteria: [1], mutationResources: ["server/schema"] },
    ] };
    expect(() => validateRefinementOutput(state, "r1", output)).toThrow(/mutation|resource|scope/i);
  });

  it.each(["client/file.ts", "server/../client/file.ts"])("rejects certified correction scope widening through %s", (resource) => {
    const state = initial();
    state.network.regions[0]!.mutationResources = ["server"];
    const seen = observation();
    const output = InspectionOutputSchema.parse({ outcome: "certified", region: { acceptanceCriteria: ["value fixed"] }, evidence: seen.evidence,
      criterionEvidence: [{ criterionIndex: 0, evidenceRefs: ["code-observation"] }],
      certifiedVerdict: { proposition: "Correct value", implementationScope: "Set value to fixed", evidenceRefs: ["code-observation"], mutationResources: [resource] },
    });
    expect(() => validateSolutionDelta(state, "r1", "inspect", inspectionOutputToDelta(output, seen.tools), seen.tools)).toThrow(/outside|Unsafe/);
  });

  it("cannot reset the cumulative recovery budget by pruning repeatedly", () => {
    let network = initialNetwork("Correct the runtime");
    for (let index = 0; index < 11; index++) network = resetPrunedRegion(network, "r1");
    expect(ensureRunnableWork(network).network.regions[0]!.status).not.toBe("blocked");
    network = resetPrunedRegion(network, "r1");
    const exhausted = ensureRunnableWork(network);
    expect(exhausted.network.regions[0]).toMatchObject({ status: "blocked", contradiction: expect.stringContaining("recoveries=12/12") });
    const retried = ensureRunnableWork(resetPrunedRegion(exhausted.network, "r1"));
    expect(retried.network.regions[0]).toMatchObject({ status: "blocked", contradiction: expect.stringContaining("recoveries=13/12") });
    expect(retried.network.telemetry?.recoveryEvents).toHaveLength(13);
  });
});
