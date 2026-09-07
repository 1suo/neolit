import { describe, expect, it } from "vitest";
import { MemorySaver } from "@langchain/langgraph";
import { CandidateSelectionOutputSchema, DomainChallengeOutputSchema, DomainGenerationOutputSchema, SolutionDeltaSchema, type Activation, type SolutionLodState, type SolutionNetwork, type SynthesisOutput } from "../src/solution-lod/types.js";
import { admitDecisionBoundary, domainFingerprint, ensureRunnableWork, initialNetwork, mergeSolutionDelta, mergeSynthesisOutput, propagateNetwork, reopenRegion, selectActivationBatch, validateImplementationOutput, validateSolutionDelta, validateSynthesisOutput } from "../src/solution-lod/reducer.js";
import { compileActivationPrompt, solutionLodGraph } from "../src/solution-lod/graph.js";
import { OpenCodeRuntimeError } from "../src/runtime-error.js";

const usage = { turns: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
const state = (network: SolutionNetwork): SolutionLodState => ({ stateVersion: 10, runId: "v10", directory: "/r", worktree: "/r", phase: "", activeBatch: [], network, results: [], usage, callsUsed: 0, startedAt: 0, result: "" });
const initialInput = (task: string, runId: string) => ({ task: { id: `task-${runId}`, exactText: task }, authoritativeMessages: [], directory: "/r", worktree: "/r", runId });
const implementationWorkspace = async () => ({ worktree: "/r", baselineFingerprint: "lifecycle-baseline" });

function activation(network: SolutionNetwork, operation: Activation["operation"]): Activation {
  const region = network.regions[0]!;
  const item: Activation = { id: `a${network.nextActivationId++}`, capability: "synthesize", operation, domainFingerprint: region.domainFingerprint, boundDomainFingerprint: region.boundDomainFingerprint, regionId: region.id, request: operation!, expectedDelta: `${operation}:${region.boundDomainFingerprint}`, contextRefs: [region.id], status: "running", basisRevision: network.revision };
  network.activations.push(item);
  region.activationIds.push(item.id);
  return item;
}

function generated(): SolutionNetwork {
  let network = initialNetwork("change it");
  network.activations[0]!.status = "completed";
  network.regions[0]!.status = "superposed";
  network.regions[0]!.domainPhase = "ungenerated";
  network = admitDecisionBoundary(network, "r1", { basisRevision: network.revision, variables: [], permittedPairs: [] });
  const act = activation(network, "generate-domain");
  return mergeSynthesisOutput(state(network), act.id, {
    outcome: "candidates",
    candidates: [
      { key: "native", proposition: "Use the native repository pattern", evidenceRefs: [], coordinates: [] },
      { key: "adapter", proposition: "Add a local adapter", evidenceRefs: [], coordinates: [] },
    ],
  });
}

function acceptDomain(network: SolutionNetwork): SolutionNetwork {
  const act = activation(network, "challenge-domain");
  return mergeSynthesisOutput(state(network), act.id, { outcome: "accept", boundDomainFingerprint: network.regions[0]!.boundDomainFingerprint!, viableCandidateIds: ["r1:native", "r1:adapter"] });
}

describe("solution LOD state v8 lifecycle", () => {
  it("uses strict disjoint operation schemas and bounded generation", () => {
    expect(() => DomainGenerationOutputSchema.parse({ outcome: "candidates", evidence: [], variables: [], candidates: [{ key: "x", proposition: "x", evidenceRefs: [], stances: [] }], constraints: [], selectedCandidateId: "x" })).toThrow();
    expect(() => DomainGenerationOutputSchema.parse({ outcome: "candidates", candidates: Array.from({ length: 8 }, (_, index) => ({ key: `x${index}`, proposition: `x${index}`, coordinates: [] })) })).toThrow();
    expect(() => DomainChallengeOutputSchema.parse({ outcome: "accept", domainFingerprint: "f", viableCandidateIds: ["x"], candidate: { key: "y", proposition: "y", evidenceRefs: [], stances: [] } })).toThrow();
    expect(() => CandidateSelectionOutputSchema.parse({ outcome: "selected", domainFingerprint: "f", comparisons: [] })).toThrow();
  });

  it("requires exact challenge coverage and gates authored and singleton selection", () => {
    let network = generated();
    const region = network.regions[0]!;
    const challenge = activation(network, "challenge-domain");
    expect(() => validateSynthesisOutput(state(network), challenge, { outcome: "accept", boundDomainFingerprint: region.boundDomainFingerprint!, viableCandidateIds: ["r1:native"] })).toThrow(/every and only/);

    network.evidence.push({ id: "e1", text: "adapter is incompatible", source: "inspection", kind: "tool", status: "confirmed", fingerprint: "e1" });
    network.constraints.push({ id: "c1", kind: "refutes", subject: "e1", target: "r1:adapter", reason: "incompatible", sourceActivationId: challenge.id, sourceKind: "repo-evidence", evidenceRefs: ["e1"] });
    region.constraintIds.push("c1");
    network = propagateNetwork(network);
    expect(network.candidates.find((item) => item.id === "r1:adapter")?.status).toBe("eliminated");
    expect(network.regions[0]!.selectedCandidateIds).toEqual([]);
    expect(network.candidates.find((item) => item.id === "r1:native")?.status).toBe("possible");
  });

  it("rejects model-authored selection and never resurrects a cleared pre-accept choice", () => {
    let network = generated();
    const act = activation(network, "challenge-domain");
    const delta = SolutionDeltaSchema.parse({ region: {}, evidence: [], candidates: [{ key: "native", proposition: "Use the native repository pattern", outcome: "selected", evidenceRefs: [], stances: [] }], constraints: [], select: ["native"], activations: [] });
    expect(() => validateSolutionDelta(state(network), "r1", "synthesize", delta)).toThrow(/only by the select-candidate operation/);
    network = mergeSolutionDelta(state(network), act.id, delta);
    expect(network.candidates.find((item) => item.id === "r1:native")?.declaredStatus).toBe("possible");
    network = acceptDomain(network);
    expect(network.regions[0]!.selectedCandidateIds).toEqual([]);
    expect(network.candidates.find((item) => item.id === "r1:native")?.status).toBe("possible");
  });

  it("merges one counterexample, invalidates acceptance, and accepts only the enlarged fingerprint", () => {
    let network = generated();
    const before = network.regions[0]!.boundDomainFingerprint;
    const act = activation(network, "challenge-domain");
    network = mergeSynthesisOutput(state(network), act.id, { outcome: "counterexample", boundDomainFingerprint: before!, candidate: { key: "config", proposition: "Use configuration only", evidenceRefs: [], coordinates: [] }, reason: "material missing family", evidenceRefs: [] });
    expect(network.regions[0]!.progress.cegarRounds.count).toBe(1);
    expect(network.regions[0]!.acceptedFingerprint).toBeNull();
    expect(network.regions[0]!.domainPhase).toBe("challenging");
    expect(network.regions[0]!.boundDomainFingerprint).not.toBe(before);
    expect(network.regions[0]!.candidateIds).toHaveLength(3);
  });

  it("selects by deterministic tiers only after acceptance and keeps preferences soft", () => {
    let network = acceptDomain(generated());
    const region = network.regions[0]!;
    expect(region.acceptedFingerprint).toBe(region.boundDomainFingerprint);
    const act = activation(network, "select-candidate");
    const output: SynthesisOutput = {
      outcome: "selected", boundDomainFingerprint: region.boundDomainFingerprint!, selectedCandidateId: "r1:native",
      comparisons: [
        { candidateId: "r1:native", userPreference: "neutral", repositoryCompatibility: "neutral", changeScope: "preferred", irreversibleRisk: "neutral", evidenceRefs: [] },
        { candidateId: "r1:adapter", userPreference: "neutral", repositoryCompatibility: "neutral", changeScope: "disfavored", irreversibleRisk: "neutral", evidenceRefs: [] },
      ],
    };
    network = mergeSynthesisOutput(state(network), act.id, output);
    expect(network.regions[0]!.selectedCandidateIds).toEqual(["r1:native"]);
    expect(network.constraints).toEqual([]);
    expect(network.candidates.find((item) => item.id === "r1:adapter")?.eliminationReasons).toContain("a different non-equivalent approach was chosen");
  });

  it("invalidates only when local fingerprint input changes", () => {
    let network = acceptDomain(generated());
    const accepted = network.regions[0]!.acceptedFingerprint;
    network.evidence.push({ id: "unrelated", text: "other", source: "other", kind: "tool", status: "confirmed", fingerprint: "other" });
    network = propagateNetwork(network);
    expect(network.regions[0]!.acceptedFingerprint).toBe(accepted);
    network.candidates.find((item) => item.id === "r1:native")!.proposition = "Use a changed native pattern";
    network = propagateNetwork(network);
    expect(network.regions[0]!.acceptedFingerprint).toBeNull();
    expect(domainFingerprint(network, "r1")).toBe(network.regions[0]!.domainFingerprint);
  });

  it("blocks bounded counterexample and repeated no-progress cycles with exact reasons", () => {
    let network = generated();
    network.regions[0]!.progress.cegarRounds.count = 2;
    let act = activation(network, "challenge-domain");
    network = mergeSynthesisOutput(state(network), act.id, { outcome: "counterexample", boundDomainFingerprint: network.regions[0]!.boundDomainFingerprint!, candidate: { key: "third", proposition: "A concrete third family", evidenceRefs: [], coordinates: [] }, reason: "missing", evidenceRefs: [] });
    expect(network.regions[0]!.blockedReason).toContain("unresolved counterexample A concrete third family");
    expect(network.regions[0]!.blockedReason).toContain('"key":"third"');
    expect(network.regions[0]!.blockedReason).toContain('"reason":"missing"');

    network = acceptDomain(generated());
    const tie = () => ({ outcome: "needs-fact" as const, boundDomainFingerprint: network.regions[0]!.boundDomainFingerprint!, comparisons: [
      { candidateId: "r1:native", userPreference: "neutral" as const, repositoryCompatibility: "neutral" as const, changeScope: "neutral" as const, irreversibleRisk: "neutral" as const, evidenceRefs: [] },
      { candidateId: "r1:adapter", userPreference: "neutral" as const, repositoryCompatibility: "neutral" as const, changeScope: "neutral" as const, irreversibleRisk: "neutral" as const, evidenceRefs: [] },
    ], inspectionRequest: { request: "Which pattern is already used?", expectedDelta: "pattern", contextRefs: [], requiredCapabilities: ["repository-observe"] } });
    act = activation(network, "select-candidate");
    network = mergeSynthesisOutput(state(network), act.id, tie());
    act = activation(network, "select-candidate");
    network = mergeSynthesisOutput(state(network), act.id, tie());
    expect(network.regions[0]!.domainPhase).toBe("blocked");
    expect(network.regions[0]!.blockedReason).toContain("two semantic comparison cycles");
  });

  it("rejects counterexample ID collisions and blocks an eighth distinct candidate", () => {
    let network = generated();
    let act = activation(network, "challenge-domain");
    expect(() => validateSynthesisOutput(state(network), act, { outcome: "counterexample", boundDomainFingerprint: network.regions[0]!.boundDomainFingerprint!, candidate: { key: "native", proposition: "A distinct proposition under an occupied ID", evidenceRefs: [], coordinates: [] }, reason: "collision", evidenceRefs: [] })).toThrow(/genuinely new candidate ID/);
    for (let index = 0; index < 5; index++) {
      const id = `r1:extra-${index}`;
      network.candidates.push({ id, regionId: "r1", key: `extra-${index}`, proposition: `Extra family ${index}`, status: "possible", declaredStatus: "possible", evidenceIds: [], declaredEvidenceIds: [], eliminationReasons: [], declaredEliminationReasons: [], stances: [], createdRevision: 1, sourceActivationId: act.id });
      network.regions[0]!.candidateIds.push(id);
    }
    network = propagateNetwork(network);
    act = activation(network, "challenge-domain");
    network = mergeSynthesisOutput(state(network), act.id, { outcome: "counterexample", boundDomainFingerprint: network.regions[0]!.boundDomainFingerprint!, candidate: { key: "eighth", proposition: "An eighth concrete family", evidenceRefs: [], coordinates: [] }, reason: "still missing", evidenceRefs: [] });
    expect(network.regions[0]!.candidateIds).toHaveLength(7);
    expect(network.regions[0]!.domainPhase).toBe("blocked");
    expect(network.regions[0]!.blockedReason).toContain("candidate bound 7 reached");
  });

  it("does not reset selection no-progress for changed request wording or reopen", () => {
    let network = acceptDomain(generated());
    const comparisons = [
      { candidateId: "r1:native", userPreference: "neutral" as const, repositoryCompatibility: "neutral" as const, changeScope: "neutral" as const, irreversibleRisk: "neutral" as const, evidenceRefs: [] },
      { candidateId: "r1:adapter", userPreference: "neutral" as const, repositoryCompatibility: "neutral" as const, changeScope: "neutral" as const, irreversibleRisk: "neutral" as const, evidenceRefs: [] },
    ];
    let act = activation(network, "select-candidate");
    network = mergeSynthesisOutput(state(network), act.id, { outcome: "needs-fact", boundDomainFingerprint: network.regions[0]!.boundDomainFingerprint!, comparisons, inspectionRequest: { request: "Which pattern is used?", expectedDelta: "pattern", contextRefs: ["task", "r1"], requiredCapabilities: ["repository-observe"] } });
    act = activation(network, "select-candidate");
    network = mergeSynthesisOutput(state(network), act.id, { outcome: "needs-fact", boundDomainFingerprint: network.regions[0]!.boundDomainFingerprint!, comparisons: [...comparisons].reverse(), inspectionRequest: { request: " Which pattern is used? ", expectedDelta: "pattern", contextRefs: ["r1", "task"], requiredCapabilities: ["repository-observe"] } });
    expect(network.regions[0]!.domainPhase).toBe("blocked");

    network = reopenRegion(network, "r1", "new repair cycle");
    expect(network.regions[0]!.progress.selectionNoProgress.count).toBe(2);
  });

  it("schedules a fresh synthesis cycle after a needs-fact inspection", () => {
    let network = acceptDomain(generated());
    const region = network.regions[0]!;
    network.activations.forEach((item) => { item.status = "completed"; });
    region.domainPhase = "challenging";
    const first = ensureRunnableWork(network);
    const firstChallenge = first.network.activations.at(-1)!;
    firstChallenge.status = "completed";
    first.network.regions[0]!.progress.cegarRounds.count = 1;

    const scheduled = ensureRunnableWork(first.network);

    expect(scheduled.blocked).toBeUndefined();
    expect(scheduled.network.activations.at(-1)).toMatchObject({ status: "queued", operation: "challenge-domain" });
    expect(scheduled.network.activations.at(-1)!.idempotencyKey).not.toBe(firstChallenge.idempotencyKey);
  });

  it("accepts only cited hard elimination rules and validates needs-fact context references", () => {
    const network = acceptDomain(generated());
    network.evidence.push({ id: "e1", text: "Repository fact", source: "inspection", kind: "tool", status: "confirmed", fingerprint: "e1" });
    const act = activation(network, "select-candidate");
    const base = { outcome: "hard-constraint" as const, boundDomainFingerprint: network.regions[0]!.boundDomainFingerprint!, comparisons: [
      { candidateId: "r1:native", userPreference: "neutral" as const, repositoryCompatibility: "neutral" as const, changeScope: "neutral" as const, irreversibleRisk: "neutral" as const, evidenceRefs: [] },
      { candidateId: "r1:adapter", userPreference: "neutral" as const, repositoryCompatibility: "neutral" as const, changeScope: "neutral" as const, irreversibleRisk: "neutral" as const, evidenceRefs: [] },
    ] };
    expect(() => validateSynthesisOutput(state(network), act, { ...base, hardConstraints: [{ kind: "supports", subject: "e1", target: "r1:native", reason: "soft", evidenceRefs: ["e1"], sourceKind: "repo-evidence" }] })).toThrow(/hard elimination rule/);
    expect(() => validateSynthesisOutput(state(network), act, { ...base, hardConstraints: [{ kind: "requires", subject: "r1:native", target: "r1:adapter", reason: "uncited", evidenceRefs: [], sourceKind: "model-inference" }] })).toThrow(/cited confirmed evidence/);
    expect(() => validateSynthesisOutput(state(network), act, { outcome: "needs-fact", boundDomainFingerprint: base.boundDomainFingerprint, comparisons: base.comparisons, inspectionRequest: { request: "Inspect", expectedDelta: "fact", contextRefs: ["invented"], requiredCapabilities: ["repository-observe"] } })).toThrow(/unknown context reference/);
  });

  it("treats equivalent selected candidates as one implementation family", () => {
    let network = generated();
    network.constraints.push({ id: "c1", kind: "equivalent", subject: "r1:native", target: "r1:adapter", reason: "interchangeable", sourceActivationId: "a1", sourceKind: "model-inference", evidenceRefs: [] });
    network.regions[0]!.constraintIds.push("c1");
    network = propagateNetwork(network);
    network = acceptDomain(network);
    const act = activation(network, "select-candidate");
    network = mergeSynthesisOutput(state(network), act.id, { outcome: "selected", boundDomainFingerprint: network.regions[0]!.boundDomainFingerprint!, selectedCandidateId: "r1:native", comparisons: [
      { candidateId: "r1:native", userPreference: "neutral", repositoryCompatibility: "neutral", changeScope: "preferred", irreversibleRisk: "neutral", evidenceRefs: [] },
      { candidateId: "r1:adapter", userPreference: "neutral", repositoryCompatibility: "neutral", changeScope: "disfavored", irreversibleRisk: "neutral", evidenceRefs: [] },
    ] });
    network.regions[0]!.certifiedLeaf = { criterionIds: [], implementationScope: "Apply the interchangeable implementation", evidenceRefs: [] };
    expect(network.regions[0]!.selectedCandidateIds).toEqual(["r1:native", "r1:adapter"]);
    expect(() => validateImplementationOutput(state(network), "r1", { outcome: "completed", summary: "done", changedFiles: ["src/x.ts"], checks: [{ name: "check", passed: true, evidence: "passed" }] })).not.toThrow();
  });

  it("supersedes stale local synthesis and purges descendants on fingerprint invalidation", () => {
    let network = acceptDomain(generated());
    const queued = activation(network, "select-candidate");
    queued.status = "queued";
    network.regions.push({ id: "r9", key: "stale", parentId: "r1", parentCandidateId: "r1:native", edge: "partOf", lod: 1, objective: "stale child", delivery: "change", allowedVariables: [], acceptanceCriteria: ["done"], coveredCriteria: [0], status: "unformed", progress: structuredClone(network.regions[0]!.progress), candidateIds: [], selectedCandidateIds: [], constraintIds: [], evidenceIds: [], activationIds: [], artifactIds: [], scopeId: "scope:r9", criterionIds: ["criterion:r9:0"], domainPhase: "inspecting", domainFingerprint: null, acceptedFingerprint: null, challengeVerdict: null });
    network.candidates.find((item) => item.id === "r1:native")!.proposition = "Use changed native code";
    network = propagateNetwork(network);
    expect(network.regions.some((item) => item.id === "r9")).toBe(false);
    expect(network.regions[0]!.acceptedFingerprint).toBeNull();
    expect(network.activations.find((item) => item.id === queued.id)?.status).toBe("superseded");
    expect(selectActivationBatch(network, 1)).toEqual([]);
  });

  it("frames independent root tasks as exclusively owned typed AND scopes", () => {
    const network = initialNetwork("change A and answer B");
    network.activations[0]!.status = "running";
    const delta = SolutionDeltaSchema.parse({ region: {}, evidence: [], candidates: [], constraints: [], select: [], activations: [], taskScopes: [
      { key: "change-a", objective: "Change A", delivery: "change", allowedVariables: ["implementation"], acceptanceCriteria: ["A passes"] },
      { key: "answer-b", objective: "Answer B", delivery: "answer", allowedVariables: [], acceptanceCriteria: ["B is sourced"] },
    ] });
    validateSolutionDelta(state(network), "r1", "inspect", delta);
    const merged = mergeSolutionDelta(state(network), "a1", delta);
    const children = merged.regions.filter((item) => item.parentId === "r1");
    expect(children.map((item) => item.edge)).toEqual(["partOf", "partOf"]);
    expect(new Set(children.map((item) => item.scopeId)).size).toBe(2);
    expect(children.map((item) => item.coveredCriteria)).toEqual([[0], [1]]);
    expect(children.every((item) => item.domainPhase === "inspecting" && item.candidateIds.length === 0)).toBe(true);
  });

  it("runs inspect through all three synthesis operations, certified implementation, and verification", async () => {
    const calls: string[] = [];
    const location = { canonicalPath: "src/feature.ts", range: [1, 1] as [number, number], fileDigest: "feature", snapshotEpoch: 0 };
    const chunkId = "feature-chunk";
    const tools = [{ tool: "graph_read", status: "completed" as const, metadata: { repositoryDescriptor: { chunkId, ...location } } }];
    const runtime = { call: async (input: any) => {
      calls.push(input.node);
      const network = input.state.network as SolutionNetwork;
      const region = network.regions[0]!;
      if (input.node === "inspect:r1") return { text: "", tools, structured: { outcome: "boundary", region: { acceptanceCriteria: ["criterion done"] }, evidence: [{ text: "criterion is already satisfied", source: "src/feature.ts:1", kind: "repository", chunkId }], criterionEvidence: [{ criterionIndex: 0, evidenceRefs: [chunkId] }], decisionBoundary: { basisRevision: 0, variables: [], permittedPairs: [] } } };
      if (input.node === "generate-domain:r1") return { text: "", structured: { outcome: "candidates", candidates: [
        { key: "native", proposition: "Use native code", evidenceRefs: [], coordinates: [] },
        { key: "adapter", proposition: "Add an adapter", evidenceRefs: [], coordinates: [] },
      ] } };
      if (input.node === "challenge-domain:r1") return { text: "", structured: { outcome: "accept", boundDomainFingerprint: region.boundDomainFingerprint, viableCandidateIds: [...region.candidateIds] } };
      if (input.node === "select-candidate:r1") return { text: "", structured: { outcome: "selected", boundDomainFingerprint: region.boundDomainFingerprint, selectedCandidateId: "r1:native", comparisons: [
        { candidateId: "r1:native", userPreference: "neutral", repositoryCompatibility: "neutral", changeScope: "preferred", irreversibleRisk: "neutral", evidenceRefs: [] },
        { candidateId: "r1:adapter", userPreference: "neutral", repositoryCompatibility: "neutral", changeScope: "disfavored", irreversibleRisk: "neutral", evidenceRefs: [] },
      ] } };
      if (input.node === "refine:r1") return { text: "", structured: { outcome: "leaf", evidence: [], certifiedLeaf: { implementationScope: "one bounded source edit", criterionIds: ["criterion:scope:r1:0"], requirementIds: ["requirement:root-criterion-0"], evidenceRefs: [], mutationResources: ["src/feature.ts"], checks: [{ criterionId: "criterion:scope:r1:0", commandOrObservation: "run focused test" }] }, atomicityWitness: { outcome: "one bounded source edit", criterionIds: ["criterion:scope:r1:0"], requirementIds: ["requirement:root-criterion-0"], mutationResources: ["src/feature.ts"], whySplittingFails: "The feature edit and focused check are one change." } } };
      if (input.node === "challenge-leaf:r1") return { text: "", structured: { outcome: "accept-leaf", reason: "The source edit and focused check share one bounded file." } };
      if (input.node === "implement:r1") return { text: "", structured: { outcome: "already-satisfied", summary: "already satisfied", changedFiles: [], checks: [{ name: "focused", passed: true, evidence: "criterion done" }] } };
      if (input.node === "verify:r1") return { text: "", structured: { outcome: "pass", summary: "verified", findings: [], checks: [{ name: "criterion done", passed: true, evidence: "criterion done observed" }], completionEvidence: { implementation: "already satisfied after inspection", implementationOutcome: "already-satisfied", inspectionEvidenceRefs: [...region.evidenceIds], directTest: "focused check passed", correctnessReview: "reviewed criterion", releaseGate: "full checks passed", changedFiles: [], focusedTests: ["focused"], fullChecks: ["full"] } } };
      throw new Error(`unexpected call ${input.node}`);
    } };
    const configured = solutionLodGraph({ agents: { inspect: "inspect", synthesize: "synthesize", refine: "refine", implement: "implement", verify: "verify", present: "present" }, checkpointer: new MemorySaver() });
    const result = await configured.graph.invoke(configured.initial(initialInput("change it", "v9-e2e")), { recursionLimit: 64, configurable: { thread_id: "v9-e2e", langgraphOpenCodeRuntime: runtime, langgraphPrepareImplementationWorkspace: implementationWorkspace, langgraphPrepareVerifierWorkspace: async () => "/r", langgraphReleaseVerifierWorkspace: async () => {} } });
    expect(calls).toEqual(["inspect:r1", "generate-domain:r1", "challenge-domain:r1", "select-candidate:r1", "refine:r1", "challenge-leaf:r1", "implement:r1", "verify:r1"]);
    expect(configured.progress?.(result as SolutionLodState)?.phase).toBe("completed");
    expect(configured.result?.(result as SolutionLodState)).toContain("Verified 1 solution region.");
  });

  it("stores canonically equivalent inspection evidence once and keeps descendant activation sparse", async () => {
    const configLocation = { canonicalPath: "src/config.ts", range: [4, 4] as [number, number], fileDigest: "config", snapshotEpoch: 0 };
    const themeLocation = { canonicalPath: "src/theme.ts", range: [9, 9] as [number, number], fileDigest: "theme", snapshotEpoch: 0 };
    const findingA = { kind: "repository" as const, text: "Native transport is already configured", source: "src/config.ts:4", chunkId: "config-chunk" };
    const findingB = { kind: "repository" as const, text: "Unrelated color theme constant exists", source: "src/theme.ts:9", chunkId: "theme-chunk" };
    const variantA = { kind: "repository" as const, text: " native TRANSPORT is ALREADY configured!! ", source: "SRC/config.ts:4", chunkId: "config-chunk" };
    const variantB = { kind: "repository" as const, text: "unrelated COLOR theme  constant... exists?", source: "src/theme.ts:9 ", chunkId: "theme-chunk" };
    const repositoryTools = (locations: Array<typeof configLocation>) => locations.map((location) => ({ tool: "graph_read", status: "completed" as const, metadata: { repositoryDescriptor: { chunkId: location.fileDigest === "config" ? "config-chunk" : location.fileDigest === "theme" ? "theme-chunk" : `${location.fileDigest}-chunk`, ...location } } }));
    const calls: string[] = [];
    const inspectPrompts = new Map<string, { prompt: string; evidenceIds: string[] }>();
    const nodeCalls = new Map<string, number>();
    const runtime = { call: async (input: any) => {
      calls.push(input.node);
      nodeCalls.set(input.node, (nodeCalls.get(input.node) ?? 0) + 1);
      const network = input.state.network as SolutionNetwork;
      const region = network.regions.find((item) => input.node.endsWith(`:${item.id}`))!;
      if (nodeCalls.get(input.node) === 1 && input.prompt) inspectPrompts.set(input.node, { prompt: String(input.prompt), evidenceIds: [...region.evidenceIds] });
      if (input.node === "inspect:r1" && nodeCalls.get(input.node) === 1) return { text: "", tools: repositoryTools([configLocation, themeLocation]), structured: { outcome: "boundary", region: { acceptanceCriteria: ["criterion done"] }, evidence: [findingA, findingB], criterionEvidence: [{ criterionIndex: 0, evidenceRefs: ["config-chunk"] }], materialRequirements: [{ key: "criterion-done", text: "criterion done", scopeKey: "r1", criterionIndex: 0, evidenceRefs: ["config-chunk"] }, { key: "descendant-scope", text: "exercise descendant context projection", scopeKey: "r1", criterionIndex: 0, evidenceRefs: ["config-chunk"] }], decisionBoundary: { basisRevision: network.revision, variables: [], permittedPairs: [] } } };
      if (input.node === "inspect:r1") return { text: "", tools: repositoryTools([configLocation, themeLocation]), structured: { outcome: "facts", region: { acceptanceCriteria: ["criterion done", "restatement collapsed"] }, evidence: [variantA, variantB], criterionEvidence: [{ criterionIndex: 0, evidenceRefs: ["config-chunk"] }, { criterionIndex: 1, evidenceRefs: ["theme-chunk"] }] } };
      if (input.node.startsWith("inspect:")) {
        const childLocation = { canonicalPath: `src/${region.id}.ts`, range: [1, 1] as [number, number], fileDigest: region.id, snapshotEpoch: 0 };
        return { text: "", tools: repositoryTools([childLocation]), structured: { outcome: "boundary", region: {}, evidence: [{ kind: "repository" as const, text: `Descendant fact for ${region.id}`, source: `src/${region.id}.ts:1`, chunkId: `${region.id}-chunk` }], criterionEvidence: region.criterionIds.map((_, criterionIndex) => ({ criterionIndex, evidenceRefs: [`${region.id}-chunk`] })), decisionBoundary: { basisRevision: network.revision, variables: [], permittedPairs: [] } } };
      }
      if (input.node === `challenge-domain:${region.id}` && nodeCalls.get(input.node) === 1 && region.id === "r1") return { text: "", structured: { outcome: "needs-fact", boundDomainFingerprint: region.boundDomainFingerprint, request: "Restate the confirmed findings to exercise canonical storage.", expectedDelta: "restatement:r1", contextRefs: [region.criterionIds[0]], requiredCapabilities: ["repository-observe"] } };
      if (input.node.startsWith("challenge-domain:")) return { text: "", structured: { outcome: "accept", boundDomainFingerprint: region.boundDomainFingerprint, viableCandidateIds: [...region.candidateIds] } };
      if (input.node.startsWith("generate-domain:")) return { text: "", structured: { outcome: "candidates", candidates: [
        { key: "native", proposition: `Use native code in ${region.id}`, evidenceRefs: [], coordinates: [] },
      ] } };
      if (input.node.startsWith("select-candidate:")) return { text: "", structured: { outcome: "selected", boundDomainFingerprint: region.boundDomainFingerprint, selectedCandidateId: `${region.id}:native`, comparisons: [...region.candidateIds].sort().map((candidateId) => ({ candidateId, userPreference: "neutral", repositoryCompatibility: "neutral", changeScope: candidateId.endsWith("native") ? "preferred" : "disfavored", irreversibleRisk: "neutral", evidenceRefs: [] })) } };
      if (input.node === "refine:r1") return { text: "", structured: { outcome: "children", evidence: [], children: [
        { key: "criterion", objective: "Implement the selected criterion behavior", edge: "partOf", allowedVariables: [], acceptanceCriteria: ["child done"], coveredCriteria: [0], requirementIds: ["requirement:criterion-done"], mutationResources: ["src/feature-a.ts"] },
        { key: "context", objective: "Implement the descendant context behavior", edge: "partOf", allowedVariables: [], acceptanceCriteria: ["child second"], coveredCriteria: [1], requirementIds: ["requirement:descendant-scope"], mutationResources: ["src/feature-b.ts"] },
      ] } };
      if (input.node.startsWith("refine:")) return { text: "", structured: { outcome: "leaf", evidence: [], certifiedLeaf: { implementationScope: "one bounded source edit", criterionIds: [...region.criterionIds], requirementIds: [...(region.requirementIds ?? [])], evidenceRefs: [], mutationResources: [...(region.mutationResources ?? [])], checks: region.criterionIds.map((criterionId) => ({ criterionId, commandOrObservation: "run focused test" })) }, atomicityWitness: { outcome: "one bounded source edit", criterionIds: [...region.criterionIds], requirementIds: [...(region.requirementIds ?? [])], mutationResources: [...(region.mutationResources ?? [])], whySplittingFails: "The bounded edit and focused checks are one change." } } };
      if (input.node.startsWith("challenge-leaf:")) return { text: "", structured: { outcome: "accept-leaf", reason: "Each certified source edit and its checks are one bounded change." } };
      if (input.node.startsWith("implement:")) return { text: "", structured: { outcome: "already-satisfied", summary: "done", changedFiles: [], checks: region.acceptanceCriteria.map((criterion) => ({ name: criterion, passed: true, evidence: `${criterion} observed` })) } };
      if (input.node.startsWith("verify:")) return { text: "", structured: { outcome: "pass", summary: "verified", findings: [], checks: region.acceptanceCriteria.map((criterion) => ({ name: criterion, passed: true, evidence: `${criterion} observed` })), completionEvidence: { implementation: "already satisfied by confirmed inspection evidence", implementationOutcome: "already-satisfied", directTest: "focused tests ran", correctnessReview: "reviewed", releaseGate: "gates passed", changedFiles: [], focusedTests: ["focused"], fullChecks: ["full"], inspectionEvidenceRefs: [...region.evidenceIds] } } };
      throw new Error(`unexpected call ${input.node}`);
    } };
    const configured = solutionLodGraph({ agents: { inspect: "inspect", synthesize: "synthesize", refine: "refine", implement: "implement", verify: "verify", present: "present" }, checkpointer: new MemorySaver() });
    const result = await configured.graph.invoke(configured.initial(initialInput("change it", "v9-dedup-e2e")), { recursionLimit: 128, configurable: { thread_id: "v9-dedup-e2e", langgraphOpenCodeRuntime: runtime, langgraphPrepareImplementationWorkspace: implementationWorkspace, langgraphPrepareVerifierWorkspace: async () => "/r", langgraphReleaseVerifierWorkspace: async () => {} } });
    const final = result as SolutionLodState;
    expect(configured.progress?.(final)?.phase, JSON.stringify({ blocked: final.network.regions.filter((r) => r.blockedReason).map((r) => [r.id, r.blockedReason]), failed: final.network.activations.filter((a) => a.status === "failed").slice(-2).map((a) => [a.id, a.capability, String(a.error).slice(0, 300)]) })).toBe("completed");
    expect(nodeCalls.get("inspect:r1")).toBe(2);

    expect(final.network.evidence).toHaveLength(4);
    const storedA = final.network.evidence.find((item) => item.text === "Native transport is already configured")!;
    const storedB = final.network.evidence.find((item) => item.text === "Unrelated color theme constant exists")!;
    expect(storedA).toBeDefined();
    expect(storedB).toBeDefined();

    const rootRegion = final.network.regions.find((item) => item.id === "r1")!;
    const childRegion = final.network.regions.find((item) => item.id === "r2")!;
    for (const region of [rootRegion, childRegion]) {
      expect(new Set(region.evidenceIds).size).toBe(region.evidenceIds.length);
    }
    expect(rootRegion.evidenceIds.filter((id) => id === storedA.id)).toHaveLength(1);

    const childInspect = inspectPrompts.get("inspect:r2");
    expect(childInspect).toBeDefined();
    expect(childInspect!.evidenceIds).toEqual([]);
    expect(childInspect!.prompt).toContain(findingA.text);
    expect(childInspect!.prompt).not.toContain(findingB.text);
    expect(childInspect!.prompt).toContain(findingA.source);

    const base = { id: "ax", capability: "inspect" as const, regionId: childRegion.id, request: "q", expectedDelta: "x", contextRefs: [childRegion.id], status: "running" as const, basisRevision: 0 };
    const sparsePrompt = compileActivationPrompt({ ...final, network: final.network }, { ...base });
    expect(sparsePrompt).not.toContain(findingA.text);
    const explicitPrompt = compileActivationPrompt({ ...final, network: final.network }, { ...base, contextRefs: [childRegion.id, storedA.id] });
    expect(explicitPrompt).toContain(findingA.text);
  });

  it("preserves structured runtime failure diagnostics in activation task records", async () => {
    const connector = solutionLodGraph({ agents: { inspect: "i", synthesize: "s", refine: "r", implement: "m", verify: "v", present: "p" }, checkpointer: new MemorySaver() });
    const contextTelemetry = { repositoryReadChars: 20, otherToolOutputChars: 0, duplicateReadCharsAvoided: 4, accumulatedSessionInput: 30, cacheReadInput: 8, structuredRepairAttempts: 1 };
    const runtime = { call: async () => { throw new OpenCodeRuntimeError("transport", "connection lost", { sessionId: "session-1", usage: { ...usage, turns: 1, input: 4 }, tools: [{ tool: "read", status: "completed" }], contextTelemetry, progressText: "read src/x.ts", retryable: true }); } };
    let failure: SolutionLodState["results"][number] | undefined;
    for await (const value of await connector.graph.stream(connector.initial(initialInput("change it", "diagnostics")), { configurable: { thread_id: "diagnostics", langgraphOpenCodeRuntime: runtime }, streamMode: "values", recursionLimit: 40 })) {
      const current = value as SolutionLodState;
      if (current.results?.length) failure = current.results[0];
    }
    expect(failure).toMatchObject({ failureKind: "transport", sessionId: "session-1", retryable: true, progressText: "read src/x.ts", usage: { turns: 1, input: 4 }, tools: [{ tool: "read", status: "completed" }], contextTelemetry });
  });

  it("preserves successful tool and context telemetry in activation records", async () => {
    const connector = solutionLodGraph({ agents: { inspect: "i", synthesize: "s", refine: "r", implement: "m", verify: "v", present: "p" }, maxActivations: 1, checkpointer: new MemorySaver() });
    const contextTelemetry = { repositoryReadChars: 12, otherToolOutputChars: 3, duplicateReadCharsAvoided: 2, accumulatedSessionInput: 18, cacheReadInput: 5, structuredRepairAttempts: 0 };
    const runtime = { call: async () => ({ text: "", structured: { outcome: "boundary", region: { acceptanceCriteria: ["known"] }, evidence: [], criterionEvidence: [{ criterionIndex: 0, evidenceRefs: ["task"] }], decisionBoundary: { basisRevision: 0, variables: [], permittedPairs: [] } }, tools: [{ tool: "read", status: "completed" as const, output: "known" }], contextTelemetry }) };
    let success: SolutionLodState["results"][number] | undefined;
    for await (const value of await connector.graph.stream(connector.initial(initialInput("change it", "success-diagnostics")), { configurable: { thread_id: "success-diagnostics", langgraphOpenCodeRuntime: runtime }, streamMode: "values", recursionLimit: 10 })) {
      const current = value as SolutionLodState;
      if (current.results?.length) success = current.results[0];
    }
    expect(success).toMatchObject({ outcome: "applied", tools: [{ tool: "read", status: "completed", output: "known" }], contextTelemetry });
  });

  it("rejects a v8 checkpoint with a precise start-fresh result", async () => {
    const connector = solutionLodGraph({ agents: { inspect: "i", synthesize: "s", refine: "r", implement: "m", verify: "v", present: "p" }, checkpointer: new MemorySaver() });
    const legacy = { ...connector.initial(initialInput("change it", "legacy-v8")), stateVersion: 8 };
    const result = await connector.graph.invoke(legacy, { configurable: { thread_id: "legacy-v8" }, recursionLimit: 3 });
    expect(result).toMatchObject({ phase: "incompatible-checkpoint", result: "Solution LOD checkpoint stateVersion 8 is incompatible with stateVersion 11; start a fresh run." });
    expect(connector.progress!(result as SolutionLodState).nodes).toHaveLength(1);
  });
});
