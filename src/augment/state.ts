import {
  type LOD,
  type PathExplanation,
  type PathPattern,
  type PlanCandidate,
  type PlanCandidateId,
  type PlanConstraint,
  type PlanConstraintId,
  type PlanDiffId,
  type PlanEvent,
  type PlanEvidence,
  type PlanEvidenceId,
  type PlanNode,
  type PlanNodeId,
  type PlanObligation,
  type PlanObligationId,
  type PlanRevision,
  type PlanTask,
  type PlanTaskMode,
  type PlanTreeEntry,
  type PlannedDiff,
  type PlannedDiffKind,
} from "./types.js";

export const MAX_CANDIDATES_PER_NODE = 7;
export const MAX_CHILDREN_PER_NODE = 16;
const ROOT_PATH = ".";

export class PlanStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanStateError";
  }
}

export interface CreatePlanTaskInput {
  id: string;
  objective: string;
  basisRevision: string;
  mode?: PlanTaskMode;
}

export interface DomainCandidateInput {
  label: string;
  rationale: string;
  confidence: number;
  touchedPaths: PathPattern[];
}

export interface GenerateDomainInput {
  taskId: string;
  expectedRevision: PlanRevision;
  nodeId: PlanNodeId;
  candidates: DomainCandidateInput[];
  replace?: boolean;
}

export interface AddCandidateInput {
  taskId: string;
  expectedRevision: PlanRevision;
  nodeId: PlanNodeId;
  candidate: DomainCandidateInput;
  reason: string;
}

export interface AddConstraintInput {
  taskId: string;
  expectedRevision: PlanRevision;
  nodeId?: PlanNodeId;
  path?: PathPattern;
  text: string;
}

export interface CollapseInput {
  taskId: string;
  expectedRevision: PlanRevision;
  nodeId: PlanNodeId;
  candidateId: PlanCandidateId;
}

export interface RejectCandidateInput {
  taskId: string;
  expectedRevision: PlanRevision;
  candidateId: PlanCandidateId;
  reason: string;
}

export interface RefinementChildInput {
  path?: PathPattern;
  kind: "dir" | "file" | "hunk" | "virtual";
  lod: LOD;
  reason: string;
  obligations?: Array<{ kind: PlanObligation["kind"]; description: string }>;
  diff?: { patch: string };
}

export interface RefineNodeInput {
  taskId: string;
  expectedRevision: PlanRevision;
  nodeId: PlanNodeId;
  children: RefinementChildInput[];
}

export interface ReopenNodeInput {
  taskId: string;
  expectedRevision: PlanRevision;
  nodeId: PlanNodeId;
  reason: string;
}

export interface AttachPatchInput {
  taskId: string;
  expectedRevision: PlanRevision;
  nodeId: PlanNodeId;
  patch: string;
}

export interface MarkStaleInput {
  taskId: string;
  expectedRevision: PlanRevision;
  path: string;
}

export interface SetPathLockInput {
  taskId: string;
  expectedRevision: PlanRevision;
  path: string;
  locked: boolean;
}

export interface PathExplanationInput {
  path: PathPattern;
  role: PathExplanation["role"];
  summary: string;
  detail: string;
  confidence: number;
}

export interface AttachExplanationsInput {
  taskId: string;
  expectedRevision: PlanRevision;
  topic: string;
  entries: PathExplanationInput[];
}

function clone<T extends PlanTask>(task: T): T {
  return structuredClone(task);
}

function nextRevision(task: PlanTask): number {
  return task.revision + 1;
}

function nextId(prefix: string, existing: Iterable<string>): string {
  let max = 0;
  for (const id of existing) {
    const match = id.match(new RegExp(`^${prefix}(\\d+)$`));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}${max + 1}`;
}

export function normalizePath(input: string): string {
  if (input === "" || input === ROOT_PATH) return ROOT_PATH;
  if (input.includes("\\") || input.includes("\0")) throw new PlanStateError(`Plan path must use POSIX separators: ${input}`);
  const parts: string[] = [];
  for (const part of input.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") throw new PlanStateError(`Plan path may not contain '..': ${input}`);
    parts.push(part);
  }
  if (!parts.length) return ROOT_PATH;
  return parts.join("/");
}

function validateConcretePath(input: string | undefined, kind: PlanNode["kind"]): string | undefined {
  if (kind === "virtual") {
    if (input !== undefined) throw new PlanStateError("A virtual node may not declare a repository path.");
    return undefined;
  }
  if (input === undefined) throw new PlanStateError(`A ${kind} node requires a path.`);
  const normalized = normalizePath(input);
  if (normalized.includes("*") || normalized.includes("?") || normalized.includes("[")) throw new PlanStateError(`Node paths must be concrete: ${input}`);
  if (kind === "hunk" && normalized === ROOT_PATH) throw new PlanStateError("A hunk node requires a file path.");
  return normalized;
}

function validatePathPattern(input: string): PathPattern {
  const normalized = normalizePath(input);
  if (normalized === ROOT_PATH) throw new PlanStateError("A touched path may not be the repository root.");
  return normalized;
}

function pathInside(parent: PathPattern | undefined, child: string): boolean {
  if (!parent || parent === ROOT_PATH) return true;
  if (child === parent) return true;
  return child.startsWith(`${parent}/`);
}

function globToRegExp(pattern: string): RegExp {
  let expression = "^";
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index]!;
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        expression += "[\\s\\S]*";
        index++;
        if (pattern[index + 1] === "/") index++;
      } else {
        expression += "[^/]*";
      }
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${expression}$`);
}

