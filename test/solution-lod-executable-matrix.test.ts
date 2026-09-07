import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { MemorySaver } from "@langchain/langgraph";
import { solutionLodGraph } from "../src/solution-lod/graph.js";
import { queueActivation } from "../src/solution-lod/reducer.js";
import type { SolutionLodState, SolutionNetwork } from "../src/solution-lod/types.js";

const directories = new Set<string>();
const agents = { inspect: "inspect", synthesize: "synthesize", refine: "refine", implement: "implement", verify: "verify", present: "present" } as const;
const changeHooks = (directory: string) => ({
  langgraphPrepareImplementationWorkspace: async () => ({ worktree: directory, baselineFingerprint: "matrix-baseline" }),
  langgraphPrepareVerifierWorkspace: async () => directory,
  langgraphExecuteVerificationChecks: async (_runId: string, _activationId: string, _worktree: string, _regionId: string, checks: Array<{ criterionId: string }>) => checks.map((check) => ({ criterionId: check.criterionId, name: `host ${check.criterionId}`, passed: true, evidence: "host check passed" })),
  langgraphIntegrateVerifiedWorkspace: async (_runId: string, _verificationActivationId: string, _worktree: string, implementationActivationId: string, changedFiles: string[]) => ({ outcome: "landed" as const, implementationActivationId, baselineFingerprint: "matrix-baseline", changedFiles, patchFingerprint: "matrix-patch", commitId: "matrix-commit", treeFingerprint: "matrix-tree", preservedRef: "refs/neolit/matrix", landedFileFingerprints: Object.fromEntries(changedFiles.map((file) => [file, `landed:${file}`])) }),
});

afterEach(() => {
  for (const directory of directories) fs.rmSync(directory, { recursive: true, force: true });
  directories.clear();
});

function workspace(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "solution-lod-matrix-"));
  directories.add(directory);
  fs.writeFileSync(path.join(directory, "code.txt"), "before");
  fs.writeFileSync(path.join(directory, "docs.txt"), "before");
  return directory;
}

function snapshot(directory: string): Map<string, string> {
  return new Map(["code.txt", "docs.txt"].map((file) => [file, fs.readFileSync(path.join(directory, file), "utf8")]));
}

const observed = (text: string, file = "docs.txt") => ({
  tools: [{ tool: "graph_read", status: "completed" as const, metadata: { repositoryDescriptor: { chunkId: "observed-chunk", canonicalPath: file, range: [1, 1], fileDigest: createHash("sha256").update("before").digest("hex"), snapshotEpoch: 0 } } }],
  evidence: [{ kind: "repository" as const, text, source: `${file}:1`, chunkId: "observed-chunk" }],
});

