import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Annotation, Command, END, interrupt, isInterrupted, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { afterEach, describe, expect, it } from "vitest";
import { commandModel, defineGraph, loadConnectorDefinition, opencodeModel, typedConfigFile, withSolutionRoleModelAssignments, writeConnectorConfig } from "../src/config.js";
import { DurableFileSaver } from "../src/durable-checkpointer.js";
import { assertValidConnector, validateConnector } from "../src/validate.js";
import type { AgentCall, ConnectorDefinition } from "../src/types.js";
import { compileActivationPrompt, projectActivationContext, solutionLodGraph } from "../src/solution-lod/graph.js";
import { SOLUTION_ROLE_CONTRACTS } from "../src/solution-lod/roles.js";
import { applyBatchRecords, completeImplementation, completeVerification, ensureRunnableWork, initialNetwork, mergeRefinementOutput, mergeSolutionDelta, mergeSynthesisOutput, nextQueuedActivation, propagateNetwork, reopenRegion, selectActivationBatch, validateImplementationOutput, validateRefinementOutput, validateSolutionDelta, validateVerificationOutput } from "../src/solution-lod/reducer.js";
import type { ActivationTaskResult, SolutionLodState, SolutionNetwork } from "../src/solution-lod/types.js";

const temporaryDirectories = new Set<string>();
function temp(prefix: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.add(directory);
  return directory;
}
afterEach(() => {
  for (const directory of temporaryDirectories) fs.rmSync(directory, { recursive: true, force: true });
  temporaryDirectories.clear();
});

function mockV8Structured(title: string, prompt = ""): unknown {
  const fingerprint = prompt.match(/"fingerprint":"([^"]+)"/)?.[1];
  const candidateIds = [...prompt.matchAll(/"referenceId":"(r\d+:[^"]+)"/g)].map((match) => match[1]);
  const regionId = title.match(/:(r\d+)/)?.[1] ?? "r1";
  if (title.includes("generate-domain:")) return { operation: "generate-domain", evidence: [], variables: [], constraints: [], candidates: [{ key: "direct", proposition: "Update target", evidenceRefs: [], stances: [] }, { key: "adapter", proposition: "Update target through an adapter", evidenceRefs: [], stances: [] }] };
  if (title.includes("challenge-domain:")) return { operation: "challenge-domain", verdict: "accept", domainFingerprint: fingerprint, viableCandidateIds: candidateIds };
  if (title.includes("select-candidate:")) return { operation: "select-candidate", domainFingerprint: fingerprint, basis: "lexicographic", selectedCandidateId: `${regionId}:direct`, hardConstraints: [], comparisons: candidateIds.map((candidateId) => ({ candidateId, userPreference: "neutral", repositoryCompatibility: "neutral", changeScope: candidateId === `${regionId}:direct` ? "preferred" : "disfavored", irreversibleRisk: "neutral", evidenceRefs: [] })) };
  if (title.includes("refine:")) return { evidence: [], children: [], certifiedLeaf: { implementationScope: "bounded test change", criterionIds: ["criterion:scope:r1:0"], evidenceRefs: [], mutationResources: ["src/test.ts"], checks: [{ criterionId: "criterion:scope:r1:0", commandOrObservation: "run focused test" }] }, activations: [] };
  return undefined;
}

function graph(terminates = true) {
  const State = Annotation.Root({ result: Annotation<string> });
  const builder = new StateGraph(State).addNode("work", () => ({ result: "ok" })).addEdge(START, "work");
  if (terminates) builder.addEdge("work", END);
  return builder.compile({ checkpointer: new MemorySaver() });
}


describe("typed graph validation", () => {
  it("accepts a compiled terminating graph with valid references", async () => {
    const definition: ConnectorDefinition = {
      version: 1,
      models: { current: { backend: "opencode", model: "inherit" } },
      agents: { worker: { model: "current", systemPrompt: "work", tools: { question: false } } },
      graphs: { default: { graph: graph(), initial: () => ({ result: "" }) } },
      defaultGraph: "default",
    };
    expect(await validateConnector(definition)).toEqual([]);
  });

  it("reports model references and missing checkpoint persistence", async () => {
    const State = Annotation.Root({ result: Annotation<string> });
    const compiled = new StateGraph(State).addNode("work", () => ({ result: "ok" })).addEdge(START, "work").addEdge("work", END).compile();
    const definition: ConnectorDefinition = {
      version: 1,
      models: {},
      agents: { worker: { model: "missing", systemPrompt: "work" } },
      graphs: { default: { graph: compiled, initial: () => ({ result: "" }) } },
      defaultGraph: "default",
    };
    expect((await validateConnector(definition)).map((item) => item.code)).toEqual(expect.arrayContaining(["REFERENCE", "GRAPH"]));
  });

  it("rejects non-positive agent timeout settings", async () => {
    const definition: ConnectorDefinition = {
      version: 1,
      models: { current: { backend: "opencode", model: "inherit" } },
      agents: { worker: { model: "current", systemPrompt: "work", tools: { question: false }, inactivityTimeoutMs: 0, maxRuntimeMs: -1 } },
      graphs: { default: { graph: graph(), initial: () => ({ result: "" }) } },
      defaultGraph: "default",
    };
    expect((await validateConnector(definition)).map((item) => item.path)).toEqual(expect.arrayContaining(["agents.worker.inactivityTimeoutMs", "agents.worker.maxRuntimeMs"]));
  });

  it("uses the production solution-LOD workflow as the zero-config preset", async () => {
    const project = temp("opencode-langgraph-config-");
    const definition = await loadConnectorDefinition(project);
    expect(definition.defaultGraph).toBe("solution-lod");
    for (const role of ["inspect", "synthesize", "refine", "implement", "verify", "present"]) {
      expect(definition.models[`${role}-model`]).toEqual({ backend: "opencode", model: "inherit" });
    }
    expect(definition.agents.inspect).toMatchObject({ model: "inspect-model", maxSteps: 32, tools: { read: true, bash: false, edit: false, task: false } });
    expect(definition.agents.synthesize).toMatchObject({ model: "synthesize-model", maxSteps: 8, tools: { read: false, bash: false } });
    expect(definition.agents.refine).toMatchObject({ model: "refine-model", maxSteps: 8, tools: { read: false, bash: false } });
    expect(definition.agents.verify).toMatchObject({ model: "verify-model", maxSteps: 16, tools: { bash: true, edit: false } });
    expect(definition.agents.implement).toMatchObject({ model: "implement-model", maxSteps: 32, tools: { task: false } });
    const file = writeConnectorConfig(project);
    expect(path.relative(project, file)).toBe(typedConfigFile);
    expect(fs.readFileSync(file, "utf8")).toContain('preset: "solution-lod"');
    expect((await loadConnectorDefinition(project)).graphs["solution-lod"]).toBeDefined();
  });

  it("applies preset model and activation-quantum overrides", async () => {
    const project = temp("opencode-langgraph-options-");
    const file = writeConnectorConfig(project);
    fs.writeFileSync(file, `import { defineOpenCodeLangGraph } from "opencode-langgraph";\nexport default defineOpenCodeLangGraph({ version: 1, preset: "solution-lod", options: { models: { inspect: "provider/cheap", implement: "provider/strong" }, roleLimits: { inspect: { maxTurns: 3 } } } });\n`);
    const definition = await loadConnectorDefinition(project);
    expect(definition.models["inspect-model"]).toEqual({ backend: "opencode", model: "provider/cheap" });
    expect(definition.models["implement-model"]).toEqual({ backend: "opencode", model: "provider/strong" });
    expect(definition.agents.inspect.maxSteps).toBe(3);
    const initial = definition.graphs["solution-lod"].initial({ task: "x", directory: project, worktree: project, runId: "x" }) as SolutionLodState;
    expect(initial.stateVersion).toBe(8);
  });

  it("loads dependency-free langgraph.json presets and degrades broken configs to the preset", async () => {
    const jsonProject = temp("opencode-langgraph-json-");
    fs.mkdirSync(path.join(jsonProject, ".opencode"), { recursive: true });
    const jsonFile = path.join(jsonProject, ".opencode", "langgraph.json");
    fs.writeFileSync(jsonFile, JSON.stringify({ version: 1, preset: "solution-lod", options: { models: { inspect: "provider/from-json" }, roleLimits: { refine: { maxTurns: 4 } } } }));
    const fromJson = await loadConnectorDefinition(jsonProject);
    expect(fromJson.models["inspect-model"]).toEqual({ backend: "opencode", model: "provider/from-json" });
    expect(fromJson.agents.refine.maxSteps).toBe(4);

    fs.writeFileSync(jsonFile, JSON.stringify({ version: 1, models: {} }));
    const fallback = await loadConnectorDefinition(jsonProject);
    expect(fallback.defaultGraph).toBe("solution-lod");
    expect(fallback.models["inspect-model"]).toEqual({ backend: "opencode", model: "inherit" });

    const brokenProject = temp("opencode-langgraph-broken-");
    fs.mkdirSync(path.join(brokenProject, ".opencode"), { recursive: true });
    fs.writeFileSync(path.join(brokenProject, typedConfigFile), `import { defineOpenCodeLangGraph } from "../../some/missing/checkout/dist/index.js";\nexport default defineOpenCodeLangGraph({ version: 1, preset: "solution-lod" });\n`);
    const degraded = await loadConnectorDefinition(brokenProject);
    expect(degraded.defaultGraph).toBe("solution-lod");
    expect(degraded.graphs["solution-lod"]).toBeDefined();
  });

  it("applies per-session role assignments without changing the configured definition", async () => {
    const project = temp("solution-lod-model-proxy-");
    const definition = await loadConnectorDefinition(project);
    const assigned = withSolutionRoleModelAssignments(definition, {
      inspect: { backend: "opencode", model: "provider/fast" },
      implement: commandModel({ command: "codex", args: ["exec"] }),
    });
    expect(assigned.models["inspect-model"]).toEqual({ backend: "opencode", model: "provider/fast" });
    expect(assigned.models["implement-model"]).toEqual({ backend: "command", command: "codex", args: ["exec"] });
    expect(definition.models["inspect-model"]).toEqual({ backend: "opencode", model: "inherit" });
  });
});