/**
 * One restriction plain: `lockedPaths` is the marked set and
 * `restrictionMode` is its polarity. In "lock" mode the marked set is
 * forbidden and everything else is free; in "allow" mode the marked set is
 * the only thing that may change and everything else is locked. What is not
 * allowed is locked; what is not locked is allowed.
 */
export function markedCovers(task: PlanTask, path: string): boolean {
  const normalized = normalizePath(path);
  return task.lockedPaths.some((marked) => {
    if (normalized === marked || normalized.startsWith(`${marked}/`)) return true;
    return globToRegExp(marked).test(normalized);
  });
}

export function pathIsLocked(task: PlanTask, path: string): boolean {
  if (task.restrictionMode === "allow") {
    if (!task.lockedPaths.length) return true;
    return !markedCovers(task, path);
  }
  const normalized = normalizePath(path);
  if (normalized === ROOT_PATH) return task.lockedPaths.length > 0;
  return markedCovers(task, path);
}

/**
 * Paths in `touchedPaths` that fall outside the node's own subtree. Root
 * nodes impose no scope. The kernel uses this to split model proposals into
 * in-scope work and out-of-scope dependencies instead of failing them.
 */
export function candidateScopeEscapes(task: PlanTask, nodeId: string, touchedPaths: readonly string[]): string[] {
  const node = task.nodes[nodeId];
  if (!node?.path || node.kind === "root") return [];
  return touchedPaths.filter((pattern) => !pathInside(node.path!, normalizePath(pattern)));
}

export function pathIsAllowed(task: PlanTask, path: string): boolean {
  return !pathIsLocked(task, path);
}

function patternInsideMarkedSet(task: PlanTask, pattern: PathPattern): boolean {
  const normalized = normalizePath(pattern);
  return task.lockedPaths.some((marked) => {
    if (normalized === marked || normalized.startsWith(`${marked}/`) || marked.startsWith(`${normalized}/`)) return true;
    return globToRegExp(marked).test(normalized) || globToRegExp(normalized).test(marked);
  });
}

function requireChangeablePattern(task: PlanTask, label: string, pattern: PathPattern): void {
  if (task.restrictionMode === "allow") {
    if (!task.lockedPaths.length || !patternInsideMarkedSet(task, pattern)) throw new PlanStateError(`Candidate ${label} escapes the allowed paths: ${pattern}`);
    return;
  }
  if (patternInsideMarkedSet(task, pattern)) throw new PlanStateError(`Candidate ${label} touches locked path: ${pattern}`);
}

function requireChangeablePath(task: PlanTask, path: string): void {
  if (pathIsLocked(task, path)) throw new PlanStateError(`Path is ${task.restrictionMode === "allow" ? "outside the allowed paths" : "locked"} for this run: ${path}`);
}

export function classifyPatchKind(patch: string): PlannedDiffKind {
  if (/(^|\n)new file mode\b/i.test(patch) || /(^|\n)---\s+\/dev\/null\b/.test(patch)) return "new";
  if (/(^|\n)deleted file mode\b/i.test(patch) || /(^|\n)\+\+\+\s+\/dev\/null\b/.test(patch)) return "delete";
  if (/(^|\n)(diff --git|---\s+[^\n]+\n\+\+\+\s+[^\n]+)/.test(patch)) return "modify";
  return "unknown";
}

export function createPlanTask(input: CreatePlanTaskInput): PlanTask {
  if (!input.id.trim()) throw new PlanStateError("Task ID is required.");
  if (!input.objective.trim()) throw new PlanStateError("Task objective is required.");
  if (!input.basisRevision.trim()) throw new PlanStateError("Task basis revision is required.");
  const root: PlanNode = {
    id: "node:root",
    kind: "root",
    path: ROOT_PATH,
    status: "unresolved",
    lod: "architecture",
    reason: input.objective,
    candidateIds: [],
    acceptedDomain: false,
    challengeExhausted: false,
    challengeRound: 0,
    constraintIds: [],
    evidenceIds: [],
    obligationIds: [],
    explanationIds: [],
    diffIds: [],
  };
  return {
    version: 1,
    id: input.id,
    mode: input.mode ?? "change",
    objective: input.objective,
    basisRevision: input.basisRevision,
    revision: 1,
    rootNodeId: root.id,
    lockedPaths: [],
    restrictionMode: "lock",
    nodes: { [root.id]: root },
    candidates: {},
    constraints: {},
    evidence: {},
    explanations: {},
    obligations: {},
    diffs: {},
    events: [{ type: "task-created", revision: 1, objective: input.objective }],
  };
}

