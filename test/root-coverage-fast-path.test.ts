import { describe, expect, it } from "vitest";
import { SolutionDeltaSchema, type Activation, type SolutionLodState, type SolutionNetwork } from "../src/solution-lod/types.js";
import { applyBatchRecords, completeImplementation, domainFingerprint, ensureRunnableWork, initialNetwork, mergeSolutionDelta, selectActivationBatch, validateImplementationOutput, validateRefinementOutput, validateSolutionDelta, validateVerificationOutput } from "../src/solution-lod/reducer.js";
import { finalResult } from "../src/solution-lod/graph.js";

const usage = { turns: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
const state = (network: SolutionNetwork, originalTask = "fix it"): SolutionLodState => ({ stateVersion: 8, runId: "coverage", originalTask, conversationContext: "", directory: "/r", worktree: "/r", phase: "", activeBatch: [], network, results: [], usage, callsUsed: 0, startedAt: 0, result: "" });

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
    expect(() => validateImplementationOutput(state(network), "r1", { status: "completed", summary: "done", changedFiles: [], checks: [{ name: "focused", passed: true, evidence: "passed" }], activations: [] })).not.toThrow();
    network.activations.push({ id: "a2", capability: "implement", regionId: "r1", request: "fix", expectedDelta: "fix", contextRefs: ["r1"], status: "running", basisRevision: 0 });
    const rejected = completeImplementation(network, "a2", { status: "completed", summary: "done", changedFiles: ["src/x.ts"], checks: [{ name: "focused", passed: true, evidence: "passed" }], activations: [] }, []);
    expect(rejected.regions[0]!.status).toBe("actionable");
    expect(ensureRunnableWork({ ...rejected, activations: rejected.activations.map((item) => ({ ...item, status: "completed" as const })) }).done).toBe(false);
  });

  it("rejects prose-only verification and accepts complete execution evidence", () => {
    const network = initialNetwork("change it");
    const region = network.regions[0]!;
    region.status = "implemented";
    region.acceptanceCriteria = ["behavior works"];
    region.criterionIds = ["criterion:scope:r1:0"];
    network.artifacts.push({ id: "x1", regionId: "r1", kind: "file", path: "src/x.ts", summary: "Changed src/x.ts", activationId: "a1" });
    region.artifactIds = ["x1"];
    const checks = [{ name: "behavior works", passed: true, evidence: "behavior works in focused test" }];
    expect(() => validateVerificationOutput(state(network), "r1", { verdict: "pass", summary: "looks good", findings: [], checks, activations: [] })).toThrow(/completion evidence/);
    expect(() => validateVerificationOutput(state(network), "r1", { verdict: "pass", summary: "verified", findings: [], checks, completionEvidence: { implementation: "measured src/x.ts", directTest: "focused test passed", correctnessReview: "reviewed behavior", releaseGate: "full suite passed", changedFiles: ["src/x.ts"], focusedTests: ["focused"], fullChecks: ["npm test"] }, activations: [] })).not.toThrow();
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
    const finding = { regionId: "r1", criterionId: "criterion:scope:r1:0", severity: "high" as const, files: ["src/x.ts"], problem: "regression", regressionCriterion: "behavior works after repair", evidence: "focused test failed" };
    expect(() => validateVerificationOutput(state(network), "r1", { verdict: "repair", summary: "repair required", findings: [finding], checks: [], activations: [] })).not.toThrow();
    expect(() => validateVerificationOutput(state(network), "r1", { verdict: "pass", summary: "pass", findings: [finding], checks: [{ name: "behavior works", passed: true, evidence: "behavior works" }], completionEvidence: { implementation: "changed", directTest: "passed", correctnessReview: "reviewed", releaseGate: "passed", changedFiles: [], focusedTests: ["focused"], fullChecks: ["full"] }, activations: [] })).toThrow();
  });
  it("rejects omitted, duplicate, and false-optional requirement ownership", () => {
    const network = initialNetwork("change both");
    const base = { region: {}, evidence: [], candidates: [], constraints: [], select: [], activations: [], materialRequirements: [
      { key: "one", text: "First required change", criterion: "one passes" },
      { key: "two", text: "Second required change", criterion: "two passes" },
    ] };
    const scopes = [
      { key: "one", objective: "First", acceptanceCriteria: ["one passes"], requirementKeys: ["one"] },
      { key: "two", objective: "Second", acceptanceCriteria: ["two passes"], requirementKeys: [] },
    ];
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", SolutionDeltaSchema.parse({ ...base, taskScopes: scopes }))).toThrow(/exactly one task-scope owner/);
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", SolutionDeltaSchema.parse({ ...base, taskScopes: [{ ...scopes[0], requirementKeys: ["one", "two"] }, { ...scopes[1], requirementKeys: ["two"] }] }))).toThrow(/exactly one task-scope owner/);
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", SolutionDeltaSchema.parse({ ...base, materialRequirements: [{ key: "one", text: "Optional later", criterion: "one passes" }], taskScopes: scopes }))).toThrow(/estimate, optionalization, or deferred work/);
  });

  it("binds requirements structurally by scope key and criterion index without echoing text", () => {
    const network = initialNetwork("change both");
    const base = { region: {}, evidence: [], candidates: [], constraints: [], select: [], activations: [] };
    const scopes = [
      { key: "alpha", objective: "First", acceptanceCriteria: ["first passes"] },
      { key: "beta", objective: "Second", acceptanceCriteria: ["second passes", "second also logs"] },
    ];
    const delta = SolutionDeltaSchema.parse({ ...base, taskScopes: scopes, materialRequirements: [
      { key: "one", text: "First required change", scopeKey: "beta", criterionIndex: 0 },
      { key: "two", text: "Second required change", scopeKey: "beta", criterionIndex: 1 },
    ] });
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", delta)).not.toThrow();
    network.activations[0]!.status = "running";
    const merged = mergeSolutionDelta(state(network), "a1", delta);
    const inventory = JSON.stringify(merged.materialRequirements);
    expect(inventory).toContain("criterion:scope:r1:beta:0");
    expect(inventory).toContain("criterion:scope:r1:beta:1");
    expect(merged.regions.find((item) => item.scopeId === "scope:r1:beta")?.requirementIds).toEqual(["requirement:one", "requirement:two"]);
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", SolutionDeltaSchema.parse({ ...base, taskScopes: scopes, materialRequirements: [{ key: "one", text: "x", scopeKey: "missing", criterionIndex: 0 }] }))).toThrow(/unknown task scope/);
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", SolutionDeltaSchema.parse({ ...base, taskScopes: scopes, materialRequirements: [{ key: "one", text: "x", scopeKey: "beta", criterionIndex: 5 }] }))).toThrow(/criterion #5/);
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", SolutionDeltaSchema.parse({ ...base, taskScopes: scopes, materialRequirements: [{ key: "one", text: "x" }] }))).toThrow(/scopeKey and criterionIndex/);
    const echoed = SolutionDeltaSchema.parse({ ...base, taskScopes: [...scopes.slice(0, 1), { ...scopes[1], requirementKeys: ["two"], dependencyScopeIds: ["alpha"] }], materialRequirements: [{ key: "two", text: "y", scopeKey: "beta", criterionIndex: 0 }] });
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", echoed)).not.toThrow();
    network.activations[0]!.status = "running";
    const canonical = mergeSolutionDelta(state(network), "a1", echoed);
    expect(canonical.regions.find((item) => item.scopeId === "scope:r1:beta")).toMatchObject({ requirementIds: ["requirement:two"], dependencyScopeIds: ["scope:r1:alpha"] });
    const wrongOwner = SolutionDeltaSchema.parse({ ...base, taskScopes: [{ ...scopes[0], requirementKeys: ["two"] }, scopes[1]], materialRequirements: [{ key: "two", text: "y", scopeKey: "beta", criterionIndex: 0 }] });
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", wrongOwner)).toThrow(/belongs to beta/);
    const ambiguous = SolutionDeltaSchema.parse({ ...base, taskScopes: [{ ...scopes[0], acceptanceCriteria: ["same"] }, { ...scopes[1], acceptanceCriteria: ["same"] }], materialRequirements: [{ key: "one", text: "x", criterion: "same" }] });
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", ambiguous)).toThrow(/ambiguous legacy criterion/);
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
    const delta = SolutionDeltaSchema.parse({ region: { acceptanceCriteria: ["exact text is corrected"] }, evidence: [{ text: "the literal is misspelled", source: "src/x.ts:4", kind: "repository" }], candidates: [], constraints: [], select: [], activations: [], materialRequirements: [{ key: "typo", text: "Correct the literal", criterion: "exact text is corrected" }], certifiedVerdict: { proposition: "Correct the misspelled literal", implementationScope: "Edit the literal in src/x.ts", evidenceRefs: ["src/x.ts:4"], mutationResources: ["src/x.ts"] } });
    validateSolutionDelta(state(network), "r1", "inspect", delta);
    const merged = mergeSolutionDelta(state(network), "a1", delta);
    expect(merged.regions[0]).toMatchObject({ status: "actionable", mutationResources: ["src/x.ts"] });
    expect(merged.activations.some((item) => item.capability === "synthesize" || item.capability === "refine")).toBe(false);
  });

  it("rejects request-only certification and unrequested estimate language", () => {
    const network = initialNetwork("fix typo");
    const candidate = SolutionDeltaSchema.parse({ region: { acceptanceCriteria: ["fixed"] }, evidence: [], candidates: [], constraints: [], select: [], activations: [], certifiedVerdict: { proposition: "Fix it", implementationScope: "Do it in two hours", evidenceRefs: ["task"], mutationResources: ["src/x.ts"] } });
    expect(() => validateSolutionDelta(state(network), "r1", "inspect", candidate)).toThrow();
  });

  it("serializes dependencies and prioritizes aged accepted work", () => {
    const network = initialNetwork("two changes");
    network.activations = [];
    const add = (id: string, scopeId: `scope:${string}`, status: "actionable" | "verified", age: number, dependencies: `scope:${string}`[] = []) => {
      network.regions.push({ ...network.regions[0]!, id, key: id, scopeId, parentId: "r1", edge: "partOf", lod: 1, status, domainPhase: "selected", selectionAge: age, dependencyScopeIds: dependencies, mutationResources: ["src/shared.ts"], activationIds: [] });
      const activation: Activation = { id: `a${id.slice(1)}`, capability: "implement", regionId: id, request: id, expectedDelta: id, contextRefs: [id], status: "queued", basisRevision: 0, mutationResources: ["src/shared.ts"] };
      network.activations.push(activation);
    };
    add("r2", "scope:r2", "actionable", 9);
    add("r3", "scope:r3", "actionable", 1, ["scope:r2"]);
    expect(selectActivationBatch(network, 3).map((item) => item.regionId)).toEqual(["r2"]);
    network.regions.find((item) => item.id === "r2")!.status = "verified";
    expect(selectActivationBatch(network, 3).map((item) => item.regionId)).toEqual(["r3"]);
  });

  it("queues runnable prerequisites when a dependent activation is already blocked", () => {
    const network = initialNetwork("two dependent changes");
    network.activations = [];
    network.regions[0]!.status = "collapsed";
    network.regions[0]!.domainPhase = "selected";
    const prerequisite = { ...structuredClone(network.regions[0]!), id: "r2", key: "prerequisite", scopeId: "scope:r2" as const, parentId: "r1", edge: "partOf" as const, status: "superposed" as const, domainPhase: "ungenerated" as const, dependencyScopeIds: [], activationIds: [] };
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
    const network = initialNetwork("dependent changes");
    network.activations = [];
    const root = network.regions[0]!;
    root.status = "collapsed";
    const prerequisite = { ...structuredClone(root), id: "r2", key: "prerequisite", scopeId: "scope:r2" as const, parentId: "r1", edge: "partOf" as const, status: "collapsed" as const, activationIds: [] };
    const leaf = { ...structuredClone(root), id: "r4", key: "leaf", scopeId: "scope:r4" as const, parentId: "r2", edge: "partOf" as const, status: "verified" as const, activationIds: [] };
    const dependent = { ...structuredClone(root), id: "r3", key: "dependent", scopeId: "scope:r3" as const, parentId: "r1", edge: "partOf" as const, status: "unformed" as const, domainPhase: "inspecting" as const, dependencyScopeIds: ["scope:r2" as const], activationIds: [] };
    network.regions.push(prerequisite, leaf, dependent);
    const scheduled = ensureRunnableWork(network, 3);
    expect(scheduled.blocked).toBeUndefined();
    expect(selectActivationBatch(scheduled.network, 3).map((item) => item.regionId)).toEqual(["r3"]);
  });

  it("requires exact child requirement ownership and emits deterministic partial audit IDs", () => {
    const network = initialNetwork("split");
    const region = network.regions[0]!;
    region.acceptanceCriteria = ["one", "two"];
    region.criterionIds = ["criterion:scope:r1:0", "criterion:scope:r1:1"];
    region.requirementIds = ["requirement:one", "requirement:two"];
    expect(() => validateRefinementOutput(state(network), "r1", { evidence: [], activations: [], children: [
      { key: "one", objective: "one", edge: "partOf", allowedVariables: [], acceptanceCriteria: ["one"], coveredCriteria: [0], requirementIds: ["requirement:one"] },
      { key: "two", objective: "two", edge: "partOf", allowedVariables: [], acceptanceCriteria: ["two"], coveredCriteria: [1], requirementIds: [] },
    ] })).toThrow(/exactly one child owner/);
    region.status = "verified";
    network.regions.push({ ...region, id: "r2", key: "pending", scopeId: "scope:r2", parentId: "r1", edge: "partOf", status: "blocked", criterionIds: ["criterion:scope:r2:0"] });
    const audit = finalResult(state(network));
    expect(audit).toContain("Partial bundle audit");
    expect(audit).toContain("completed scope:r1: criterion:scope:r1:0, criterion:scope:r1:1");
    expect(audit).toContain("unresolved scope:r2: criterion:scope:r2:0");
  });
});
