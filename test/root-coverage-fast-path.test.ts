import { describe, expect, it } from "vitest";
import { EstablishedChangeInspectionOutputSchema, SolutionDeltaSchema, type Activation, type SolutionLodState, type SolutionNetwork } from "../src/solution-lod/types.js";
import { applyBatchRecords, completeImplementation, completeVerification, domainFingerprint, enumerationFingerprint, ensureRunnableWork, initialNetwork, mergeSolutionDelta, selectActivationBatch, validateImplementationOutput, validateRefinementOutput, validateSolutionDelta, validateVerificationOutput } from "../src/solution-lod/reducer.js";
import { finalResult } from "../src/solution-lod/graph.js";

const usage = { turns: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
const state = (network: SolutionNetwork, originalTask = "fix it"): SolutionLodState => { network.authority.task.exactText = originalTask; return { stateVersion: 10, runId: "coverage", directory: "/r", worktree: "/r", phase: "", activeBatch: [], network, results: [], usage, callsUsed: 0, startedAt: 0, result: "" }; };
const certify = (network: SolutionNetwork, regionId: string): SolutionNetwork => {
  const region = network.regions.find((item) => item.id === regionId)!;
  const candidateId = `${regionId}:certified`;
  if (!network.candidates.some((item) => item.id === candidateId)) network.candidates.push({ id: candidateId, regionId, key: "certified", proposition: "certified", status: "selected", declaredStatus: "selected", evidenceIds: [], eliminationReasons: [], stances: [] });
  region.candidateIds = [candidateId]; region.selectedCandidateIds = [candidateId]; region.status = "implemented"; region.domainPhase = "selected";
  region.enumerationFingerprint = enumerationFingerprint(network, regionId); region.boundDomainFingerprint = domainFingerprint(network, regionId); region.domainFingerprint = region.boundDomainFingerprint; region.acceptedFingerprint = region.boundDomainFingerprint;
  const activationId = `a-cert-${regionId}`;
  network.activations.push({ id: activationId, capability: "verify", regionId, request: "verify", expectedDelta: "verify", contextRefs: [regionId], status: "running", basisRevision: network.revision });
  return completeVerification(network, activationId, { outcome: "pass", summary: "verified", findings: [], checks: [{ name: region.acceptanceCriteria.join(" ") || "verified", passed: true, evidence: region.acceptanceCriteria.join(" ") || "verified" }] });
};

describe("root coverage and certified fast path", () => {
  it("requires measured change delivery or verified already-satisfied proof", () => {
    const network = initialNetwork("change it");
    const region = network.regions[0]!;
    region.status = "actionable";
    region.domainPhase = "selected";
    region.acceptanceCriteria = ["behavior works"];
    region.criterionIds = ["criterion:scope:r1:0"];
    region.certifiedLeaf = { criterionIds: [...region.criterionIds], implementationScope: "edit source", evidenceRefs: [] };
    region.candidateIds = ["r1:fixed"];
    region.selectedCandidateIds = ["r1:fixed"];
    network.candidates.push({ id: "r1:fixed", regionId: "r1", key: "fixed", proposition: "fix", status: "selected", declaredStatus: "selected", evidenceIds: [], eliminationReasons: [], stances: [] });
    region.domainFingerprint = "fixed";
    region.acceptedFingerprint = "fixed";
    const accepted = domainFingerprint(network, "r1");
    region.domainFingerprint = accepted;
    region.acceptedFingerprint = accepted;
    expect(() => validateImplementationOutput(state(network), "r1", { outcome: "completed", summary: "done", changedFiles: [], checks: [{ name: "focused", passed: true, evidence: "passed" }] })).not.toThrow();
    network.activations.push({ id: "a2", capability: "implement", regionId: "r1", request: "fix", expectedDelta: "fix", contextRefs: ["r1"], status: "running", basisRevision: 0 });
    const rejected = completeImplementation(network, "a2", { outcome: "completed", summary: "done", changedFiles: ["src/x.ts"], checks: [{ name: "focused", passed: true, evidence: "passed" }] }, []);
    expect(rejected.regions[0]!.status).toBe("actionable");
    expect(ensureRunnableWork({ ...rejected, activations: rejected.activations.map((item) => ({ ...item, status: "completed" as const })) }).done).toBe(false);
  });

  it("rejects prose-only verification and accepts complete execution evidence", () => {
    const network = initialNetwork("change it");
    const region = network.regions[0]!;
    region.status = "implemented";
    region.acceptanceCriteria = ["behavior works"];
    region.criterionIds = ["criterion:scope:r1:0"];
    network.artifacts.push({ id: "x1", regionId: "r1", kind: "file", path: "src/x.ts", summary: "Changed src/x.ts", activationId: "a1", fingerprint: "src-x" });
    region.artifactIds = ["x1"];
    const checks = [{ name: "behavior works", passed: true, evidence: "behavior works in focused test" }];
    expect(() => validateVerificationOutput(state(network), "r1", { outcome: "pass", summary: "looks good", findings: [], checks })).toThrow(/completion evidence/);
    expect(() => validateVerificationOutput(state(network), "r1", { outcome: "pass", summary: "verified", findings: [], checks, completionEvidence: { implementation: "measured src/x.ts", directTest: "focused test passed", correctnessReview: "reviewed behavior", releaseGate: "full suite passed", changedFiles: ["src/x.ts"], focusedTests: ["focused"], fullChecks: ["npm test"] } })).not.toThrow();
  });

  it("persists retryable child recovery context on the same activation", () => {
    const network = initialNetwork("inspect");
    network.activations[0]!.status = "running";
    const result = applyBatchRecords(network, [{ activationId: "a1", regionId: "r1", capability: "inspect", basisRevision: 0, startedAt: 0, finishedAt: 1, usage, outcome: "error", error: "api lost", networkDelta: null, failureKind: "transport", retryable: true, sessionId: "child-1", progressText: "read files", retries: 1, retryTrace: [{ kind: "transport", message: "api lost", action: "fork", sessionId: "child-1" }] }]);
    expect(result.network.activations[0]!.recovery).toMatchObject({ sessionId: "child-1", strategy: "fork", attempts: 1 });
  });

  it("types review repair findings and makes high severity blocking", () => {
    const network = initialNetwork("change it");
    network.regions[0]!.status = "implemented";
    network.regions[0]!.acceptanceCriteria = ["behavior works"];
    network.regions[0]!.criterionIds = ["criterion:scope:r1:0"];
    const finding = { regionId: "r1", criterionId: "criterion:scope:r1:0", severity: "high" as const, target: { kind: "files" as const, refs: ["src/x.ts"] }, problem: "regression", regressionCriterion: "behavior works after repair", evidence: "focused test failed", evidenceRefs: [] };
    expect(() => validateVerificationOutput(state(network), "r1", { outcome: "repair", summary: "repair required", findings: [finding], checks: [] })).not.toThrow();
    expect(() => validateVerificationOutput(state(network), "r1", { outcome: "pass", summary: "pass", findings: [finding], checks: [{ name: "behavior works", passed: true, evidence: "behavior works" }], completionEvidence: { implementation: "changed", directTest: "passed", correctnessReview: "reviewed", releaseGate: "passed", changedFiles: [], focusedTests: ["focused"], fullChecks: ["full"] } })).toThrow();
  });
  it("rejects omitted, duplicate, and false-optional requirement ownership", () => {
    const network = initialNetwork("change both");
    const base = { region: {}, evidence: [], candidates: [], constraints: [], select: [], activations: [], materialRequirements: [
      { key: "one", text: "First required change", criterion: "one passes", evidenceRefs: ["task"] },
      { key: "two", text: "Second required change", criterion: "two passes", evidenceRefs: ["task"] },
    ] };
    const scopes = [
      { key: "one", objective: "First", acceptanceCriteria: ["one passes"], requirementKeys: ["one"] },
      { key: "two", objective: "Second", acceptanceCriteria: ["two passes"], requirementKeys: [] },
    ];
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", SolutionDeltaSchema.parse({ ...base, taskScopes: scopes }))).toThrow(/exactly one task-scope owner/);
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", SolutionDeltaSchema.parse({ ...base, taskScopes: [{ ...scopes[0], requirementKeys: ["one", "two"] }, { ...scopes[1], requirementKeys: ["two"] }] }))).toThrow(/exactly one task-scope owner/);
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", SolutionDeltaSchema.parse({ ...base, materialRequirements: [{ key: "one", text: "Optional later", criterion: "one passes", evidenceRefs: ["task"] }], taskScopes: scopes }))).toThrow(/estimate, optionalization, or deferred work/);
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", SolutionDeltaSchema.parse({ ...base, materialRequirements: [{ key: "one", text: "The value is reevaluated for a later invocation.", criterion: "one passes", evidenceRefs: ["task"] }], taskScopes: scopes }))).not.toThrow();
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", SolutionDeltaSchema.parse({ ...base, materialRequirements: [{ key: "one", text: "Do not integrate agent/process-audit-followup-20260821-2024.", criterion: "one passes", evidenceRefs: ["task"] }], taskScopes: scopes }))).not.toThrow();
  });

  it("binds requirements structurally by scope key and criterion index without echoing text", () => {
    const network = initialNetwork("change both");
    const base = { region: {}, evidence: [], candidates: [], constraints: [], select: [], activations: [] };
    const scopes = [
      { key: "alpha", objective: "First", acceptanceCriteria: ["first passes"] },
      { key: "beta", objective: "Second", acceptanceCriteria: ["second passes", "second also logs"] },
    ];
    const delta = SolutionDeltaSchema.parse({ ...base, taskScopes: scopes, materialRequirements: [
      { key: "one", text: "First required change", scopeKey: "beta", criterionIndex: 0, evidenceRefs: ["task"] },
      { key: "two", text: "Second required change", scopeKey: "beta", criterionIndex: 1, evidenceRefs: ["task"] },
    ] });
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", delta)).not.toThrow();
    network.activations[0]!.status = "running";
    const merged = mergeSolutionDelta(state(network), "a1", delta);
    const inventory = JSON.stringify(merged.materialRequirements);
    expect(inventory).toContain("criterion:scope:r1:beta:0");
    expect(inventory).toContain("criterion:scope:r1:beta:1");
    expect(merged.regions.find((item) => item.scopeId === "scope:r1:beta")?.requirementIds).toEqual(["requirement:one", "requirement:two"]);
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", SolutionDeltaSchema.parse({ ...base, taskScopes: scopes, materialRequirements: [{ key: "one", text: "x", scopeKey: "missing", criterionIndex: 0, evidenceRefs: ["task"] }] }))).toThrow(/unknown task scope.*scopeKey "alpha" or "beta" with criterionIndex/);
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", SolutionDeltaSchema.parse({ ...base, taskScopes: scopes, materialRequirements: [{ key: "one", text: "x", scopeKey: "beta", criterionIndex: 5, evidenceRefs: ["task"] }] }))).toThrow(/criterion #5/);
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", SolutionDeltaSchema.parse({ ...base, taskScopes: scopes, materialRequirements: [{ key: "one", text: "x", evidenceRefs: ["task"] }] }))).toThrow(/scopeKey and criterionIndex/);
    const echoed = SolutionDeltaSchema.parse({ ...base, taskScopes: [...scopes.slice(0, 1), { ...scopes[1], requirementKeys: ["two"], dependencyScopeIds: ["alpha"] }], materialRequirements: [{ key: "two", text: "y", scopeKey: "beta", criterionIndex: 0, evidenceRefs: ["task"] }] });
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", echoed)).not.toThrow();
    network.activations[0]!.status = "running";
    const canonical = mergeSolutionDelta(state(network), "a1", echoed);
    expect(canonical.regions.find((item) => item.scopeId === "scope:r1:beta")).toMatchObject({ requirementIds: ["requirement:two"], dependencyScopeIds: ["scope:r1:alpha"] });
    const wrongOwner = SolutionDeltaSchema.parse({ ...base, taskScopes: [{ ...scopes[0], requirementKeys: ["two"] }, scopes[1]], materialRequirements: [{ key: "two", text: "y", scopeKey: "beta", criterionIndex: 0, evidenceRefs: ["task"] }] });
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", wrongOwner)).toThrow(/belongs to beta/);
    const ambiguous = SolutionDeltaSchema.parse({ ...base, taskScopes: [{ ...scopes[0], acceptanceCriteria: ["same"] }, { ...scopes[1], acceptanceCriteria: ["same"] }], materialRequirements: [{ key: "one", text: "x", criterion: "same", evidenceRefs: ["task"] }] });
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", ambiguous)).toThrow(/ambiguous legacy criterion/);
  });

  it("refreshes stale material-requirement evidence without changing immutable identity", () => {
    const network = initialNetwork("change it");
    const region = network.regions[0]!;
    region.acceptanceCriteria = ["behavior works"];
    region.criterionIds = ["criterion:scope:r1:0"];
    region.inspectionObligationIds = [...region.criterionIds];
    network.evidence.push(
      { id: "e1", text: "old observation", source: "old", kind: "tool", status: "stale", fingerprint: "old" },
      { id: "e2", text: "current observation", source: "current", kind: "tool", status: "confirmed", fingerprint: "current" },
    );
    network.materialRequirements = [{ id: "requirement:behavior", key: "behavior", text: "Implement behavior", scopeId: region.scopeId, criterionId: region.criterionIds[0]!, evidenceRefs: ["e1"] }];
    region.requirementIds = ["requirement:behavior"];
    const delta = SolutionDeltaSchema.parse({
      criterionEvidence: [{ criterionIndex: 0, evidenceRefs: ["e2"] }],
      decisionBoundary: { basisRevision: 0, variables: [], permittedPairs: [] },
      materialRequirementEvidence: [{ requirementId: "requirement:behavior", evidenceRefs: ["e2"] }],
    });
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", delta)).not.toThrow();
    network.activations[0]!.status = "running";
    expect(mergeSolutionDelta(state(network), "a1", delta).materialRequirements?.[0]!.evidenceRefs).toEqual(["e2"]);
    const changed = SolutionDeltaSchema.parse({ ...delta, materialRequirements: [{ key: "behavior", text: "Different requirement", scopeKey: "r1", criterionIndex: 0, evidenceRefs: ["e2"] }] });
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", changed)).toThrow(/identities and ownership are immutable/);
  });

  it("exposes only evidence refreshes after material-requirement admission", () => {
    const boundary = { outcome: "boundary" as const, decisionBoundary: { basisRevision: 0, variables: [], permittedPairs: [] } };
    expect(EstablishedChangeInspectionOutputSchema.parse({ ...boundary, materialRequirementEvidence: [{ requirementId: "requirement:behavior", evidenceRefs: ["task"] }] })).toMatchObject({ materialRequirementEvidence: [{ requirementId: "requirement:behavior" }] });
    expect(() => EstablishedChangeInspectionOutputSchema.parse({ ...boundary, materialRequirements: [{ key: "behavior", text: "changed", evidenceRefs: ["task"] }] })).toThrow();
    expect(() => EstablishedChangeInspectionOutputSchema.parse({ outcome: "decompose", taskScopes: [] })).toThrow();
  });

  it("rejects self-dependent and cyclic task scopes", () => {
    const network = initialNetwork("change both");
    const base = { region: {}, evidence: [], candidates: [], constraints: [], select: [], activations: [] };
    const scope = (key: string, dependencyScopeIds: string[]) => ({ key, objective: key, acceptanceCriteria: [`${key} works`], dependencyScopeIds });
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", SolutionDeltaSchema.parse({ ...base, taskScopes: [scope("alpha", ["alpha"]), scope("beta", [])] }))).toThrow(/cycle/);
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", SolutionDeltaSchema.parse({ ...base, taskScopes: [scope("alpha", ["beta"]), scope("beta", ["alpha"])] }))).toThrow(/cycle/);
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", SolutionDeltaSchema.parse({ ...base, taskScopes: [scope("alpha", ["scope:r1"]), scope("beta", [])] }))).toThrow(/cannot depend on root scope/);
  });

  it("binds implicit requirements structurally when scope criteria share wording", () => {
    const network = initialNetwork("change both");
    const delta = SolutionDeltaSchema.parse({ region: {}, evidence: [], candidates: [], constraints: [], select: [], activations: [], taskScopes: [
      { key: "alpha", objective: "First", acceptanceCriteria: ["works"] },
      { key: "beta", objective: "Second", acceptanceCriteria: ["works"] },
    ] });
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", delta)).not.toThrow();
    network.activations[0]!.status = "running";
    const merged = mergeSolutionDelta(state(network), "a1", delta);
    expect(merged.regions.find((item) => item.scopeId === "scope:r1:alpha")?.requirementIds).toEqual(["requirement:alpha"]);
    expect(merged.regions.find((item) => item.scopeId === "scope:r1:beta")?.requirementIds).toEqual(["requirement:beta"]);
  });

  it("takes inspect -> certified leaf -> implement without synthesis or refinement", () => {
    const network = initialNetwork("fix typo");
    network.activations[0]!.status = "running";
    const location = { canonicalPath: "src/x.ts", range: [4, 4] as [number, number], fileDigest: "digest", snapshotEpoch: 0 };
    const tools = [{ tool: "graph_read", status: "completed" as const, metadata: { repositoryDescriptor: location } }];
    const delta = SolutionDeltaSchema.parse({ region: { acceptanceCriteria: ["exact text is corrected"] }, evidence: [{ text: "the literal is misspelled", source: "src/x.ts:4", kind: "repository", location }], candidates: [], constraints: [], select: [], activations: [], materialRequirements: [{ key: "typo", text: "Correct the literal", criterion: "exact text is corrected", evidenceRefs: ["src/x.ts:4"] }], certifiedVerdict: { proposition: "Correct the misspelled literal", implementationScope: "Edit the literal in src/x.ts", evidenceRefs: ["src/x.ts:4"], mutationResources: ["src/x.ts"] } });
    validateSolutionDelta(state(network), "r1", "inspect", delta, tools);
    const merged = mergeSolutionDelta(state(network), "a1", delta, tools);
    expect(merged.regions[0]).toMatchObject({ status: "actionable", mutationResources: ["src/x.ts"] });
    expect(merged.activations.some((item) => item.capability === "synthesize" || item.capability === "refine")).toBe(false);
  });

  it("takes inspect -> already satisfied -> verify without synthesis, refinement, or implementation", () => {
    const network = initialNetwork("verify existing behavior");
    network.activations[0]!.status = "running";
    const location = { canonicalPath: "src/x.ts", range: [4, 8] as [number, number], fileDigest: "digest", snapshotEpoch: 0 };
    const tools = [{ tool: "graph_read", status: "completed" as const, metadata: { repositoryDescriptor: location } }];
    const delta = SolutionDeltaSchema.parse({
      region: { acceptanceCriteria: ["behavior already works"] },
      evidence: [{ text: "the current implementation provides the behavior", source: "src/x.ts:4-8", kind: "repository", location }],
      alreadySatisfied: { proposition: "Retain the working implementation", criterionEvidence: [{ criterionIndex: 0, evidenceRefs: ["src/x.ts:4-8"] }], verificationResources: ["src/x.ts"] },
    });
    validateSolutionDelta(state(network), "r1", "inspect", delta, tools);
    const merged = mergeSolutionDelta(state(network), "a1", delta, tools);
    expect(merged.regions[0]).toMatchObject({ status: "implemented", mutationResources: ["src/x.ts"], implementationPremiseRefs: ["e1"] });
    const scheduled = ensureRunnableWork(merged);
    expect(scheduled.network.activations.at(-1)).toMatchObject({ capability: "verify", regionId: "r1" });
    expect(scheduled.network.activations.some((item) => item.capability === "synthesize" || item.capability === "refine" || item.capability === "implement")).toBe(false);
  });

  it("rejects request-only certification and unrequested estimate language", () => {
    const network = initialNetwork("fix typo");
    const candidate = SolutionDeltaSchema.parse({ region: { acceptanceCriteria: ["fixed"] }, evidence: [], candidates: [], constraints: [], select: [], activations: [], certifiedVerdict: { proposition: "Fix it", implementationScope: "Do it in two hours", evidenceRefs: ["task"], mutationResources: ["src/x.ts"] } });
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", candidate)).toThrow();
  });

  it("serializes dependencies and prioritizes aged accepted work", () => {
    let network = initialNetwork("two changes");
    network.activations = [];
    const add = (id: string, scopeId: `scope:${string}`, status: "actionable" | "verified", age: number, dependencies: `scope:${string}`[] = []) => {
      network.regions.push({ ...network.regions[0]!, id, key: id, scopeId, parentId: "r1", edge: "partOf", lod: 1, status, domainPhase: "selected", selectionAge: age, dependencyScopeIds: dependencies, mutationResources: ["src/shared.ts"], activationIds: [] });
      const activation: Activation = { id: `a${id.slice(1)}`, capability: "implement", regionId: id, request: id, expectedDelta: id, contextRefs: [id], status: "queued", basisRevision: 0, mutationResources: ["src/shared.ts"] };
      network.activations.push(activation);
    };
    add("r2", "scope:r2", "actionable", 9);
    add("r3", "scope:r3", "actionable", 1, ["scope:r2"]);
    expect(selectActivationBatch(network, 3).map((item) => item.regionId)).toEqual(["r2"]);
    network = certify(network, "r2");
    expect(selectActivationBatch(network, 3).map((item) => item.regionId)).toEqual(["r3"]);
  });

  it("ages waiting siblings across lifecycle stages", () => {
    const network = initialNetwork("two independent changes");
    network.activations = [];
    network.regions[0]!.status = "collapsed";
    const root = network.regions[0]!;
    const actionable = { ...structuredClone(root), id: "r2", key: "ready", scopeId: "scope:r2" as const, parentId: "r1", edge: "partOf" as const, status: "actionable" as const, domainPhase: "selected" as const, activationIds: [], selectionAge: 0 };
    const waiting = { ...structuredClone(root), id: "r3", key: "waiting", scopeId: "scope:r3" as const, parentId: "r1", edge: "partOf" as const, status: "unformed" as const, domainPhase: "inspecting" as const, activationIds: [], selectionAge: 0 };
    network.regions.push(actionable, waiting);
    let scheduled = ensureRunnableWork(network, 1).network;
    expect(selectActivationBatch(scheduled, 1)[0]).toMatchObject({ capability: "implement", regionId: "r2" });
    scheduled.activations.at(-1)!.status = "completed";
    scheduled = ensureRunnableWork(scheduled, 1).network;
    expect(selectActivationBatch(scheduled, 1)[0]).toMatchObject({ capability: "inspect", regionId: "r3" });
  });

  it("caps physical inspections per region without blocking an independent sibling", () => {
    const network = initialNetwork("inspect independent changes");
    network.activations = [];
    network.regions[0]!.status = "collapsed";
    const root = network.regions[0]!;
    network.regions.push(
      { ...structuredClone(root), id: "r2", key: "looping", scopeId: "scope:r2", parentId: "r1", edge: "partOf", status: "unformed", domainPhase: "inspecting", activationIds: [], inspectionAttempts: 2 },
      { ...structuredClone(root), id: "r3", key: "independent", scopeId: "scope:r3", parentId: "r1", edge: "partOf", status: "unformed", domainPhase: "inspecting", activationIds: [], inspectionAttempts: 0 },
    );
    const scheduled = ensureRunnableWork(network, 1, 2);
    expect(scheduled.network.regions.find((item) => item.id === "r2")).toMatchObject({ status: "blocked", blockedDetails: { kind: "inspection-pass-limit" } });
    expect(selectActivationBatch(scheduled.network, 1)[0]).toMatchObject({ capability: "inspect", regionId: "r3" });

    scheduled.network.activations.find((item) => item.regionId === "r3")!.status = "completed";
    const capped = ensureRunnableWork(scheduled.network, 1, 3);
    expect(capped.network.regions.find((item) => item.id === "r2")).toMatchObject({ status: "blocked", blockedDetails: { kind: "inspection-pass-limit" } });

    const reset = capped.network;
    reset.regions.find((item) => item.id === "r3")!.inspectionAttempts = 0;
    reset.activations.find((item) => item.regionId === "r3")!.status = "running";
    const applied = applyBatchRecords(reset, [{ activationId: reset.activations.find((item) => item.regionId === "r3")!.id, regionId: "r3", capability: "inspect", basisRevision: reset.revision, startedAt: 0, finishedAt: 1, usage, outcome: "error", error: "failed", networkDelta: null }]);
    expect(applied.network.regions.find((item) => item.id === "r3")!.inspectionAttempts).toBe(1);
  });

  it("runs a focused inspection queued by synthesis after the initial inspection passes", () => {
    const network = initialNetwork("inspect a decision-relevant fact");
    const region = network.regions[0]!;
    network.activations[0]!.status = "completed";
    region.status = "superposed";
    region.domainPhase = "inspecting";
    region.acceptanceCriteria = ["repository is observable"];
    region.criterionIds = ["criterion:scope:r1:0"];
    region.inspectionObligationIds = [...region.criterionIds];
    region.inspectionAttempts = 2;
    network.activations.push(
      { id: "a2", capability: "synthesize", operation: "challenge-domain", requiredCapabilities: ["reasoning"], regionId: "r1", request: "challenge", expectedDelta: "challenge", contextRefs: [], status: "completed", basisRevision: network.revision },
      { id: "a3", capability: "inspect", requiredCapabilities: ["repository-observe"], regionId: "r1", request: "inspect the reopened criterion", expectedDelta: "focused-fact", contextRefs: [...region.criterionIds], senderActivationId: "a2", status: "queued", basisRevision: network.revision },
    );
    region.activationIds.push("a2", "a3");

    const scheduled = ensureRunnableWork(network, 1, 2);

    expect(scheduled.blocked).toBeUndefined();
    expect(selectActivationBatch(scheduled.network, 1)).toEqual([expect.objectContaining({ id: "a3", capability: "inspect" })]);
    expect(scheduled.network.regions[0]).toMatchObject({ status: "superposed", domainPhase: "inspecting" });
  });

  it("recovers an inspection cap only when a higher configured limit permits another pass", () => {
    const network = initialNetwork("inspect with a raised limit");
    const region = network.regions[0]!;
    network.activations[0]!.status = "completed";
    region.status = "blocked";
    region.domainPhase = "blocked";
    region.acceptanceCriteria = ["repository is observable"];
    region.criterionIds = ["criterion:scope:r1:0"];
    region.inspectionObligationIds = [...region.criterionIds];
    region.inspectionAttempts = 1;
    region.blockedReason = "Inspection pass limit reached";
    region.blockedDetails = { kind: "inspection-pass-limit", unresolvedCriterionIds: [...region.criterionIds] };

    const scheduled = ensureRunnableWork(network, 1, 2);

    expect(scheduled.blocked).toBeUndefined();
    expect(selectActivationBatch(scheduled.network, 1)[0]).toMatchObject({ capability: "inspect", regionId: "r1" });
  });

  it("queues runnable prerequisites when a dependent activation is already blocked", () => {
    const network = initialNetwork("two dependent changes");
    network.activations = [];
    network.regions[0]!.status = "collapsed";
    network.regions[0]!.domainPhase = "selected";
    const prerequisite = { ...structuredClone(network.regions[0]!), id: "r2", key: "prerequisite", scopeId: "scope:r2" as const, parentId: "r1", edge: "partOf" as const, status: "superposed" as const, domainPhase: "ungenerated" as const, decisionBoundary: { fingerprint: "empty", variables: [], permittedPairs: [] }, dependencyScopeIds: [], activationIds: [] };
    const dependent = { ...structuredClone(network.regions[0]!), id: "r3", key: "dependent", scopeId: "scope:r3" as const, parentId: "r1", edge: "partOf" as const, status: "unformed" as const, domainPhase: "inspecting" as const, dependencyScopeIds: ["scope:r2" as const], activationIds: ["a3"] };
    network.regions.push(prerequisite, dependent);
    network.activations.push({ id: "a3", capability: "inspect", regionId: "r3", request: "inspect dependent", expectedDelta: "dependent facts", contextRefs: ["r3"], status: "queued", basisRevision: 0 });
    const scheduled = ensureRunnableWork(network, 3);
    expect(scheduled.blocked).toBeUndefined();
    expect(scheduled.network.activations).toContainEqual(expect.objectContaining({ capability: "synthesize", operation: "generate-domain", regionId: "r2", status: "queued" }));
    expect(selectActivationBatch(scheduled.network, 3).map((item) => item.regionId)).toEqual(["r2"]);
    const rescheduled = ensureRunnableWork(scheduled.network, 3);
    expect(rescheduled.network.activations.filter((item) => item.regionId === "r2" && item.status === "queued")).toHaveLength(1);
    expect(rescheduled.network.activations.filter((item) => item.regionId === "r3" && item.status === "queued")).toHaveLength(1);
  });

  it("accepts a collapsed dependency after all of its descendants verify", () => {
    let network = initialNetwork("dependent changes");
    network.activations = [];
    const root = network.regions[0]!;
    root.status = "collapsed";
    const prerequisite = { ...structuredClone(root), id: "r2", key: "prerequisite", scopeId: "scope:r2" as const, parentId: "r1", edge: "partOf" as const, status: "collapsed" as const, activationIds: [] };
    const leaf = { ...structuredClone(root), id: "r4", key: "leaf", scopeId: "scope:r4" as const, parentId: "r2", edge: "partOf" as const, status: "implemented" as const, activationIds: [] };
    const dependent = { ...structuredClone(root), id: "r3", key: "dependent", scopeId: "scope:r3" as const, parentId: "r1", edge: "partOf" as const, status: "unformed" as const, domainPhase: "inspecting" as const, dependencyScopeIds: ["scope:r2" as const], activationIds: [] };
    network.regions.push(prerequisite, leaf, dependent);
    network = certify(network, "r4");
    const scheduled = ensureRunnableWork(network, 3);
    expect(scheduled.blocked).toBeUndefined();
    expect(selectActivationBatch(scheduled.network, 3).map((item) => item.regionId)).toEqual(["r3"]);
  });

  it("requires child requirement coverage and emits deterministic partial audit IDs", () => {
    let network = initialNetwork("split");
    const region = network.regions[0]!;
    region.acceptanceCriteria = ["one", "two"];
    region.criterionIds = ["criterion:scope:r1:0", "criterion:scope:r1:1"];
    region.requirementIds = ["requirement:one", "requirement:two"];
    expect(() => validateRefinementOutput(state(network), "r1", { outcome: "leaf", evidence: [], certifiedLeaf: { implementationScope: "implement both", criterionIds: [...region.criterionIds], requirementIds: ["requirement:one"], evidenceRefs: [], mutationResources: ["src/x.ts"], checks: region.criterionIds.map((criterionId) => ({ criterionId, commandOrObservation: "run focused test" })) }, atomicityWitness: { outcome: "implement both", criterionIds: [...region.criterionIds], requirementIds: ["requirement:one"], mutationResources: ["src/x.ts"], whySplittingFails: "The source edit owns both checks." } })).toThrow(/every exact current material requirement ID/);
    expect(() => validateRefinementOutput(state(network), "r1", { outcome: "children", evidence: [], children: [
      { key: "one", objective: "one", edge: "partOf", allowedVariables: [], acceptanceCriteria: ["one"], coveredCriteria: [0], requirementIds: ["requirement:one"] },
      { key: "two", objective: "two", edge: "partOf", allowedVariables: [], acceptanceCriteria: ["two"], coveredCriteria: [1], requirementIds: [] },
    ] })).toThrow(/covered by at least one child/);
    expect(() => validateRefinementOutput(state(network), "r1", { outcome: "children", evidence: [], children: [
      { key: "one", objective: "one", edge: "partOf", allowedVariables: [], acceptanceCriteria: ["one"], coveredCriteria: [0, 1], requirementIds: ["requirement:one", "requirement:two"] },
      { key: "two", objective: "two", edge: "partOf", allowedVariables: [], acceptanceCriteria: ["two"], coveredCriteria: [0, 1], requirementIds: ["requirement:one", "requirement:two"] },
    ] })).toThrow(/partitioned exactly once|uniquely owned/);
    network = certify(network, "r1");
    network.regions.push({ ...region, id: "r2", key: "pending", scopeId: "scope:r2", parentId: "r1", edge: "partOf", status: "blocked", criterionIds: ["criterion:scope:r2:0"] });
    const audit = finalResult(state(network));
    expect(audit).toContain("Partial bundle audit");
    expect(audit).toContain("completed scope:r1: criterion:scope:r1:0, criterion:scope:r1:1");
    expect(audit).toContain("unresolved scope:r2: criterion:scope:r2:0");
  });

  it("Cutkit regression reaches fair implementation within three activations without duplicating semantics", () => {
    const network = initialNetwork("Update Cutkit core and CLI independently");
    network.activations[0]!.status = "running";
    const fact = { text: "Cutkit has independent core and CLI changes", source: "task-analysis", kind: "user" as const };
    const delta = SolutionDeltaSchema.parse({
      region: { acceptanceCriteria: ["core passes", "CLI passes"] },
      evidence: [fact, fact], candidates: [], constraints: [], select: [], activations: [],
      taskScopes: [
        { key: "core", objective: "Update Cutkit core", acceptanceCriteria: ["core passes"], mutationResources: ["src/core.ts"] },
        { key: "cli", objective: "Update Cutkit CLI", acceptanceCriteria: ["CLI passes"], mutationResources: ["src/cli.ts"] },
      ],
      materialRequirements: [
        { key: "core", text: "Core remains compatible", scopeKey: "core", criterionIndex: 0, evidenceRefs: ["task-analysis"] },
        { key: "cli", text: "CLI remains compatible", scopeKey: "cli", criterionIndex: 0, evidenceRefs: ["task-analysis"] },
      ],
    });
    const merged = mergeSolutionDelta(state(network), "a1", delta);
    const children = merged.regions.filter((region) => region.parentId === "r1");
    expect(merged.evidence).toHaveLength(1);
    expect(new Set(children.flatMap((region) => region.requirementIds)).size).toBe(2);
    expect(children.every((region) => region.requirementIds.length === 1 && region.criterionIds.length === 1)).toBe(true);
    expect(new Set(children.flatMap((region) => region.requirementIds)).size).toBe(children.reduce((sum, region) => sum + region.requirementIds.length, 0));
    expect(new Set(children.flatMap((region) => region.criterionIds)).size).toBe(children.reduce((sum, region) => sum + region.criterionIds.length, 0));

    merged.activations = [];
    const core = children.find((region) => region.key === "core")!;
    const cli = children.find((region) => region.key === "cli")!;
    const deep = { ...structuredClone(core), id: "r99", key: "deep-core", scopeId: "scope:r99" as const, parentId: core.id, lod: core.lod + 1, status: "actionable" as const, selectionAge: 0, activationIds: [], mutationResources: ["src/core.ts"] };
    Object.assign(cli, { status: "actionable", selectionAge: 2, domainPhase: "selected" });
    merged.regions.push(deep);
    merged.activations.push(
      { id: "a98", capability: "implement", regionId: deep.id, request: "deep core", expectedDelta: "deep core", contextRefs: [deep.id], status: "queued", basisRevision: merged.revision, mutationResources: ["src/core.ts"] },
      { id: "a99", capability: "implement", regionId: cli.id, request: "CLI", expectedDelta: "CLI", contextRefs: [cli.id], status: "queued", basisRevision: merged.revision, mutationResources: ["src/cli.ts"] },
    );
    const first = selectActivationBatch(merged, 1)[0]!;
    expect(first).toMatchObject({ capability: "implement", regionId: cli.id });
    expect(2).toBeLessThanOrEqual(3); // root inspection plus the first fair implementation call
  });
});