function requireTask(task: PlanTask | undefined, taskId: string): PlanTask {
  if (!task || task.id !== taskId) throw new PlanStateError(`Unknown task: ${taskId}`);
  return task;
}

function requireRevision(task: PlanTask, expectedRevision: PlanRevision): void {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new PlanStateError("Expected revision must be a positive integer.");
  if (task.revision !== expectedRevision) throw new PlanStateError(`Stale task revision: expected ${expectedRevision}, current ${task.revision}.`);
}

function requireNode(task: PlanTask, nodeId: PlanNodeId): PlanNode {
  const node = task.nodes[nodeId];
  if (!node) throw new PlanStateError(`Unknown plan node: ${nodeId}`);
  return node;
}

function candidateInputsValid(candidates: DomainCandidateInput[]): void {
  if (!candidates.length) throw new PlanStateError("A candidate domain requires at least one candidate.");
  if (candidates.length > MAX_CANDIDATES_PER_NODE) throw new PlanStateError(`A candidate domain may contain at most ${MAX_CANDIDATES_PER_NODE} candidates.`);
  const labels = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.label.trim()) throw new PlanStateError("Every candidate requires a label.");
    const key = candidate.label.trim().toLowerCase();
    if (labels.has(key)) throw new PlanStateError(`Duplicate candidate label: ${candidate.label}`);
    labels.add(key);
    if (!candidate.rationale.trim()) throw new PlanStateError(`Candidate ${candidate.label} requires a rationale.`);
    if (!Number.isSafeInteger(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 100) throw new PlanStateError(`Candidate ${candidate.label} confidence must be an integer from 0 through 100.`);
    if (!candidate.touchedPaths.length) throw new PlanStateError(`Candidate ${candidate.label} must touch at least one path.`);
    for (const path of candidate.touchedPaths) validatePathPattern(path);
  }
}

function addCandidateRecord(task: PlanTask, node: PlanNode, input: DomainCandidateInput): PlanCandidate {
  const id = nextId(`candidate:${node.id}:`, Object.keys(task.candidates));
  const candidate: PlanCandidate = {
    id,
    nodeId: node.id,
    label: input.label.trim(),
    rationale: input.rationale.trim(),
    confidence: input.confidence,
    touchedPaths: [...new Set(input.touchedPaths.map(validatePathPattern))].sort(),
    status: "possible",
  };
  task.candidates[id] = candidate;
  node.candidateIds.push(id);
  return candidate;
}

function emit(task: PlanTask, event: PlanEvent): void {
  task.events.push(event);
}

function propagateReadiness(task: PlanTask, nodeId: PlanNodeId): void {
  const node = task.nodes[nodeId];
  if (!node || node.status === "stale" || node.status === "blocked") return;
  if (node.diffIds.length) {
    const obligations = node.obligationIds.map((id) => task.obligations[id]!);
    if (obligations.every((obligation) => obligation.status === "satisfied")) node.status = "ready";
    return;
  }
  const children = Object.values(task.nodes).filter((child) => child.parent === node.id);
  if (children.length) {
    if (children.every((child) => child.status === "ready")) node.status = "ready";
    else if (node.status === "ready") node.status = node.selectedCandidateId ? "refined" : "collapsed";
  }
}

export function generateDomain(task: PlanTask, input: GenerateDomainInput): PlanTask {
  const next = clone(requireTask(task, input.taskId));
  requireRevision(next, input.expectedRevision);
  const node = requireNode(next, input.nodeId);
  candidateInputsValid(input.candidates);
  for (const candidate of input.candidates) {
    for (const rawPath of candidate.touchedPaths) {
      const candidatePath = validatePathPattern(rawPath);
      if (node.path && node.kind !== "root" && !pathInside(node.path, candidatePath)) throw new PlanStateError(`Candidate ${candidate.label} escapes ${node.id} scope ${node.path}: ${candidatePath}`);
      requireChangeablePattern(next, candidate.label, candidatePath);
    }
  }
  if (node.status === "stale" || node.status === "blocked") throw new PlanStateError(`Cannot generate a domain for ${node.id} while it is ${node.status}.`);
  if (node.selectedCandidateId) throw new PlanStateError(`Cannot replace the collapsed domain for ${node.id}; reopen it first.`);
  const existingPossible = node.candidateIds.map((id) => next.candidates[id]!).filter((candidate) => candidate.status === "possible");
  if (existingPossible.length && !input.replace) throw new PlanStateError(`Node ${node.id} already has a live candidate domain.`);
  for (const candidate of existingPossible) {
    candidate.status = "eliminated";
    candidate.eliminationReason = "superseded by domain regeneration";
  }
  const added = input.candidates.map((candidate) => addCandidateRecord(next, node, candidate));
  node.acceptedDomain = false;
  node.challengeExhausted = false;
  node.challengeRound = 0;
  node.status = "domain";
  next.revision = nextRevision(next);
  emit(next, { type: "domain-generated", revision: next.revision, nodeId: node.id, candidateIds: added.map((candidate) => candidate.id) });
  return next;
}