describe("solution LOD executable task matrix", () => {
  it("does not dispatch parallel work beyond the remaining run allowance", async () => {
    const directory = workspace();
    const configured = solutionLodGraph({ agents, maxActivations: 2, maxParallelActivations: 3, checkpointer: new MemorySaver() });
    const initial = configured.initial({ task: { id: "cap", exactText: "Inspect independent scopes" }, authoritativeMessages: [], directory, worktree: directory, runId: "cap" });
    initial.callsUsed = 1;
    initial.network.activations = [];
    const root = initial.network.regions[0]!;
    root.activationIds = [];
    for (const id of ["r2", "r3"]) initial.network.regions.push({ ...structuredClone(root), id, key: id, scopeId: `scope:${id}`, parentId: "r1", edge: "partOf", lod: 1 });
    for (const id of ["r2", "r3"]) initial.network = queueActivation(initial.network, "inspect", id, "Inspect this scope", `inspect:${id}`, [id]);
    let calls = 0;
    const result = await configured.graph.invoke(initial, { recursionLimit: 16, configurable: { thread_id: "cap", langgraphOpenCodeRuntime: { call: async () => { calls++; throw new Error("unavailable"); } } } }) as SolutionLodState;
    expect(calls).toBe(1);
    expect(result.callsUsed).toBe(2);
    expect(result.phase).toBe("blocked");
  });

  it("locally refines a prescribed non-atomic root before executing dependent children", async () => {
    const directory = workspace();
    const calls: string[] = [];
    const implementations = new Map<string, number>();
    const verifications = new Map<string, number>();
    const runtime = { call: async (input: any) => {
      calls.push(input.node);
      const network = input.state.network as SolutionNetwork;
      const region = network.regions.find((item) => input.node.endsWith(`:${item.id}`))!;
      if (input.node === "inspect:r1") return { text: "", structured: {
        outcome: "boundary",
        region: { acceptanceCriteria: ["code is fixed", "docs describe fixed code"] },
        criterionEvidence: [{ criterionIndex: 0, evidenceRefs: ["task"] }, { criterionIndex: 1, evidenceRefs: ["task"] }],
        decisionBoundary: { basisRevision: network.revision, variables: [], permittedPairs: [] },
      } };
      if (input.node.startsWith("inspect:")) return { text: "", structured: {
        outcome: "boundary",
        criterionEvidence: region.criterionIds.map((_, criterionIndex) => ({ criterionIndex, evidenceRefs: ["task"] })),
        decisionBoundary: { basisRevision: network.revision, variables: [], permittedPairs: [] },
      } };
      if (input.node.startsWith("generate-domain:")) return { text: "", structured: { outcome: "candidates", candidates: [{ key: "fixed", proposition: `Perform the prescribed ${region.key} change`, coordinates: [] }] } };
      if (input.node.startsWith("challenge-domain:")) return { text: "", structured: { outcome: "accept", boundDomainFingerprint: region.boundDomainFingerprint, viableCandidateIds: [...region.candidateIds] } };
      if (input.node.startsWith("select-candidate:")) return { text: "", structured: {
        outcome: "selected",
        boundDomainFingerprint: region.boundDomainFingerprint,
        selectedCandidateId: `${region.id}:fixed`,
        comparisons: region.candidateIds.map((candidateId) => ({ candidateId, userPreference: "neutral", repositoryCompatibility: "neutral", changeScope: "neutral", irreversibleRisk: "neutral", evidenceRefs: [] })),
      } };
      if (input.node === "refine:r1") return { text: "", structured: { outcome: "children", evidence: [], children: [
        { key: "code", objective: "Update the runtime code", edge: "partOf", delivery: "change", allowedVariables: [], acceptanceCriteria: ["code is fixed"], coveredCriteria: [0], requirementIds: ["requirement:root-criterion-0"], mutationResources: ["code.txt"] },
        { key: "docs", objective: "Document the fixed runtime", edge: "partOf", delivery: "change", allowedVariables: [], acceptanceCriteria: ["docs describe fixed code"], coveredCriteria: [1], requirementIds: ["requirement:root-criterion-1"], dependencyScopeIds: ["scope:r1:code"], mutationResources: ["docs.txt"] },
      ] } };
      if (input.node.startsWith("refine:")) return { text: "", structured: { outcome: "leaf", evidence: [], certifiedLeaf: {
        implementationScope: `Change ${region.mutationResources[0]}`,
        criterionIds: [...region.criterionIds],
        requirementIds: [...region.requirementIds],
        evidenceRefs: [],
        mutationResources: [...region.mutationResources],
        checks: region.criterionIds.map((criterionId) => ({ criterionId, commandOrObservation: `check ${region.acceptanceCriteria[0]}` })),
      }, atomicityWitness: { outcome: `Change ${region.mutationResources[0]}`, criterionIds: [...region.criterionIds], requirementIds: [...region.requirementIds], mutationResources: [...region.mutationResources], whySplittingFails: "The bounded file change and its focused check are one change." } } };
      if (input.node.startsWith("challenge-leaf:")) return { text: "", structured: { outcome: "accept-leaf", reason: "Each leaf owns one bounded file change and its check." } };
      if (input.node.startsWith("implement:")) {
        const count = (implementations.get(region.id) ?? 0) + 1;
        implementations.set(region.id, count);
        const file = region.mutationResources[0]!;
        fs.writeFileSync(path.join(directory, file), region.key === "code" && count === 1 ? "broken" : "fixed");
        return { text: "", structured: { outcome: "completed", summary: `implemented ${region.key}`, changedFiles: [file], checks: [{ name: region.acceptanceCriteria[0], passed: true, evidence: "focused check ran" }] } };
      }
      if (input.node.startsWith("verify:")) {
        const count = (verifications.get(region.id) ?? 0) + 1;
        verifications.set(region.id, count);
        if (region.key === "code" && count === 1) return { text: "", structured: {
          outcome: "repair",
          summary: "code is still broken",
          findings: [{ regionId: region.id, criterionId: region.criterionIds[0], severity: "high", target: { kind: "files", refs: ["code.txt"] }, problem: "wrong runtime value", regressionCriterion: region.acceptanceCriteria[0], evidence: "code.txt contains broken", evidenceRefs: [] }],
          checks: [{ name: region.acceptanceCriteria[0], passed: false, evidence: "observed broken", criterionIds: [region.criterionIds[0]] }],
        } };
        const file = region.mutationResources[0]!;
        return { text: "", structured: {
          outcome: "pass",
          summary: `verified ${region.key}`,
          findings: [],
          checks: [{ name: region.acceptanceCriteria[0], passed: true, evidence: "observed fixed", criterionIds: [region.criterionIds[0]] }],
          completionEvidence: { implementation: `measured ${file}`, directTest: `${file} focused test passed`, correctnessReview: "reviewed behavior", releaseGate: "matrix checks passed", changedFiles: [file], focusedTests: [`${file} focused`], fullChecks: ["matrix suite"] },
        } };
      }
      throw new Error(`unexpected call ${input.node}`);
    } };
    const configured = solutionLodGraph({ agents, maxParallelActivations: 2, checkpointer: new MemorySaver() });
    const initial = configured.initial({ task: { id: "task-matrix", exactText: "Update runtime code, then document it" }, authoritativeMessages: [], directory, worktree: directory, runId: "matrix-dependent-repair" });
    const result = await configured.graph.invoke(initial, { recursionLimit: 128, configurable: {
      thread_id: "matrix-dependent-repair",
      langgraphOpenCodeRuntime: runtime,
      ...changeHooks(directory),
      langgraphAcquireWorktree: async () => {},
      langgraphSnapshotWorkspace: snapshot,
      langgraphReleaseVerifierWorkspace: async () => {},
    } });
    const final = result as SolutionLodState;
    expect(configured.progress?.(final)?.phase, final.result).toBe("completed");
    expect(fs.readFileSync(path.join(directory, "code.txt"), "utf8")).toBe("fixed");
    expect(fs.readFileSync(path.join(directory, "docs.txt"), "utf8")).toBe("fixed");
    expect(implementations.get("r2")).toBe(2);
    expect(verifications.get("r2")).toBe(2);
    expect(calls).toContain("refine:r1");
    expect(calls.indexOf("implement:r1")).toBe(-1);
    expect(calls.indexOf("inspect:r3")).toBeGreaterThan(calls.lastIndexOf("verify:r2"));
    expect(final.network.regions.filter((region) => region.parentId === "r1").every((region) => region.status === "verified")).toBe(true);
  }, 20_000);

  it("routes a repository-certified correction directly to implementation and an external verification failure", async () => {
    const directory = workspace();
    const calls: string[] = [];
    const runtime = { call: async (input: any) => {
      calls.push(input.node);
      const region = input.state.network.regions[0];
      if (input.node === "inspect:r1") { const observation = observed("code.txt contains the incorrect fixed value"); return { text: "", tools: observation.tools, structured: {
        outcome: "certified", region: { acceptanceCriteria: ["code is corrected"] }, evidence: observation.evidence, criterionEvidence: [{ criterionIndex: 0, evidenceRefs: ["observed-chunk"] }],
        certifiedVerdict: { proposition: "Correct code.txt", implementationScope: "Replace the incorrect value", evidenceRefs: ["observed-chunk"], mutationResources: ["code.txt"], checks: [{ criterionIndex: 0, commandOrObservation: "Run the focused code.txt test and assert it reads fixed." }] },
      } }; }
      if (input.node === "challenge-leaf:r1") return { text: "", structured: { outcome: "accept-leaf", reason: "The correction and focused check form one file-owned change." } };
      if (input.node === "implement:r1") { fs.writeFileSync(path.join(directory, "code.txt"), "fixed"); return { text: "", structured: { outcome: "completed", summary: "corrected", changedFiles: ["code.txt"], checks: [{ name: "code is corrected", passed: true, evidence: "observed fixed" }] } }; }
      if (input.node === "verify:r1") return { text: "", structured: { outcome: "fail", summary: "external service unavailable", findings: [{ regionId: "r1", criterionId: region.criterionIds[0], severity: "high", target: { kind: "environment", refs: [] }, problem: "required service is unavailable", regressionCriterion: "code is corrected", evidence: "connection refused", evidenceRefs: [], resolutionOwner: "service operator", requiredEvidence: ["successful service probe"] }], checks: [] } };
      throw new Error(`unexpected call ${input.node}`);
    } };
    const configured = solutionLodGraph({ agents, checkpointer: new MemorySaver() });
    const result = await configured.graph.invoke(configured.initial({ task: { id: "certified-fail", exactText: "Correct code.txt" }, authoritativeMessages: [], directory, worktree: directory, runId: "matrix-certified-fail" }), { recursionLimit: 16, configurable: { thread_id: "matrix-certified-fail", langgraphOpenCodeRuntime: runtime, ...changeHooks(directory), langgraphAcquireWorktree: async () => {}, langgraphSnapshotWorkspace: snapshot, langgraphReleaseVerifierWorkspace: async () => {} } });
    expect(calls).toEqual(["inspect:r1", "challenge-leaf:r1", "implement:r1", "verify:r1"]);
    expect(configured.progress?.(result)?.phase).toBe("blocked");
    expect((result as SolutionLodState).network.regions[0]?.blockedDetails?.kind).toBe("blocked-external");
  });

  it("admits an evidence-backed implementation dependency missing from a provisional local scope", async () => {
    const directory = workspace();
    const calls: string[] = [];
    const runtime = { call: async (input: any) => {
      calls.push(input.node);
      const region = input.state.network.regions[0];
      if (input.node === "inspect:r1") { const observation = observed("code.txt contains the validator implementation that must change", "code.txt"); return { text: "", tools: observation.tools, structured: {
        outcome: "certified", region: { acceptanceCriteria: ["code is corrected"] }, evidence: observation.evidence, criterionEvidence: [{ criterionIndex: 0, evidenceRefs: ["observed-chunk"] }],
        certifiedVerdict: { proposition: "Correct code.txt", implementationScope: "Replace the incorrect value", evidenceRefs: ["observed-chunk"], mutationResources: ["code.txt"], checks: [{ criterionIndex: 0, commandOrObservation: "Run the focused code.txt test and assert it reads fixed." }] },
      } }; }
      if (input.node === "challenge-leaf:r1") return { text: "", structured: { outcome: "accept-leaf", reason: "The correction and focused check form one file-owned change." } };
      if (input.node === "implement:r1") { fs.writeFileSync(path.join(directory, "code.txt"), "fixed"); return { text: "", structured: { outcome: "completed", summary: "corrected", changedFiles: ["code.txt"], checks: [{ name: "code is corrected", passed: true, evidence: "focused check ran" }] } }; }
      if (input.node === "verify:r1") return { text: "", structured: { outcome: "pass", summary: "verified", findings: [], checks: [{ name: "code is corrected", passed: true, evidence: "code.txt is fixed", criterionIds: [...region.criterionIds] }], completionEvidence: { implementation: "changed code.txt", directTest: "focused code test passed", correctnessReview: "reviewed corrected value", releaseGate: "matrix checks passed", changedFiles: ["code.txt"], focusedTests: ["code.txt focused"], fullChecks: ["matrix suite"] } } };
      throw new Error(`unexpected call ${input.node}`);
    } };
    const configured = solutionLodGraph({ agents, checkpointer: new MemorySaver() });
    const initial = configured.initial({ task: { id: "scope-expansion", exactText: "Correct code.txt" }, authoritativeMessages: [], directory, worktree: directory, runId: "scope-expansion" });
    initial.network.regions[0]!.mutationResources = ["docs.txt"];
    initial.network.activations = [];
    initial.network.regions[0]!.activationIds = [];
    initial.network = queueActivation(initial.network, "inspect", "r1", "Inspect code.txt", "inspect:r1", ["r1"]);
    const result = await configured.graph.invoke(initial, { recursionLimit: 32, configurable: { thread_id: "scope-expansion", langgraphOpenCodeRuntime: runtime, ...changeHooks(directory), langgraphAcquireWorktree: async () => {}, langgraphSnapshotWorkspace: snapshot, langgraphReleaseVerifierWorkspace: async () => {} } }) as SolutionLodState;
    expect(calls).toEqual(["inspect:r1", "challenge-leaf:r1", "implement:r1", "verify:r1"]);
    expect(result.network.regions[0]!.certifiedLeaf?.mutationResources).toEqual(["code.txt"]);
    expect(result.result).toContain("completed");
  });

  it("routes an already-satisfied inspection directly to verification", async () => {
    const directory = workspace();
    const calls: string[] = [];
    const runtime = { call: async (input: any) => {
      calls.push(input.node);
      const region = input.state.network.regions[0];
      if (input.node === "inspect:r1") { const observation = observed("code.txt already contains the required value"); return { text: "", tools: observation.tools, structured: {
        outcome: "already-satisfied", region: { acceptanceCriteria: ["code is already correct"] }, evidence: observation.evidence, criterionEvidence: [{ criterionIndex: 0, evidenceRefs: ["observed-chunk"] }],
        alreadySatisfied: { proposition: "code.txt is already correct", criterionEvidence: [{ criterionIndex: 0, evidenceRefs: ["observed-chunk"] }], verificationResources: ["code.txt"] },
      } }; }
      if (input.node === "verify:r1") return { text: "", structured: { outcome: "pass", summary: "confirmed", findings: [], checks: [{ name: "code is already correct", passed: true, evidence: "observed required value", criterionIds: [...region.criterionIds] }], completionEvidence: { implementationOutcome: "already-satisfied", implementation: "repository state was unchanged", directTest: "value check passed", correctnessReview: "reviewed value", releaseGate: "matrix passed", changedFiles: [], focusedTests: ["value check"], fullChecks: ["matrix"], inspectionEvidenceRefs: [...region.evidenceIds] } } };
      throw new Error(`unexpected call ${input.node}`);
    } };
    const configured = solutionLodGraph({ agents, checkpointer: new MemorySaver() });
    const result = await configured.graph.invoke(configured.initial({ task: { id: "already", exactText: "Ensure code.txt is correct" }, authoritativeMessages: [], directory, worktree: directory, runId: "matrix-already" }), { recursionLimit: 16, configurable: { thread_id: "matrix-already", langgraphOpenCodeRuntime: runtime, ...changeHooks(directory), langgraphSnapshotWorkspace: snapshot, langgraphReleaseVerifierWorkspace: async () => {} } });
    expect(calls).toEqual(["inspect:r1", "verify:r1"]);
    expect(configured.progress?.(result)?.phase, configured.result?.(result)).toBe("completed");
  });

  it("routes an inspected answer directly to verification", async () => {
    const directory = workspace();
    const calls: string[] = [];
    const runtime = { call: async (input: any) => {
      calls.push(input.node);
      const region = input.state.network.regions[0];
      if (input.node === "inspect:r1") return { text: "", structured: { outcome: "answer", resolvedAnswer: { answer: "The value is fixed.", acceptanceCriteria: ["answer states the value"], evidenceRefs: ["task"] } } };
      if (input.node === "verify:r1") return { text: "", structured: { outcome: "pass", summary: "confirmed", findings: [], checks: [{ name: "answer states the value", passed: true, evidence: "answer says fixed", criterionIds: [...region.criterionIds] }] } };
      throw new Error(`unexpected call ${input.node}`);
    } };
    const configured = solutionLodGraph({ agents, checkpointer: new MemorySaver() });
    const result = await configured.graph.invoke(configured.initial({ task: { id: "answer", exactText: "What is the value?" }, authoritativeMessages: [], directory, worktree: directory, runId: "matrix-answer" }), { recursionLimit: 16, configurable: { thread_id: "matrix-answer", langgraphOpenCodeRuntime: runtime } });
    expect(calls).toEqual(["inspect:r1", "verify:r1"]);
    expect(configured.progress?.(result)?.phase, configured.result?.(result)).toBe("completed");
    expect(configured.result?.(result)).toBe("The value is fixed.");
  });

  it("executes counterexample expansion and hard-constraint rechallenge before selection", async () => {
    const directory = workspace();
    const calls: string[] = [];
    let challenges = 0;
    let selections = 0;
    const runtime = { call: async (input: any) => {
      calls.push(input.node);
      const network = input.state.network as SolutionNetwork;
      const region = network.regions[0]!;
      const variableId = network.variables[0]?.id;
      const comparisons = () => region.candidateIds.filter((candidateId) => network.candidates.find((candidate) => candidate.id === candidateId)?.status !== "eliminated").map((candidateId) => ({ candidateId, userPreference: "neutral", repositoryCompatibility: "neutral", changeScope: candidateId === "r1:native" ? "preferred" : "disfavored", irreversibleRisk: "neutral", evidenceRefs: [] }));
      if (input.node === "inspect:r1") { const observation = observed("docs.txt requires the native approach"); return { text: "", tools: observation.tools, structured: { outcome: "boundary", region: { acceptanceCriteria: ["approach is applied"] }, evidence: observation.evidence, criterionEvidence: [{ criterionIndex: 0, evidenceRefs: ["observed-chunk"] }], materialRequirements: [{ key: "applied", text: "approach is applied", scopeKey: "r1", criterionIndex: 0, evidenceRefs: ["observed-chunk"] }], decisionBoundary: { basisRevision: network.revision, variables: [{ key: "approach", name: "approach", seedLabels: ["native", "adapter", "config"], evidenceRefs: ["observed-chunk"] }], permittedPairs: [] } } }; }
      if (input.node === "generate-domain:r1") return { text: "", structured: { outcome: "candidates", candidates: ["native", "adapter"].map((key) => ({ key, proposition: `Use ${key}`, coordinates: [{ variableId, applicability: "applies", stances: [{ relation: "requires", valueLabel: key }] }] })) } };
      if (input.node === "challenge-domain:r1") {
        challenges++;
        if (challenges === 1) return { text: "", structured: { outcome: "counterexample", boundDomainFingerprint: region.boundDomainFingerprint, candidate: { key: "config", proposition: "Use config", coordinates: [{ variableId, applicability: "applies", stances: [{ relation: "requires", valueLabel: "config" }] }] }, reason: "configuration is a distinct family", evidenceRefs: [] } };
        return { text: "", structured: { outcome: "accept", boundDomainFingerprint: region.boundDomainFingerprint, viableCandidateIds: region.candidateIds.filter((id) => network.candidates.find((candidate) => candidate.id === id)?.status !== "eliminated") } };
      }
      if (input.node === "select-candidate:r1") {
        selections++;
        if (selections === 1) return { text: "", structured: { outcome: "hard-constraint", boundDomainFingerprint: region.boundDomainFingerprint, comparisons: comparisons(), hardConstraints: [{ kind: "refutes", subject: "e1", target: "r1:adapter", reason: "confirmed incompatible", evidenceRefs: ["e1"], sourceKind: "repo-evidence" }] } };
        return { text: "", structured: { outcome: "selected", boundDomainFingerprint: region.boundDomainFingerprint, selectedCandidateId: "r1:native", comparisons: comparisons() } };
      }
      if (input.node === "refine:r1") return { text: "", structured: { outcome: "leaf", evidence: [], certifiedLeaf: { implementationScope: "Apply native approach", criterionIds: [...region.criterionIds], requirementIds: [...region.requirementIds], evidenceRefs: ["e1"], mutationResources: ["code.txt"], checks: [{ criterionId: region.criterionIds[0], commandOrObservation: "check approach" }] }, atomicityWitness: { outcome: "Apply native approach", criterionIds: [...region.criterionIds], requirementIds: [...region.requirementIds], mutationResources: ["code.txt"], whySplittingFails: "The code change and approach check are one change." } } };
      if (input.node === "challenge-leaf:r1") return { text: "", structured: { outcome: "accept-leaf", reason: "The native change and approach check share one bounded file." } };
      if (input.node === "implement:r1") return { text: "", structured: { outcome: "already-satisfied", summary: "native approach is present", changedFiles: [], checks: [{ name: "approach is applied", passed: true, evidence: "native observed" }] } };
      if (input.node === "verify:r1") return { text: "", structured: { outcome: "pass", summary: "verified", findings: [], checks: [{ name: "approach is applied", passed: true, evidence: "native observed", criterionIds: [...region.criterionIds] }], completionEvidence: { implementationOutcome: "already-satisfied", implementation: "native approach was already present", directTest: "approach check passed", correctnessReview: "reviewed approach", releaseGate: "matrix passed", changedFiles: [], focusedTests: ["approach check"], fullChecks: ["matrix"], inspectionEvidenceRefs: ["e1"] } } };
      throw new Error(`unexpected call ${input.node}`);
    } };
    const configured = solutionLodGraph({ agents, checkpointer: new MemorySaver() });
    const result = await configured.graph.invoke(configured.initial({ task: { id: "cegar", exactText: "Apply the repository approach" }, authoritativeMessages: [], directory, worktree: directory, runId: "matrix-cegar" }), { recursionLimit: 64, configurable: { thread_id: "matrix-cegar", langgraphOpenCodeRuntime: runtime, ...changeHooks(directory), langgraphSnapshotWorkspace: snapshot, langgraphReleaseVerifierWorkspace: async () => {} } });
    expect(configured.progress?.(result)?.phase, JSON.stringify({ result: configured.result?.(result), calls, failed: (result as SolutionLodState).network.activations.filter((item) => item.status === "failed").map((item) => item.error) })).toBe("completed");
    expect(challenges).toBe(3);
    expect(selections).toBe(2);
    expect(calls).toEqual(["inspect:r1", "generate-domain:r1", "challenge-domain:r1", "challenge-domain:r1", "select-candidate:r1", "challenge-domain:r1", "select-candidate:r1", "refine:r1", "challenge-leaf:r1", "implement:r1", "verify:r1"]);
  });

  it("reopens an invalidated decision premise and re-verifies the rebuilt path", async () => {
    const directory = workspace();
    const calls: string[] = [];
    let verifications = 0;
    const runtime = { call: async (input: any) => {
      calls.push(input.node);
      const network = input.state.network as SolutionNetwork;
      const region = network.regions[0]!;
      if (input.node === "inspect:r1") { const observation = observed("docs.txt establishes the required correction"); return { text: "", tools: observation.tools, structured: { outcome: "boundary", region: { acceptanceCriteria: ["correction is valid"] }, evidence: observation.evidence, criterionEvidence: [{ criterionIndex: 0, evidenceRefs: ["observed-chunk"] }], decisionBoundary: { basisRevision: network.revision, variables: [], permittedPairs: [] } } }; }
      if (input.node === "generate-domain:r1") return { text: "", structured: { outcome: "candidates", candidates: [{ key: "fixed", proposition: "Apply the prescribed correction", coordinates: [] }] } };
      if (input.node === "challenge-domain:r1") return { text: "", structured: { outcome: "accept", boundDomainFingerprint: region.boundDomainFingerprint, viableCandidateIds: region.candidateIds.filter((id) => network.candidates.find((candidate) => candidate.id === id)?.status !== "eliminated") } };
      if (input.node === "select-candidate:r1") return { text: "", structured: { outcome: "selected", boundDomainFingerprint: region.boundDomainFingerprint, selectedCandidateId: "r1:fixed", comparisons: [{ candidateId: "r1:fixed", userPreference: "neutral", repositoryCompatibility: "neutral", changeScope: "neutral", irreversibleRisk: "neutral", evidenceRefs: ["e1"] }] } };
      if (input.node === "refine:r1") return { text: "", structured: { outcome: "leaf", evidence: [], certifiedLeaf: { implementationScope: "Apply correction", criterionIds: [...region.criterionIds], requirementIds: [...region.requirementIds], evidenceRefs: ["e1"], mutationResources: ["code.txt"], checks: [{ criterionId: region.criterionIds[0], commandOrObservation: "check correction" }] }, atomicityWitness: { outcome: "Apply correction", criterionIds: [...region.criterionIds], requirementIds: [...region.requirementIds], mutationResources: ["code.txt"], whySplittingFails: "The correction and its focused check are one change." } } };
      if (input.node === "challenge-leaf:r1") return { text: "", structured: { outcome: "accept-leaf", reason: "The correction and focused check share one bounded file." } };
      if (input.node === "implement:r1") return { text: "", structured: { outcome: "already-satisfied", summary: "correction present", changedFiles: [], checks: [{ name: "correction is valid", passed: true, evidence: "correction observed" }] } };
      if (input.node === "verify:r1") {
        verifications++;
        if (verifications === 1) return { text: "", structured: { outcome: "reopen", summary: "decision premise must be reconsidered", findings: [{ regionId: "r1", criterionId: region.criterionIds[0], severity: "high", target: { kind: "files", refs: ["code.txt"] }, problem: "the selected correction depends on a disputed premise", regressionCriterion: "correction is valid", evidence: "review contradicted the premise", evidenceRefs: [], invalidatedPremiseRefs: ["e1"] }], checks: [] } };
        return { text: "", structured: { outcome: "pass", summary: "verified", findings: [], checks: [{ name: "correction is valid", passed: true, evidence: "correction observed", criterionIds: [...region.criterionIds] }], completionEvidence: { implementationOutcome: "already-satisfied", implementation: "correction was present", directTest: "correction check passed", correctnessReview: "reviewed rebuilt decision", releaseGate: "matrix passed", changedFiles: [], focusedTests: ["correction check"], fullChecks: ["matrix"], inspectionEvidenceRefs: ["e1"] } } };
      }
      throw new Error(`unexpected call ${input.node}`);
    } };
    const configured = solutionLodGraph({ agents, checkpointer: new MemorySaver() });
    const result = await configured.graph.invoke(configured.initial({ task: { id: "reopen", exactText: "Apply the correction" }, authoritativeMessages: [], directory, worktree: directory, runId: "matrix-reopen" }), { recursionLimit: 64, configurable: { thread_id: "matrix-reopen", langgraphOpenCodeRuntime: runtime, ...changeHooks(directory), langgraphSnapshotWorkspace: snapshot, langgraphReleaseVerifierWorkspace: async () => {} } });
    expect(configured.progress?.(result)?.phase, JSON.stringify({ result: configured.result?.(result), calls, failed: (result as SolutionLodState).network.activations.filter((item) => item.status === "failed").map((item) => item.error) })).toBe("completed");
    expect(verifications).toBe(2);
    expect(calls.filter((node) => node === "challenge-domain:r1")).toHaveLength(2);
    expect(calls.filter((node) => node === "select-candidate:r1")).toHaveLength(2);
  });

  it("rejects a resumed root inspection that rewrites requirements already owned by children", async () => {
    const directory = workspace();
    const configured = solutionLodGraph({ agents, maxActivations: 1, checkpointer: new MemorySaver() });
    const initial = configured.initial({ task: { id: "task-resume", exactText: "Resume the existing task" }, authoritativeMessages: [], directory, worktree: directory, runId: "matrix-root-resume" });
    const root = initial.network.regions[0]!;
    root.acceptanceCriteria = ["existing child remains owned"];
    root.criterionIds = ["criterion:scope:r1:0"];
    root.inspectionObligationIds = [];
    root.status = "superposed";
    initial.network.materialRequirements = [{ id: "requirement:existing", key: "existing", text: "existing child remains owned", scopeId: "scope:r1:child", criterionId: "criterion:scope:r1:child:0", evidenceRefs: ["task"] }];
    root.requirementIds = ["requirement:existing"];
    initial.network.regions.push({ ...structuredClone(root), id: "r2", key: "child", parentId: "r1", edge: "partOf", lod: 1, scopeId: "scope:r1:child", acceptanceCriteria: ["existing child remains owned"], criterionIds: ["criterion:scope:r1:child:0"], requirementIds: ["requirement:existing"], activationIds: [], candidateIds: [], selectedCandidateIds: [], constraintIds: [], evidenceIds: [], artifactIds: [] });
    initial.network.activations = [];
    root.activationIds = [];
    initial.network = queueActivation(initial.network, "inspect", "r1", "All inspection obligations are closed. Return the evidence-backed decision boundary; do not inspect generally.", "inspection:r1:boundary", ["r1"]);
    const inspectionId = initial.network.activations[0]!.id;
    const requirements = structuredClone(initial.network.materialRequirements);
    const runtime = { call: async () => ({ text: "", structured: {
      outcome: "boundary",
      materialRequirements: [{ key: "bad-replacement", text: "invented replacement", scopeKey: "r1", criterionIndex: 0, evidenceRefs: ["invented"] }],
      decisionBoundary: { basisRevision: 0, variables: [{ key: "solution-family", name: "solution family", ownerRegionId: "r1", seedLabels: [], evidenceRefs: ["task"] }], permittedPairs: [] },
    } }) };
    const result = await configured.graph.invoke(initial, { recursionLimit: 8, configurable: { thread_id: "matrix-root-resume", langgraphOpenCodeRuntime: runtime } });
    const final = result as SolutionLodState;
    expect(final.network.activations.find((activation) => activation.id === inspectionId)?.status).toBe("failed");
    expect(final.network.materialRequirements).toEqual(requirements);
    expect(final.network.materialRequirements?.some((requirement) => requirement.key === "bad-replacement")).toBe(false);
  });
});
