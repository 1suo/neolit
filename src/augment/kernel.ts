import {
  ChallengeDomainSchema,
  DomainProposalSchema,
  ExplanationProposalSchema,
  PatchProposalSchema,
  RefinementProposalSchema,
  BatchPatchProposalSchema,
  type PatchProposal,
} from "./schemas.js";
import { parseRawDraftReply } from "./raw-diff.js";
import {
  acceptDomain,
  addCandidate,
  addConstraint,
  attachExplanations,
  attachPatch,
  candidateScopeEscapes,
  collapseNode,
  exhaustDomainChallenge,
  generateDomain,
  refineNode,
  replacePatch,
  PlanStateError,
} from "./state.js";
import type {
  LOD,
  ModelContextPacket,
  ModelRuntime,
  PlanCandidate,
  PlanNode,
  PlanRevision,
  PlanTask,
  Temperature,
} from "./types.js";

export const MAX_DOMAIN_CHALLENGE_ROUNDS = 2;

export type AugmentModelErrorCode = "invalid-model-output" | "unknown-node" | "unknown-diff" | "node-state";

export class AugmentModelError extends Error {
  constructor(
    message: string,
    readonly code: AugmentModelErrorCode = "invalid-model-output",
  ) {
    super(message);
    this.name = "AugmentModelError";
  }
}

export interface CrystallizeNodeInput {
  taskId: string;
  nodeId: string;
  temperature: Temperature;
  lod: LOD;
  replace?: boolean;
  challengeRounds?: number;
}

export interface RefineWithModelInput {
  taskId: string;
  nodeId: string;
  temperature: Temperature;
  lod: LOD;
}

export interface DraftPatchWithModelInput {
  taskId: string;
  nodeId: string;
  temperature: Temperature;
}

export interface RepairPatchWithModelInput {
  taskId: string;
  diffId: string;
  failedCheck: string;
  temperature: Temperature;
}

export interface ExplainProjectWithModelInput {
  taskId: string;
  nodeId?: string;
  temperature: Temperature;
}

function requireNode(task: PlanTask, nodeId: string): PlanNode {
  const node = task.nodes[nodeId];
  if (!node) throw new AugmentModelError(`Unknown plan node: ${nodeId}`, "unknown-node");
  return node;
}

function candidates(task: PlanTask, node: PlanNode): PlanCandidate[] {
  return node.candidateIds.map((id) => task.candidates[id]!).filter(Boolean);
}

function context(task: PlanTask, node: PlanNode): ModelContextPacket {
  const parent = node.parent ? task.nodes[node.parent] : undefined;
  const live = candidates(task, node);
  const rejected = Object.values(task.candidates)
    .filter((candidate) => candidate.status === "eliminated")
    .map((candidate) => ({ label: candidate.label, reason: candidate.eliminationReason ?? "eliminated" }));
  const constraintIds = new Set(node.constraintIds);
  let ancestorId = node.parent;
  while (ancestorId) {
    for (const constraintId of task.nodes[ancestorId]?.constraintIds ?? []) constraintIds.add(constraintId);
    ancestorId = task.nodes[ancestorId]?.parent;
  }
  return {
    taskId: task.id,
    taskRevision: task.revision,
    objective: task.objective,
    basisRevision: task.basisRevision,
    node,
    parentNode: parent,
    candidates: live,
    constraints: [...constraintIds].map((id) => task.constraints[id]!).filter(Boolean),
    obligations: node.obligationIds.map((id) => task.obligations[id]!).filter(Boolean),
    diffs: node.diffIds.map((id) => task.diffs[id]!).filter(Boolean),
    taskDiffs: Object.values(task.diffs),
    taskTree: compactTree(task),
    lockedPaths: task.lockedPaths,
    restrictionMode: task.restrictionMode,
    rejectedCandidates: rejected,
  };
}