export function acceptDomain(task: PlanTask, input: { taskId: string; expectedRevision: PlanRevision; nodeId: PlanNodeId; challengeRound: number }): PlanTask {
  const next = clone(requireTask(task, input.taskId));
  requireRevision(next, input.expectedRevision);
  const node = requireNode(next, input.nodeId);
  const possible = node.candidateIds.map((id) => next.candidates[id]!).filter((candidate) => candidate.status === "possible");
  if (!possible.length) throw new PlanStateError(`Cannot accept an empty domain for ${node.id}.`);
  if (!Number.isSafeInteger(input.challengeRound) || input.challengeRound < 1) throw new PlanStateError("Domain acceptance requires a positive challenge round.");
  node.acceptedDomain = true;
  node.challengeExhausted = false;
  node.challengeRound = input.challengeRound;
  if (node.status === "unresolved" || node.status === "stale") node.status = "domain";
  next.revision = nextRevision(next);
  emit(next, { type: "domain-accepted", revision: next.revision, nodeId: node.id, challengeRound: input.challengeRound });
  return next;
}

export function exhaustDomainChallenge(task: PlanTask, input: { taskId: string; expectedRevision: PlanRevision; nodeId: PlanNodeId; challengeRound: number }): PlanTask {
  const next = clone(requireTask(task, input.taskId));
  requireRevision(next, input.expectedRevision);
  const node = requireNode(next, input.nodeId);
  const possible = node.candidateIds.map((id) => next.candidates[id]!).filter((candidate) => candidate.status === "possible");
  if (!possible.length) throw new PlanStateError(`Cannot exhaust an empty domain for ${node.id}.`);
  if (!Number.isSafeInteger(input.challengeRound) || input.challengeRound < 1) throw new PlanStateError("Challenge exhaustion requires a positive challenge round.");
  node.acceptedDomain = false;
  node.challengeExhausted = true;
  node.challengeRound = input.challengeRound;
  if (node.status === "unresolved" || node.status === "stale") node.status = "domain";
  next.revision = nextRevision(next);
  emit(next, { type: "domain-challenge-exhausted", revision: next.revision, nodeId: node.id, challengeRound: input.challengeRound });
  return next;
}

export function addCandidate(task: PlanTask, input: AddCandidateInput): PlanTask {
  const next = clone(requireTask(task, input.taskId));
  requireRevision(next, input.expectedRevision);
  const node = requireNode(next, input.nodeId);
  candidateInputsValid([input.candidate]);
  for (const rawPath of input.candidate.touchedPaths) {
    const candidatePath = validatePathPattern(rawPath);
    if (node.path && node.kind !== "root" && !pathInside(node.path, candidatePath)) throw new PlanStateError(`Candidate ${input.candidate.label} escapes ${node.id} scope ${node.path}: ${candidatePath}`);
    requireChangeablePattern(next, input.candidate.label, candidatePath);
  }
  if (node.selectedCandidateId) throw new PlanStateError(`Cannot add a candidate to collapsed node ${node.id}.`);
  const count = node.candidateIds.map((id) => next.candidates[id]!).filter((candidate) => candidate.status === "possible").length;
  if (count >= MAX_CANDIDATES_PER_NODE) throw new PlanStateError(`Node ${node.id} already has the maximum ${MAX_CANDIDATES_PER_NODE} live candidates.`);
  const candidate = addCandidateRecord(next, node, input.candidate);
  node.acceptedDomain = false;
  node.challengeExhausted = false;
  if (node.status === "unresolved") node.status = "domain";
  next.revision = nextRevision(next);
  emit(next, { type: "candidate-added", revision: next.revision, nodeId: node.id, candidateId: candidate.id, reason: input.reason });
  return next;
}

export function addConstraint(task: PlanTask, input: AddConstraintInput): PlanTask {
  const next = clone(requireTask(task, input.taskId));
  requireRevision(next, input.expectedRevision);
  if (!input.text.trim()) throw new PlanStateError("Constraint text is required.");
  if (input.nodeId) requireNode(next, input.nodeId);
  const path = input.path === undefined ? undefined : validatePathPattern(input.path);
  const id = nextId("constraint:", Object.keys(next.constraints));
  const constraint: PlanConstraint = {
    id,
    nodeId: input.nodeId,
    path,
    text: input.text.trim(),
    source: "user",
    createdRevision: next.revision + 1,
  };
  next.constraints[id] = constraint;
  if (input.nodeId) next.nodes[input.nodeId]!.constraintIds.push(id);
  next.revision = nextRevision(next);
  emit(next, { type: "constraint-added", revision: next.revision, constraintId: id });
  return next;
}

