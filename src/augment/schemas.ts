import { z } from "zod";

const pathPattern = z.string().min(1).max(512).refine((value) => !value.includes("\\") && !value.includes("\0") && value !== ".");

export const DomainCandidateSchema = z.object({
  label: z.string().min(1).max(240),
  rationale: z.string().min(1).max(4000),
  confidence: z.number().int().min(0).max(100),
  touchedPaths: z.array(pathPattern).min(1).max(64),
});

export const DomainProposalSchema = z.object({
  // Leave two controller slots for challenge counterexamples. The live domain
  // remains bounded by MAX_CANDIDATES_PER_NODE (7).
  candidates: z.array(DomainCandidateSchema).min(1).max(5),
});

export const ChallengeDomainSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("accept") }),
  z.object({ kind: z.literal("missing-candidate"), candidate: DomainCandidateSchema, reason: z.string().min(1).max(4000) }),
  z.object({ kind: z.literal("missing-path"), path: pathPattern, reason: z.string().min(1).max(4000) }),
]);

export const RefinementObligationSchema = z.object({
  kind: z.enum(["test", "documentation", "check", "todo"]),
  description: z.string().min(1).max(2000),
});

export const RefinementChildSchema = z.object({
  path: pathPattern.optional(),
  kind: z.enum(["dir", "file", "hunk", "virtual"]),
  lod: z.enum(["architecture", "file", "hunk"]),
  reason: z.string().min(1).max(4000),
  obligations: z.array(RefinementObligationSchema).max(16).optional(),
  diff: z.object({ patch: z.string().min(1) }).optional(),
});

export const RefinementProposalSchema = z.object({
  children: z.array(RefinementChildSchema).min(1).max(16),
});

export const PatchProposalSchema = z.object({
  patch: z.string().min(1),
  assumptions: z.array(z.string().min(1).max(2000)).max(32).default([]),
});

export const PathExplanationSchema = z.object({
  path: pathPattern,
  role: z.enum(["primary", "supporting", "context"]),
  summary: z.string().min(1).max(500),
  detail: z.string().min(1).max(4000),
  confidence: z.number().int().min(0).max(100),
});

export const ExplanationProposalSchema = z.object({
  topic: z.string().min(1).max(300),
  entries: z.array(PathExplanationSchema).min(1).max(64),
});

const PlanEventSchema = z.object({ type: z.string().min(1), revision: z.number().int().min(1) }).passthrough();

const PlanNodeSchema = z.object({
  id: z.string().min(1),
  parent: z.string().optional(),
  kind: z.enum(["root", "dir", "file", "hunk", "virtual"]),
  path: z.string().optional(),
  status: z.enum(["unresolved", "domain", "collapsed", "refined", "ready", "stale"]),
  lod: z.enum(["architecture", "file", "hunk"]),
  reason: z.string(),
  candidateIds: z.array(z.string()),
  selectedCandidateId: z.string().optional(),
  acceptedDomain: z.boolean(),
  challengeExhausted: z.boolean(),
  challengeRound: z.number().int().min(0),
  constraintIds: z.array(z.string()),
  evidenceIds: z.array(z.string()),
  obligationIds: z.array(z.string()),
  explanationIds: z.array(z.string()),
  diffIds: z.array(z.string()),
});

const PlanCandidateSchema = z.object({
  id: z.string().min(1),
  nodeId: z.string().min(1),
  label: z.string().min(1),
  rationale: z.string().min(1),
  confidence: z.number().int().min(0).max(100),
  touchedPaths: z.array(z.string().min(1)).min(1),
  status: z.enum(["possible", "selected", "eliminated"]),
  eliminationReason: z.string().optional(),
});

const PlanConstraintSchema = z.object({
  id: z.string().min(1),
  nodeId: z.string().optional(),
  path: z.string().optional(),
  text: z.string().min(1),
  source: z.enum(["user", "repository", "model"]),
  createdRevision: z.number().int().min(1),
});

const PlanEvidenceSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),
  source: z.string().min(1),
  kind: z.enum(["repository", "test", "runtime", "user", "model"]),
  refs: z.array(z.string()),
});

const PathExplanationRecordSchema = z.object({
  id: z.string().min(1),
  topic: z.string().min(1),
  path: z.string().min(1),
  role: z.enum(["primary", "supporting", "context"]),
  summary: z.string().min(1),
  detail: z.string().min(1),
  confidence: z.number().int().min(0).max(100),
});

const PlanObligationSchema = z.object({
  id: z.string().min(1),
  nodeId: z.string().min(1),
  kind: z.enum(["test", "documentation", "check", "todo"]),
  description: z.string().min(1),
});

const PlannedDiffSchema = z.object({
  id: z.string().min(1),
  nodeId: z.string().min(1),
  path: z.string(),
  patch: z.string().min(1),
  kind: z.enum(["new", "modify", "delete", "unknown"]),
  basisRevision: z.string().min(1),
  failedCheck: z.string().optional(),
});

/**
 * Boundary schema for tasks entering the controller from outside — the
 * `task/restore` payload and, later, persisted snapshots. Events are
 * validated structurally only (typed shape plus revision); their discriminated
 * payload fields are controller history, not future input. Referential
 * integrity is checked separately by `assertTaskIntegrity`.
 */
export const PlanTaskSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  mode: z.enum(["change", "explanation"]),
  objective: z.string().min(1),
  basisRevision: z.string().min(1),
  revision: z.number().int().min(1),
  rootNodeId: z.string().min(1),
  lockedPaths: z.array(z.string().min(1)),
  restrictionMode: z.enum(["lock", "allow"]),
  nodes: z.record(z.string(), PlanNodeSchema),
  candidates: z.record(z.string(), PlanCandidateSchema),
  constraints: z.record(z.string(), PlanConstraintSchema),
  evidence: z.record(z.string(), PlanEvidenceSchema),
  explanations: z.record(z.string(), PathExplanationRecordSchema),
  obligations: z.record(z.string(), PlanObligationSchema),
  diffs: z.record(z.string(), PlannedDiffSchema),
  events: z.array(PlanEventSchema),
});

export type DomainProposal = z.infer<typeof DomainProposalSchema>;
export type ChallengeDomainProposal = z.infer<typeof ChallengeDomainSchema>;
export type RefinementProposal = z.infer<typeof RefinementProposalSchema>;
export type PatchProposal = z.infer<typeof PatchProposalSchema>;
export type ExplanationProposal = z.infer<typeof ExplanationProposalSchema>;