function compactTree(task: PlanTask): ModelContextPacket["taskTree"] {
  const seen = new Set<string>();
  const entries: ModelContextPacket["taskTree"] = [];
  for (const node of Object.values(task.nodes)) {
    if (!node.path || seen.has(node.path)) continue;
    seen.add(node.path);
    entries.push({ path: node.path, kind: node.kind, status: node.status, drafted: node.diffIds.length > 0 });
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

async function call<T>(
  runtime: ModelRuntime,
  task: PlanTask,
  node: PlanNode,
  operation: Parameters<ModelRuntime["call"]>[0]["operation"],
  temperature: Temperature,
  lod: LOD,
  parse: (value: unknown) => T,
  extra?: Partial<ModelContextPacket>,
): Promise<T> {
  const result = await runtime.call({
    operation,
    context: { ...context(task, node), ...extra },
    temperature,
    lod,
  });
  try {
    return parse(result.value);
  } catch (error) {
    throw new AugmentModelError(`Model ${operation} output is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseWith<T>(schema: { parse(value: unknown): T }): (value: unknown) => T {
  return (value: unknown) => schema.parse(value);
}

/**
 * Draft replies may be raw unified-diff text instead of the JSON envelope:
 * a diff is self-delimiting, so wrapping it in a JSON string only invites
 * escape errors and mid-string truncation. A raw reply's assumptions are
 * trailing `Assumption:` lines parsed out of the text. Both shapes pass the
 * same schema validation afterwards.
 */
function parseDraftReply(value: unknown): PatchProposal {
  if (typeof value === "string") {
    const raw = parseRawDraftReply(value);
    if (!raw) {
      throw new Error("the reply contains no unified diff (expected a `diff --git` or `--- a/…` header followed by `@@` hunks)");
    }
    return PatchProposalSchema.parse(raw);
  }
  return PatchProposalSchema.parse(value);
}

export interface DomainProposalInput {
  taskId: string;
  expectedRevision: PlanRevision;
  nodeId: string;
  candidates: Array<{ label: string; rationale: string; confidence: number; touchedPaths: string[] }>;
  replace?: boolean;
}

/**
 * Deterministic merge of one proposed candidate domain: candidates whose
 * touched paths escape the node's scope are recorded as out-of-scope
 * constraints instead of candidates (the omission stays inspectable), and a
 * proposal with nothing in scope fails naming the escapes. Shared by the
 * model-driven `crystallizeNode` and the protocol's tool-driven
 * `domain/propose`, so both paths enforce identical controller authority.
 */
export function applyDomainProposal(task: PlanTask, input: DomainProposalInput): PlanTask {
  const scope = task.nodes[input.nodeId]?.path ?? ".";
  const escapes = input.candidates.map((candidate) => candidateScopeEscapes(task, input.nodeId, candidate.touchedPaths));
  const escaping = input.candidates
    .map((candidate, index) => ({ label: candidate.label, paths: escapes[index]! }))
    .filter((entry) => entry.paths.length > 0);
  const inScope = input.candidates.filter((_, index) => escapes[index]!.length === 0);
  if (!inScope.length) {
    throw new AugmentModelError(
      `Every proposed candidate escapes ${scope}: ${escaping.map((entry) => `${entry.label} (${entry.paths.join(", ")})`).join("; ")}. `
      + `Develop the parent path so this work lands in its own node, or rethink with that limit in mind.`,
    );
  }
  let current = generateDomain(task, {
    taskId: task.id,
    expectedRevision: task.revision,
    nodeId: input.nodeId,
    candidates: inScope,
    replace: input.replace,
  });
  if (escaping.length) {
    current = addConstraint(current, {
      taskId: current.id,
      expectedRevision: current.revision,
      nodeId: input.nodeId,
      text: `Out-of-scope dependency noted by domain: ${escaping.map((entry) => `${entry.label} (${entry.paths.join(", ")})`).join("; ")} — belongs outside ${scope}.`,
    });
  }
  return current;
}

export type ChallengeVerdict =
  | { kind: "accept" }
  | { kind: "missing-candidate"; candidate: { label: string; rationale: string; confidence: number; touchedPaths: string[] }; reason: string }
  | { kind: "missing-path"; path: string; reason: string };

export interface ApplyChallengeInput {
  taskId: string;
  expectedRevision: PlanRevision;
  nodeId: string;
  verdict: ChallengeVerdict;
}

/**
 * Deterministic application of one challenge verdict against a live domain:
 * acceptance records the challenge round; a concrete omission becomes a
 * candidate (or an out-of-scope constraint when its paths escape the node);
 * exhausting the bounded budget records `challengeExhausted`, which permits
 * collapse without claiming acceptance. Shared by the model-driven
 * `crystallizeNode` loop and the protocol's tool-driven `domain/challenge`.
 */
export function applyChallenge(task: PlanTask, input: ApplyChallengeInput): { task: PlanTask; outcome: "accepted" | "counterexample" | "exhausted" } {
  const node = task.nodes[input.nodeId];
  if (!node) throw new AugmentModelError(`Unknown plan node: ${input.nodeId}`, "unknown-node");
  // challengeRound counts every round spent on the current domain instance
  // (it resets on regeneration and reopen), so the budget survives across
  // separate tool calls instead of relying on one caller's loop.
  const round = node.challengeRound + 1;
  if (round > MAX_DOMAIN_CHALLENGE_ROUNDS) {
    throw new AugmentModelError(`Challenge budget exhausted for ${input.nodeId}: selection is already permitted, or re-propose the domain.`, "node-state");
  }
  if (input.verdict.kind === "accept") {
    return { task: acceptDomain(task, { taskId: input.taskId, expectedRevision: input.expectedRevision, nodeId: input.nodeId, challengeRound: round }), outcome: "accepted" };
  }
  const proposal = input.verdict.kind === "missing-candidate"
    ? { label: input.verdict.candidate.label, rationale: `Missing family: ${input.verdict.reason}`, confidence: input.verdict.candidate.confidence, touchedPaths: input.verdict.candidate.touchedPaths, note: `the domain omits a materially distinct approach: ${input.verdict.reason}` }
    : { label: `Cover ${input.verdict.path}`, rationale: input.verdict.reason, confidence: 0, touchedPaths: [input.verdict.path], note: `challenge reported missing path ${input.verdict.path}: ${input.verdict.reason}` };
  let current: PlanTask;
  try {
    current = addCandidate(task, {
      taskId: input.taskId,
      expectedRevision: input.expectedRevision,
      nodeId: input.nodeId,
      candidate: {
        label: proposal.label,
        rationale: proposal.rationale,
        confidence: proposal.confidence,
        touchedPaths: proposal.touchedPaths,
      },
      reason: proposal.note,
    });
  } catch (error) {
    // A challenger candidate touching paths outside this node's scope is a
    // real dependency, but it cannot become a candidate here. Record it as a
    // constraint so the omission is not lost and keep going. Locked-path
    // proposals stay failures: the plain is controller authority.
    if (!(error instanceof PlanStateError) || error.code !== "scope-escape") throw error;
    current = addConstraint(task, {
      taskId: input.taskId,
      expectedRevision: input.expectedRevision,
      nodeId: input.nodeId,
      text: `Out-of-scope dependency noted by challenge: ${proposal.note} (paths: ${proposal.touchedPaths.join(", ")})`,
    });
  }
  current.nodes[input.nodeId]!.challengeRound = round;
  if (round >= MAX_DOMAIN_CHALLENGE_ROUNDS) {
    return {
      task: exhaustDomainChallenge(current, { taskId: input.taskId, expectedRevision: current.revision, nodeId: input.nodeId, challengeRound: MAX_DOMAIN_CHALLENGE_ROUNDS }),
      outcome: "exhausted",
    };
  }
  return { task: current, outcome: "counterexample" };
}

export async function crystallizeNode(runtime: ModelRuntime, task: PlanTask, input: CrystallizeNodeInput): Promise<PlanTask> {
  requireNode(task, input.nodeId);
  const proposal = await call(runtime, task, task.nodes[input.nodeId]!, "generate-domain", input.temperature, input.lod, parseWith(DomainProposalSchema));
  let current = applyDomainProposal(task, {
    taskId: task.id,
    expectedRevision: task.revision,
    nodeId: input.nodeId,
    candidates: proposal.candidates,
    replace: input.replace,
  });

  const rounds = Math.max(0, Math.min(input.challengeRounds ?? MAX_DOMAIN_CHALLENGE_ROUNDS, MAX_DOMAIN_CHALLENGE_ROUNDS));
  for (let round = 1; round <= rounds; round++) {
    const node = current.nodes[input.nodeId]!;
    const challenge = await call(runtime, current, node, "challenge-domain", input.temperature, input.lod, parseWith(ChallengeDomainSchema));
    const applied = applyChallenge(current, { taskId: current.id, expectedRevision: current.revision, nodeId: input.nodeId, verdict: challenge });
    current = applied.task;
    if (applied.outcome !== "counterexample") return current;
  }
  if (rounds === 0) return current;
  return exhaustDomainChallenge(current, {
    taskId: current.id,
    expectedRevision: current.revision,
    nodeId: input.nodeId,
    challengeRound: MAX_DOMAIN_CHALLENGE_ROUNDS,
  });
}

export async function refineWithModel(runtime: ModelRuntime, task: PlanTask, input: RefineWithModelInput): Promise<PlanTask> {
  const node = requireNode(task, input.nodeId);
  const proposal = await call(runtime, task, node, "refine-node", input.temperature, input.lod, parseWith(RefinementProposalSchema));
  return refineNode(task, {
    taskId: task.id,
    expectedRevision: task.revision,
    nodeId: input.nodeId,
    children: proposal.children,
  });
}

export async function draftPatchWithModel(runtime: ModelRuntime, task: PlanTask, input: DraftPatchWithModelInput): Promise<PlanTask> {
  const node = requireNode(task, input.nodeId);
  const proposal = await call(runtime, task, node, "draft-patch", input.temperature, node.lod, parseDraftReply);
  let current = attachPatch(task, { taskId: task.id, expectedRevision: task.revision, nodeId: input.nodeId, patch: proposal.patch });
  for (const assumption of proposal.assumptions) {
    current = addConstraint(current, { taskId: current.id, expectedRevision: current.revision, nodeId: input.nodeId, text: `Draft assumption: ${assumption}`, source: "model" });
  }
  return current;
}

export async function explainProjectWithModel(runtime: ModelRuntime, task: PlanTask, input: ExplainProjectWithModelInput): Promise<PlanTask> {
  const node = requireNode(task, input.nodeId ?? task.rootNodeId);
  const proposal = await call(runtime, task, node, "explain-project", input.temperature, "architecture", parseWith(ExplanationProposalSchema));
  return attachExplanations(task, {
    taskId: task.id,
    expectedRevision: task.revision,
    topic: proposal.topic,
    entries: proposal.entries,
  });
}

export async function repairPatchWithModel(runtime: ModelRuntime, task: PlanTask, input: RepairPatchWithModelInput): Promise<PlanTask> {
  const diff = task.diffs[input.diffId];
  if (!diff) throw new AugmentModelError(`Unknown planned diff: ${input.diffId}`, "unknown-diff");
  const node = requireNode(task, diff.nodeId);
  const proposal = await call(runtime, task, node, "repair-patch", input.temperature, node.lod, parseDraftReply);
  let current = replacePatch(task, {
    taskId: task.id,
    expectedRevision: task.revision,
    diffId: input.diffId,
    patch: proposal.patch,
    failedCheck: input.failedCheck,
  });
  for (const assumption of proposal.assumptions) {
    current = addConstraint(current, { taskId: current.id, expectedRevision: current.revision, nodeId: node.id, text: `Repair assumption: ${assumption}`, source: "model" });
  }
  return current;
}

export function selectCandidate(task: PlanTask, input: { taskId: string; expectedRevision: PlanRevision; nodeId: string; candidateId: string }): PlanTask {
  return collapseNode(task, input);
}

export type DevelopmentStep =
  | { action: "refine" }
  | { action: "crystallize" }
  | { action: "draft" }
  | { action: "choose"; count: number }
  | { action: "descend"; nodeId: string; path: string; step: "crystallize" | "refine" | "choose" | "draft" }
  | { action: "already-drafted" }
  | { action: "done" }
  | { action: "stalled"; reason: string };

function descendantsOf(task: PlanTask, nodeId: string): PlanNode[] {
  return Object.values(task.nodes).filter((candidate) => {
    if (candidate.id === nodeId) return false;
    let ancestor = candidate.parent;
    while (ancestor) {
      if (ancestor === nodeId) return true;
      ancestor = task.nodes[ancestor]?.parent;
    }
    return false;
  });
}

/** Undrafted file, hunk, and virtual descendants of a node, in path order. */
export function undraftedFileTargets(task: PlanTask, nodeId: string): PlanNode[] {
  return descendantsOf(task, nodeId)
    .filter((candidate) => ["file", "hunk", "virtual"].includes(candidate.kind) && candidate.diffIds.length === 0 && candidate.path)
    .sort((left, right) => (left.path ?? "").localeCompare(right.path ?? ""));
}

export interface DraftPatchesWithModelInput {
  taskId: string;
  nodeId: string;
  temperature: Temperature;
}

/**
 * One batched draft for every undrafted file target under a node: the model
 * sees the whole subtree in one prompt, so imports and shared types stay
 * coherent and one call replaces N sequential ones. All-or-nothing — every
 * patch is attached on a chain of pure reducers first, so an invalid or
 * incomplete batch leaves the task state untouched.
 */
export async function draftPatchesWithModel(runtime: ModelRuntime, task: PlanTask, input: DraftPatchesWithModelInput): Promise<PlanTask> {
  const node = requireNode(task, input.nodeId);
  const targets = undraftedFileTargets(task, input.nodeId);
  if (!targets.length) throw new AugmentModelError(`Node ${node.id} has no undrafted file targets to draft.`, "node-state");
  const proposal = await call(runtime, task, node, "draft-patches", input.temperature, node.lod, parseWith(BatchPatchProposalSchema), {
    draftTargets: targets.map((target) => ({ path: target.path! })),
  });
  const known = new Set(targets.map((target) => target.path!));
  for (const patch of proposal.patches) {
    if (!known.has(patch.path)) throw new AugmentModelError(`Batch draft names ${patch.path}, which is not an undrafted target under ${node.id}.`, "invalid-model-output");
  }
  const byPath = new Map(proposal.patches.map((patch) => [patch.path, patch.patch]));
  let current = task;
  for (const target of targets) {
    const patch = byPath.get(target.path!);
    if (!patch) throw new AugmentModelError(`Batch draft omits ${target.path}; a batch must cover every target.`, "invalid-model-output");
    current = attachPatch(current, { taskId: task.id, expectedRevision: current.revision, nodeId: target.id, patch });
  }
  return current;
}

/**
 * Decides the next deterministic development step for a node — the entire
 * "what does Develop do here" policy in one pure function. Hosts render the
 * result; they never re-derive the lifecycle.
 */
export function nextDevelopmentStep(task: PlanTask, nodeId: string): DevelopmentStep {
  const node = task.nodes[nodeId];
  if (!node) return { action: "stalled", reason: "Unknown plan node." };
  if (node.status === "stale") return { action: "stalled", reason: "This path is stale." };
  // A file, hunk, or virtual target develops by drafting its patch directly.
  // Its lifecycle state never reroutes it: a collapsed or domain file must
  // still draft, not refine into children or reopen an approach choice.
  const isFileTarget = ["file", "hunk", "virtual"].includes(node.kind);
  if (isFileTarget) return node.diffIds.length > 0 ? { action: "already-drafted" } : { action: "draft" };
  if (node.status === "collapsed") return { action: "refine" };
  if (node.status === "unresolved") return { action: "crystallize" };
  if (node.status === "domain") {
    const possible = node.candidateIds.map((id) => task.candidates[id]).filter((candidate) => candidate?.status === "possible");
    return possible.length ? { action: "choose", count: possible.length } : { action: "crystallize" };
  }
  if (node.status === "refined" || node.status === "ready") {
    const descendants = descendantsOf(task, nodeId);
    const nextFile = descendants.find((candidate) => ["file", "hunk", "virtual"].includes(candidate.kind) && candidate.diffIds.length === 0);
    if (nextFile?.path) return { action: "descend", nodeId: nextFile.id, path: nextFile.path, step: "draft" };
    // A collapsed child directory still owes its refinement before the
    // subtree can be done; report it so a host driving the whole subtree
    // keeps going instead of stopping at an incomplete frontier.
    const nextCollapsedDir = descendants.find((candidate) => candidate.kind === "dir" && candidate.status === "collapsed" && candidate.diffIds.length === 0);
    if (nextCollapsedDir?.path) return { action: "descend", nodeId: nextCollapsedDir.id, path: nextCollapsedDir.path, step: "refine" };
    const nextDir = descendants.find((candidate) => candidate.kind === "dir" && candidate.diffIds.length === 0 && ["unresolved", "domain"].includes(candidate.status));
    if (nextDir?.path) {
      const possible = nextDir.candidateIds.map((id) => task.candidates[id]).filter((candidate) => candidate?.status === "possible");
      const step = nextDir.status === "unresolved" || !possible.length ? "crystallize" : "choose";
      return { action: "descend", nodeId: nextDir.id, path: nextDir.path, step };
    }
    return { action: "done" };
  }
  return { action: "stalled", reason: `This path is ${node.status}.` };
}