export function rejectCandidate(task: PlanTask, input: RejectCandidateInput): PlanTask {
  const next = clone(requireTask(task, input.taskId));
  requireRevision(next, input.expectedRevision);
  const candidate = next.candidates[input.candidateId];
  if (!candidate) throw new PlanStateError(`Unknown plan candidate: ${input.candidateId}`);
  if (!input.reason.trim()) throw new PlanStateError("Rejecting a candidate requires a reason.");
  if (candidate.status === "selected") throw new PlanStateError("Cannot reject the selected candidate; reopen the node first.");
  candidate.status = "eliminated";
  candidate.eliminationReason = input.reason;
  next.revision = nextRevision(next);
  emit(next, { type: "candidate-rejected", revision: next.revision, candidateId: candidate.id, reason: input.reason });
  return next;
}

export function collapseNode(task: PlanTask, input: CollapseInput): PlanTask {
  const next = clone(requireTask(task, input.taskId));
  requireRevision(next, input.expectedRevision);
  const node = requireNode(next, input.nodeId);
  const candidate = next.candidates[input.candidateId];
  if (!candidate || candidate.nodeId !== node.id) throw new PlanStateError(`Candidate ${input.candidateId} does not belong to ${node.id}.`);
  for (const path of candidate.touchedPaths) requireChangeablePattern(next, candidate.label, path);
  if (candidate.status !== "possible") throw new PlanStateError(`Only a possible candidate can collapse ${node.id}; ${candidate.id} is ${candidate.status}.`);
  if (!node.acceptedDomain && !node.challengeExhausted) throw new PlanStateError(`Domain for ${node.id} must be challenged and accepted before collapse.`);
  for (const siblingId of node.candidateIds) {
    const sibling = next.candidates[siblingId]!;
    if (sibling.id === candidate.id) continue;
    if (sibling.status === "possible") {
      sibling.status = "eliminated";
      sibling.eliminationReason = `superseded by selected candidate ${candidate.id}`;
    }
  }
  candidate.status = "selected";
  node.selectedCandidateId = candidate.id;
  node.status = "collapsed";
  next.revision = nextRevision(next);
  emit(next, { type: "node-collapsed", revision: next.revision, nodeId: node.id, candidateId: candidate.id });
  return next;
}

function createRefinementChild(task: PlanTask, parent: PlanNode, input: RefinementChildInput, ordinal: number): PlanNode {
  const path = validateConcretePath(input.path, input.kind);
  if (!pathInside(parent.path, path ?? ROOT_PATH) && input.kind !== "virtual") throw new PlanStateError(`Refined path ${path} escapes parent scope ${parent.path}.`);
  if (path && input.kind !== "virtual") requireChangeablePath(task, path);
  if (input.kind !== "virtual") {
    const duplicate = Object.values(task.nodes).some((node) => node.path === path && node.kind === input.kind && node.parent === parent.id);
    if (duplicate) throw new PlanStateError(`Refinement already contains ${input.kind} ${path}.`);
  }
  const id = `node:${parent.id}/${input.kind}:${ordinal}:${nextId("seq", Object.keys(task.nodes).map((key) => key.split(":").at(-1) ?? "0"))}`;
  const child: PlanNode = {
    id,
    parent: parent.id,
    kind: input.kind,
    path,
    status: "unresolved",
    lod: input.lod,
    reason: input.reason,
    candidateIds: [],
    acceptedDomain: false,
    challengeExhausted: false,
    challengeRound: 0,
    constraintIds: [],
    evidenceIds: [],
    obligationIds: [],
    explanationIds: [],
    diffIds: [],
  };
  task.nodes[id] = child;
  for (const obligation of input.obligations ?? []) {
    if (!obligation.description.trim()) throw new PlanStateError("Every refinement obligation requires a description.");
    const obligationId = nextId("obligation:", Object.keys(task.obligations));
    task.obligations[obligationId] = { id: obligationId, nodeId: id, kind: obligation.kind, description: obligation.description, status: "open" };
    child.obligationIds.push(obligationId);
  }
  if (input.diff) {
    const diffId = nextId("diff:", Object.keys(task.diffs));
    task.diffs[diffId] = { id: diffId, nodeId: id, path: path ?? "", patch: input.diff.patch, kind: classifyPatchKind(input.diff.patch), basisRevision: task.basisRevision };
    child.diffIds.push(diffId);
  }
  return child;
}

