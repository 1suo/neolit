import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { MemorySaver } from "@langchain/langgraph";
import { repositoryEvidenceDigests, solutionLodGraph } from "../src/solution-lod/graph.js";
import { applyActivationOutput, applyBatchRecords, completeImplementation, completeVerification, ensureRunnableWork, initialNetwork, inspectionOutputToDelta, isCompletionCertificateValid, queueActivation, invalidateEvidenceDigestMismatches, resetPrunedRegion, validateRefinementOutput, validateSolutionDelta } from "../src/solution-lod/reducer.js";
import { inspectLinkedWorktrees } from "../src/repository-service.js";
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
    certifiedVerdict: { proposition: "Correct both values", implementationScope: "Set both values to fixed", evidenceRefs: ["code-observation"], mutationResources: ["code.txt", "helper.txt"], checks: [{ criterionIndex: 0, commandOrObservation: "Run the delivery fixture and assert both files read fixed." }] },
  });
  const network = applyActivationOutput(state, state.network.activations[0]!, inspectionOutputToDelta(output, seen.tools), [], seen.tools);
  return queueActivation(network, "implement", "r1", "Fix both values", "fixed-values");
}

describe("delivery recovery", () => {
  it.each([[false, false, false], [true, false, false], [true, true, false], [true, true, true]])("retains cumulative delivery: artifacts=%s inventory=%s externalDuringLanding=%s", async (citeArtifacts, observeWorktrees, externalDuringLanding) => {
    const directory = workspace();
    const baseline = workspace();
    const execution = workspace();
    const verifierCheckout = `${directory}-verifier`;
    const git = (...args: string[]) => execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: "pipe" });
    if (observeWorktrees) {
      fs.writeFileSync(path.join(directory, "outside.txt"), "outside-before");
      git("init", "-q"); git("add", ".");
      git("-c", "user.name=Recovery Test", "-c", "user.email=recovery@example.test", "commit", "-qm", "initial");
      directories.push(verifierCheckout);
    }
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
        const inventoryDigest = observeWorktrees ? (inspectLinkedWorktrees(directory).value as { observationDigest: string }).observationDigest : "";
        const seen = observeWorktrees ? {
          tools: [
            { tool: "graph_inspect_worktrees", status: "completed", metadata: { repositoryDescriptor: { chunkId: "code-observation", canonicalPath: ".git/worktrees", range: [0, 0], fileDigest: inventoryDigest, snapshotEpoch: 0, observation: "worktrees" } } },
            { tool: "graph_read", status: "completed", metadata: { repositoryDescriptor: { chunkId: "outside-observation", canonicalPath: "outside.txt", range: [1, 1], fileDigest: digest("outside-before"), snapshotEpoch: 0 } } },
          ], evidence: [
            { kind: "repository", text: "Worktree inventory observed before correction", source: ".git/worktrees", chunkId: "code-observation" },
            { kind: "repository", text: "Outside file observed before correction", source: "outside.txt:1", chunkId: "outside-observation" },
          ],
        } : observation();
        return { text: "", tools: seen.tools, structured: {
          outcome: "certified", region: { acceptanceCriteria: ["both values are fixed"] }, evidence: seen.evidence,
          criterionEvidence: [{ criterionIndex: 0, evidenceRefs: ["code-observation"] }],
          certifiedVerdict: { proposition: "Correct both values", implementationScope: "Set code and helper to fixed", evidenceRefs: ["code-observation"], mutationResources: ["code.txt", "helper.txt"], checks: [{ criterionIndex: 0, commandOrObservation: "Run the delivery fixture and assert both files read fixed." }] },
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
      langgraphPrepareVerifierWorkspace: async () => {
        if (observeWorktrees) git("worktree", "add", "--detach", verifierCheckout, "HEAD");
        return execution;
      },
      langgraphExecuteVerificationChecks: async (_run: string, _verify: string, _worktree: string, _region: string, criterionIds: string[]) => criterionIds.map((criterionId) => ({ criterionId, name: `host ${criterionId}`, passed: true, evidence: "host check passed" })),
      langgraphReleaseVerifierWorkspace: async () => { if (observeWorktrees && fs.existsSync(verifierCheckout)) git("worktree", "remove", verifierCheckout); },
      langgraphIntegrateVerifiedWorkspace: async (_run: string, _verify: string, worktree: string, implementationActivationId: string, changedFiles: string[]) => { for (const file of changedFiles) fs.copyFileSync(path.join(execution, file), path.join(directory, file)); if (externalDuringLanding) fs.writeFileSync(path.join(directory, "outside.txt"), "external modification"); return { outcome: "landed", implementationActivationId, changedFiles, baselineFingerprint: "original-baseline", patchFingerprint: "patch", commitId: "commit", treeFingerprint: "tree", preservedRef: "refs/test/landed", landedFileFingerprints: Object.fromEntries([...snapshot(execution)].map(([file, value]) => [file, digest(value)])) }; },
    } }) as SolutionLodState;
    if (externalDuringLanding) {
      expect(configured.progress?.(result)?.phase).toBe("blocked");
      expect(result.network.evidence.find((item) => item.location?.canonicalPath === "outside.txt")?.status).toBe("stale");
      expect(result.network.evidence.find((item) => item.location?.observation === "worktrees")?.status).toBe("stale");
      expect(result.network.repositoryEpochs?.["outside.txt"]).toBeUndefined();
      expect(result.network.repositoryEpochs?.[".git/worktrees"]).toBeUndefined();
      return;
    }
    expect(configured.progress?.(result)?.phase, result.result).toBe("completed");
    if (observeWorktrees) {
      expect(fs.existsSync(verifierCheckout)).toBe(false);
      expect(result.network.repositoryEpochs?.[".git/worktrees"]?.digest).toBe((inspectLinkedWorktrees(directory).value as { observationDigest: string }).observationDigest);
      expect(result.network.repositoryEpochs?.["outside.txt"]).toBeUndefined();
    }
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
    if (observeWorktrees) git("worktree", "add", "--detach", verifierCheckout, "HEAD");
    const external = invalidateEvidenceDigestMismatches(landed, observeWorktrees ? repositoryEvidenceDigests(directory, landed) : { "code.txt": digest(fs.readFileSync(path.join(directory, "code.txt"), "utf8")) });
    expect(external.evidence.find((item) => item.kind === "repository")?.status).toBe("stale");
    expect(external.regions[0]!.status).not.toBe("verified");
    expect(external.repositoryEpochs?.["code.txt"]).toBeUndefined();
    if (observeWorktrees) {
      expect(external.evidence.find((item) => item.location?.observation === "worktrees")?.status).toBe("stale");
      expect(external.repositoryEpochs?.[".git/worktrees"]).toBeUndefined();
    }
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

  it.each([false, true])("rebuilds a challenged boundary without reopening settled criteria; persistent=%s", async (persistent) => {
    const directory = workspace();
    const execution = workspace();
    const configured = solutionLodGraph({ agents, checkpointer: new MemorySaver(), maxActivations: 16 });
    const calls: string[] = [];
    let inspections = 0;
    let challenges = 0;
    const defect = "The storage and index variables need a permitted pair for indexed arrays.";
    const missingFamily = { key: "indexed-array", proposition: "Use an array plus a lookup index" };
    const runtime = { call: async (input: any) => {
      calls.push(input.node);
      const network = input.state.network;
      const region = network.regions[0];
      if (input.node === "inspect:r1") {
        inspections++;
        const seen = observation();
        if (inspections > 1) {
          expect(region.inspectionObligationIds).toEqual([]);
          expect(region.criterionVerdicts).toEqual([expect.objectContaining({ verdict: "unsatisfied", evidenceRefs: ["e1"] })]);
          const activation = network.activations.find((item: { id: string }) => item.id === input.physicalActivationId);
          expect(activation.request).toContain(defect);
          expect(activation.request).toContain(missingFamily.proposition);
          expect(input.prompt).toContain(defect);
          expect(input.prompt).toContain(missingFamily.proposition);
          expect(activation.contextRefs).toContain("e1");
        }
        return { text: "", tools: inspections === 1 ? seen.tools : [], structured: {
          outcome: "boundary", ...(inspections === 1 ? { region: { acceptanceCriteria: ["recent collection implemented"], allowedVariables: ["storage", "index"] }, evidence: seen.evidence, criterionEvidence: [{ criterionIndex: 0, verdict: "unsatisfied", reason: "collection absent", evidenceRefs: ["code-observation"] }] } : {}),
          decisionBoundary: { basisRevision: network.revision, variables: [
            { key: "storage", name: "storage", seedLabels: ["array", "set"], evidenceRefs: [inspections === 1 ? "code-observation" : "e1"] },
            { key: "index", name: "index", seedLabels: ["map"], evidenceRefs: [inspections === 1 ? "code-observation" : "e1"] },
          ], permittedPairs: inspections > 1 ? [{ leftVariableKey: "storage", rightVariableKey: "index", evidenceRefs: ["e1"] }] : [] },
        } };
      }
      if (input.node === "generate-domain:r1") {
        const variables = region.decisionBoundary.variables;
        const storage = variables.find((item: { name: string }) => item.name === "storage").id;
        const index = variables.find((item: { name: string }) => item.name === "index").id;
        const candidates = ["array", "set"].map((key) => ({ key, proposition: `Use ${key}`, evidenceRefs: ["e1"], coordinates: [
          { variableId: storage, applicability: "applies", stances: [{ relation: "requires", valueLabel: key }] },
          { variableId: index, applicability: "not-applicable", reason: "No auxiliary index" },
        ] }));
        if (inspections > 1) candidates.push({ ...missingFamily, evidenceRefs: ["e1"], coordinates: [
          { variableId: storage, applicability: "applies", stances: [{ relation: "requires", valueLabel: "array" }] },
          { variableId: index, applicability: "applies", stances: [{ relation: "requires", valueLabel: "map" }] },
        ] });
        return { text: "", structured: { outcome: "candidates", candidates } };
      }
      if (input.node === "challenge-domain:r1") {
        challenges++;
        if (challenges === 1 || persistent) return { text: "", structured: { outcome: "boundary-counterexample", boundDomainFingerprint: region.boundDomainFingerprint, missingFamily, defect: { kind: "missing-pair", description: defect }, evidenceRefs: ["e1"] } };
        expect(region.candidateIds).toContain("r1:indexed-array");
        expect(region.progress.cegarRounds.count).toBe(1);
        return { text: "", structured: { outcome: "accept", boundDomainFingerprint: region.boundDomainFingerprint, viableCandidateIds: region.candidateIds } };
      }
      if (input.node === "select-candidate:r1") return { text: "", structured: { outcome: "selected", boundDomainFingerprint: region.boundDomainFingerprint, selectedCandidateId: "r1:array", comparisons: region.candidateIds.map((candidateId: string) => ({ candidateId, userPreference: "neutral", repositoryCompatibility: "neutral", changeScope: candidateId === "r1:array" ? "preferred" : "neutral", irreversibleRisk: "neutral", evidenceRefs: ["e1"] })) } };
      if (input.node === "refine:r1") return { text: "", structured: { outcome: "leaf", evidence: [], certifiedLeaf: { implementationScope: "Implement array representation", criterionIds: region.criterionIds, requirementIds: region.requirementIds, evidenceRefs: ["e1"], mutationResources: ["code.txt"], checks: [{ criterionId: region.criterionIds[0], commandOrObservation: "check array implementation" }] }, atomicityWitness: { outcome: "Implement array representation", criterionIds: region.criterionIds, requirementIds: region.requirementIds, mutationResources: ["code.txt"], whySplittingFails: "One bounded collection implementation and its behavior check" } } };
      if (input.node === "implement:r1") {
        fs.writeFileSync(path.join(input.worktree, "code.txt"), "array implementation");
        return { text: "", structured: { outcome: "completed", summary: "Array implemented", changedFiles: ["code.txt"], checks: [{ name: "recent collection implemented", passed: true, evidence: "observed array implementation" }] } };
      }
      if (input.node === "verify:r1") {
        expect(fs.readFileSync(path.join(input.worktree, "code.txt"), "utf8")).toBe("array implementation");
        return { text: "", structured: { outcome: "pass", summary: "Array verified", findings: [], checks: [{ name: "recent collection implemented", passed: true, evidence: "array implementation observed", criterionIds: region.criterionIds }], completionEvidence: { implementation: "measured code.txt", directTest: "array observation passed", correctnessReview: "reviewed chosen representation", releaseGate: "focused checks passed", changedFiles: ["code.txt"], focusedTests: ["array observation"], fullChecks: ["focused checks"] } } };
      }
      throw new Error(`Unexpected activation ${input.node}`);
    } };
    const start = configured.initial({ task: { id: "task", exactText: "Choose a representation and implement the recent collection" }, authoritativeMessages: [], directory, worktree: directory, runId: `boundary-recovery-${persistent}` });
    const result = await configured.graph.invoke(start, { recursionLimit: 64, configurable: {
      thread_id: `boundary-recovery-${persistent}`, langgraphOpenCodeRuntime: runtime, langgraphSnapshotWorkspace: snapshot,
      langgraphPrepareImplementationWorkspace: async () => ({ worktree: execution, baselineFingerprint: "before" }),
      langgraphPrepareVerifierWorkspace: async () => execution,
      langgraphExecuteVerificationChecks: async (_run: string, _verify: string, _worktree: string, _region: string, criterionIds: string[]) => criterionIds.map((criterionId) => ({ criterionId, name: `host ${criterionId}`, passed: true, evidence: "host check passed" })),
      langgraphIntegrateVerifiedWorkspace: async (_run: string, _verify: string, _worktree: string, implementationActivationId: string, changedFiles: string[]) => {
        fs.copyFileSync(path.join(execution, "code.txt"), path.join(directory, "code.txt"));
        return { outcome: "landed", implementationActivationId, changedFiles, baselineFingerprint: "before", patchFingerprint: "array-patch", commitId: "array-commit", treeFingerprint: "array-tree", preservedRef: "refs/test/array", landedFileFingerprints: { "code.txt": digest("array implementation") } };
      },
    } }) as SolutionLodState;
    expect(result.network.regions[0]!.criterionVerdicts).toEqual([expect.objectContaining({ verdict: "unsatisfied", evidenceRefs: ["e1"] })]);
    if (persistent) {
      expect(result.result).toContain("CEGAR repair bound exceeded");
      expect(inspections).toBe(3);
      expect(challenges).toBe(3);
      expect(result.network.regions[0]!.progress.cegarRounds.count).toBe(2);
    } else {
      expect(calls, JSON.stringify(result.network.activations.filter((item) => item.status === "failed"))).toEqual(["inspect:r1", "generate-domain:r1", "challenge-domain:r1", "inspect:r1", "generate-domain:r1", "challenge-domain:r1", "select-candidate:r1", "refine:r1", "implement:r1", "verify:r1"]);
      expect(configured.progress?.(result)?.phase, result.result).toBe("completed");
      expect(result.network.regions[0]).toMatchObject({ status: "verified", selectedCandidateIds: ["r1:array"], inspectionAttempts: 2 });
    }
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
    const landed = completeVerification(network, verify.id, { outcome: "pass", summary: "fixed", findings: [], checks: [{ name: "both values fixed", passed: true, evidence: "observed", disposition: "criterion-gating", baselineEvidenceRefs: [], requiredEvidence: [], criterionIds: network.regions[0]!.criterionIds }] }, { outcome: "landed", implementationActivationId: implement.id, baselineFingerprint: "baseline", patchFingerprint: "helper-patch", changedFiles: ["helper.txt"], landedFileFingerprints: { "helper.txt": digest("fixed") }, landedObservationFingerprints: { "code.txt": digest("external edit") } });
    expect(landed.repositoryEpochs?.["code.txt"]?.digest).toBe(digest("fixed"));
    expect(landed.repositoryEpochs?.["helper.txt"]?.digest).toBe(digest("fixed"));
    expect(landed.regions[0]!.integration?.landedObservationFingerprints).toEqual({});
    expect(invalidateEvidenceDigestMismatches(landed, { "code.txt": digest("external edit") }).evidence[0]!.status).toBe("stale");
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
      certifiedVerdict: { proposition: "Correct value", implementationScope: "Set value to fixed", evidenceRefs: ["code-observation"], mutationResources: [resource], checks: [{ criterionIndex: 0, commandOrObservation: "Run the value fixture and assert it reads fixed." }] },
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
