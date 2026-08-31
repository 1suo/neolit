import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SOLUTION_ROLE_CONTRACTS, SOLUTION_ROLE_GRAPH, SYNTHESIS_OPERATION_CONTRACTS, renderSolutionRoleMermaid, validateSolutionRoleContracts } from "../src/solution-lod/roles.js";
import { CandidateSelectionOutputSchema, DomainChallengeOutputSchema, DomainGenerationOutputSchema, ImplementationOutputSchema, InspectionOutputSchema, PresentationOutputSchema, RefinementOutputSchema, VerificationOutputSchema } from "../src/solution-lod/types.js";
import { activationAdmitted, ensureRunnableWork, initialNetwork, mergeRefinementOutput, mergeSolutionDelta, queueActivation, resetPrunedRegion, validateSolutionDelta } from "../src/solution-lod/reducer.js";

describe("solution role relationship graph", () => {
  it("validates schemas, outcomes, targets, actions, tools, prompts, and bounds from the contracts", () => {
    expect(validateSolutionRoleContracts()).toEqual([]);
    expect(SYNTHESIS_OPERATION_CONTRACTS["generate-domain"]).toMatchObject({ owner: "synthesize", outcomes: ["candidates"] });
    expect(SOLUTION_ROLE_CONTRACTS.verify.actions).toMatchObject({ consumesEvidence: true, executesChecks: true, mutatesWorkspace: false });

    const badRoles = { ...SOLUTION_ROLE_CONTRACTS, verify: { ...SOLUTION_ROLE_CONTRACTS.verify, maxSteps: 0, tools: { ...SOLUTION_ROLE_CONTRACTS.verify.tools, edit: true } } };
    expect(validateSolutionRoleContracts(badRoles)).toEqual(expect.arrayContaining([expect.stringContaining("maxSteps"), expect.stringContaining("tool edit")]));
    const badGraph = [...SOLUTION_ROLE_GRAPH, { from: "verify", outcome: "invented", to: ["pseudo-role"] }] as never;
    expect(validateSolutionRoleContracts(SOLUTION_ROLE_CONTRACTS, SYNTHESIS_OPERATION_CONTRACTS, badGraph)).toEqual(expect.arrayContaining([expect.stringContaining("undeclared outcome"), expect.stringContaining("no executable contract")]));
  });

  it("renders the committed Mermaid block byte-for-byte", () => {
    const start = "<!-- BEGIN GENERATED SOLUTION ROLE GRAPH -->";
    const end = "<!-- END GENERATED SOLUTION ROLE GRAPH -->";
    const document = readFileSync(new URL("../src/solution-lod/README.md", import.meta.url), "utf8");
    expect(document.match(new RegExp(`${start}[\\s\\S]*?${end}`))?.[0]).toBe(`${start}\n\`\`\`mermaid\n${renderSolutionRoleMermaid()}\n\`\`\`\n${end}`);
    expect(renderSolutionRoleMermaid().match(/-->/g)).toHaveLength(SOLUTION_ROLE_GRAPH.reduce((count, edge) => count + edge.to.length, 0));
  });

  it("uses outcome as the sole strict role discriminator", () => {
    const comparison = { candidateId: "r1:a", userPreference: "neutral", repositoryCompatibility: "neutral", changeScope: "neutral", irreversibleRisk: "neutral", evidenceRefs: [] };
    expect(InspectionOutputSchema.safeParse({ outcome: "facts", evidence: [], result: { type: "facts" } }).success).toBe(false);
    expect(DomainGenerationOutputSchema.safeParse({ outcome: "candidates", candidates: [{ key: "a", proposition: "A", coordinates: [] }], operation: "generate-domain" }).success).toBe(false);
    expect(DomainChallengeOutputSchema.safeParse({ outcome: "accept", boundDomainFingerprint: "f", viableCandidateIds: ["r1:a"], verdict: "accept" }).success).toBe(false);
    expect(CandidateSelectionOutputSchema.safeParse({ outcome: "selected", boundDomainFingerprint: "f", selectedCandidateId: "r1:a", comparisons: [comparison], basis: "only-viable" }).success).toBe(false);
    expect(RefinementOutputSchema.safeParse({ outcome: "children", evidence: [], children: [], certifiedLeaf: {} }).success).toBe(false);
    expect(ImplementationOutputSchema.safeParse({ outcome: "completed", checks: [], status: "completed" }).success).toBe(false);
    expect(VerificationOutputSchema.safeParse({ outcome: "pass", findings: [], checks: [], verdict: "pass" }).success).toBe(false);
    expect(PresentationOutputSchema.safeParse({ outcome: "answer", answer: "ok", extra: true }).success).toBe(false);
  });

  it("disables graph lifecycle tools inside every worker role", () => {
    for (const contract of Object.values(SOLUTION_ROLE_CONTRACTS)) {
      for (const tool of ["langgraph_start", "langgraph_inspect", "langgraph_prune", "langgraph_resume", "langgraph_cancel", "langgraph_pause"]) expect(contract.tools[tool]).toBe(false);
    }
  });

  it("makes refinement outcomes exclusive and permits only one inspection request", () => {
    const request = { request: "Read the config", expectedDelta: "config-value", contextRefs: [], requiredCapabilities: ["repository-observe"] as const };
    expect(RefinementOutputSchema.safeParse({ outcome: "need-fact", evidence: [], inspection: request }).success).toBe(true);
    expect(RefinementOutputSchema.safeParse({ outcome: "leaf", evidence: [], certifiedLeaf: { implementationScope: "edit x", criterionIds: ["c"], mutationResources: ["x"], checks: [{ criterionId: "c", commandOrObservation: "test" }] }, atomicityWitness: { outcome: "edit x", criterionIds: ["c"], requirementIds: [], mutationResources: ["x"], whySplittingFails: "The edit and test are one change." }, inspection: request }).success).toBe(false);
    expect(RefinementOutputSchema.safeParse({ outcome: "need-fact", evidence: [], inspection: { ...request, capability: "implement" } }).success).toBe(false);
  });

  it("routes a refinement inspection request instead of silently discarding it", () => {
    let network = initialNetwork("change it");
    network.activations = [];
    network.regions[0]!.activationIds = [];
    network.regions[0]!.status = "unrefined";
    network.regions[0]!.domainPhase = "selected";
    network = queueActivation(network, "refine", "r1", "refine", "refinement:r1", ["r1"]);
    network.activations[0]!.status = "running";
    network = mergeRefinementOutput(network, network.activations[0]!.id, { outcome: "need-fact", evidence: [], inspection: { request: "Read the config", expectedDelta: "config-value", contextRefs: ["r1"], requiredCapabilities: ["repository-observe"] } });
    const inspection = network.activations.find((item) => item.capability === "inspect")!;
    expect(inspection).toMatchObject({ status: "queued", senderActivationId: "a2" });
    expect(activationAdmitted(network, inspection)).toBe(true);
  });

  it("rejects a request before scheduling when its role lacks the declared capability", () => {
    let network = initialNetwork("change it");
    network.activations = [];
    network.regions[0]!.activationIds = [];
    network.regions[0]!.status = "unrefined";
    network.regions[0]!.domainPhase = "selected";
    network = queueActivation(network, "refine", "r1", "refine", "refinement:r1", ["r1"]);
    network.activations[0]!.status = "running";
    expect(() => mergeRefinementOutput(network, network.activations[0]!.id, { outcome: "need-fact", evidence: [], inspection: { request: "Edit the repository", expectedDelta: "mutation", contextRefs: ["r1"], requiredCapabilities: ["workspace-mutate"] } })).toThrow(/inspect cannot satisfy required capabilities: workspace-mutate/);
  });

  it("keeps implementation and verification escalation controller-owned", () => {
    const activation = { capability: "inspect", request: "inspect", expectedDelta: "fact", contextRefs: [] };
    expect(ImplementationOutputSchema.safeParse({ outcome: "blocked", blocker: "missing fact", activations: [activation] }).success).toBe(false);
    expect(VerificationOutputSchema.safeParse({ outcome: "fail", findings: [], activations: [activation] }).success).toBe(false);
  });

  it("returns a boundaryless pruned region to inspection instead of generating an invalid domain", () => {
    let network = initialNetwork("change it");
    const region = network.regions[0]!;
    region.acceptanceCriteria = ["works"];
    region.criterionIds = ["criterion:scope:r1:0"];
    region.inspectionObligationIds = [];
    region.progress.selectionNoProgress = { count: 2, fingerprint: "stale", unresolvedCriterionIds: [...region.criterionIds] };
    region.convergenceCycles = [{ kind: "reopen", inputFingerprint: "stale", outputFingerprint: "stale", unresolvedCriterionIds: [...region.criterionIds], revision: 1 }];
    region.contradiction = "stale blocker";
    region.status = "superposed";
    network.activations = [];
    region.activationIds = [];
    network = queueActivation(network, "inspect", "r1", "resolve criterion", "inspection:r1:criterion:scope:r1:0", ["criterion:scope:r1:0"]);
    network.activations[0]!.status = "completed";
    const logicalActivationId = network.activations[0]!.logicalActivationId;
    network.schemaRetries[logicalActivationId] = { logicalActivationId, contextFingerprint: logicalActivationId, attempts: 3, retries: 2, repairs: 2, reservedAttempts: 0, trace: [] };
    network = resetPrunedRegion(network, region.id);
    expect(network.regions[0]).toMatchObject({ domainPhase: "inspecting", decisionBoundary: undefined, inspectionObligationIds: ["criterion:scope:r1:0"], progress: { selectionNoProgress: { count: 0 } }, convergenceCycles: [], contradiction: undefined });
    expect(network.activations[0]).toMatchObject({ status: "completed", historical: true });
    expect(network.schemaRetries[logicalActivationId]).toBeUndefined();
    const scheduled = ensureRunnableWork(network).network;
    expect(scheduled.activations.at(-1)).toMatchObject({ capability: "inspect", regionId: "r1" });
    expect(scheduled.activations.some((item) => item.operation === "generate-domain")).toBe(false);
  });

  it("blocks changing expectedDelta from extending a factless inspection chain", () => {
    let network = initialNetwork("inspect");
    network.regions[0]!.status = "superposed";
    network.activations[0]!.status = "running";
    network = mergeSolutionDelta({ network } as never, "a1", { region: {}, evidence: [], factIds: [], validations: [], variables: [], candidates: [], constraints: [], select: [], activations: [{ capability: "inspect", request: "first", expectedDelta: "first", contextRefs: [], requiredCapabilities: ["repository-observe"] }] });
    const followup = network.activations.find((item) => item.status === "queued")!;
    followup.status = "running";
    network = mergeSolutionDelta({ network } as never, followup.id, { region: {}, evidence: [], factIds: [], validations: [], variables: [], candidates: [], constraints: [], select: [], activations: [{ capability: "inspect", request: "different wording", expectedDelta: "different-value", contextRefs: [], requiredCapabilities: ["repository-observe"] }] });
    expect(network.regions[0]).toMatchObject({ status: "blocked", progress: { inspectionNoProgress: { count: 2 } } });
    expect(network.activations.filter((item) => item.status === "queued")).toHaveLength(0);
  });

  it("closes finite inspection obligations before requiring a boundary", () => {
    let network = initialNetwork("inspect");
    const region = network.regions[0]!;
    region.status = "superposed";
    region.acceptanceCriteria = ["one", "two"];
    region.criterionIds = ["criterion:scope:r1:0", "criterion:scope:r1:1"];
    region.inspectionObligationIds = [...region.criterionIds];
    network.activations[0]!.status = "running";
    network = mergeSolutionDelta({ network } as never, "a1", { region: {}, evidence: [], factIds: [], validations: [], criterionEvidence: [{ criterionIndex: 0, evidenceRefs: ["task"] }], variables: [], candidates: [], constraints: [], select: [], activations: [] });
    expect(network.regions[0]!.inspectionObligationIds).toEqual(["criterion:scope:r1:1"]);
    expect(() => validateSolutionDelta({ network } as never, "r1", "inspect", { region: {}, evidence: [], factIds: [], validations: [], criterionEvidence: [], variables: [], candidates: [], constraints: [], select: [], activations: [] })).toThrow(/must close at least one unresolved criterion/);
    network.activations[0]!.status = "completed";
    network.regions[0]!.inspectionObligationIds = [];
    const scheduled = ensureRunnableWork(network).network.activations.at(-1)!;
    expect(scheduled.request).toContain("All inspection obligations are closed");
  });

  it("schedules every open criterion in one inspection activation", () => {
    const network = initialNetwork("inspect");
    const region = network.regions[0]!;
    network.activations = [];
    region.activationIds = [];
    region.status = "superposed";
    region.acceptanceCriteria = ["one", "two", "three"];
    region.criterionIds = region.acceptanceCriteria.map((_, index) => `criterion:scope:r1:${index}` as const);
    region.inspectionObligationIds = [...region.criterionIds];
    const scheduled = ensureRunnableWork(network).network.activations.at(-1)!;
    expect(scheduled.request).toContain("Breadth pass: inspect the minimum dependency closure for every listed criterion");
    expect(scheduled.contextRefs).toEqual(expect.arrayContaining(region.criterionIds));
    expect(scheduled.expectedDelta).toContain(region.criterionIds.join(","));
  });
});