export function reopenNode(task: PlanTask, input: ReopenNodeInput): PlanTask {
  const next = clone(requireTask(task, input.taskId));
  requireRevision(next, input.expectedRevision);
  const node = requireNode(next, input.nodeId);
  if (!input.reason.trim()) throw new PlanStateError("Reopening a node requires a reason.");
  if (!node.selectedCandidateId && !Object.values(next.nodes).some((child) => child.parent === node.id)) {
    throw new PlanStateError(`Node ${node.id} has no committed refinement to reopen.`);
  }

  const descendants: PlanNode[] = [];
  const visit = (current: PlanNodeId) => {
    for (const child of Object.values(next.nodes).filter((candidate) => candidate.parent === current)) {
      descendants.push(child);
      visit(child.id);
    }
  };
  visit(node.id);
  for (const descendant of descendants) {
    for (const candidateId of descendant.candidateIds) delete next.candidates[candidateId];
    for (const constraintId of descendant.constraintIds) delete next.constraints[constraintId];
    for (const evidenceId of descendant.evidenceIds) delete next.evidence[evidenceId];
    for (const obligationId of descendant.obligationIds) delete next.obligations[obligationId];
    for (const diffId of descendant.diffIds) delete next.diffs[diffId];
    delete next.nodes[descendant.id];
  }
  for (const candidateId of node.candidateIds) {
    const candidate = next.candidates[candidateId];
    if (candidate?.status === "selected") {
      candidate.status = "possible";
      delete candidate.eliminationReason;
    }
  }
  node.status = "unresolved";
  node.selectedCandidateId = undefined;
  node.acceptedDomain = false;
  node.challengeExhausted = false;
  node.challengeRound = 0;
  node.diffIds = [];
  node.obligationIds = node.obligationIds.filter((id) => next.obligations[id] !== undefined);
  next.revision = nextRevision(next);
  emit(next, { type: "node-reopened", revision: next.revision, nodeId: node.id, reason: input.reason });
  return next;
}

export function refineNode(task: PlanTask, input: RefineNodeInput): PlanTask {
  const next = clone(requireTask(task, input.taskId));
  requireRevision(next, input.expectedRevision);
  const node = requireNode(next, input.nodeId);
  if (!node.selectedCandidateId) throw new PlanStateError(`Node ${node.id} must be collapsed before refinement.`);
  if (node.status === "stale" || node.status === "blocked") throw new PlanStateError(`Cannot refine ${node.id} while it is ${node.status}.`);
  if (!input.children.length) throw new PlanStateError("Refinement requires at least one child.");
  if (input.children.length > MAX_CHILDREN_PER_NODE) throw new PlanStateError(`Refinement may contain at most ${MAX_CHILDREN_PER_NODE} children.`);
  if (Object.values(next.nodes).some((child) => child.parent === node.id)) throw new PlanStateError(`Node ${node.id} already has a refinement; reopen it before refining again.`);
  const children = input.children.map((child, index) => createRefinementChild(next, node, child, index + 1));
  node.status = "refined";
  next.revision = nextRevision(next);
  emit(next, { type: "node-refined", revision: next.revision, nodeId: node.id, childIds: children.map((child) => child.id) });
  for (const child of children) propagateReadiness(next, child.id);
  propagateReadiness(next, node.id);
  return next;
}

export interface ReplacePatchInput {
  taskId: string;
  expectedRevision: PlanRevision;
  diffId: PlanDiffId;
  patch: string;
  failedCheck?: string;
}

export function replacePatch(task: PlanTask, input: ReplacePatchInput): PlanTask {
  const next = clone(requireTask(task, input.taskId));
  requireRevision(next, input.expectedRevision);
  const diff = next.diffs[input.diffId];
  if (!diff) throw new PlanStateError(`Unknown planned diff: ${input.diffId}`);
  const node = requireNode(next, diff.nodeId);
  if (node.status === "stale" || node.status === "blocked") throw new PlanStateError(`Cannot repair a patch on ${node.id} while it is ${node.status}.`);
  if (!input.patch.trim()) throw new PlanStateError("A replacement patch may not be empty.");
  if (node.path) requireChangeablePath(next, node.path);
  diff.patch = input.patch;
  diff.kind = classifyPatchKind(input.patch);
  diff.failedCheck = input.failedCheck;
  next.revision = nextRevision(next);
  emit(next, { type: "patch-attached", revision: next.revision, nodeId: node.id, diffId: diff.id });
  return next;
}

export function attachPatch(task: PlanTask, input: AttachPatchInput): PlanTask {
  const next = clone(requireTask(task, input.taskId));
  requireRevision(next, input.expectedRevision);
  const node = requireNode(next, input.nodeId);
  if (node.status === "stale" || node.status === "blocked") throw new PlanStateError(`Cannot attach a patch to ${node.id} while it is ${node.status}.`);
  if (node.kind === "dir" || node.kind === "root") throw new PlanStateError(`A patch must target a file, hunk, or virtual node, not ${node.kind}.`);
  if (!input.patch.trim()) throw new PlanStateError("A planned patch may not be empty.");
  if (node.path) requireChangeablePath(next, node.path);
  const id = nextId("diff:", Object.keys(next.diffs));
  const diff: PlannedDiff = { id, nodeId: node.id, path: node.path ?? "", patch: input.patch, kind: classifyPatchKind(input.patch), basisRevision: next.basisRevision };
  next.diffs[id] = diff;
  node.diffIds.push(id);
  next.revision = nextRevision(next);
  emit(next, { type: "patch-attached", revision: next.revision, nodeId: node.id, diffId: id });
  propagateReadiness(next, node.id);
  let current: PlanNode | undefined = node.parent ? next.nodes[node.parent] : undefined;
  while (current) {
    propagateReadiness(next, current.id);
    current = current.parent ? next.nodes[current.parent] : undefined;
  }
  return next;
}

