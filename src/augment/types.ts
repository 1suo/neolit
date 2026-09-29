export type PlanNodeId = string;
export type PlanCandidateId = string;
export type PlanConstraintId = string;
export type PlanEvidenceId = string;
export type PlanDiffId = string;
export type PlanObligationId = string;

export type PlanRevision = number;

export type LOD = "architecture" | "file" | "hunk";
export type Temperature = "low" | "normal" | "high";

export type PathPattern = string;

export interface PlanCandidate {
  id: PlanCandidateId;
  nodeId: PlanNodeId;
  label: string;
  rationale: string;
  touchedPaths: PathPattern[];
  status: "possible" | "selected" | "eliminated";
  eliminationReason?: string;
}

export interface PlanConstraint {
  id: PlanConstraintId;
  nodeId?: PlanNodeId;
  path?: PathPattern;
  text: string;
  source: "user" | "repository" | "model";
  createdRevision: PlanRevision;
}

export interface PlanEvidence {
  id: PlanEvidenceId;
  statement: string;
  source: string;
  kind: "repository" | "test" | "runtime" | "user" | "model";
  refs: string[];
}

export interface PlannedDiff {
  id: PlanDiffId;
  nodeId: PlanNodeId;
  path: string;
  patch: string;
  basisRevision: string;
  failedCheck?: string;
}

export interface PlanObligation {
  id: PlanObligationId;
  nodeId: PlanNodeId;
  kind: "test" | "documentation" | "check" | "todo";
  description: string;
  status: "open" | "satisfied";
}

export type PlanNodeStatus =
  | "unresolved"
  | "domain"
  | "collapsed"
  | "refined"
  | "ready"
  | "blocked"
  | "stale";

export interface PlanNode {
  id: PlanNodeId;
  parent?: PlanNodeId;
  kind: "root" | "dir" | "file" | "hunk" | "virtual";
  path?: PathPattern;
  status: PlanNodeStatus;
  lod: LOD;
  reason: string;
  candidateIds: PlanCandidateId[];
  selectedCandidateId?: PlanCandidateId;
  acceptedDomain: boolean;
  challengeRound: number;
  constraintIds: PlanConstraintId[];
  evidenceIds: PlanEvidenceId[];
  obligationIds: PlanObligationId[];
  diffIds: PlanDiffId[];
  blockedReason?: string;
}

export interface PlanTask {
  version: 1;
  id: string;
  objective: string;
  basisRevision: string;
  revision: PlanRevision;
  rootNodeId: PlanNodeId;
  nodes: Record<PlanNodeId, PlanNode>;
  candidates: Record<PlanCandidateId, PlanCandidate>;
  constraints: Record<PlanConstraintId, PlanConstraint>;
  evidence: Record<PlanEvidenceId, PlanEvidence>;
  obligations: Record<PlanObligationId, PlanObligation>;
  diffs: Record<PlanDiffId, PlannedDiff>;
  events: PlanEvent[];
}

export type PlanEvent =
  | { type: "task-created"; revision: PlanRevision; objective: string }
  | { type: "domain-generated"; revision: PlanRevision; nodeId: PlanNodeId; candidateIds: PlanCandidateId[] }
  | { type: "candidate-added"; revision: PlanRevision; nodeId: PlanNodeId; candidateId: PlanCandidateId; reason: string }
  | { type: "domain-accepted"; revision: PlanRevision; nodeId: PlanNodeId; challengeRound: number }
  | { type: "candidate-rejected"; revision: PlanRevision; candidateId: PlanCandidateId; reason: string }
  | { type: "node-collapsed"; revision: PlanRevision; nodeId: PlanNodeId; candidateId: PlanCandidateId }
  | { type: "node-refined"; revision: PlanRevision; nodeId: PlanNodeId; childIds: PlanNodeId[] }
  | { type: "node-reopened"; revision: PlanRevision; nodeId: PlanNodeId; reason: string }
  | { type: "patch-attached"; revision: PlanRevision; nodeId: PlanNodeId; diffId: PlanDiffId }
  | { type: "constraint-added"; revision: PlanRevision; constraintId: PlanConstraintId }
  | { type: "node-staled"; revision: PlanRevision; nodeId: PlanNodeId; path: string }
  | { type: "node-blocked"; revision: PlanRevision; nodeId: PlanNodeId; reason: string };

export interface PlanTreeEntry {
  path: string;
  name: string;
  kind: "root" | "dir" | "file" | "hunk" | "virtual";
  status: PlanNodeStatus;
  nodeIds: PlanNodeId[];
  candidateIds: PlanCandidateId[];
  selectedCandidateId?: PlanCandidateId;
  diffIds: PlanDiffId[];
  obligationIds: PlanObligationId[];
  children: PlanTreeEntry[];
}

export type ModelOperation =
  | "generate-domain"
  | "challenge-domain"
  | "refine-node"
  | "draft-patch"
  | "repair-patch";

export interface ModelContextPacket {
  taskId: string;
  taskRevision: PlanRevision;
  objective: string;
  basisRevision: string;
  node: PlanNode;
  parentNode?: PlanNode;
  candidates: PlanCandidate[];
  constraints: PlanConstraint[];
  obligations: PlanObligation[];
  diffs: PlannedDiff[];
  rejectedCandidates: Array<{ label: string; reason: string }>;
}

export interface ModelCallRequest {
  operation: ModelOperation;
  context: ModelContextPacket;
  temperature: Temperature;
  lod: LOD;
}

export interface ModelRuntimeCallResult {
  value: unknown;
}

export interface ModelRuntime {
  call(request: ModelCallRequest): Promise<ModelRuntimeCallResult>;
}