describe("solution LOD reducer", () => {
  const state = (): SolutionLodState => ({
    stateVersion: 8, runId: "run", originalTask: "change", conversationContext: "prior decision", directory: "/repo", worktree: "/repo", phase: "forming-root-domain", activeBatch: [], results: [],
    network: initialNetwork("change"), usage: { turns: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }, callsUsed: 0, startedAt: 0, result: "",
  });
  const candidate = (key: string, proposition: string, outcome: "possible" | "eliminated" | "selected" | "equivalent" = "possible") => ({ key, proposition, outcome, reasons: [], evidenceRefs: [] });
  const contract = (acceptanceCriteria: string[], coveredCriteria = acceptanceCriteria.map((_, index) => index)) => ({ delivery: "change" as const, allowedVariables: [], acceptanceCriteria, coveredCriteria });
  const stateWith = (network: SolutionNetwork): SolutionLodState => ({ ...state(), network });
  const synthesisActivation = (network: SolutionNetwork, regionId: string, operation: SynthesisOperation): Activation => {
    const region = network.regions.find((item) => item.id === regionId)!;
    network.nextActivationId = Math.max(network.nextActivationId, 1_000);
    const activation: Activation = { id: `a${network.nextActivationId++}`, capability: "synthesize", operation, domainFingerprint: region.domainFingerprint, regionId, request: operation, expectedDelta: `${operation}:${regionId}:${region.domainFingerprint}`, contextRefs: [regionId], status: "running", basisRevision: network.revision };
    network.activations.push(activation); region.activationIds.push(activation.id);
    return activation;
  };
  const acceptDomain = (network: SolutionNetwork, regionId = "r1") => {
    const region = network.regions.find((item) => item.id === regionId)!;
    region.domainPhase = "challenging";
    const activation = synthesisActivation(network, regionId, "challenge-domain");
    const accepted = mergeSynthesisOutput(stateWith(network), activation.id, { operation: "challenge-domain", verdict: "accept", domainFingerprint: region.domainFingerprint!, viableCandidateIds: region.candidateIds.filter((id) => network.candidates.find((item) => item.id === id)?.status !== "eliminated") });
    accepted.activations.find((item) => item.id === activation.id)!.status = "completed";
    return accepted;
  };
  const selectDelta = (network: SolutionLodState["network"], activationId: string, ...keys: string[]) => {
    const source = network.activations.find((item) => item.id === activationId); if (source) source.status = "completed";
    const regionId = source?.regionId ?? "r1";
    let current = propagateNetwork(network);
    let region = current.regions.find((item) => item.id === regionId)!;
    if (region.candidateIds.length && !current.candidates.some((item) => item.regionId === regionId && keys.includes(item.key) && item.status !== "eliminated")) {
      current = reopenRegion(current, regionId, "test reselection");
      region = current.regions.find((item) => item.id === regionId)!;
    }
    if (!region.candidateIds.length) {
      region.status = "superposed"; region.domainPhase = "ungenerated";
      const generatedKeys = [...new Set([...keys, keys.length === 1 ? `${keys[0]}-alternative` : "alternative"])];
      const activation = synthesisActivation(current, regionId, "generate-domain");
      current = mergeSynthesisOutput(stateWith(current), activation.id, { operation: "generate-domain", evidence: [], variables: [], constraints: [], candidates: generatedKeys.map((key) => ({ key, proposition: `${key} approach`, evidenceRefs: [], stances: [] })) });
      current.activations.find((item) => item.id === activation.id)!.status = "completed";
    }
    current = acceptDomain(current, regionId);
    const live = current.regions.find((item) => item.id === regionId)!;
    const viable = live.candidateIds.filter((id) => current.candidates.find((item) => item.id === id)?.status !== "eliminated");
    const selectedId = current.candidates.find((item) => item.regionId === regionId && keys.includes(item.key))?.id ?? viable[0]!;
    const activation = synthesisActivation(current, regionId, "select-candidate");
    current = mergeSynthesisOutput(stateWith(current), activation.id, { operation: "select-candidate", domainFingerprint: live.domainFingerprint!, basis: viable.length === 1 ? "only-viable" : "lexicographic", selectedCandidateId: selectedId, hardConstraints: [], comparisons: viable.map((id) => ({ candidateId: id, userPreference: "neutral", repositoryCompatibility: "neutral", changeScope: id === selectedId ? "preferred" : "disfavored", irreversibleRisk: "neutral", evidenceRefs: [] })) });
    current.activations.find((item) => item.id === activation.id)!.status = "completed";
    return current;
  };
  const certifyLeaf = (network: SolutionNetwork, regionId = "r1") => {
    const region = network.regions.find((item) => item.id === regionId)!;
    const activation: Activation = { id: `a${network.nextActivationId++}`, capability: "refine", regionId, request: "certify", expectedDelta: `certify:${regionId}`, contextRefs: [regionId], status: "running", basisRevision: network.revision };
    network.activations.push(activation); network.regions.find((item) => item.id === regionId)!.activationIds.push(activation.id);
    return mergeRefinementOutput(network, activation.id, { evidence: [], children: [], certifiedLeaf: { implementationScope: "bounded test change", criterionIds: [...region.criterionIds], evidenceRefs: [], mutationResources: ["src/test.ts"], checks: region.criterionIds.map((criterionId) => ({ criterionId, commandOrObservation: "run focused test" })) }, activations: [] });
  };
  const pushActivation = (network: SolutionLodState["network"], capability: "synthesize" | "refine" | "inspect", regionId: string, id: string) => {
    network.activations.push({ id, capability, regionId, request: capability, expectedDelta: `${capability}:${regionId}:${id}`, contextRefs: [regionId], status: "running", basisRevision: network.revision });
    network.regions.find((region) => region.id === regionId)?.activationIds.push(id);
  };

  it("keeps a criterion-less selection unrefined until refinement splits it", () => {
    const current = state();
    let merged = mergeSolutionDelta(current, "a1", {
      region: {}, evidence: [], constraints: [], activations: [],
      candidates: [candidate("adapter", "Use an adapter"), candidate("rewrite", "Rewrite the subsystem")], select: [],
    });
    merged = selectDelta(merged, "a1", "adapter");
    expect(merged.regions.find((region) => region.id === "r1")?.status).toBe("unrefined");
    expect(merged.regions.filter((region) => region.parentId === "r1")).toHaveLength(0);
    expect(nextQueuedActivation(ensureRunnableWork(merged).network)).toMatchObject({ capability: "refine", regionId: "r1" });
  });

  it("rejects one result committing to multiple non-equivalent approaches", () => {
    const current = state();
    expect(() => validateSolutionDelta(current, "r1", {
      candidates: [candidate("inline", "Inline provenance", "selected"), candidate("grouped", "Grouped details", "selected")],
      constraints: [], evidence: [], select: ["inline", "grouped"], activations: [],
    })).toThrow(/select-candidate operation/);
    expect(() => validateSolutionDelta(current, "r1", {
      candidates: [
        candidate("left", "Left approach", "selected"),
        candidate("right", "Right approach", "selected"),
        { ...candidate("twin", "Twin of left", "selected"), key: "twin" },
      ],
      constraints: [
        { kind: "equivalent", subject: "left", target: "twin", reason: "same approach", evidenceRefs: [] },
      ], evidence: [], select: ["left", "right", "twin"], activations: [],
    })).toThrow(/select-candidate operation/);
    expect(() => validateSolutionDelta(current, "r1", {
      candidates: [
        candidate("left", "Left approach", "selected"),
        candidate("twin", "Twin of left", "selected"),
      ],
      constraints: [
        { kind: "equivalent", subject: "left", target: "twin", reason: "same approach", evidenceRefs: [] },
      ], evidence: [], select: ["left", "twin"], activations: [],
    })).toThrow(/select-candidate operation/);
  });

  it("requires a certified leaf before any selected change becomes actionable", () => {
    const current = state();
    current.network.activations[0].status = "completed";
    let merged = mergeSolutionDelta(current, "a1", {
      region: { acceptanceCriteria: ["target updated"] }, evidence: [], constraints: [], activations: [],
      candidates: [candidate("direct", "Direct change"), candidate("adapter", "Adapter change")], select: [],
    });
    merged = selectDelta(merged, "a1", "direct");
    expect(merged.regions[0]).toMatchObject({ status: "unrefined" });
    expect(nextQueuedActivation(ensureRunnableWork(merged).network)).toMatchObject({ capability: "refine", regionId: "r1" });
    merged = certifyLeaf(merged);
    expect(merged.regions[0]).toMatchObject({ status: "actionable" });
    expect(nextQueuedActivation(ensureRunnableWork(merged).network)).toMatchObject({ capability: "implement", regionId: "r1" });
  });

  it("materializes refined children, collapses the parent, and inspects each child before synthesis", () => {
    const current = state();
    current.network.regions[0].acceptanceCriteria = ["mapping explicit", "docs updated"];
    current.network.regions[0].criterionIds = ["criterion:scope:r1:0", "criterion:scope:r1:1"];
    current.network = selectDelta(current.network, "a1", "direct");
    pushActivation(current.network, "refine", "r1", "a2");
    current.network = mergeRefinementOutput(current.network, "a2", {
      evidence: [], activations: [],
      children: [
        { key: "mapping", objective: "Resolve mapping", edge: "refines", allowedVariables: ["mapping contract"], acceptanceCriteria: ["mapping is explicit"], coveredCriteria: [0] },
        { key: "docs", objective: "Update docs", edge: "partOf", allowedVariables: [], acceptanceCriteria: ["docs mention mapping"], coveredCriteria: [1] },
      ],
    });
    expect(current.network.regions.find((region) => region.id === "r1")?.status).toBe("collapsed");
    const children = current.network.regions.filter((region) => region.parentId === "r1");
    expect(children.map((region) => region.key)).toEqual(["mapping", "docs"]);
    expect(children.every((region) => region.status === "unformed" && region.lod === 1)).toBe(true);
    const scheduled = ensureRunnableWork(current.network);
    expect(nextQueuedActivation(scheduled.network)).toMatchObject({ capability: "inspect", regionId: children[0].id });
  });

  it("promotes an inspected child to synthesis only after its facts land", () => {
    const current = state();
    current.network = selectDelta(current.network, "a1", "direct");
    pushActivation(current.network, "refine", "r1", "a2");
    current.network = mergeRefinementOutput(current.network, "a2", {
      evidence: [], activations: [],
      children: [{ key: "mapping", objective: "Resolve mapping", edge: "refines", allowedVariables: [], acceptanceCriteria: [], coveredCriteria: [0] }],
    });
    const child = current.network.regions.find((region) => region.parentId === "r1")!;
    pushActivation(current.network, "inspect", child.id, "a3");
    current.network = mergeSolutionDelta(current, "a3", { region: {}, evidence: [{ text: "mapping lives in config", source: "config.ts:1", kind: "repository" }], candidates: [], constraints: [], select: [], activations: [] });
    expect(current.network.regions.find((region) => region.id === child.id)?.status).toBe("superposed");
    expect(nextQueuedActivation(ensureRunnableWork(current.network).network)).toMatchObject({ capability: "synthesize", operation: "generate-domain", regionId: child.id });
  });

  it("drops stale refinement children and the contract when synthesis chooses anew", () => {
    const current = state();
    current.network = selectDelta(current.network, "a1", "adapter");
    pushActivation(current.network, "refine", "r1", "a2");
    current.network = mergeRefinementOutput(current.network, "a2", {
      evidence: [], activations: [],
      children: [{ key: "mapping", objective: "Resolve mapping", edge: "refines", allowedVariables: [], acceptanceCriteria: [], coveredCriteria: [0] }],
    });
    current.network = selectDelta(current.network, "a1", "rewrite");
    expect(current.network.regions.filter((region) => region.parentId === "r1")).toHaveLength(0);
    expect(current.network.regions[0]).toMatchObject({ status: "unrefined" });
    expect(current.network.regions[0].selectedCandidateIds).toEqual(["r1:rewrite"]);
  });

  it("rejects refinements that do not split into covering, self-carrying children", () => {
    const current = state();
    current.network = selectDelta(current.network, "a1", "direct");
    current.network.regions[0].acceptanceCriteria = ["works", "documented"];
    expect(() => validateRefinementOutput(current, "r1", { evidence: [], children: [], activations: [] })).toThrow(/either one certified leaf contract/);
    const child = (key: string, coveredCriteria: number[], acceptanceCriteria: string[] = ["child done"]) => ({ key, objective: `${key} work`, edge: "partOf" as const, allowedVariables: [], acceptanceCriteria, coveredCriteria });
    expect(() => validateRefinementOutput(current, "r1", { evidence: [], children: [child("left", [])], activations: [] })).toThrow(/does not address any known success criterion/);
    expect(() => validateRefinementOutput(current, "r1", { evidence: [], children: [child("left", [0])], activations: [] })).toThrow(/collectively cover/);
    expect(() => validateRefinementOutput(current, "r1", { evidence: [], children: [child("left", [0]), child("left", [1])], activations: [] })).toThrow(/distinct stable name/);
    expect(() => validateRefinementOutput(current, "r1", { evidence: [], children: [child("left", [0], []), child("right", [0, 1])], activations: [] })).toThrow(/carries no success criterion/);
    expect(() => validateRefinementOutput(current, "r1", { evidence: [], children: [child("left", [0]), child("right", [1])], activations: [] })).not.toThrow();
  });

    it("collapses a repository-backed read-only answer without synthesis or a child LOD, then verifies it", () => {
    const current = state();
    const network = mergeSolutionDelta(current, "a1", {
      region: { delivery: "answer" },
      evidence: [{ text: "The marker says ready", source: "SMOKE.md:1", kind: "repository" }],
      candidates: [], constraints: [], select: [], activations: [],
      resolvedAnswer: { answer: "ready", acceptanceCriteria: ["Report the marker exactly"], evidenceRefs: ["task", "SMOKE.md:1"] },
    });
    expect(network.regions).toHaveLength(1);
    expect(network.regions[0]).toMatchObject({ delivery: "answer", status: "implemented", answer: "ready", selectedCandidateIds: ["r1:resolved-answer"] });
    expect(network.candidates[0]).toMatchObject({ status: "selected", evidenceIds: ["e1"] });
    network.activations[0].status = "completed";
    const scheduled = ensureRunnableWork(network);
    expect(scheduled.done).toBe(false);
    expect(scheduled.network.activations.at(-1)).toMatchObject({ capability: "verify", status: "queued" });
    const verified = completeVerification(scheduled.network, scheduled.network.activations.at(-1)!.id, { verdict: "pass", summary: "", findings: [], checks: [], activations: [] });
    expect(verified.regions[0].status).toBe("verified");
    expect(ensureRunnableWork(verified).done).toBe(true);
  });

  it("rejects a resolved answer that cites no real fact", () => {
    const current = state();
    expect(() => validateSolutionDelta(current, "r1", {
      region: { delivery: "answer" },
      evidence: [], candidates: [], constraints: [], select: [], activations: [],
      resolvedAnswer: { answer: "Trust me.", acceptanceCriteria: ["answered"], evidenceRefs: [] },
    })).toThrow(/cite at least one real fact/);
    expect(() => validateSolutionDelta(current, "r1", {
      region: { delivery: "answer" },
      evidence: [{ text: "fact", source: "a.ts:1", kind: "repository" }], candidates: [], constraints: [], select: [], activations: [],
      resolvedAnswer: { answer: "Grounded.", acceptanceCriteria: ["answered"], evidenceRefs: ["a.ts:1"] },
    })).toThrow(/user authority/);
    expect(() => validateSolutionDelta(current, "r1", {
      region: { delivery: "answer" },
      evidence: [{ text: "fact", source: "a.ts:1", kind: "repository" }], candidates: [], constraints: [], select: [], activations: [],
      resolvedAnswer: { answer: "Grounded.", acceptanceCriteria: ["answered"], evidenceRefs: ["task", "a.ts:1"] },
    })).not.toThrow();
  });

  it("rejects downgrading a change goal to an answer while implementation alternatives remain possible", () => {
    const current = state();
    const network = mergeSolutionDelta(current, "a1", {
      candidates: [
        { key: "left", proposition: "do it left", outcome: "possible", reasons: [], evidenceRefs: [] },
        { key: "right", proposition: "do it right", outcome: "possible", reasons: [], evidenceRefs: [] },
      ], constraints: [], evidence: [], select: [], activations: [],
    });
    expect(() => validateSolutionDelta({ ...current, network }, "r1", {
      region: { delivery: "answer" }, evidence: [], candidates: [], constraints: [], select: [], activations: [],
      resolvedAnswer: { answer: "just use left", acceptanceCriteria: ["answered"], evidenceRefs: ["task"] },
    })).toThrow(/remain possible/);
  });

  it("clears a stale conflict lock instead of letting a selected holder contest its own exclusions", () => {
    const current = state();
    let network = mergeSolutionDelta(current, "a1", {
      variables: [{ name: "provenance-surface", seedLabels: ["inline", "tree", "dedicated"] }],
      candidates: [
        { key: "inline", proposition: "Inline", outcome: "selected", reasons: [], evidenceRefs: [], stances: [{ variable: "provenance-surface", relation: "requires", valueLabel: "inline" }, { variable: "provenance-surface", relation: "excludes", valueLabel: "tree" }, { variable: "provenance-surface", relation: "excludes", valueLabel: "dedicated" }] },
        { key: "tree", proposition: "Tree", outcome: "possible", reasons: [], evidenceRefs: [], stances: [{ variable: "provenance-surface", relation: "requires", valueLabel: "tree" }] },
        { key: "dedicated", proposition: "Dedicated", outcome: "possible", reasons: [], evidenceRefs: [], stances: [{ variable: "provenance-surface", relation: "requires", valueLabel: "dedicated" }] },
      ],
      constraints: [], evidence: [], select: ["inline"], activations: [],
    });
    network = selectDelta(network, "a1", "inline");
    network = propagateNetwork(network);
    expect(network.regions[0].contradiction).toBeUndefined();
    const locked = propagateNetwork({ ...network, regions: [{ ...network.regions[0], status: "contradiction", contradiction: "Commitments conflict on shared choice: committed moves demand different options." }] });
    expect(locked.regions[0].contradiction).toBeUndefined();
    expect(locked.candidates.find((candidate) => candidate.key === "tree")?.status).toBe("eliminated");
  });

  it("rejects a standalone delivery rewrite without a resolved answer", () => {
    const current = state();
    expect(() => validateSolutionDelta(current, "r1", "synthesize", {
      region: { delivery: "answer" }, evidence: [], candidates: [], constraints: [], select: [], activations: [],
    })).toThrow(/may not rewrite the objective, delivery type/);
    expect(() => validateSolutionDelta(current, "r1", "inspect", {
      region: { delivery: "answer" }, evidence: [], candidates: [], constraints: [], select: [], activations: [],
    })).toThrow(/Delivery type may change only through/);
    expect(() => mergeSolutionDelta(current, "a1", {
      region: { delivery: "answer" }, evidence: [], candidates: [], constraints: [], select: [], activations: [],
    })).toThrow(/only valid through a complete resolvedAnswer/);
  });

  it("queues verification for a directly-resolved answer", () => {
    const current = state();
    const network = mergeSolutionDelta(current, "a1", {
      region: { delivery: "answer" },
      evidence: [{ text: "The section is already fully implemented", source: "TODO.md:1", kind: "repository" }],
      candidates: [], constraints: [], select: [], activations: [],
      resolvedAnswer: { answer: "Already complete.", acceptanceCriteria: ["confirmed implemented"], evidenceRefs: ["task", "TODO.md:1"] },
    });
    expect(network.regions[0]).toMatchObject({ delivery: "answer", status: "implemented", answer: "Already complete." });
    network.activations[0].status = "completed";
    const scheduled = ensureRunnableWork(network);
    expect(scheduled.done).toBe(false);
    expect(scheduled.network.activations.at(-1)).toMatchObject({ capability: "verify", status: "queued" });
  });

  it("allows independent regions to remain at different LODs", () => {
    const current = state();
    current.network = selectDelta(current.network, "a1", "composed");
    current.network.regions.push(
      { ...current.network.regions[0], id: "r2", key: "api", parentId: "r1", edge: "partOf" as const, lod: 1, status: "unformed" as const, candidateIds: [], selectedCandidateIds: [], artifactIds: [] },
      { ...current.network.regions[0], id: "r3", key: "storage", parentId: "r1", edge: "partOf" as const, lod: 1, status: "unformed" as const, candidateIds: [], selectedCandidateIds: [], artifactIds: [] },
    );
    const api = current.network.regions.find((region) => region.key === "api")!;
    pushActivation(current.network, "synthesize", api.id, "a99");
    current.network = selectDelta(current.network, "a99", "direct");
    expect(current.network.regions.find((region) => region.key === "api")?.status).toBe("unrefined");
    pushActivation(current.network, "refine", api.id, "a100");
    current.network = mergeRefinementOutput(current.network, "a100", { evidence: [], activations: [], children: [{ key: "ship", objective: "Ship the API work", edge: "partOf", allowedVariables: [], acceptanceCriteria: ["API works"], coveredCriteria: [0] }] });
    expect(current.network.regions.find((region) => region.key === "api")?.status).toBe("collapsed");
    expect(current.network.regions.find((region) => region.key === "ship")?.status).toBe("unformed");
    expect(current.network.regions.find((region) => region.key === "storage")?.status).toBe("unformed");
  });

  it("propagates hard refutations immediately but waits for accepted selection", () => {
    const current = state();
    const merged = mergeSolutionDelta(current, "a1", {
      region: { acceptanceCriteria: ["works"] }, evidence: [{ text: "rewrite is incompatible", source: "src/a.ts:1", kind: "repository" }], activations: [],
      candidates: [
        candidate("adapter", "Adapter"),
        candidate("rewrite", "Rewrite"),
      ], constraints: [{ kind: "refutes", subject: "e1", target: "rewrite", reason: "incompatible contract" }], select: [],
    });
    expect(merged.candidates.find((candidate) => candidate.key === "rewrite")?.status).toBe("eliminated");
    expect(merged.candidates.find((candidate) => candidate.key === "adapter")?.status).toBe("possible");
    expect(merged.regions[0].selectedCandidateIds).toEqual([]);
    const selected = selectDelta(merged, "a1", "adapter");
    expect(selected.candidates.find((candidate) => candidate.key === "adapter")?.status).toBe("selected");
    expect(selected.regions[0].status).toBe("unrefined");
  });

  it("invalidates a selected candidate whose required target is unavailable", () => {
    const current = state();
    let merged = mergeSolutionDelta(current, "a1", {
      region: { acceptanceCriteria: ["works"] },
      evidence: [{ text: "The dependency is unavailable", source: "src/dependency.ts:1", kind: "repository" }],
      candidates: [candidate("source", "Use the dependent design"), candidate("target", "Provide the dependency")],
      constraints: [
        { kind: "requires", subject: "source", target: "target", reason: "source needs target" },
        { kind: "refutes", subject: "src/dependency.ts:1", target: "target", reason: "dependency is unavailable", evidenceRefs: ["src/dependency.ts:1"] },
      ],
      select: [], activations: [],
    });
    expect(merged.candidates.find((item) => item.key === "target")?.status).toBe("eliminated");
    expect(merged.candidates.find((item) => item.key === "source")).toMatchObject({ status: "eliminated", declaredStatus: "possible" });
    expect(merged.candidates.find((item) => item.key === "source")?.eliminationReasons).toContain("source needs target");
    expect(merged.regions[0].status).toBe("contradiction");
    expect(propagateNetwork(merged)).toEqual(merged);
  });

  it("does not eliminate a refutes target when the refuting candidate is itself rejected", () => {
    const current = state();
    let merged = mergeSolutionDelta(current, "a1", {
      region: { acceptanceCriteria: ["works"] }, evidence: [{ text: "bad-a violates contract", source: "a:1", kind: "repository" }, { text: "bad-b is legacy", source: "b:1", kind: "repository" }], activations: [],
      candidates: [
        candidate("good", "Good"),
        candidate("bad-a", "Bad A"),
        candidate("bad-b", "Bad B"),
      ], constraints: [
        { kind: "refutes", subject: "bad-a", target: "good", reason: "bad-a disagrees" },
        { kind: "refutes", subject: "bad-b", target: "good", reason: "bad-b disagrees" },
        { kind: "refutes", subject: "a:1", target: "bad-a", reason: "violates contract", evidenceRefs: ["a:1"] },
        { kind: "refutes", subject: "b:1", target: "bad-b", reason: "legacy path", evidenceRefs: ["b:1"] },
      ], select: [],
    });
    expect(merged.candidates.find((candidate) => candidate.key === "good")?.status).toBe("possible");
    merged = selectDelta(merged, "a1", "good");
    expect(merged.candidates.find((candidate) => candidate.key === "good")?.status).toBe("selected");
    expect(merged.regions[0].status).toBe("unrefined");
  });

  it("still fires a refutes constraint from a non-candidate subject like task or evidence", () => {
    const current = state();
    let merged = mergeSolutionDelta(current, "a1", {
      region: { acceptanceCriteria: ["works"] }, evidence: [], activations: [],
      candidates: [
        candidate("kept", "Kept"),
        candidate("ruled-out", "Ruled out"),
      ], constraints: [{ kind: "refutes", subject: "task", target: "ruled-out", reason: "the request itself rules this out" }], select: [],
    });
    expect(merged.candidates.find((candidate) => candidate.key === "ruled-out")?.status).toBe("eliminated");
    expect(merged.candidates.find((candidate) => candidate.key === "kept")?.status).toBe("possible");
    merged = selectDelta(merged, "a1", "kept");
    expect(merged.candidates.find((candidate) => candidate.key === "kept")?.status).toBe("selected");
  });

  it("recomputes symmetric exclusion idempotently from authored candidate state", () => {
    const current = state();
    let merged = mergeSolutionDelta(current, "a1", {
      region: { acceptanceCriteria: ["works"] }, evidence: [], activations: [],
      candidates: [candidate("left", "Left"), { ...candidate("right", "Right"), outcome: "selected" }],
      constraints: [{ kind: "excludes", subject: "left", target: "right", reason: "mutually exclusive" }], select: ["right"],
    });
    expect(merged.candidates.find((item) => item.key === "left")?.status).toBe("possible");
    merged = selectDelta(merged, "a1", "right");
    expect(merged.candidates.find((item) => item.key === "left")?.status).toBe("eliminated");
    const again = propagateNetwork(merged);
    expect(again.revision).toBe(merged.revision);
    expect(again.candidates.find((item) => item.key === "left")?.eliminationReasons).toEqual(["mutually exclusive"]);
  });

  it("rejects role overreach and endpoint-invalid constraints before merge", () => {
    const current = state();
    expect(() => validateSolutionDelta(current, "r1", "inspect", {
      evidence: [], candidates: [candidate("x", "X")], constraints: [], select: [], activations: [],
    })).toThrow(/Inspection may report sourced facts/);
    expect(() => validateSolutionDelta(current, "r1", "synthesize", {
      evidence: [], candidates: [candidate("x", "X")], constraints: [{ kind: "requires", subject: "task", target: "x", reason: "invalid hard endpoint" }], select: [], activations: [],
    })).toThrow(/Invalid requires endpoints/);
  });

  it("requires observable implementation and criterion-specific verification evidence", () => {
    const current = state(); current.network.regions[0].acceptanceCriteria = ["target updated"]; current.network.regions[0].criterionIds = ["criterion:scope:r1:0"];
    current.network = certifyLeaf(selectDelta(current.network, "a1", "direct"));
    expect(() => validateImplementationOutput(current, "r1", { status: "completed", summary: "done", changedFiles: [], checks: [], activations: [] })).toThrow(/focused check/);
    expect(() => validateVerificationOutput(current, "r1", { verdict: "pass", summary: "ok", findings: [], checks: [{ name: "smoke", passed: true, evidence: "unrelated" }], activations: [] })).toThrow(/criterion-specific evidence/);
    expect(() => validateVerificationOutput(current, "r1", { verdict: "pass", summary: "ok", findings: [], checks: [{ name: "target updated", passed: true, evidence: "target updated: yes" }], completionEvidence: { implementation: "already satisfied after inspection", directTest: "focused passed", correctnessReview: "reviewed", releaseGate: "full passed", changedFiles: [], focusedTests: ["focused"], fullChecks: ["full"] }, activations: [] })).not.toThrow();
  });

  it("demotes previously selected candidates when a resolved answer lands", () => {
    const current = state();
    current.network = selectDelta(current.network, "a1", "inspect-then-split");
    const merged = mergeSolutionDelta(current, "a1", {
      region: { delivery: "answer" }, evidence: [{ text: "Already covered", source: "src/x.spec.ts:1", kind: "repository" }],
      candidates: [], constraints: [], select: [], activations: [],
      resolvedAnswer: { answer: "Already covered.", acceptanceCriteria: ["confirmed"], evidenceRefs: ["src/x.spec.ts:1"] },
    });
    const region = merged.regions[0];
    const selected = merged.candidates.filter((candidate) => candidate.regionId === region.id && candidate.status === "selected");
    expect(selected.map((candidate) => candidate.key)).toEqual(["resolved-answer"]);
    expect(merged.candidates.find((candidate) => candidate.key === "inspect-then-split")?.status).not.toBe("selected");
    expect(region.status).toBe("implemented");
  });

  it("rejects a delta that eliminates every candidate without a selection", () => {
    const current = state();
    current.network = mergeSolutionDelta(current, "a1", {
      region: { acceptanceCriteria: ["works"] }, evidence: [], activations: [],
      candidates: [
        { key: "alpha", proposition: "Alpha", outcome: "possible", reasons: [], evidenceRefs: [] },
        { key: "beta", proposition: "Beta", outcome: "possible", reasons: [], evidenceRefs: [] },
      ], constraints: [], select: [],
    });
    expect(() => validateSolutionDelta(current, current.network.regions[0].id, {
      evidence: [], constraints: [], activations: [], select: [],
      candidates: [
        { key: "alpha", proposition: "Alpha", outcome: "eliminated", reasons: ["supporting evidence misread as defeater"], evidenceRefs: [] },
        { key: "beta", proposition: "Beta", outcome: "eliminated", reasons: ["supporting evidence misread as defeater"], evidenceRefs: [] },
      ],
    })).toThrow(/cannot be directly eliminated/);
    expect(() => validateSolutionDelta(current, current.network.regions[0].id, {
      evidence: [], constraints: [], activations: [], select: ["alpha"],
      candidates: [
        { key: "alpha", proposition: "Alpha", outcome: "selected", reasons: [], evidenceRefs: [] },
        { key: "beta", proposition: "Beta", outcome: "possible", reasons: [], evidenceRefs: [] },
      ],
    })).toThrow(/select-candidate operation/);
  });

  it("rejects an all-eliminating delta even when it selects an unknown candidate key", () => {
    const current = state();
    current.network = mergeSolutionDelta(current, "a1", {
      region: { acceptanceCriteria: ["works"] }, evidence: [], activations: [], constraints: [], select: [],
      candidates: [{ key: "alpha", proposition: "Alpha", outcome: "possible", reasons: [], evidenceRefs: [] }],
    });
    expect(() => validateSolutionDelta(current, "r1", {
      evidence: [], constraints: [], activations: [], select: ["ghost"],
      candidates: [{ key: "alpha", proposition: "Alpha", outcome: "eliminated", reasons: ["misread defeater"], evidenceRefs: [] }],
    })).toThrow(/select-candidate operation/);
    expect(() => validateSolutionDelta(current, "r1", {
      evidence: [], constraints: [], activations: [], select: ["alpha"],
      candidates: [{ key: "alpha", proposition: "Alpha", outcome: "eliminated", reasons: ["misread defeater"], evidenceRefs: [] }],
    })).toThrow(/select-candidate operation/);
  });

  it("resynthesizes a pruned region even when its completed synthesis activation survives", () => {
    const current = state();
    current.network = mergeSolutionDelta(current, "a1", {
      region: { acceptanceCriteria: ["works"] }, evidence: [], constraints: [], activations: [], select: [],
      candidates: [
        { key: "alpha", proposition: "Alpha", outcome: "possible", reasons: [], evidenceRefs: [] },
        { key: "beta", proposition: "Beta", outcome: "possible", reasons: [], evidenceRefs: [] },
      ],
    });
    // Legacy end-state: the region's synthesis completed, then every candidate was eliminated.
    current.network.activations.push({ id: "a9", capability: "synthesize", regionId: "r1", request: "form domain", expectedDelta: "synthesis:r1", contextRefs: ["r1"], status: "completed", basisRevision: current.network.revision });
    for (const candidate of current.network.candidates) candidate.status = "eliminated";
    // Simulate pruneRun: reopen the region, keep only its completed activations, clear its activation list.
    const reopened = reopenRegion(current.network, "r1", "pruned for resynthesis");
    const pruned = {
      ...reopened,
      activations: reopened.activations.filter((item) => item.regionId !== "r1" || item.status === "completed"),
      regions: reopened.regions.map((item) => item.id === "r1" ? { ...item, activationIds: [] } : item),
    };
    const scheduled = ensureRunnableWork(pruned);
    expect(scheduled.blocked).toBeUndefined();
    expect(nextQueuedActivation(scheduled.network)).toMatchObject({ capability: "synthesize", regionId: "r1" });
  });

  it("canonicalizes region-prefixed candidate keys and rejects dangling constraints", () => {
    const current = state();
    expect(() => mergeSolutionDelta(current, "a1", {
      region: { acceptanceCriteria: ["works"] }, evidence: [], activations: [],
      candidates: [{ key: "r1:direct", proposition: "Direct extension", outcome: "selected", reasons: [], evidenceRefs: [] }],
      constraints: [{ kind: "requires", subject: "imaginary-subject", target: "imaginary-target", reason: "decorative prose" }],
      select: ["r1:direct"],
    })).toThrow(/unknown endpoint/);
    expect(() => mergeSolutionDelta(current, "a1", {
      region: {}, evidence: [], candidates: [], select: [], activations: [],
      constraints: [{ kind: "acceptance", subject: "task", target: "task", reason: "inert" } as never],
    })).toThrow(/Unknown constraint kind/);
    expect(current.network.candidates).toEqual([]);
  });

  it("never makes a bare selection actionable without a certified refinement", () => {
    const current = state();
    const network = selectDelta(current.network, "a1", "direct");
    expect(network.regions[0]).toMatchObject({ status: "unrefined" });
    expect(nextQueuedActivation(ensureRunnableWork(network).network)).toMatchObject({ capability: "refine" });
  });

  it("ignores resolvedAnswer injected into a change-delivery synthesis delta", () => {
    const current = state();
    current.network.regions[0].acceptanceCriteria = ["files change"];
    current.network.regions[0].criterionIds = ["criterion:scope:r1:0"];
    current.network = selectDelta(current.network, "a1", "direct");
    const network = mergeSolutionDelta({ ...current, network: current.network }, current.network.activations.at(-1)!.id, {
      region: { delivery: "change" }, evidence: [], constraints: [], activations: [], select: [], candidates: [],
      resolvedAnswer: { answer: "Here is a plan", acceptanceCriteria: ["describe it"], evidenceRefs: [] },
    });
    expect(network.regions[0]).toMatchObject({ delivery: "change", status: "unrefined", selectedCandidateIds: ["r1:direct"] });
    expect(network.regions[0].answer).toBeUndefined();
  });

  it("reopens one implicated region while preserving sibling verification and artifacts", () => {
    const network = initialNetwork("change");
    network.regions.push(
      { ...network.regions[0], id: "r2", key: "left", parentId: "r1", edge: "partOf", lod: 1, status: "verified", artifactIds: ["x1"], activationIds: [], candidateIds: [], selectedCandidateIds: [] },
      { ...network.regions[0], id: "r3", key: "right", parentId: "r1", edge: "partOf", lod: 1, status: "verified", artifactIds: ["x2"], activationIds: [], candidateIds: ["r3:choice"], selectedCandidateIds: ["r3:choice"] },
    );
    network.candidates.push({ id: "r3:choice", regionId: "r3", key: "choice", proposition: "choice", status: "selected", evidenceIds: [], eliminationReasons: [] });
    network.artifacts.push({ id: "x1", regionId: "r2", kind: "file", path: "left.ts", summary: "left", activationId: "a1" }, { id: "x2", regionId: "r3", kind: "file", path: "right.ts", summary: "right", activationId: "a1" });
    const reopened = reopenRegion(network, "r3", "criterion failed");
    expect(reopened.regions.find((region) => region.id === "r2")?.status).toBe("verified");
    expect(reopened.regions.find((region) => region.id === "r3")?.status).toBe("unformed");
    expect(reopened.artifacts.map((artifact) => artifact.path)).toEqual(["left.ts", "right.ts"]);
  });

  it("schedules the frontier by viable-domain size, deepest first on ties", () => {
    const network = initialNetwork("task");
    network.activations[0].status = "completed";
    network.regions[0].status = "collapsed";
    network.regions[0].domainPhase = "selected";
    network.regions[0].acceptanceCriteria = ["settled"];
    for (const [id, key, viableCount, lod] of [["r2", "wide", 4, 0], ["r3", "narrow", 2, 0], ["r4", "deep-tie", 3, 2], ["r5", "shallow-tie", 3, 1]] as const) {
      network.regions.push({ ...network.regions[0], id, key, scopeId: `scope:${id}`, parentId: "r1", edge: "partOf", lod, objective: key, delivery: "change", allowedVariables: [], acceptanceCriteria: [], status: "superposed", domainPhase: "challenging", candidateIds: [], selectedCandidateIds: [], constraintIds: [], evidenceIds: [], activationIds: [], artifactIds: [] });
      for (let index = 0; index < viableCount; index += 1) {
        const candidateId = `${id}:c${index}`;
        network.candidates.push({ id: candidateId, regionId: id, key: `c${index}`, proposition: `option ${index}`, status: "possible", evidenceIds: [], eliminationReasons: [], stances: [] });
        network.regions.find((region) => region.id === id)!.candidateIds.push(candidateId);
      }
    }
    // One pass, width 4: narrow first (viable 2), tie broken by depth (r4 before r5), wide last.
    const scheduled = ensureRunnableWork(network, 4);
    expect(scheduled.network.activations.filter((item) => item.status === "queued").slice(-4).map((item) => item.regionId)).toEqual(["r3", "r4", "r5", "r2"]);
  });

  it("projects shared choices with bindings and refuted options into activation payloads", () => {
    const current = state();
    current.network.variables.push({ id: "v1", name: "http-client", ownerRegionId: "r1", seedLabels: ["undici", "node-fetch"] });
    current.network.evidence.push({ id: "e7", text: "repo standardizes on undici", source: "src/http.ts:1", kind: "repository", fingerprint: "f7" }, { id: "e8", text: "unrelated fact", source: "other.ts:1", kind: "repository", fingerprint: "f8" });
    current.network.constraints.push({ id: "c7", kind: "refutes", subject: "e7", target: "v1:node-fetch", reason: "conflicts with repo standard", sourceActivationId: "a1", sourceKind: "repo-evidence", evidenceRefs: ["e7"] });
    current.network.regions[0].evidenceIds.push("e7");
    current.network.activations[0].contextRefs.push("e7");
    const projection = projectActivationContext(current, current.network.activations[0]) as { variableStates: unknown[] };
    expect(projection.variableStates).toEqual([{
      id: "v1", name: "http-client", declaredAt: "r1", knownLabels: ["undici", "node-fetch"], binding: undefined, bindingWitnesses: [], bindingConflict: undefined,
      unavailableLabels: ["node-fetch"], unavailabilityWitnesses: [{ valueLabel: "node-fetch", constraintId: "c7", relationship: "refutes", evidenceRefs: ["e7"], reason: "conflicts with repo standard" }],
    }]);
  });

  it("projects every conflicting binding witness instead of overwriting one", () => {
    const current = state();
    current.network.variables.push({ id: "v1", name: "runtime", ownerRegionId: "r1", seedLabels: ["node", "bun"] });
    current.network.candidates.push(
      { id: "r1:node", regionId: "r1", key: "node", proposition: "Node", status: "selected", declaredStatus: "selected", evidenceIds: [], eliminationReasons: [], stances: [{ variableId: "v1", relation: "requires", valueLabel: "node" }] },
      { id: "r1:bun", regionId: "r1", key: "bun", proposition: "Bun", status: "selected", declaredStatus: "selected", evidenceIds: [], eliminationReasons: [], stances: [{ variableId: "v1", relation: "requires", valueLabel: "bun" }] },
    );
    current.network.regions[0].candidateIds = ["r1:node", "r1:bun"];
    current.network.regions[0].selectedCandidateIds = ["r1:node", "r1:bun"];
    const projection = projectActivationContext(current, current.network.activations[0]) as { variableStates: Array<{ binding?: string; bindingConflict?: string[]; bindingWitnesses: Array<{ candidateId: string }> }> };
    expect(projection.variableStates[0].binding).toBeUndefined();
    expect(projection.variableStates[0].bindingConflict).toEqual(["bun", "node"]);
    expect(projection.variableStates[0].bindingWitnesses.map((item) => item.candidateId)).toEqual(["r1:bun", "r1:node"]);
  });

  it("projects only referenced context and the collapsed ancestry", () => {
    const current = state();
    current.network.evidence.push({ id: "e1", text: "relevant", source: "a.ts", kind: "repository", fingerprint: "1" }, { id: "e2", text: "unrelated", source: "b.ts", kind: "repository", fingerprint: "2" });
    current.network.regions[0].evidenceIds.push("e1");
    current.network.activations[0].contextRefs.push("e1");
    for (let index = 0; index < 300; index += 1) {
      const suffix = String(index);
      current.network.evidence.push({ id: `noise-e${suffix}`, text: `unrelated fact ${suffix}`, source: `noise/${suffix}.ts:1`, kind: "repository", fingerprint: `ne${suffix}` });
      current.network.artifacts.push({ id: `noise-x${suffix}`, regionId: "r1", kind: "file", path: `noise/${suffix}.txt`, summary: `unrelated ${suffix}`, activationId: "a1" });
    }
    const projection = JSON.stringify(projectActivationContext(current, current.network.activations[0]));
    expect(projection).toContain("prior decision");
    expect(projection).toContain("relevant");
    expect(projection).not.toContain("unrelated");
    expect(projection.length, "projection must stay bounded by references, not by network size").toBeLessThan(JSON.stringify(current.network).length / 3);
    expect(projection).not.toContain("nextActivationId");
  });

  it("gives agents concise role-native instructions instead of controller vocabulary", () => {
    for (const contract of Object.values(SOLUTION_ROLE_CONTRACTS)) {
      expect(contract.systemPrompt).not.toMatch(/\b(?:LOD|ancestry|region|collapsed|domain|activation|allowedVariables)\b/i);
      expect(contract.systemPrompt.length).toBeLessThan(1_100);
    }
    const current = state();
    current.network.regions[0].acceptanceCriteria = ["target behavior works"];
    current.network.regions[0].criterionIds = ["criterion:scope:r1:0"];
    current.network.candidates.push({ id: "r1:direct", regionId: "r1", key: "direct", proposition: "Extend the existing implementation", status: "selected", evidenceIds: [], eliminationReasons: [] });
    current.network.regions[0].candidateIds = ["r1:direct"];
    current.network.regions[0].selectedCandidateIds = ["r1:direct"];
    const implement = { ...current.network.activations[0], capability: "implement" as const, request: "Implement the selected behavior" };
    const projection = projectActivationContext(current, implement);
    expect(projection).toMatchObject({
      goal: "change",
      successCriteria: [{ criterionId: "criterion:scope:r1:0", criterion: "target behavior works" }],
      chosenApproach: [{ regionId: "r1", scopeId: "scope:r1", candidateId: "r1:direct", choice: "Extend the existing implementation", evidenceIds: [] }],
    });
    expect(projection).not.toHaveProperty("decisionsAlreadyMade");
    expect(projection).not.toHaveProperty("region");
    expect(projection).not.toHaveProperty("collapsedAncestry");
    expect(projection).not.toHaveProperty("domain");
    expect(projection).not.toHaveProperty("availableCapabilities");
  });

  it("compiles confirmed facts and unresolved claims into different operational permissions", () => {
    const current = state();
    current.network.evidence.push(
      { id: "e1", text: "package pins Node 20", source: "package.json:4", kind: "repository", status: "confirmed", fingerprint: "f1" },
      { id: "e2", text: "Node 16 may be unsupported", source: "model", kind: "inference", status: "hypothesis", validationKind: "repository-evidence", fingerprint: "f2" },
    );
    current.network.activations[0].contextRefs.push("e1", "e2");
    const compiled = compileActivationPrompt(current, { ...current.network.activations[0], capability: "synthesize" });
    expect(compiled).toContain("CONFIRMED FACTS");
    expect(compiled).toContain("package pins Node 20");
    expect(compiled).toContain("UNRESOLVED CLAIMS — NO PRUNING AUTHORITY");
    expect(compiled).toContain("Node 16 may be unsupported");
    expect(compiled).toContain("generation, challenge, and selection are exclusive");
    expect(compiled).toContain("Never self-approve");
    expect(compiled).not.toContain("nextActivationId");
  });

  it("keeps compiled prompts bounded when unrelated graph state grows", () => {
    const current = state();
    const activation = current.network.activations[0];
    const before = compileActivationPrompt(current, activation);
    for (let index = 0; index < 300; index++) current.network.evidence.push({ id: `noise-${index}`, text: `noise ${index}`, source: `noise/${index}`, kind: "repository", fingerprint: `n${index}` });
    expect(compileActivationPrompt(current, activation)).toBe(before);
  });

  it("preserves user wording while keeping the same local operation contract", () => {
    const left = state(); const right = state();
    left.originalTask = "Add a cache without changing deployment";
    right.originalTask = "Introduce caching while preserving the deployment topology";
    const leftPrompt = compileActivationPrompt(left, left.network.activations[0]);
    const rightPrompt = compileActivationPrompt(right, right.network.activations[0]);
    expect(leftPrompt).toContain(left.originalTask);
    expect(rightPrompt).toContain(right.originalTask);
    expect(leftPrompt).toContain("inspect: Find repository facts needed");
    expect(rightPrompt).toContain("inspect: Find repository facts needed");
  });

  it("compiles a bounded operational contract for every role", () => {
    const current = state();
    current.network.regions[0].acceptanceCriteria = ["criterion zero"];
    current.network.candidates.push({ id: "r1:a", regionId: "r1", key: "a", proposition: "Existing approach", status: "possible", evidenceIds: [], eliminationReasons: [], stances: [] });
    current.network.regions[0].candidateIds.push("r1:a");
    current.network.artifacts.push({ id: "x1", regionId: "r1", kind: "file", path: "src/a.ts", summary: "implemented output", activationId: "a0" });
    current.network.activations[0].contextRefs.push("x1");
    for (const capability of ["inspect", "synthesize", "refine", "implement", "verify", "present"] as const) {
      const compiled = compileActivationPrompt(current, { ...current.network.activations[0], capability });
      expect(compiled).toContain(`LOCAL OPERATION\n${capability}:`);
      expect(compiled).toContain("DECISION BOUNDARY");
      expect(compiled).toContain("DATA BOUNDARY");
      expect(compiled).toContain("Return exactly one JSON value");
      expect(compiled.length).toBeLessThan(3500);
      expect(compiled).toContain(`LOCAL OPERATION\n${capability}:`);
      if (capability === "synthesize") expect(compiled).toContain("CURRENT ALTERNATIVES\n[{\"referenceId\":\"r1:a\"");
      if (capability === "refine") { expect(compiled).toContain("NUMBERED PARENT CRITERIA"); expect(compiled).toContain("ONE-LEVEL DECOMPOSITION CONTRACT"); }
      if (capability === "implement" || capability === "verify" || capability === "present") expect(compiled).toContain("implemented output");
    }
  });

  it("forms an unformed region by inspection before synthesis, then reports convergence instead of looping", () => {
    const network = initialNetwork("change");
    network.activations[0].status = "completed";
    network.regions[0].status = "superposed";
    network.regions[0].domainPhase = "ungenerated";
    const first = ensureRunnableWork(network);
    expect(first.network.activations.at(-1)).toMatchObject({ capability: "synthesize", operation: "generate-domain", status: "queued" });
    first.network.activations.at(-1)!.status = "completed";
    const second = ensureRunnableWork(first.network);
    expect(second.blocked).toContain("No activation can make a novel state delta");
    expect(second.network.activations).toHaveLength(2);
  });

  it("schedules inspection for an unformed region before any synthesis", () => {
    const current = state();
    current.network.activations[0].status = "completed";
    const scheduled = ensureRunnableWork(current.network);
    expect(scheduled.done).toBe(false);
    expect(nextQueuedActivation(scheduled.network)).toMatchObject({ capability: "inspect", regionId: "r1" });
  });

  it("reschedules a failed implement activation instead of dead-ending", () => {
    let network = initialNetwork("change");
    network.regions[0].acceptanceCriteria = ["works"]; network.regions[0].criterionIds = ["criterion:scope:r1:0"];
    network = certifyLeaf(selectDelta(network, "a1", "direct"));
    network.activations.push({ id: "a2", capability: "implement", regionId: "r1", request: "implement", expectedDelta: `implement:r1:${network.revision}`, contextRefs: ["r1"], status: "failed", basisRevision: network.revision });
    const scheduled = ensureRunnableWork(network);
    expect(scheduled.done).toBe(false);
    expect(scheduled.network.regions[0].status).toBe("actionable");
    expect(scheduled.network.activations.at(-1)).toMatchObject({ capability: "implement", status: "queued" });
  });

  it("collapses an equivalent surviving set as one implementer-local choice", () => {
    const current = state();
    let network = mergeSolutionDelta(current, "a1", {
      region: { acceptanceCriteria: ["behavior is equivalent"] }, evidence: [], activations: [],
      candidates: [
        { key: "a", proposition: "Equivalent implementation A", outcome: "possible", reasons: [], evidenceRefs: [] },
        { key: "b", proposition: "Equivalent implementation B", outcome: "possible", reasons: [], evidenceRefs: [] },
      ], constraints: [{ kind: "equivalent", subject: "a", target: "b", reason: "same external contract" }], select: [],
    });
    network = certifyLeaf(selectDelta(network, "a1", "a"));
    expect(network.regions[0]).toMatchObject({ status: "actionable", selectedCandidateIds: ["r1:a", "r1:b"] });
  });

  it("rejects multiple selected non-equivalent alternatives before merge", () => {
    const current = state();
    current.network.regions[0].acceptanceCriteria = ["one coherent design"];
    current.network.regions[0].criterionIds = ["criterion:scope:r1:0"];
    expect(() => validateSolutionDelta(current, "r1", "synthesize", {
      region: { acceptanceCriteria: ["one coherent design"] }, evidence: [], constraints: [], activations: [],
      candidates: [
        { key: "event-shape", proposition: "Choose an event shape", outcome: "selected", reasons: [], evidenceRefs: [] },
        { key: "duplicate-policy", proposition: "Choose a duplicate policy", outcome: "selected", reasons: [], evidenceRefs: [] },
      ], select: ["event-shape", "duplicate-policy"],
    })).toThrow(/select-candidate operation/);
  });

  it("gives fail distinct blocked semantics instead of silently reopening a choice", () => {
    const network = initialNetwork("change");
    network.activations[0].status = "completed";
    network.regions[0].status = "implemented";
    network.regions[0].candidateIds = ["r1:choice", "r1:alt"];
    network.regions[0].selectedCandidateIds = ["r1:choice"];
    network.candidates.push(
      { id: "r1:choice", regionId: "r1", key: "choice", proposition: "chosen approach", status: "selected", evidenceIds: [], eliminationReasons: [] },
      { id: "r1:alt", regionId: "r1", key: "alt", proposition: "alternative approach", status: "possible", evidenceIds: [], eliminationReasons: [] },
    );
    network.activations.push({ id: "a2", capability: "verify", regionId: "r1", request: "verify", expectedDelta: "verification:r1", contextRefs: ["r1"], status: "running", basisRevision: 0 });
    const verified = completeVerification(network, "a2", { verdict: "fail", summary: "evidence contradicts the design", findings: [], checks: [], activations: [] });
    expect(verified.regions[0].status).toBe("blocked");
    expect(verified.regions[0].contradiction).toContain("evidence contradicts");
    const scheduled = ensureRunnableWork(verified);
    expect(scheduled.done).toBe(false);
    expect(scheduled.blocked).toContain("evidence contradicts the design");
  });

  it("treats transitively chained equivalence as one interchangeable set", () => {
    const current = state();
    let network = mergeSolutionDelta(current, "a1", {
      region: { acceptanceCriteria: ["one behavior"] }, evidence: [], activations: [],
      candidates: [
        { key: "a", proposition: "A", outcome: "possible", reasons: [], evidenceRefs: [] },
        { key: "b", proposition: "B", outcome: "possible", reasons: [], evidenceRefs: [] },
        { key: "c", proposition: "C", outcome: "possible", reasons: [], evidenceRefs: [] },
      ],
      constraints: [{ kind: "equivalent", subject: "a", target: "b", reason: "same" }, { kind: "equivalent", subject: "b", target: "c", reason: "same" }],
      select: [],
    });
    network = certifyLeaf(selectDelta(network, "a1", "a"));
    expect(network.regions[0].status).not.toBe("contradiction");
    expect(network.regions[0]).toMatchObject({ status: "actionable", selectedCandidateIds: ["r1:a", "r1:b", "r1:c"] });
  });

  it("rejects duplicate candidate keys and normalized proposition/stance identities", () => {
    const current = state();
    expect(() => mergeSolutionDelta(current, "a1", {
      region: { acceptanceCriteria: ["works"] }, evidence: [], activations: [],
      candidates: [
        { key: "auth service", proposition: "Auth service", outcome: "possible", reasons: [], evidenceRefs: [] },
        { key: "auth-service", proposition: "Auth service, refined", outcome: "possible", reasons: [], evidenceRefs: [] },
      ], constraints: [], select: [],
    })).toThrow(/duplicates another candidate key/);
    expect(() => mergeSolutionDelta(current, "a1", {
      region: { acceptanceCriteria: ["works"] }, evidence: [], activations: [],
      candidates: [
        { key: "first", proposition: "Use the existing auth service.", outcome: "possible", reasons: [], evidenceRefs: [] },
        { key: "renamed", proposition: "use the existing AUTH service", outcome: "possible", reasons: [], evidenceRefs: [] },
      ], constraints: [], select: [],
    })).toThrow(/duplicates established candidate/);
    expect(current.network.candidates).toEqual([]);
  });

  it("keeps the same proposition distinct when its normalized stances differ", () => {
    const current = state();
    const network = mergeSolutionDelta(current, "a1", {
      region: { acceptanceCriteria: ["works"] }, evidence: [], activations: [], select: [], constraints: [],
      variables: [{ name: "runtime", seedLabels: ["node", "bun"] }],
      candidates: [
        { key: "node", proposition: "Use the selected runtime", outcome: "possible", reasons: [], evidenceRefs: [], stances: [{ variable: "runtime", relation: "requires", valueLabel: "node" }] },
        { key: "bun", proposition: "Use the selected runtime", outcome: "possible", reasons: [], evidenceRefs: [], stances: [{ variable: "runtime", relation: "requires", valueLabel: "bun" }] },
      ],
    });
    expect(network.candidates).toHaveLength(2);
  });

  it("deduplicates constraints by operative identity instead of paraphrased reason text", () => {
    const current = state();
    const network = mergeSolutionDelta(current, "a1", {
      region: { acceptanceCriteria: ["works"] },
      evidence: [{ text: "API already exports x", source: "src/api.ts:1", kind: "repository" }],
      candidates: [{ key: "reuse", proposition: "Reuse the API", outcome: "possible", reasons: [], evidenceRefs: [] }],
      constraints: [
        { kind: "supports", subject: "src/api.ts:1", target: "reuse", reason: "The export exists", sourceKind: "repo-evidence", evidenceRefs: ["src/api.ts:1"] },
        { kind: "supports", subject: "src/api.ts:1", target: "reuse", reason: "Existing API export supports reuse", sourceKind: "repo-evidence", evidenceRefs: ["src/api.ts:1"] },
        { kind: "supports", subject: "src/api.ts:1", target: "reuse", reason: "Reuse is supported by that export", sourceKind: "repo-evidence", evidenceRefs: ["src/api.ts:1"] },
      ],
      select: [], activations: [],
    });
    expect(network.constraints).toHaveLength(1);
    expect(network.constraints[0]).toMatchObject({ kind: "supports", subject: "e1", target: "r1:reuse", evidenceRefs: ["e1"] });
    expect(network.regions[0].constraintIds).toEqual([network.constraints[0].id]);
  });

  it("batches queued read-only activations on pairwise distinct regions and keeps mutating work singleton", () => {
    const network = initialNetwork("task");
    for (const id of ["r2", "r3"]) network.regions.push({ ...network.regions[0], id, key: id, scopeId: `scope:${id}`, parentId: "r1", edge: "partOf", lod: 1, objective: id, delivery: "change", allowedVariables: [], acceptanceCriteria: [], status: "unformed", domainPhase: "inspecting", candidateIds: [], selectedCandidateIds: [], constraintIds: [], evidenceIds: [], activationIds: [], artifactIds: [] });
    const queued = (id: string, capability: Activation["capability"], regionId: string, basisRevision = 0) => network.activations.push({ id, capability, regionId, request: id, expectedDelta: id, contextRefs: [regionId], status: "queued", basisRevision });
    queued("a2", "inspect", "r2"); queued("a3", "inspect", "r3"); queued("a4", "synthesize", "r1"); queued("a5", "implement", "r3", 1);
    expect(selectActivationBatch(network, 4).map((item) => item.id)).toEqual(["a1", "a2", "a3"]);
    expect(selectActivationBatch(network, 2).map((item) => item.id)).toEqual(["a1", "a2"]);
    for (const item of network.activations) item.status = "completed";
    queued("a9", "implement", "r1", 5); queued("a10", "inspect", "r2", 5);
    network.regions[0].status = "actionable";
    expect(selectActivationBatch(network, 4).map((item) => item.id)).toEqual(["a9"]);
  });

  it("applies batch records in (basisRevision, activationId) order regardless of completion order", () => {
    const network = initialNetwork("task");
    network.activations.push({ id: "a2", capability: "inspect", regionId: "r1", request: "a2", expectedDelta: "a2", contextRefs: ["r1"], status: "running", basisRevision: 1 });
    const record = (activationId: string, basisRevision: number, text: string): ActivationTaskResult => ({
      activationId, regionId: "r1", capability: "inspect", basisRevision, startedAt: 0, finishedAt: 0,
      usage: { turns: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
      outcome: "applied", networkDelta: { kind: "delta", delta: { evidence: [{ text, source: text, kind: "repository" }], candidates: [], constraints: [], select: [], activations: [] } },
    });
    const application = applyBatchRecords(network, [record("a2", 1, "second"), record("a1", 0, "first")]);
    expect(application.applied).toEqual(["a1", "a2"]);
    expect(application.network.evidence.map((item) => item.text)).toEqual(["first", "second"]);
    expect(application.network.activations.filter((item) => ["a1", "a2"].includes(item.id)).map((item) => item.status)).toEqual(["completed", "completed"]);
  });

  it("propagates a failed activation record and clears a stale commitment-conflict lock", () => {
    const network = initialNetwork("task");
    network.activations[0].status = "running";
    network.variables.push({ id: "v1", name: "runtime", ownerRegionId: "r1", seedLabels: ["node", "bun"] });
    network.candidates.push(
      { id: "r1:node", regionId: "r1", key: "node", proposition: "Use Node", status: "selected", declaredStatus: "selected", evidenceIds: [], declaredEvidenceIds: [], eliminationReasons: [], declaredEliminationReasons: [], stances: [{ variableId: "v1", relation: "requires", valueLabel: "node" }] },
      { id: "r1:bun", regionId: "r1", key: "bun", proposition: "Use Bun", status: "eliminated", declaredStatus: "possible", evidenceIds: [], declaredEvidenceIds: [], eliminationReasons: ["refuted"], declaredEliminationReasons: [], stances: [{ variableId: "v1", relation: "requires", valueLabel: "bun" }] },
    );
    network.regions[0].candidateIds = ["r1:node", "r1:bun"];
    network.regions[0].selectedCandidateIds = ["r1:node"];
    network.regions[0].status = "contradiction";
    network.regions[0].contradiction = "Commitments conflict on shared choice: stale";
    const failed: ActivationTaskResult = {
      activationId: "a1", regionId: "r1", capability: "inspect", basisRevision: 0, startedAt: 0, finishedAt: 1,
      usage: { turns: 1, input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }, outcome: "error", error: "invalid output", networkDelta: null,
    };
    const application = applyBatchRecords(network, [failed]);
    expect(application.failed).toEqual(["a1"]);
    expect(application.network.regions[0].contradiction).toBeUndefined();
    expect(application.network.regions[0].status).not.toBe("contradiction");
  });

  it("does not retain a conflict lock when confirmed evidence kills one binder in the same propagation", () => {
    const network = initialNetwork("task");
    network.variables.push({ id: "v1", name: "runtime", ownerRegionId: "r1", seedLabels: ["node", "bun"] });
    network.evidence.push({ id: "e1", text: "Bun is unavailable", source: "tool", kind: "tool", fingerprint: "bun-unavailable" });
    network.candidates.push(
      { id: "r1:node", regionId: "r1", key: "node", proposition: "Use Node", status: "selected", declaredStatus: "selected", evidenceIds: [], eliminationReasons: [], stances: [{ variableId: "v1", relation: "requires", valueLabel: "node" }] },
      { id: "r1:bun", regionId: "r1", key: "bun", proposition: "Use Bun", status: "selected", declaredStatus: "selected", evidenceIds: [], eliminationReasons: [], stances: [{ variableId: "v1", relation: "requires", valueLabel: "bun" }] },
    );
    network.constraints.push({ id: "c1", kind: "refutes", subject: "e1", target: "r1:bun", reason: "runtime unavailable", sourceActivationId: "a1", sourceKind: "repo-evidence", evidenceRefs: ["e1"] });
    network.regions[0].candidateIds = ["r1:node", "r1:bun"];
    network.regions[0].selectedCandidateIds = ["r1:node", "r1:bun"];
    const accepted = acceptDomain(propagateNetwork(network));
    for (const candidate of accepted.candidates) if (candidate.regionId === "r1") { candidate.status = "selected"; candidate.declaredStatus = "selected"; }
    accepted.regions[0].selectedCandidateIds = ["r1:node", "r1:bun"];
    const propagated = propagateNetwork(accepted);
    expect(propagated.candidates.find((item) => item.id === "r1:bun")?.status).toBe("eliminated");
    expect(propagated.regions[0].contradiction).toBeUndefined();
    expect(propagated.regions[0].selectedCandidateIds).toEqual(["r1:node"]);
  });

  it("marks a record superseded when its region disappeared from the current solution", () => {
    const network = mergeSolutionDelta(state(), "a1", {
      region: { acceptanceCriteria: ["works"] }, evidence: [], activations: [],
      candidates: [{ key: "only", proposition: "Only path", outcome: "selected", reasons: [], evidenceRefs: [] }], constraints: [], select: ["only"],
    });
    network.activations[0].status = "completed";
    network.activations.push({ id: "a9", capability: "refine", regionId: "r1", request: "split", expectedDelta: "refine:r1", contextRefs: ["r1"], status: "running", basisRevision: network.revision });
    const split = mergeRefinementOutput(network, "a9", { evidence: [], activations: [], children: [{ key: "child", objective: "Child work", edge: "partOf", allowedVariables: [], acceptanceCriteria: [], coveredCriteria: [0] }] });
    const child = split.regions.find((item) => item.key === "child")!;
    split.activations.push({ id: "a2", capability: "inspect", regionId: child.id, request: "a2", expectedDelta: "a2", contextRefs: [child.id], status: "running", basisRevision: split.revision });
    const reopened = reopenRegion(split, split.regions[0].id, "contradiction");
    const record: ActivationTaskResult = {
      activationId: "a2", regionId: child.id, capability: "inspect", basisRevision: 1, startedAt: 0, finishedAt: 0,
      usage: { turns: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
      outcome: "applied", networkDelta: { kind: "delta", delta: { evidence: [{ text: "late", source: "late", kind: "repository" }], candidates: [], constraints: [], select: [], activations: [] } },
    };
    const application = applyBatchRecords(reopened, [record]);
    expect(application.superseded).toEqual(["a2"]);
    expect(application.applied).toEqual([]);
    expect(application.network.activations.find((item) => item.id === "a2")?.status).toBe("superseded");
    expect(application.network.evidence.some((item) => item.text === "late")).toBe(false);
  });

  it("frees an activation signature for requeueing after supersede or failure", () => {
    const current = state();
    const network = mergeSolutionDelta(current, "a1", {
      region: { acceptanceCriteria: ["works"] }, evidence: [], activations: [],
      candidates: [{ key: "left", proposition: "Left", outcome: "selected", reasons: [], evidenceRefs: [] }], constraints: [], select: ["left"],
    });
    network.activations[0].status = "completed";
    network.activations.push({ id: "a9", capability: "synthesize", regionId: "r1", request: "again", expectedDelta: "novel:r1", contextRefs: ["r1"], status: "superseded", basisRevision: 0 });
    expect(ensureRunnableWork(network).done).toBe(false);
  });

  it("retains the workspace mutation of a failed implement record and blocks its region", () => {
    const network = mergeSolutionDelta(state(), "a1", {
      region: { acceptanceCriteria: ["works"] }, evidence: [], activations: [],
      candidates: [{ key: "direct", proposition: "Direct", outcome: "selected", reasons: [], evidenceRefs: [] }], constraints: [], select: ["direct"],
    });
    network.activations.push({ id: "a2", capability: "implement", regionId: "r1", request: "a2", expectedDelta: "a2", contextRefs: ["r1"], status: "running", basisRevision: network.revision });
    network.regions[0].status = "implementing";
    const record: ActivationTaskResult = {
      activationId: "a2", regionId: "r1", capability: "implement", basisRevision: network.revision, startedAt: 0, finishedAt: 0,
      usage: { turns: 1, input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
      outcome: "error", error: "invalid structured output", changedFiles: ["target.txt"], networkDelta: null,
    };
    const application = applyBatchRecords(network, [record]);
    expect(application.failed).toEqual(["a2"]);
    expect(application.network.activations.find((item) => item.id === "a2")?.status).toBe("failed");
    expect(application.network.artifacts.some((item) => item.kind === "file" && item.path === "target.txt")).toBe(true);
  });

  const actionableSingleChoice = () => {
    const network = initialNetwork("change");
    network.activations[0].status = "completed";
    const region = network.regions[0];
    region.status = "actionable"; region.candidateIds = ["r1:direct"]; region.selectedCandidateIds = ["r1:direct"]; region.acceptanceCriteria = ["works"];
    network.candidates.push({ id: "r1:direct", regionId: "r1", key: "direct", proposition: "implement it", status: "selected", evidenceIds: [], eliminationReasons: [] });
    return network;
  };
  const blockedImplementCycle = (network: SolutionLodState["network"], changedFiles: string[] = [], checks: ImplementationOutput["checks"] = []): SolutionLodState["network"] => {
    const id = `a${network.activations.length + 1}`;
    network.activations.push({ id, capability: "implement", regionId: "r1", request: "implement", expectedDelta: `implement:r1:${network.revision}`, contextRefs: ["r1"], status: "running", basisRevision: network.revision });
    network.regions[0].activationIds.push(id);
    network.regions[0].status = "implementing";
    return completeImplementation(network, id, { status: "blocked", summary: "missing prerequisite", changedFiles: [], checks, blocker: "missing prerequisite", activations: [] }, changedFiles);
  };

  it("stalls a region after three contentless reopens despite fresh artifact ids each cycle", () => {
    const sameChecks: ImplementationOutput["checks"] = [{ name: "lint", passed: false, evidence: "same failure" }];
    let current = actionableSingleChoice();
    for (let cycle = 0; cycle < 3; cycle++) current = blockedImplementCycle(current, [], sameChecks);
    expect(current.regions[0]).toMatchObject({ status: "superposed", reopens: 3 });
    expect(current.artifacts).toHaveLength(3);
    const stalled = blockedImplementCycle(current, [], sameChecks);
    expect(stalled.regions[0]).toMatchObject({ status: "stalled", reopens: 3 });
    expect(stalled.regions[0].contradiction).toBe("Region r1 stalled: 3 reopens without new evidence");
    const scheduled = ensureRunnableWork(stalled);
    expect(scheduled.done).toBe(false);
    expect(scheduled.blocked).toBe("Region r1 stalled: 3 reopens without new evidence");
    expect(nextQueuedActivation(scheduled.network)).toBeUndefined();
  });

  it("resets the reopen counter only on genuinely new evidence or artifact content", () => {
    let current = actionableSingleChoice();
    for (let cycle = 0; cycle < 3; cycle++) current = blockedImplementCycle(current);
    expect(current.regions[0].reopens).toBe(3);
    current = blockedImplementCycle(current, ["target.txt"]);
    expect(current.regions[0]).toMatchObject({ status: "superposed", reopens: 1 });
    current = blockedImplementCycle(current, ["target.txt"]);
    expect(current.regions[0].reopens).toBe(2);
    current.evidence.push({ id: "e1", text: "fresh repository fact", source: "src/new.ts", kind: "repository", fingerprint: "fresh1" });
    current.regions[0].evidenceIds.push("e1");
    current = blockedImplementCycle(current, ["target.txt"]);
    expect(current.regions[0]).toMatchObject({ status: "superposed", reopens: 1 });
  });

  it("declares a shared choice once and resolves candidate stances against it", () => {
    const current = state();
    const merged = mergeSolutionDelta(current, "a1", {
      region: { acceptanceCriteria: ["works"] }, evidence: [], constraints: [], select: [], activations: [],
      variables: [{ name: "HTTP Client", seedLabels: ["undici"] }],
      candidates: [{ key: "reuse", proposition: "Reuse undici", outcome: "selected", reasons: [], evidenceRefs: [], stances: [{ variable: "http-client", relation: "requires", valueLabel: "undici" }] }],
      select: ["reuse"],
    });
    expect(merged.variables.map((item) => item.name)).toEqual(["http-client"]);
    expect(merged.candidates[0].stances).toEqual([{ variableId: merged.variables[0].id, relation: "requires", valueLabel: "undici" }]);
  });

  it("keeps shared-choice spellings canonical and names unique", () => {
    const current = state();
    current.network = mergeSolutionDelta(current, "a1", {
      region: {}, evidence: [], constraints: [], select: [], activations: [],
      variables: [{ name: "http-client", seedLabels: ["undici"] }],
      candidates: [{ key: "a", proposition: "A", outcome: "possible", reasons: [], evidenceRefs: [] }],
    });
    expect(() => validateSolutionDelta(current, "r1", {
      region: {}, evidence: [], candidates: [{ key: "b", proposition: "B", outcome: "possible", reasons: [], evidenceRefs: [], stances: [{ variable: "http-client", relation: "prefers", valueLabel: "Undici" }] }], constraints: [], select: [], activations: [],
    })).toThrow(/Reuse the established option spelling/);
    expect(() => validateSolutionDelta(current, "r1", {
      region: {}, evidence: [], candidates: [{ key: "b", proposition: "B", outcome: "possible", reasons: [], evidenceRefs: [] }], constraints: [], select: [], activations: [],
      variables: [{ name: "http client" }],
    })).toThrow(/already exists/);
  });

  it("round-trips constraint provenance through merge", () => {
    const current = state();
    const merged = mergeSolutionDelta(current, "a1", {
      region: { acceptanceCriteria: ["works"] }, evidence: [], select: [], activations: [],
      candidates: [
        { key: "left", proposition: "L", outcome: "possible", reasons: [], evidenceRefs: [] },
        { key: "right", proposition: "R", outcome: "possible", reasons: [], evidenceRefs: [] },
      ],
      constraints: [{ kind: "excludes", subject: "left", target: "right", reason: "cannot coexist", sourceKind: "user-task", evidenceRefs: [] }],
    });
    expect(merged.constraints[0]).toMatchObject({ sourceKind: "user-task", kind: "excludes", subject: merged.candidates[0].id });
    expect(() => validateSolutionDelta(current, "r1", {
      region: {}, evidence: [], candidates: [{ key: "x", proposition: "X", outcome: "possible", reasons: [], evidenceRefs: [] }], constraints: [
        { kind: "excludes", subject: "task", target: "x", reason: "invalid direction", sourceKind: "repo-evidence", evidenceRefs: [] },
      ], select: [], activations: [],
    })).toThrow(/Invalid excludes endpoints/);
  });

  it("rejects stances on choices declared outside the region's subtree", () => {
    const current = state();
    current.network.regions.push({ ...current.network.regions[0], id: "r2", key: "left", parentId: "r1", edge: "partOf" as const, lod: 1, objective: "left", status: "unformed" as const, candidateIds: [], selectedCandidateIds: [], activationIds: [], artifactIds: [] });
    current.network.regions.push({ ...current.network.regions[0], id: "r3", key: "right", parentId: "r1", edge: "partOf" as const, lod: 1, objective: "right", status: "unformed" as const, candidateIds: [], selectedCandidateIds: [], activationIds: [], artifactIds: [] });
    current.network.variables.push({ id: "v9", name: "left-only", ownerRegionId: "r2" });
    current.network.activations.push({ id: "a9", capability: "synthesize", regionId: "r3", request: "choose", expectedDelta: "s-r3", contextRefs: ["r3"], status: "running", basisRevision: 0 });
    expect(() => mergeSolutionDelta(current, "a9", {
      region: {}, evidence: [], constraints: [], select: [], activations: [], variables: [],
      candidates: [{ key: "move", proposition: "Move", outcome: "possible", reasons: [], evidenceRefs: [], stances: [{ variable: "left-only", relation: "requires", valueLabel: "x" }] }],
    })).toThrow(/declared at r2 and is not visible here/);
  });

  it("keeps duplicate primal couplings legal and rejects only true transitive cycles", () => {
    const current = state();
    for (const [id, delta] of [["a2", "s-r1-again"], ["a3", "s-r1-third"], ["a4", "s-r1-fourth"]] as const) {
      current.network.activations.push({ id, capability: "synthesize", regionId: "r1", request: "more", expectedDelta: delta, contextRefs: ["r1"], status: "running", basisRevision: 0 });
    }
    current.network = mergeSolutionDelta(current, "a1", {
      region: {}, evidence: [], constraints: [], select: [], activations: [],
      variables: [{ name: "http-client" }, { name: "auth-db" }, { name: "cache-layer" }],
      candidates: [{ key: "first", proposition: "First move", outcome: "possible", reasons: [], evidenceRefs: [], stances: [
        { variable: "http-client", relation: "requires", valueLabel: "undici" },
        { variable: "auth-db", relation: "requires", valueLabel: "sqlite" },
      ] }],
    });
    // A second move coupling the SAME variable pair is a parallel edge, not a cycle.
    expect(() => {
      current.network = mergeSolutionDelta(current, "a2", {
        region: {}, evidence: [], constraints: [], select: [], activations: [], variables: [],
        candidates: [{ key: "parallel", proposition: "Parallel move", outcome: "possible", reasons: [], evidenceRefs: [], stances: [
          { variable: "http-client", relation: "prefers", valueLabel: "undici" },
          { variable: "auth-db", relation: "excludes", valueLabel: "postgres" },
        ] }],
      });
    }).not.toThrow();
    // Extend the chain: auth-db <-> cache-layer.
    expect(() => {
      current.network = mergeSolutionDelta(current, "a3", {
        region: {}, evidence: [], constraints: [], select: [], activations: [], variables: [],
        candidates: [{ key: "chain", proposition: "Chain move", outcome: "possible", reasons: [], evidenceRefs: [], stances: [
          { variable: "auth-db", relation: "prefers", valueLabel: "sqlite" },
          { variable: "cache-layer", relation: "requires", valueLabel: "redis" },
        ] }],
      });
    }).not.toThrow();
    // Coupling the outer vertices of the chain closes a real cycle.
    expect(() => mergeSolutionDelta(current, "a4", {
      region: {}, evidence: [], constraints: [], select: [], activations: [], variables: [],
      candidates: [{ key: "closer", proposition: "Cycle closer", outcome: "possible", reasons: [], evidenceRefs: [], stances: [
        { variable: "http-client", relation: "requires", valueLabel: "undici" },
        { variable: "cache-layer", relation: "prefers", valueLabel: "redis" },
      ] }],
    })).toThrow(/close a coupling cycle/);
  });

  it("prunes requiring moves everywhere once a committed move excludes an option", () => {
    const current = state();
    current.network.regions.push({ ...current.network.regions[0], id: "r2", key: "child", parentId: "r1", edge: "refines" as const, lod: 1, objective: "child", status: "unformed" as const, candidateIds: ["r2:move"], selectedCandidateIds: [], activationIds: [], artifactIds: [] });
    current.network.variables.push({ id: "v1", name: "http-client", ownerRegionId: "r1", seedLabels: [] });
    current.network.evidence.push({ id: "e5", text: "the platform forbids extra clients", source: "docs/adr/0007.md:1", kind: "repository", fingerprint: "f5" });
    current.network.candidates.push(
      { id: "r2:move", regionId: "r2", key: "move", proposition: "Move needing undici", status: "possible", evidenceIds: [], eliminationReasons: [], stances: [{ variableId: "v1", relation: "requires", valueLabel: "undici" }] },
      { id: "r1:committer", regionId: "r1", key: "committer", proposition: "Commit that rules undici out", status: "selected", declaredStatus: "selected", evidenceIds: [], eliminationReasons: [], stances: [] },
    );
    current.network.regions[0].candidateIds = ["r1:committer"];
    current.network.constraints.push({ id: "c7", kind: "excludes", subject: "r1:committer", target: "v1:undici", reason: "this approach forbids adding any client", sourceActivationId: "a9", sourceKind: "repo-evidence", evidenceRefs: ["e5"] });
    const accepted = acceptDomain(propagateNetwork(current.network));
    const committer = accepted.candidates.find((candidate) => candidate.id === "r1:committer")!;
    committer.status = "selected"; committer.declaredStatus = "selected"; accepted.regions[0].selectedCandidateIds = [committer.id];
    const propagated = propagateNetwork(accepted);
    expect(propagated.candidates.find((candidate) => candidate.id === "r2:move")?.status).toBe("eliminated");
    expect(propagated.candidates.find((candidate) => candidate.id === "r2:move")?.eliminationReasons.join(" ")).toMatch(/rules out shared choice http-client="undici"/);
  });

  it("keeps coordinate excludes inert while their subject is uncommitted and rejects uncited ones", () => {
    const build = () => {
      const fresh = state();
      fresh.network.regions.push({ ...fresh.network.regions[0], id: "r2", key: "child", parentId: "r1", edge: "refines" as const, lod: 1, objective: "child", status: "unformed" as const, candidateIds: ["r2:move"], selectedCandidateIds: [], activationIds: [], artifactIds: [] });
      fresh.network.variables.push({ id: "v1", name: "http-client", ownerRegionId: "r1", seedLabels: [] });
      fresh.network.candidates.push(
        { id: "r2:move", regionId: "r2", key: "move", proposition: "Move needing undici", status: "possible", evidenceIds: [], eliminationReasons: [], stances: [{ variableId: "v1", relation: "requires", valueLabel: "undici" }] },
        { id: "r1:idle", regionId: "r1", key: "idle", proposition: "Uncommitted excluder", status: "possible", evidenceIds: [], eliminationReasons: [], stances: [] },
      );
      return fresh;
    };
    const inactive = build();
    inactive.network.constraints.push({ id: "cx", kind: "excludes", subject: "r1:idle", target: "v1:undici", reason: "idle grudge", sourceActivationId: "a9", sourceKind: "model-inference", evidenceRefs: ["e9"] });
    inactive.network.evidence.push({ id: "e9", text: "cited anyway", source: "x:1", kind: "repository", fingerprint: "e9" });
    // Singleton region force-selects the move; inertness means it is not eliminated.
    expect(propagateNetwork(inactive.network).candidates.find((candidate) => candidate.id === "r2:move")?.status).not.toBe("eliminated");
    expect(() => validateSolutionDelta(build(), "r1", {
      region: {}, evidence: [], candidates: [{ key: "idle2", proposition: "Idle", outcome: "possible", reasons: [], evidenceRefs: [] }], constraints: [
        { kind: "excludes", subject: "idle2", target: "http-client:undici", reason: "uncited exclusion", sourceKind: "model-inference", evidenceRefs: [] },
      ], select: [], activations: [],
    })).toThrow(/at least one cited fact/);
  });

  it("binds a committed choice and prunes conflicting moves elsewhere while prefers survives", () => {
    const current = state();
    current.network.regions.push({ ...current.network.regions[0], id: "r2", key: "child", parentId: "r1", edge: "refines" as const, lod: 1, objective: "child", status: "unformed" as const, candidateIds: [], selectedCandidateIds: [], activationIds: [], artifactIds: [] });
    let network = mergeSolutionDelta(current, "a1", {
      region: {}, evidence: [], constraints: [], select: [], activations: [],
      variables: [{ name: "http-client" }],
      candidates: [{ key: "reuse", proposition: "Reuse undici", outcome: "possible", reasons: [], evidenceRefs: [], stances: [{ variable: "http-client", relation: "requires", valueLabel: "undici" }] }, { key: "other", proposition: "Use another client", outcome: "possible", reasons: [], evidenceRefs: [] }],
      select: [],
    });
    network = selectDelta(network, "a1", "reuse");
    network.candidates.push(
      { id: "r2:excl", regionId: "r2", key: "excl", proposition: "Excluding move", status: "possible", evidenceIds: [], eliminationReasons: [], stances: [{ variableId: network.variables[0].id, relation: "excludes", valueLabel: "undici" }] },
      { id: "r2:reqother", regionId: "r2", key: "reqother", proposition: "Requires another option", status: "possible", evidenceIds: [], eliminationReasons: [], stances: [{ variableId: network.variables[0].id, relation: "requires", valueLabel: "node-fetch" }] },
      { id: "r2:flexible", regionId: "r2", key: "flexible", proposition: "Any client works", status: "possible", evidenceIds: [], eliminationReasons: [], stances: [{ variableId: network.variables[0].id, relation: "prefers", valueLabel: "undici" }] },
    );
    const propagated = propagateNetwork(network);
    expect(propagated.candidates.find((candidate) => candidate.id === "r2:excl")?.status).toBe("eliminated");
    expect(propagated.candidates.find((candidate) => candidate.id === "r2:reqother")?.status).toBe("eliminated");
    expect(propagated.candidates.find((candidate) => candidate.id === "r2:flexible")?.status).toBe("possible");
    expect(propagated.candidates.find((candidate) => candidate.key === "reuse")?.status).toBe("selected");
  });

  it("prunes requiring moves across regions only when a coordinate refutation cites facts", () => {
    const build = () => {
      const current = state();
      current.network.regions.push({ ...current.network.regions[0], id: "r2", key: "child", parentId: "r1", edge: "refines" as const, lod: 1, objective: "child", status: "unformed" as const, candidateIds: ["r2:move"], selectedCandidateIds: [], activationIds: [], artifactIds: [] });
      current.network.variables.push({ id: "v1", name: "http-client", ownerRegionId: "r1" });
      current.network.evidence.push({ id: "e9", text: "the repo standardizes on undici everywhere", source: "src/http.ts:1", kind: "repository", fingerprint: "f9" });
      current.network.candidates.push({ id: "r2:move", regionId: "r2", key: "move", proposition: "Move needing undici", status: "possible", evidenceIds: [], eliminationReasons: [], stances: [{ variableId: "v1", relation: "requires", valueLabel: "undici" }] });
      return current;
    };
    const cited = build();
    cited.network.constraints.push({ id: "c9", kind: "refutes", subject: "e9", target: "v1:undici", reason: "repo forbids additional clients here", sourceActivationId: "a9", sourceKind: "repo-evidence", evidenceRefs: ["e9"] });
    const pruned = propagateNetwork(cited.network);
    expect(pruned.candidates.find((candidate) => candidate.id === "r2:move")?.status).toBe("eliminated");
    expect(pruned.candidates.find((candidate) => candidate.id === "r2:move")?.eliminationReasons.join(" ")).toMatch(/refuted by cited evidence/);

    const uncited = build();
    uncited.network.constraints.push({ id: "c10", kind: "refutes", subject: "e9", target: "v1:undici", reason: "a hunch", sourceActivationId: "a9", sourceKind: "model-inference", evidenceRefs: [] });
    expect(propagateNetwork(uncited.network).candidates.find((candidate) => candidate.id === "r2:move")?.status).not.toBe("eliminated");

    expect(() => validateSolutionDelta(build(), "r1", {
      region: {}, evidence: [], candidates: [], constraints: [{ kind: "refutes", subject: "task", target: "http-client:undici", reason: "uncited", evidenceRefs: [] }], select: [], activations: [],
    })).toThrow(/at least one cited fact/);
    expect(() => validateSolutionDelta(build(), "r1", {
      region: {}, evidence: [], candidates: [], constraints: [{ kind: "refutes", subject: "task", target: "http-client:undici", reason: "phantom citation", evidenceRefs: ["ghost"] }], select: [], activations: [],
    })).toThrow(/unknown fact/);
  });

  it("prevents unresolved inference from pruning a shared option", () => {
    const current = state();
    current.network.variables.push({ id: "v1", name: "runtime", ownerRegionId: "r1", seedLabels: ["node20"] });
    current.network.evidence.push({ id: "e9", text: "Node 20 might be required", source: "model", kind: "inference", status: "hypothesis", validationKind: "repository-evidence", fingerprint: "h9" });
    expect(() => validateSolutionDelta(current, "r1", "synthesize", {
      region: {}, evidence: [], variables: [], candidates: [{ key: "legacy", proposition: "Use Node 16", outcome: "possible", reasons: [], evidenceRefs: [] }],
      constraints: [{ kind: "refutes", subject: "task", target: "runtime:node20", reason: "hypothesis", sourceKind: "model-inference", evidenceRefs: ["e9"] }], select: [], activations: [],
    })).toThrow(/unresolved claim/);
  });

  it("does not let an inspector self-confirm inference metadata", () => {
    const current = state();
    const merged = mergeSolutionDelta(current, "a1", {
      region: {}, variables: [], candidates: [], constraints: [], select: [], activations: [],
      evidence: [{ text: "Maybe Node 20 only", source: "model", kind: "inference", status: "confirmed" }],
    } as never);
    expect(merged.evidence[0]).toMatchObject({ kind: "inference", status: "hypothesis" });
  });

  it("validates a hypothesis only through independent evidence and preserves the proof", () => {
    const current = state();
    current.network.evidence.push({ id: "e9", text: "Node 20 only", source: "model", kind: "inference", status: "hypothesis", validationKind: "repository-evidence", fingerprint: "h9" });
    const delta = {
      region: {}, variables: [], candidates: [], constraints: [], select: [], activations: [],
      evidence: [{ text: "engines requires Node 20", source: "package.json:8", kind: "repository" as const }],
      validations: [{ claimRef: "e9", verdict: "confirmed" as const, evidenceRefs: ["package.json:8"], reason: "package engines field" }],
    };
    expect(() => validateSolutionDelta(current, "r1", "inspect", delta)).not.toThrow();
    const merged = mergeSolutionDelta(current, "a1", delta);
    const proofId = merged.evidence.find((item) => item.source === "package.json:8")!.id;
    expect(merged.evidence.find((item) => item.id === "e9")).toMatchObject({ status: "confirmed", validationEvidenceRefs: [proofId], validationReason: "package engines field" });
  });

  it("rejects model-forged user authority", () => {
    const current = state();
    expect(() => validateSolutionDelta(current, "r1", "synthesize", {
      region: {}, evidence: [], variables: [], candidates: [{ key: "x", proposition: "X", outcome: "possible", reasons: [], evidenceRefs: [] }],
      constraints: [{ kind: "refutes", subject: "task", target: "x", reason: "user allegedly forbade it", sourceKind: "user-task", evidenceRefs: ["task"] }], select: [], activations: [],
    })).toThrow(/cannot assert user-task authority/);
  });

  it("prevents tool-free synthesis and refinement from fabricating confirmed observations", () => {
    const current = state();
    expect(() => validateSolutionDelta(current, "r1", "synthesize", {
      region: {}, variables: [], evidence: [{ text: "alleged file fact", source: "src/x.ts:1", kind: "repository" }], candidates: [], constraints: [], select: [], activations: [],
    })).toThrow(/tool-free role cannot create confirmed/);
    expect(() => validateRefinementOutput(current, "r1", {
      evidence: [{ text: "alleged tool result", source: "command", kind: "tool" }], activations: [],
      children: [{ key: "child", objective: "Do work", edge: "partOf", allowedVariables: [], acceptanceCriteria: ["works"], coveredCriteria: [0] }],
    })).toThrow(/Refinement is tool-free/);
  });
});

describe("solution LOD graph", () => {
  const synthesisOutput = (input: { node: string; state?: SolutionLodState }, key = "direct", proposition = "Update target") => {
    const regionId = input.node.split(":").at(-1)!;
    const region = input.state?.network.regions.find((item) => item.id === regionId);
    if (input.node.startsWith("generate-domain:")) return { text: "", structured: { operation: "generate-domain", evidence: [], variables: [], constraints: [], candidates: [{ key, proposition, evidenceRefs: [], stances: [] }, { key: `${key}-alternative`, proposition: `${proposition} with an adapter`, evidenceRefs: [], stances: [] }] } };
    if (input.node.startsWith("challenge-domain:")) return { text: "", structured: { operation: "challenge-domain", verdict: "accept", domainFingerprint: region?.domainFingerprint, viableCandidateIds: region?.candidateIds ?? [] } };
    if (input.node.startsWith("select-candidate:")) return { text: "", structured: { operation: "select-candidate", domainFingerprint: region?.domainFingerprint, basis: "lexicographic", selectedCandidateId: `${regionId}:${key}`, hardConstraints: [], comparisons: (region?.candidateIds ?? []).map((candidateId) => ({ candidateId, userPreference: "neutral", repositoryCompatibility: "neutral", changeScope: candidateId === `${regionId}:${key}` ? "preferred" : "disfavored", irreversibleRisk: "neutral", evidenceRefs: [] })) } };
    return undefined;
  };
  const certifiedLeaf = { text: "", structured: { evidence: [], children: [], certifiedLeaf: { implementationScope: "bounded test change", criterionIds: ["criterion:scope:r1:0"], evidenceRefs: [], mutationResources: ["target.txt"], checks: [{ criterionId: "criterion:scope:r1:0", commandOrObservation: "run focused test" }] }, activations: [] } };

  it("executes a collapsed region and verifies it without a fixed role pipeline", async () => {
    const directory = temp("solution-lod-graph-");
    fs.writeFileSync(path.join(directory, "target.txt"), "before");
    const configured = solutionLodGraph({ agents: { inspect: "inspect", synthesize: "synthesize", refine: "refine", implement: "implement", verify: "verify", present: "present" }, checkpointer: new MemorySaver() });
    const calls: string[] = [];
    const retryCounts = new Map<string, number | undefined>();
    const runtime = { call: async (input: { node: string; retryCount?: number; state?: SolutionLodState }) => {
      calls.push(input.node);
      retryCounts.set(input.node, input.retryCount);
      if (input.node === "inspect:r1") return { text: "", structured: { region: { delivery: "change", allowedVariables: ["solution family"], acceptanceCriteria: ["target updated"] }, evidence: [{ text: "target exists", source: "target.txt", kind: "repository" }], candidates: [], constraints: [], select: [], activations: [{ capability: "synthesize", request: "form domain", expectedDelta: "domain:r1", contextRefs: ["e1"] }] } };
      const synthesis = synthesisOutput(input); if (synthesis) return synthesis;
      if (input.node === "refine:r1") return certifiedLeaf;
      if (input.node === "implement:r1") { fs.writeFileSync(path.join(directory, "target.txt"), "after"); return { text: "", structured: { status: "completed", summary: "updated", changedFiles: ["target.txt"], checks: [{ name: "target updated", passed: true, evidence: "target updated: after" }], activations: [] } }; }
      if (input.node === "verify:r1") return { text: "", structured: { verdict: "pass", summary: "ok", findings: [], checks: [{ name: "target updated", passed: true, evidence: "target updated: after" }], completionEvidence: { implementation: "measured target.txt", directTest: "target check passed", correctnessReview: "reviewed target", releaseGate: "suite passed", changedFiles: ["target.txt"], focusedTests: ["target"], fullChecks: ["suite"] }, activations: [] } };
      throw new Error(`unexpected node ${input.node}`);
    } };
    const result = await configured.graph.invoke(configured.initial({ task: "update", directory, worktree: directory, runId: "run" }), { recursionLimit: 64, configurable: { thread_id: "run", langgraphOpenCodeRuntime: runtime, langgraphAcquireWorktree: async () => {} } });
    expect(calls).toEqual(["inspect:r1", "generate-domain:r1", "challenge-domain:r1", "select-candidate:r1", "refine:r1", "implement:r1", "verify:r1"]);
    expect(retryCounts.get("generate-domain:r1")).toBe(2);
    expect(retryCounts.get("challenge-domain:r1")).toBe(2);
    expect(retryCounts.get("select-candidate:r1")).toBe(2);
    expect(retryCounts.get("inspect:r1")).toBeUndefined();
    expect(configured.progress?.(result)).toMatchObject({ phase: "completed", semantic: { kind: "solution-lod-v2" } });
    expect(configured.result?.(result)).toContain("Implemented and verified");
    expect(configured.result?.(result)).not.toContain("stale pre-implementation design");
  });

  it("stalls a region terminally after three contentless blocked-implement reopens", async () => {
    const directory = temp("solution-lod-stalled-");
    fs.writeFileSync(path.join(directory, "target.txt"), "base");
    const configured = solutionLodGraph({ agents: { inspect: "inspect", synthesize: "synthesize", refine: "refine", implement: "implement", verify: "verify", present: "present" }, checkpointer: new MemorySaver() });
    const calls: string[] = [];
    const runtime = { call: async (input: { node: string; state?: SolutionLodState }) => {
      calls.push(input.node);
      if (input.node === "inspect:r1") return { text: "", structured: { region: { delivery: "change", acceptanceCriteria: ["target updated"] }, evidence: [{ text: "target exists", source: "target.txt", kind: "repository" }], candidates: [], constraints: [], select: [], activations: [{ capability: "synthesize", request: "form domain", expectedDelta: "domain:r1", contextRefs: [] }] } };
      const synthesis = synthesisOutput(input); if (synthesis) return synthesis;
      if (input.node === "refine:r1") return certifiedLeaf;
      if (input.node === "implement:r1") return { text: "", structured: { status: "blocked", summary: "missing prerequisite", changedFiles: [], checks: [], blocker: "missing prerequisite", activations: [] } };
      throw new Error(`unexpected node ${input.node}`);
    } };
    const result = await configured.graph.invoke(configured.initial({ task: "update", directory, worktree: directory, runId: "stalled" }), { recursionLimit: 128, configurable: { thread_id: "stalled", langgraphOpenCodeRuntime: runtime, langgraphAcquireWorktree: async () => {} } });
    expect(calls.filter((node) => node === "implement:r1")).toHaveLength(4);
    const region = (result as SolutionLodState).network.regions.find((item) => item.id === "r1")!;
    expect(region.status).toBe("stalled");
    expect(region.reopens).toBe(3);
    expect(configured.progress?.(result)?.phase).toBe("blocked");
    expect(configured.result?.(result)).toContain("Region r1 stalled: 3 reopens without new evidence");
  });

  it("isolates malformed activation output and terminates with retained state", async () => {
    const configured = solutionLodGraph({ agents: { inspect: "inspect", synthesize: "synthesize", refine: "refine", implement: "implement", verify: "verify", present: "present" }, checkpointer: new MemorySaver() });
    const runtime = { call: async () => { throw new Error("invalid structured output"); } };
    const result = await configured.graph.invoke(configured.initial({ task: "x", directory: "/repo", worktree: "/repo", runId: "bad" }), { recursionLimit: 32, configurable: { thread_id: "bad", langgraphOpenCodeRuntime: runtime } });
    expect(configured.progress?.(result)?.phase).toBe("blocked");
    expect((result as SolutionLodState).network.activations.some((activation) => activation.status === "failed")).toBe(true);
    expect(configured.result?.(result)).toContain("blocked");
  });

  it("reconciles actual files changed during implementation without claiming pre-existing dirt", async () => {
    const directory = temp("solution-lod-artifacts-");
    fs.writeFileSync(path.join(directory, "target.txt"), "base"); fs.writeFileSync(path.join(directory, "untouched.txt"), "base");
    fs.writeFileSync(path.join(directory, "untouched.txt"), "user dirt");
    const configured = solutionLodGraph({ agents: { inspect: "inspect", synthesize: "synthesize", refine: "refine", implement: "implement", verify: "verify", present: "present" }, checkpointer: new MemorySaver() });
    const runtime = { call: async (input: { node: string; state?: SolutionLodState }) => {
      if (input.node === "inspect:r1") return { text: "", structured: { region: { delivery: "change", acceptanceCriteria: ["files updated"] }, evidence: [], candidates: [], constraints: [], select: [], activations: [] } };
      const synthesis = synthesisOutput(input, "direct", "change files"); if (synthesis) return synthesis;
      if (input.node === "refine:r1") return certifiedLeaf;
      if (input.node === "implement:r1") { fs.writeFileSync(path.join(directory, "target.txt"), "agent change"); fs.writeFileSync(path.join(directory, "new.txt"), "new"); return { text: "", structured: { status: "completed", summary: "done", changedFiles: [], checks: [{ name: "files updated", passed: true, evidence: "files updated: target.txt and new.txt" }], activations: [] } }; }
      if (input.node === "verify:r1") return { text: "", structured: { verdict: "pass", summary: "ok", findings: [], checks: [{ name: "files updated", passed: true, evidence: "files updated: target.txt and new.txt" }], completionEvidence: { implementationOutcome: "changed", implementation: "measured target.txt and new.txt", directTest: "files updated check passed", correctnessReview: "reviewed files", releaseGate: "suite passed", changedFiles: ["new.txt", "target.txt"], focusedTests: ["files updated"], fullChecks: ["suite"], criterionIds: ["criterion:scope:r1:0"], inspectionEvidenceRefs: [] }, activations: [] } };
      throw new Error(`unexpected node ${input.node}`);
    } };
    let snapshots = 0;
    const snapshot = () => snapshots++ === 0 ? new Map([["untouched.txt", "M:user"], ["target.txt", "clean:base"]]) : new Map([["untouched.txt", "M:user"], ["target.txt", "M:agent"], ["new.txt", "?:new"]]);
    const result = await configured.graph.invoke(configured.initial({ task: "change", directory, worktree: directory, runId: "artifacts" }), { recursionLimit: 32, configurable: { thread_id: "artifacts", langgraphOpenCodeRuntime: runtime, langgraphAcquireWorktree: async () => {}, langgraphSnapshotWorkspace: snapshot } });
    const files = (result as SolutionLodState).network.artifacts.filter((item) => item.kind === "file").map((item) => item.path).sort();
    expect(files).toEqual(["new.txt", "target.txt"]);
    expect(files).not.toContain("untouched.txt");
  });

  it("retains a workspace mutation when the implementer's final output is malformed", async () => {
    const directory = temp("solution-lod-malformed-mutation-");
    fs.writeFileSync(path.join(directory, "target.txt"), "base");
    const configured = solutionLodGraph({ agents: { inspect: "inspect", synthesize: "synthesize", refine: "refine", implement: "implement", verify: "verify", present: "present" }, checkpointer: new MemorySaver() });
    let first = true;
    const runtime = { call: async (input: { node: string; state?: SolutionLodState }) => {
      if (first && input.node === "inspect:r1") { first = false; return { text: "", structured: { region: { delivery: "change", acceptanceCriteria: ["target updated"] }, evidence: [], candidates: [], constraints: [], select: [], activations: [] } }; }
      const synthesis = synthesisOutput(input, "direct", "update target"); if (synthesis) return synthesis;
      if (input.node === "refine:r1") return certifiedLeaf;
      if (input.node === "implement:r1") { fs.writeFileSync(path.join(directory, "target.txt"), "retained"); throw new Error("invalid structured output"); }
      throw new Error("recovery activation also malformed");
    } };
    let snapshots = 0;
    const snapshot = () => snapshots++ === 0 ? new Map([["target.txt", "clean:base"]]) : new Map([["target.txt", "M:retained"]]);
    const result = await configured.graph.invoke(configured.initial({ task: "change", directory, worktree: directory, runId: "malformed-mutation" }), { recursionLimit: 32, configurable: { thread_id: "malformed-mutation", langgraphOpenCodeRuntime: runtime, langgraphAcquireWorktree: async () => {}, langgraphSnapshotWorkspace: snapshot } });
    expect(fs.readFileSync(path.join(directory, "target.txt"), "utf8")).toBe("retained");
    expect((result as SolutionLodState).network.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "file", path: "target.txt" })]));
    expect(configured.progress?.(result)?.phase).toBe("blocked");
  });

  it("fans a read-only batch out in parallel, merges deterministically, and clears the results log", async () => {
    const directory = temp("solution-lod-parallel-");
    const configured = solutionLodGraph({ agents: { inspect: "inspect", synthesize: "synthesize", refine: "refine", implement: "implement", verify: "verify", present: "present" }, checkpointer: new MemorySaver() });
    const events: string[] = [];
    let open = 0; let maxOpen = 0;
    const runtime = { call: async (input: { node: string; state?: SolutionLodState }) => {
      events.push(`start:${input.node}`); open++; maxOpen = Math.max(maxOpen, open);
      await new Promise((resolve) => setTimeout(resolve, 25));
      open--; events.push(`end:${input.node}`);
      if (input.node === "inspect:r1") return { text: "", structured: { region: { acceptanceCriteria: ["left answered", "right answered"] }, evidence: [], candidates: [], constraints: [], select: [], activations: [] } };
      const synthesis = synthesisOutput(input, input.node.endsWith(":r1") ? "split" : "direct", input.node.endsWith(":r1") ? "Two independent answers" : "Answer directly"); if (synthesis) return synthesis;
      if (input.node === "refine:r1") return { text: "", structured: { evidence: [], activations: [], children: [
        { key: "left", objective: "Answer the left question", edge: "partOf", delivery: "answer", allowedVariables: [], acceptanceCriteria: ["left answered"], coveredCriteria: [0] },
        { key: "right", objective: "Answer the right question", edge: "partOf", delivery: "answer", allowedVariables: [], acceptanceCriteria: ["right answered"], coveredCriteria: [1] },
      ] } };
      if (input.node === "inspect:r2") return { text: "", structured: { region: {}, evidence: [{ text: "left context", source: "left:1", kind: "inference" }], candidates: [], constraints: [], select: [], activations: [] } };
      if (input.node === "inspect:r3") return { text: "", structured: { region: {}, evidence: [{ text: "right context", source: "right:1", kind: "inference" }], candidates: [], constraints: [], select: [], activations: [] } };
      if (input.node === "refine:r2" || input.node === "refine:r3") {
        const region = input.state!.network.regions.find((item) => item.id === input.node.slice("refine:".length))!;
        return { text: "", structured: { evidence: [], children: [], certifiedLeaf: { implementationScope: "bounded answer", criterionIds: [...region.criterionIds], evidenceRefs: [], mutationResources: [region.key], checks: region.criterionIds.map((criterionId) => ({ criterionId, commandOrObservation: "check answer" })) }, activations: [] } };
      }
      if (input.node === "present:r2") return { text: "", structured: { answer: "left answer" } };
      if (input.node === "present:r3") return { text: "", structured: { answer: "right answer" } };
      if (input.node === "verify:r2") return { text: "", structured: { verdict: "pass", summary: "ok", findings: [], checks: [{ name: "left answered", passed: true, evidence: "left answered: left answer" }], activations: [] } };
      if (input.node === "verify:r3") return { text: "", structured: { verdict: "pass", summary: "ok", findings: [], checks: [{ name: "right answered", passed: true, evidence: "right answered: right answer" }], activations: [] } };
      throw new Error(`unexpected node ${input.node}`);
    } };
    const result = await configured.graph.invoke(configured.initial({ task: "answer two questions", directory, worktree: directory, runId: "parallel" }), { recursionLimit: 128, configurable: { thread_id: "parallel", langgraphOpenCodeRuntime: runtime } });
    expect(maxOpen).toBe(2);
    expect(events.indexOf("start:generate-domain:r2")).toBeGreaterThan(-1);
    expect(events.indexOf("start:generate-domain:r3")).toBeGreaterThan(-1);
    const final = result as SolutionLodState;
    expect(configured.progress?.(final)?.phase).toBe("completed");
    expect(configured.result?.(final)).toBe("left answer\n\nright answer");
    expect(final.results).toEqual([]);
    expect(final.activeBatch).toEqual([]);
    expect(final.network.activations.filter((item) => !["completed", "superseded"].includes(item.status)).map((item) => item.status)).toEqual([]);
  });

  it("routes the implement singleton through acquire before dispatching its activation task", async () => {
    const directory = temp("solution-lod-acquire-");
    fs.writeFileSync(path.join(directory, "target.txt"), "before");
    const configured = solutionLodGraph({ agents: { inspect: "inspect", synthesize: "synthesize", refine: "refine", implement: "implement", verify: "verify", present: "present" }, checkpointer: new MemorySaver() });
    const order: string[] = [];
    const runtime = { call: async (input: { node: string }) => {
      order.push(`node:${input.node}`);
      if (input.node === "inspect:r1") return { text: "", structured: { region: { delivery: "change", acceptanceCriteria: ["target updated"] }, evidence: [], candidates: [], constraints: [], select: [], activations: [] } };
      const synthesis = synthesisOutput(input); if (synthesis) return synthesis;
      if (input.node === "refine:r1") return certifiedLeaf;
      if (input.node === "implement:r1") { fs.writeFileSync(path.join(directory, "target.txt"), "after"); return { text: "", structured: { status: "completed", summary: "updated", changedFiles: [], checks: [{ name: "target updated", passed: true, evidence: "target updated: after" }], activations: [] } }; }
      if (input.node === "verify:r1") return { text: "", structured: { verdict: "pass", summary: "ok", findings: [], checks: [{ name: "target updated", passed: true, evidence: "target updated: after" }], completionEvidence: { implementation: "measured target.txt", directTest: "target check passed", correctnessReview: "reviewed target", releaseGate: "suite passed", changedFiles: ["target.txt"], focusedTests: ["target"], fullChecks: ["suite"] }, activations: [] } };
      throw new Error(`unexpected node ${input.node}`);
    } };
    let snapshots = 0;
    const snapshot = () => snapshots++ === 0 ? new Map([["target.txt", "clean:before"]]) : new Map([["target.txt", "M:after"]]);
    const result = await configured.graph.invoke(configured.initial({ task: "update", directory, worktree: directory, runId: "acquire" }), { recursionLimit: 64, configurable: { thread_id: "acquire", langgraphOpenCodeRuntime: runtime, langgraphAcquireWorktree: async () => { order.push("acquire"); }, langgraphSnapshotWorkspace: snapshot } });
    expect(order.filter((item) => item === "acquire")).toHaveLength(1);
    expect(order.indexOf("acquire")).toBeLessThan(order.indexOf("node:implement:r1"));
    expect(configured.progress?.(result)?.phase).toBe("completed");
    expect(fs.readFileSync(path.join(directory, "target.txt"), "utf8")).toBe("after");
    const final = result as SolutionLodState;
    expect(final.results).toEqual([]);
    expect(final.network.artifacts.some((item) => item.kind === "file" && item.path === "target.txt")).toBe(true);
  });
});

describe("durable checkpoints", () => {
  it("resumes an interrupt through a separately opened durable saver", async () => {
    const directory = temp("opencode-langgraph-checkpoints-");
    const State = Annotation.Root({ answer: Annotation<string> });
    const compile = (saver: DurableFileSaver) => new StateGraph(State)
      .addNode("ask", () => ({ answer: interrupt("question") as string }))
      .addEdge(START, "ask").addEdge("ask", END).compile({ checkpointer: saver });
    const firstSaver = new DurableFileSaver(directory);
    const first = await compile(firstSaver).invoke({ answer: "" }, { configurable: { thread_id: "durable" } });
    expect(isInterrupted(first)).toBe(true);
    const secondSaver = new DurableFileSaver(directory);
    const resumed = await compile(secondSaver).invoke(new Command({ resume: "yes" }), { configurable: { thread_id: "durable" } });
    expect(resumed.answer).toBe("yes");
  });
});