function markSubtreeStale(task: PlanTask, nodeId: PlanNodeId, path: string): PlanNode[] {
  const affected: PlanNode[] = [];
  const visit = (id: PlanNodeId) => {
    const node = task.nodes[id];
    if (!node) return;
    affected.push(node);
    if (node.status !== "stale") {
      node.status = "stale";
      node.acceptedDomain = false;
      emit(task, { type: "node-staled", revision: task.revision, nodeId: node.id, path });
    }
    for (const child of Object.values(task.nodes).filter((candidate) => candidate.parent === node.id)) visit(child.id);
  };
  visit(nodeId);
  return affected;
}

export function attachExplanations(task: PlanTask, input: AttachExplanationsInput): PlanTask {
  const next = clone(requireTask(task, input.taskId));
  requireRevision(next, input.expectedRevision);
  if (!input.topic.trim()) throw new PlanStateError("Explanation topic is required.");
  if (!input.entries.length) throw new PlanStateError("An explanation requires at least one path.");
  if (input.entries.length > 64) throw new PlanStateError("An explanation may contain at most 64 paths.");

  next.explanations = {};
  const ids: PlanEvidenceId[] = [];
  for (const entry of input.entries) {
    const explainedPath = normalizePath(entry.path);
    if (explainedPath === ROOT_PATH) throw new PlanStateError("Explain a concrete file or directory, not the repository root.");
    if (/[?*[]/.test(explainedPath)) throw new PlanStateError(`Explanation paths must be concrete: ${entry.path}`);
    if (!entry.summary.trim() || !entry.detail.trim()) throw new PlanStateError(`Explanation for ${entry.path} requires a summary and detail.`);
    if (!Number.isSafeInteger(entry.confidence) || entry.confidence < 0 || entry.confidence > 100) throw new PlanStateError(`Explanation confidence for ${entry.path} must be an integer from 0 through 100.`);
    const id = nextId("explanation:", Object.keys(next.explanations));
    next.explanations[id] = {
      id,
      topic: input.topic.trim(),
      path: explainedPath,
      role: entry.role,
      summary: entry.summary.trim(),
      detail: entry.detail.trim(),
      confidence: entry.confidence,
    };
    ids.push(id);
  }

  next.revision = nextRevision(next);
  emit(next, { type: "explanations-attached", revision: next.revision, topic: input.topic.trim(), explanationIds: ids });
  return next;
}

export interface SetPathRestrictionInput {
  taskId: string;
  expectedRevision: PlanRevision;
  /** Path to mark or unmark; omit to flip only the plain's polarity. */
  path?: string;
  mode: "lock" | "allow";
  marked?: boolean;
}

/**
 * The single restriction control. Pressing either polarity key sets the
 * plain's mode (inverting the meaning of the existing marked set without
 * touching it) and toggles the given path's membership. Locking and allowing
 * never coexist: there is one marked set and one polarity.
 */
export function setPathRestriction(task: PlanTask, input: SetPathRestrictionInput): PlanTask {
  const next = clone(requireTask(task, input.taskId));
  requireRevision(next, input.expectedRevision);
  const modeChanged = next.restrictionMode !== input.mode;
  if (input.path === undefined) {
    if (!modeChanged) return next;
    next.restrictionMode = input.mode;
    next.revision = nextRevision(next);
    emit(next, { type: "restriction-mode", revision: next.revision, mode: input.mode });
    return next;
  }
  const path = normalizePath(input.path);
  if (path === ROOT_PATH) throw new PlanStateError("Marking the repository root is not supported; mark specific top-level paths.");
  const index = next.lockedPaths.indexOf(path);
  const shouldMark = input.marked !== undefined ? input.marked : modeChanged ? index >= 0 : index < 0;
  if (modeChanged) {
    next.restrictionMode = input.mode;
    emit(next, { type: "restriction-mode", revision: next.revision, mode: input.mode });
  }
  if (shouldMark && index >= 0 && !modeChanged) return next;
  if (!shouldMark && index < 0) {
    if (modeChanged) {
      next.revision = nextRevision(next);
      return next;
    }
    return next;
  }
  if (shouldMark) {
    next.lockedPaths = [...next.lockedPaths.filter((candidate) => candidate !== path && !candidate.startsWith(`${path}/`)), path].sort();
    next.revision = nextRevision(next);
    emit(next, { type: "path-marked", revision: next.revision, mode: input.mode, path });
    return next;
  }
  next.lockedPaths = next.lockedPaths.filter((candidate) => candidate !== path);
  next.revision = nextRevision(next);
  emit(next, { type: "path-unmarked", revision: next.revision, mode: input.mode, path });
  return next;
}

export function markPathStale(task: PlanTask, input: MarkStaleInput): PlanTask {
  const next = clone(requireTask(task, input.taskId));
  requireRevision(next, input.expectedRevision);
  const changed = normalizePath(input.path);
  const affectedRoots = Object.values(next.nodes).filter((node) => {
    if (!node.path || node.kind === "root") return false;
    return node.path === changed || changed.startsWith(`${node.path}/`) || node.path.startsWith(`${changed}/`);
  });
  if (!affectedRoots.length) return next;
  let mutated = false;
  for (const root of affectedRoots) {
    if (root.status !== "stale") mutated = true;
  }
  if (!mutated) return next;
  next.revision = nextRevision(next);
  for (const root of affectedRoots) markSubtreeStale(next, root.id, changed);
  return next;
}

interface TreeBuildState {
  entries: Map<string, PlanTreeEntry>;
}

function ensureEntry(state: TreeBuildState, path: string, kind: PlanTreeEntry["kind"]): PlanTreeEntry {
  const existing = state.entries.get(path);
  if (existing) {
    if (kind !== "root" && kind !== "dir" && existing.kind === "dir") existing.kind = kind;
    return existing;
  }
  const parentPath = path === ROOT_PATH ? undefined : path.includes("/") ? path.slice(0, path.lastIndexOf("/")) || ROOT_PATH : ROOT_PATH;
  const entry: PlanTreeEntry = {
    path,
    name: path === ROOT_PATH ? "/" : path.slice(path.lastIndexOf("/") + 1),
    kind: path === ROOT_PATH ? "root" : kind,
    status: "unresolved",
    nodeIds: [],
    candidateIds: [],
    diffIds: [],
    explanationIds: [],
    obligationIds: [],
    children: [],
  };
  state.entries.set(path, entry);
  if (parentPath) {
    const parent = ensureEntry(state, parentPath, "dir");
    if (!parent.children.some((child) => child.path === path)) parent.children.push(entry);
  }
  return entry;
}

function entryStatus(current: PlanTreeEntry["status"], next: PlanNode["status"]): PlanTreeEntry["status"] {
  if (current === "stale" || next === "stale") return "stale";
  if (current === "blocked" || next === "blocked") return "blocked";
  if (next === "ready") return current === "unresolved" ? "ready" : current;
  if (current === "ready") return current;
  if (next === "unresolved") return current;
  return next;
}

function addNodeToEntry(state: TreeBuildState, node: PlanNode, task: PlanTask): void {
  const path = node.kind === "virtual" ? ROOT_PATH : node.path ?? ROOT_PATH;
  const entry = ensureEntry(state, path, node.kind === "root" ? "root" : node.kind === "dir" ? "dir" : node.kind === "file" ? "file" : "hunk");
  entry.nodeIds.push(node.id);
  entry.candidateIds.push(...node.candidateIds);
  if (node.selectedCandidateId) entry.selectedCandidateId = node.selectedCandidateId;
  entry.diffIds.push(...node.diffIds);
  entry.explanationIds.push(...node.explanationIds);
  entry.obligationIds.push(...node.obligationIds);
  entry.status = entryStatus(entry.status, node.status);
  if (node.kind === "virtual") {
    const virtualEntry = ensureEntry(state, `${ROOT_PATH}/virtual/${node.id.replaceAll("/", ":")}`, "virtual");
    virtualEntry.nodeIds.push(node.id);
    virtualEntry.candidateIds.push(...node.candidateIds);
    virtualEntry.status = entryStatus(virtualEntry.status, node.status);
    virtualEntry.diffIds.push(...node.diffIds);
    virtualEntry.obligationIds.push(...node.obligationIds);
    const root = state.entries.get(ROOT_PATH)!;
    if (!root.children.some((child) => child.path === virtualEntry.path)) root.children.push(virtualEntry);
  }
  void task;
}

export function planTree(task: PlanTask): PlanTreeEntry {
  const state: TreeBuildState = { entries: new Map() };
  for (const node of Object.values(task.nodes)) addNodeToEntry(state, node, task);
  for (const candidate of Object.values(task.candidates)) {
    if (candidate.status !== "selected") continue;
    for (const path of candidate.touchedPaths) {
      const normalized = normalizePath(path);
      const entry = ensureEntry(state, normalized, normalized.endsWith("/") ? "dir" : "file");
      if (!entry.candidateIds.includes(candidate.id)) entry.candidateIds.push(candidate.id);
    }
  }
  for (const explanation of Object.values(task.explanations)) {
    const entry = ensureEntry(state, explanation.path, explanation.path.endsWith("/") ? "dir" : "file");
    if (!entry.explanationIds.includes(explanation.id)) entry.explanationIds.push(explanation.id);
  }
  for (const diff of Object.values(task.diffs)) {
    const path = diff.path || ROOT_PATH;
    const entry = ensureEntry(state, path, path === ROOT_PATH ? "root" : "file");
    if (!entry.diffIds.includes(diff.id)) entry.diffIds.push(diff.id);
  }
  const root = state.entries.get(ROOT_PATH) ?? ensureEntry(state, ROOT_PATH, "root");
  root.status = entryStatus(root.status, task.nodes[task.rootNodeId]!.status);
  const sortChildren = (entry: PlanTreeEntry) => {
    entry.children.sort((left, right) => left.path.localeCompare(right.path));
    entry.children.forEach(sortChildren);
  };
  sortChildren(root);
  return root;
}
