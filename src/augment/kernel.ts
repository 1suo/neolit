import {
  ChallengeDomainSchema,
  DomainProposalSchema,
  ExplanationProposalSchema,
  PatchProposalSchema,
  RefinementProposalSchema,
} from "./schemas.js";
import {
  acceptDomain,
  addCandidate,
  addConstraint,
  attachExplanations,
  attachPatch,
  collapseNode,
  exhaustDomainChallenge,
  generateDomain,
  refineNode,
  replacePatch,
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

export class AugmentModelError extends Error {
  constructor(message: string) {
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
  if (!node) throw new AugmentModelError(`Unknown plan node: ${nodeId}`);
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
): Promise<T> {
  const result = await runtime.call({
    operation,
    context: context(task, node),
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

export async function crystallizeNode(runtime: ModelRuntime, task: PlanTask, input: CrystallizeNodeInput): Promise<PlanTask> {
  requireNode(task, input.nodeId);
  const proposal = await call(runtime, task, task.nodes[input.nodeId]!, "generate-domain", input.temperature, input.lod, parseWith(DomainProposalSchema));
  let current = generateDomain(task, {
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
    if (challenge.kind === "accept") {
      current = acceptDomain(current, { taskId: current.id, expectedRevision: current.revision, nodeId: input.nodeId, challengeRound: round });
      return current;
    }
    const proposal = challenge.kind === "missing-candidate"
      ? { label: challenge.candidate.label, rationale: `Missing family: ${challenge.reason}`, confidence: challenge.candidate.confidence, touchedPaths: challenge.candidate.touchedPaths, note: `the domain omits a materially distinct approach: ${challenge.reason}` }
      : { label: `Cover ${challenge.path}`, rationale: challenge.reason, confidence: 0, touchedPaths: [challenge.path], note: `challenge reported missing path ${challenge.path}: ${challenge.reason}` };
    try {
      current = addCandidate(current, {
        taskId: current.id,
        expectedRevision: current.revision,
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
      // constraint so the omission is not lost and keep going.
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("escapes") && !message.includes("scope")) throw error;
      current = addConstraint(current, {
        taskId: current.id,
        expectedRevision: current.revision,
        nodeId: input.nodeId,
        text: `Out-of-scope dependency noted by challenge: ${proposal.note} (paths: ${proposal.touchedPaths.join(", ")})`,
      });
    }
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
  const proposal = await call(runtime, task, node, "draft-patch", input.temperature, node.lod, parseWith(PatchProposalSchema));
  return attachPatch(task, { taskId: task.id, expectedRevision: task.revision, nodeId: input.nodeId, patch: proposal.patch });
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
  if (!diff) throw new AugmentModelError(`Unknown planned diff: ${input.diffId}`);
  const node = requireNode(task, diff.nodeId);
  const proposal = await call(runtime, task, node, "repair-patch", input.temperature, node.lod, parseWith(PatchProposalSchema));
  return replacePatch(task, {
    taskId: task.id,
    expectedRevision: task.revision,
    diffId: input.diffId,
    patch: proposal.patch,
    failedCheck: input.failedCheck,
  });
}

export function selectCandidate(task: PlanTask, input: { taskId: string; expectedRevision: PlanRevision; nodeId: string; candidateId: string }): PlanTask {
  return collapseNode(task, input);
}

export type DevelopmentStep =
  | { action: "refine" }
  | { action: "crystallize" }
  | { action: "draft" }
  | { action: "choose"; count: number }
  | { action: "descend"; nodeId: string; path: string; step: "crystallize" | "choose" | "draft" }
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

/**
 * Decides the next deterministic development step for a node — the entire
 * "what does Develop do here" policy in one pure function. Hosts render the
 * result; they never re-derive the lifecycle.
 */
export function nextDevelopmentStep(task: PlanTask, nodeId: string): DevelopmentStep {
  const node = task.nodes[nodeId];
  if (!node) return { action: "stalled", reason: "Unknown plan node." };
  if (node.status === "stale" || node.status === "blocked") return { action: "stalled", reason: `This path is ${node.status}.` };
  const isFileTarget = ["file", "hunk", "virtual"].includes(node.kind);
  if (node.status === "collapsed") return { action: "refine" };
  if (isFileTarget) return node.diffIds.length > 0 ? { action: "already-drafted" } : { action: "draft" };
  if (node.status === "unresolved") return { action: "crystallize" };
  if (node.status === "domain") {
    const possible = node.candidateIds.map((id) => task.candidates[id]).filter((candidate) => candidate?.status === "possible");
    return possible.length ? { action: "choose", count: possible.length } : { action: "crystallize" };
  }
  if (node.status === "refined" || node.status === "ready") {
    const descendants = descendantsOf(task, nodeId);
    const nextFile = descendants.find((candidate) => ["file", "hunk", "virtual"].includes(candidate.kind) && candidate.diffIds.length === 0);
    if (nextFile?.path) return { action: "descend", nodeId: nextFile.id, path: nextFile.path, step: "draft" };
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
