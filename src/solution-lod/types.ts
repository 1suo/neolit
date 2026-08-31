import { z } from "zod";
import { SOLUTION_EXECUTION_CAPABILITIES, type ActivationContextTelemetry, type AgentCallLimits, type AgentPromptAttemptTrace, type AgentRetryTrace, type AgentToolTrace, type AgentUsage, type SolutionExecutionCapability } from "../types.js";

export type Capability = "inspect" | "synthesize" | "refine" | "implement" | "verify" | "present";
export type SynthesisOperation = "generate-domain" | "challenge-domain" | "select-candidate";
export type RoleOutcome = "facts" | "boundary" | "need-fact" | "decompose" | "certified" | "answer" | "candidates" | "accept" | "counterexample" | "boundary-counterexample" | "needs-fact" | "selected" | "hard-constraint" | "children" | "leaf" | "completed" | "already-satisfied" | "blocked" | "pass" | "repair" | "reopen" | "fail";
export type DomainPhase = "ungenerated" | "inspecting" | "challenging" | "selecting" | "selected" | "blocked";
export type ChallengeVerdict = "accept" | "counterexample" | "boundary-counterexample" | "needs-fact";
export type ScopeId = `scope:${string}`;
export type CriterionId = `criterion:${string}`;
export type RequirementId = `requirement:${string}`;
export type ContextRefKind = "task" | "region" | "criterion" | "requirement" | "candidate" | "evidence" | "constraint" | "artifact" | "finding" | "activation" | "coordinate";
export type RegionEdge = "root" | "refines" | "partOf";
export type RegionStatus = "unformed" | "superposed" | "unrefined" | "collapsed" | "actionable" | "implementing" | "implemented" | "verified" | "contradiction" | "blocked" | "stalled";
export type CandidateStatus = "possible" | "eliminated" | "selected" | "equivalent";

export interface AuthoritativeMessage {
  id: string;
  role: "user" | "system-authorized";
  exactText: string;
}

export interface AuthorityScopeAdmission {
  messageId: string;
  scopeIds: string[] | "all";
  admittedRevision: number;
  source: "provisional-all" | "trusted-host-scope";
}

export interface SolutionAuthorityFrame {
  task: { id: string; exactText: string };
  authoritativeMessages: AuthoritativeMessage[];
  admissions: AuthorityScopeAdmission[];
}

export interface SolutionLodV11InitialInput {
  task: { id: string; exactText: string };
  authoritativeMessages: AuthoritativeMessage[];
  diagnosticContext?: string;
  directory: string;
  worktree: string;
  runId: string;
}

export interface ChildRegionDefinition {
  key: string;
  objective: string;
  edge: Exclude<RegionEdge, "root">;
  delivery?: "answer" | "change";
  allowedVariables: string[];
  acceptanceCriteria: string[];
  coveredCriteria: number[];
  requirementIds?: RequirementId[];
  dependencyScopeIds?: ScopeId[];
  mutationResources?: string[];
  unresolvedVariable?: string;
}

export interface LeafCheck {
  criterionId: CriterionId;
  commandOrObservation: string;
}

export type InspectionCriterionVerdict = "satisfied" | "unsatisfied" | "blocked" | "unknown";

export interface InspectionCriterionResult {
  criterionId: CriterionId;
  verdict: InspectionCriterionVerdict;
  evidenceRefs: string[];
  reason?: string;
}

export interface CertifiedLeaf {
  criterionIds: CriterionId[];
  requirementIds: RequirementId[];
  implementationScope: string;
  evidenceRefs: string[];
  mutationResources: string[];
  checks: LeafCheck[];
}

export interface SolutionCandidate {
  id: string;
  regionId: string;
  key: string;
  proposition: string;
  status: CandidateStatus;
  /** Authored disposition. `status` is recomputed from this on every propagation pass. */
  declaredStatus?: CandidateStatus;
  evidenceIds: string[];
  declaredEvidenceIds?: string[];
  eliminationReasons: string[];
  declaredEliminationReasons?: string[];
  /** Positions this move takes on shared decision variables. */
  stances: CandidateStance[];
  createdRevision?: number;
  sourceActivationId?: string;
  historical?: boolean;
}

export interface SolutionRegion {
  id: string;
  key: string;
  parentId?: string;
  parentCandidateId?: string;
  edge: RegionEdge;
  lod: number;
  objective: string;
  delivery: "answer" | "change";
  allowedVariables: string[];
  allowedVariablesLocked?: boolean;
  acceptanceCriteria: string[];
  status: RegionStatus;
  progress: RegionProgressLedger;
  candidateIds: string[];
  selectedCandidateIds: string[];
  constraintIds: string[];
  evidenceIds: string[];
  activationIds: string[];
  artifactIds: string[];
  answer?: string;
  contradiction?: string;
  coveredCriteria?: number[];
  scopeId: ScopeId;
  criterionIds: CriterionId[];
  domainPhase: DomainPhase;
  domainFingerprint: string | null;
  enumerationFingerprint?: string | null;
  boundDomainFingerprint?: string | null;
  acceptedFingerprint: string | null;
  challengeVerdict: ChallengeVerdict | null;
  blockedReason?: string;
  certifiedLeaf?: CertifiedLeaf;
  requirementIds?: RequirementId[];
  dependencyScopeIds?: ScopeId[];
  mutationResources?: string[];
  definitionFingerprint?: string;
  selectionAge?: number;
  inspectionAttempts?: number;
  inspectionObligationIds?: CriterionId[];
  criterionVerdicts?: InspectionCriterionResult[];
  decisionBoundary?: DecisionBoundary;
  selectionPremiseRefs?: string[];
  implementationPremiseRefs?: string[];
  verificationPremiseRefs?: string[];
  convergenceCycles?: SemanticCycleRecord[];
  blockedDetails?: { kind: string; fingerprints?: string[]; unresolvedCriterionIds?: CriterionId[]; unresolvedScopeIds?: ScopeId[] };
  completionCertificateId?: string;
}

export interface ProgressLedgerEntry {
  count: number;
  fingerprint: string | null;
  unresolvedCriterionIds: CriterionId[];
}

export interface RegionProgressLedger {
  inspectionNoProgress: ProgressLedgerEntry;
  cegarRounds: ProgressLedgerEntry;
  selectionNoProgress: ProgressLedgerEntry;
  reopenAttempts: ProgressLedgerEntry;
  repairCycles: ProgressLedgerEntry;
}

export interface SchemaRetryLedger {
  logicalActivationId: string;
  contextFingerprint: string;
  attempts: number;
  retries: number;
  repairs: number;
  reservedAttempts: number;
  reservationActivationId?: string;
  trace: AgentPromptAttemptTrace[];
}

export type SemanticCycleKind = "present" | "repair" | "verify" | "reopen";
export interface SemanticCycleRecord {
  kind: SemanticCycleKind;
  inputFingerprint: string;
  outputFingerprint: string;
  unresolvedCriterionIds: CriterionId[];
  revision: number;
}

export interface MaterialRequirement {
  id: RequirementId;
  key: string;
  text: string;
  scopeId: ScopeId;
  criterionId: CriterionId;
  evidenceRefs: string[];
}

export type TaskDispositionKind = "conflicting" | "external" | "speculative";
export interface TaskDisposition {
  key: string;
  request: string;
  disposition: TaskDispositionKind;
  reason: string;
  evidenceRefs: string[];
}

export interface SolutionEvidence {
  id: string;
  text: string;
  source: string;
  kind: "repository" | "tool" | "inference" | "user";
  /** Observation describes what exists; claim kinds describe an assessment of it. */
  assertion?: "repository-presence" | "correctness-claim" | "fitness-claim" | "other-claim";
  /** Inference starts as a hypothesis; only confirmed evidence may justify pruning. */
  status?: "hypothesis" | "confirmed" | "rejected" | "stale";
  validationKind?: "repository-evidence" | "tool-evidence" | "user-confirmation";
  validationEvidenceRefs?: string[];
  validationReason?: string;
  location?: RepositoryEvidenceLocation;
  controllerVerified?: { activationId: string; tool: "graph_read" | "graph_inspect_worktrees" | "graph_read_worktree_diff" };
  fingerprint: string;
  createdRevision?: number;
  lineageKey?: string;
  supersedesEvidenceId?: string;
  statusTimeline?: Array<{ status: "hypothesis" | "confirmed" | "rejected" | "stale"; revision: number; activationId?: string; reason: string; evidenceRefs: string[] }>;
}

export interface RepositoryEvidenceLocation {
  canonicalPath: string;
  range: [number, number];
  fileDigest: string;
  snapshotEpoch: number;
  observation?: "worktrees";
}

export interface ClaimValidation {
  claimRef: string;
  verdict: "confirmed" | "rejected" | "unresolved";
  evidenceRefs: string[];
  reason: string;
}

export type ConstraintKind = "requires" | "excludes" | "supports" | "refutes" | "equivalent";
export type ConstraintSource = "user-task" | "repo-evidence" | "model-inference";
export type StanceRelation = "requires" | "excludes" | "prefers";
export interface DecisionVariable {
  id: string;
  name: string;
  ownerRegionId: string;
  /** Known options at declaration time; new options may still appear later. Canonical spellings. */
  seedLabels: string[];
  evidenceRefs?: string[];
  historical?: boolean;
}
export interface DecisionBoundaryProposal {
  basisRevision: number;
  variables: Array<{ key: string; name: string; ownerRegionId: string; seedLabels: string[]; evidenceRefs: string[] }>;
  permittedPairs: Array<{ leftVariableKey: string; rightVariableKey: string; evidenceRefs: string[] }>;
}
export interface DecisionBoundary {
  fingerprint: string;
  variables: Array<{ id: string; name: string; ownerRegionId: string; seedLabels: string[]; evidenceRefs: string[] }>;
  permittedPairs: Array<{ leftVariableId: string; rightVariableId: string; evidenceRefs: string[] }>;
}
export interface CandidateStance {
  variableId: string;
  relation: StanceRelation;
  valueLabel: string;
}
export interface SolutionConstraint {
  id: string;
  kind: ConstraintKind;
  subject: string;
  target: string;
  reason: string;
  sourceActivationId: string;
  sourceKind: ConstraintSource;
  /** Resolved evidence ids backing this statement; coordinate-targeted refutations must be non-empty. */
  evidenceRefs: string[];
  createdRevision?: number;
  historical?: boolean;
}

export interface SolutionArtifact {
  id: string;
  regionId: string;
  kind: "file" | "check" | "answer" | "completion-review";
  path?: string;
  summary: string;
  passed?: boolean;
  activationId: string;
  createdRevision?: number;
  historical?: boolean;
  fingerprint: string;
  checkKind?: "focused" | "release" | "verification";
  checkDisposition?: "criterion-gating" | "release-gating" | "preexisting" | "out-of-scope" | "environmental";
  evidenceRefs?: string[];
  resolutionOwner?: string;
  requiredEvidence?: string[];
  implementationOutcome?: "changed" | "already-satisfied";
  criterionIds?: CriterionId[];
  focusedTests?: string[];
  fullChecks?: string[];
  todoDisposition?: string;
}

export type FindingTarget =
  | { kind: "files"; refs: string[] }
  | { kind: "answer"; refs: string[] }
  | { kind: "environment"; refs: string[] }
  | { kind: "external"; refs: string[] };

export type FindingRoute =
  | { kind: "local-repair"; regionId: string }
  | { kind: "answer-repair"; regionId: string }
  | { kind: "reopen-decision"; regionId: string; invalidatedPremiseRefs: string[] }
  | { kind: "blocked-external"; regionId: string; resolutionOwner: string; requiredEvidence: string[] };

export interface VerificationFinding {
  criterionId: CriterionId;
  regionId: string;
  severity: "low" | "medium" | "high";
  target: FindingTarget;
  problem: string;
  regressionCriterion: string;
  evidence: string;
  evidenceRefs: string[];
  invalidatedPremiseRefs?: string[];
  resolutionOwner?: string;
  requiredEvidence?: string[];
}

export interface SolutionFinding extends Omit<VerificationFinding, "invalidatedPremiseRefs" | "resolutionOwner" | "requiredEvidence"> {
  id: string;
  route: FindingRoute;
  status: "open" | "repairing" | "resolved" | "superseded";
  sourceActivationId: string;
  repairActivationIds: string[];
  createdRevision: number;
}

export interface CompletionCertificate {
  id: string;
  fingerprint: string;
  regionId: string;
  criterionIds: CriterionId[];
  requirementIds: RequirementId[];
  selectedFamilyIds: string[];
  equivalenceProofConstraintIds: string[];
  premiseRefs: string[];
  dependencyCertificateRefs: string[];
  dependencyFingerprint: string;
  measuredArtifactIds?: string[];
  focusedCheckArtifactIds?: string[];
  releaseCheckArtifactIds?: string[];
  artifactFingerprints: Record<string, string>;
  resolvedFindingIds: string[];
  verificationActivationId: string;
  createdRevision: number;
}

export interface ActivationReadRef {
  ref: string;
  kind: ContextRefKind;
  revision: number;
  fingerprint: string;
}

export interface Activation {
  id: string;
  capability: Capability;
  regionId: string;
  request: string;
  expectedDelta: string;
  contextRefs: string[];
  senderActivationId?: string;
  status: "queued" | "running" | "completed" | "failed" | "superseded";
  basisRevision: number;
  sessionId?: string;
  error?: string;
  operation?: SynthesisOperation;
  domainFingerprint?: string | null;
  boundDomainFingerprint?: string | null;
  idempotencyKey?: string;
  logicalActivationId?: string;
  readRefs?: ActivationReadRef[];
  mutationResources?: string[];
  queuedAt?: number;
  recovery?: {
    sessionId: string;
    strategy: "continue" | "fork";
    attempts: number;
    failureKind: "transport" | "inactivity";
    contextFingerprint: string;
    retryTrace: AgentRetryTrace[];
  };
  historical?: boolean;
  findingIds?: string[];
  roleOutcome?: RoleOutcome;
  schemaReservation?: { attemptOrdinal: number; maxAttempts: number };
  /** Optional only so v11 checkpoints remain readable; every new activation supplies it. */
  requiredCapabilities?: SolutionExecutionCapability[];
}

/** One entry of the manifest `schedule` writes for the batch it dispatched. */
export interface ActiveBatchEntry {
  activationId: string;
  regionId: string;
  capability: Capability;
  basisRevision: number;
}

/** The network effect of one finished activation task, or null when the task errored. */
export type ActivationNetworkDelta =
  | { kind: "delta"; delta: SolutionDelta }
  | { kind: "synthesis"; output: SynthesisOutput }
  | { kind: "refinement"; output: RefinementOutput }
  | { kind: "implementation"; output: ImplementationOutput; changedFiles: string[]; changedFileFingerprints: Record<string, string> }
  | { kind: "verification"; output: VerificationOutput }
  | { kind: "presentation"; output: z.infer<typeof PresentationOutputSchema> };

export type ActivationOutput = SolutionDelta | SynthesisOutput | RefinementOutput | ImplementationOutput | VerificationOutput | z.infer<typeof PresentationOutputSchema>;

/** The append-only per-task record a parallel `activate` task writes to `results`. */
export interface ActivationTaskResult {
  activationId: string;
  regionId: string;
  capability: Capability;
  basisRevision: number;
  startedAt: number;
  finishedAt: number;
  sessionId?: string;
  usage: AgentUsage;
  outcome: "applied" | "deferred" | "error";
  roleOutcome?: RoleOutcome;
  error?: string;
  changedFiles?: string[];
  networkDelta: ActivationNetworkDelta | null;
  /** Cheap prompt/repair telemetry recorded without another model call. */
  promptChars?: number;
  schemaChars?: number;
  validationFailures?: string[];
  operation?: SynthesisOperation;
  domainSize?: number;
  failureKind?: "startup" | "transport" | "inactivity" | "schema" | "semantic";
  tools?: AgentToolTrace[];
  progressText?: string;
  retryable?: boolean;
  retries?: number;
  retryTrace?: AgentRetryTrace[];
  logicalActivationId?: string;
  promptAttempts?: AgentPromptAttemptTrace[];
  schemaRetries?: number;
  schemaRepairs?: number;
  contextTelemetry?: ActivationContextTelemetry;
  projectedSectionChars?: Record<string, number>;
}

/** The unified snapshot a `Send` carries into one parallel `activate` task. */
export interface ActivationTaskInput {
  kind: "activation-task";
  activation: Activation;
  snapshot: {
    stateVersion: 11;
    runId: string;
    diagnosticContext?: string;
    directory: string;
    worktree: string;
    phase: string;
    network: SolutionNetwork;
  };
}

export interface SolutionNetwork {
  authority: SolutionAuthorityFrame;
  revision: number;
  nextRegionId: number;
  nextEvidenceId: number;
  nextConstraintId: number;
  nextActivationId: number;
  nextArtifactId: number;
  nextVariableId: number;
  nextFindingId: number;
  nextCertificateId: number;
  regions: SolutionRegion[];
  candidates: SolutionCandidate[];
  constraints: SolutionConstraint[];
  evidence: SolutionEvidence[];
  activations: Activation[];
  artifacts: SolutionArtifact[];
  variables: DecisionVariable[];
  findings: SolutionFinding[];
  certificates: CompletionCertificate[];
  materialRequirements?: MaterialRequirement[];
  taskDispositions?: TaskDisposition[];
  telemetry?: SolutionTelemetry;
  schemaRetries: Record<string, SchemaRetryLedger>;
}

export interface RoleContextDependency {
  ref: string;
  kind: ContextRefKind;
  revision: number;
  fingerprint: string;
  value: unknown;
}

export interface RoleContextFact {
  referenceId: string;
  fact: string;
  source: string;
  authority: SolutionEvidence["kind"];
  validationEvidenceRefs?: string[];
  validationReason?: string;
  location?: RepositoryEvidenceLocation;
}

export interface RoleContextLineageEntry {
  regionId: string;
  scopeId: ScopeId;
  parentRegionId?: string;
  relationship: RegionEdge;
  objective: string;
  successCriteria: Array<{ criterionId: CriterionId | undefined; criterion: string }>;
  requirementIds: RequirementId[];
  mutationResources: string[];
  decomposition: { parentCandidateId?: string; coveredParentCriterionIds: CriterionId[] };
  siblings: Array<{ regionId: string; scopeId: ScopeId; objective: string; criterionIds: CriterionId[]; requirementIds: RequirementId[]; mutationResources: string[] }>;
}

export interface RoleContextRootCoverage {
  requirementId: RequirementId;
  requirement: string;
  ownerRegionId?: string;
  ownerScopeId: ScopeId;
  criterionId: CriterionId;
  criterion?: string;
}

export interface RoleContextPacketBase {
  authority: SolutionAuthorityFrame;
  basisRevision: number;
  untrustedDiagnosticContext?: string;
  yourAssignment: string;
  goal: string;
  successCriteria: Array<{ criterionId: CriterionId | undefined; criterion: string }>;
  requirements: Array<{ requirementId: RequirementId; requirementKey: string; requirement: string; ownerScopeId: ScopeId; criterionId: CriterionId; evidenceRefs: string[] }>;
  variableStates: Array<{
    id: string; name: string; declaredAt: string; knownLabels: string[]; binding?: string;
    bindingWitnesses: Array<{ candidateId: string; regionId: string; valueLabel: string }>;
    bindingConflict?: string[]; unavailableLabels: string[];
    unavailabilityWitnesses: Array<{ valueLabel: string; constraintId: string; relationship: "refutes" | "excludes"; evidenceRefs: string[]; reason: string }>;
  }>;
  facts: RoleContextFact[];
  taskLineage: RoleContextLineageEntry[];
  unresolvedRootCoverage: RoleContextRootCoverage[];
  unresolvedClaims: Array<{ referenceId: string; claim: string; source: string; validationRequired: string; effect: string }>;
  relationships: Array<{ referenceId: string; relationship: ConstraintKind; from: string; to: string; explanation: string; authority: ConstraintSource; evidenceRefs: string[] }>;
  referencedContext: RoleContextDependency[];
  allowedDecisions: { mayChoose: string[]; mustNotChoose: string[] };
}

export interface RoleContextChoice { regionId: string; scopeId: string; candidateId: string; choice: string; evidenceIds: string[]; createdRevision?: number }
export type RoleContextOutput = { referenceId: string; kind: SolutionArtifact["kind"]; path?: string; summary: string; passed?: boolean; implementationOutcome?: SolutionArtifact["implementationOutcome"]; criterionIds?: CriterionId[]; focusedTests?: string[]; fullChecks?: string[]; todoDisposition?: string; fingerprint: string; checkKind?: SolutionArtifact["checkKind"] };

export type RoleContextPacket =
  | (RoleContextPacketBase & { role: "inspect"; earlierChoices: RoleContextChoice[]; repositoryScopes: string[]; questionToAnswer: string; unresolvedCriteria: Array<{ criterionId: CriterionId; criterionIndex: number; criterion: string | undefined }>; permittedNextRequest: never[]; mustNotChooseSolution: true; rootOnly: string; outputRule: string })
  | (RoleContextPacketBase & { role: "synthesize"; earlierChoices: RoleContextChoice[]; operation: SynthesisOperation; domainPhase: DomainPhase; decisionBoundary: DecisionBoundary | undefined; enumerationFingerprint: string | null | undefined; boundDomainFingerprint: string | null | undefined; acceptedFingerprint: string | null; cegarRound: number; choiceToMake: string; chooseOnly: string[]; alternativesAlreadyConsidered: Array<{ referenceId: string; approach: string; status: string; reasonsRejected: string[]; supportingFactIds: string[]; positionsOnSharedChoices: Array<{ choice: string; relation: string; option: string }> }>; permittedNextRequest: string[]; ifFactIsMissing: string })
  | (RoleContextPacketBase & { role: "refine"; earlierChoices: RoleContextChoice[]; chosenApproach: RoleContextChoice[]; outputs: RoleContextOutput[]; approachToSettle: string; successCriteriaPositions: Array<{ position: number; criterionId: CriterionId | undefined; criterion: string }>; nextStepsContract: { split: string; certifiedLeaf: string }; ifFactIsMissing: string })
  | (RoleContextPacketBase & { role: "implement"; chosenApproach: RoleContextChoice[]; outputs: RoleContextOutput[]; findings: SolutionFinding[]; repositoryScopes: string[]; certifiedLeaf?: CertifiedLeaf; mutationResources?: string[]; permittedNextRequest: string[]; ifBlocked: { missingFact: string; wrongChoice: string } })
  | (RoleContextPacketBase & { role: "verify"; earlierChoices: RoleContextChoice[]; outputs: RoleContextOutput[]; findings: SolutionFinding[]; repositoryScopes: string[]; changeToCheck: string; certifiedLeaf?: CertifiedLeaf; mutationResources?: string[]; completionEvidenceRequired: string[]; measuredChangedFiles: Array<string | undefined> })
  | (RoleContextPacketBase & { role: "present"; earlierChoices: RoleContextChoice[]; outputs: RoleContextOutput[]; findings: SolutionFinding[]; answerToWrite: string });

export interface RegionTelemetry {
  operationCalls: Partial<Record<Capability | SynthesisOperation, number>>;
  promptChars: number;
  schemaChars: number;
  validationFailures: number;
  repairAttempts: number;
  retries: number;
  domainSizes: number[];
  progressFingerprints: string[];
  elapsedMs: number;
  queueMs: number;
  roleMs: Partial<Record<Capability, number>>;
  blockedReasons: string[];
  contextTelemetry: ActivationContextTelemetry;
}

export interface ActivationTelemetryRecord {
  activationId: string;
  physicalActivationId: string;
  logicalActivationId: string;
  regionId: string;
  role: Capability;
  operation: Capability | SynthesisOperation;
  outcome: ActivationTaskResult["outcome"];
  roleOutcome?: RoleOutcome;
  promptChars: number;
  schemaChars: number;
  projectedSectionChars: Record<string, number>;
  repositoryReadChars: number;
  otherToolOutputChars: number;
  bashOutputChars: number;
  duplicateReadCharsAvoided: number;
  accumulatedSessionInput: number;
  cacheReadInput: number;
  repairAttempts: number;
  promptAttempts: number;
  schemaRetries: number;
  schemaRepairs: number;
  usage: AgentUsage;
}

export interface SolutionTelemetry {
  activations: number;
  physicalActivations: number;
  promptAttempts: number;
  schemaRetries: number;
  schemaRepairs: number;
  operationCalls: Partial<Record<Capability | SynthesisOperation, number>>;
  counterexampleRepairs: number;
  retries: number;
  reopens: number;
  cycles: number;
  candidates: number;
  regionCount: number;
  promptChars: number;
  schemaChars: number;
  projectedContextChars: number;
  validationFailures: number;
  elapsedMs: number;
  queueMs: number;
  roleMs: Partial<Record<Capability, number>>;
  implementationMs: number;
  verificationMs: number;
  usage: AgentUsage;
  blockedReasons: string[];
  regions: Record<string, RegionTelemetry>;
  contextTelemetry: ActivationContextTelemetry;
  recordedActivationIds: string[];
  activationRecords: ActivationTelemetryRecord[];
}

export interface SolutionRunLimits {
  maxElapsedMs?: number;
  maxCost?: number;
  maxRetries?: number;
  maxReopens?: number;
}

export interface SolutionRoleLimits {
  inspect: AgentCallLimits;
  synthesize: AgentCallLimits;
  refine: AgentCallLimits;
  implement: AgentCallLimits;
  verify: AgentCallLimits;
  present: AgentCallLimits;
}

export const DEFAULT_SOLUTION_ROLE_LIMITS: SolutionRoleLimits = {
  inspect: { maxTurns: 32, maxContextTokens: 160_000 },
  synthesize: { maxTurns: 8, maxContextTokens: 96_000 },
  refine: { maxTurns: 8, maxContextTokens: 96_000 },
  implement: { maxTurns: 32, maxContextTokens: 160_000 },
  verify: { maxTurns: 16, maxContextTokens: 96_000 },
  present: { maxTurns: 4, maxContextTokens: 48_000 },
};

const ChildRegionSchema = z.object({
  key: z.string().min(1).describe("A short stable name for this child."),
  objective: z.string().min(1).describe("What this child must decide or deliver."),
  edge: z.enum(["refines", "partOf"]).describe("Use 'refines' for a choice that becomes meaningful only after choosing the parent. Use 'partOf' for an independent required deliverable."),
  delivery: z.enum(["answer", "change"]).optional().describe("Use 'answer' only when this child must answer a question without changing files. Otherwise use 'change'."),
  allowedVariables: z.array(z.string()).default([]).describe("The only aspects this child may choose."),
  acceptanceCriteria: z.array(z.string()).default([]).describe("Observable conditions that prove this child is complete."),
  coveredCriteria: z.array(z.number().int().nonnegative()).default([]).describe("Positions (0-based) of the parent success criteria this child addresses."),
  requirementIds: z.array(z.string()).optional(),
  dependencyScopeIds: z.array(z.string()).optional(),
  mutationResources: z.array(z.string()).optional(),
  unresolvedVariable: z.string().optional().describe("Required for refines: the exact supplied allowed variable that remains unresolved in this child."),
});

const RepositoryEvidenceLocationSchema = z.object({ canonicalPath: z.string().min(1), range: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]), fileDigest: z.string().min(1), snapshotEpoch: z.number().int().nonnegative(), observation: z.literal("worktrees").optional() }).strict();
const EvidenceSchema = z.object({
  text: z.string().min(1), source: z.string().min(1), kind: z.enum(["repository", "tool", "inference", "user"]).default("inference"), assertion: z.enum(["repository-presence", "correctness-claim", "fitness-claim", "other-claim"]).optional(), location: RepositoryEvidenceLocationSchema.optional(),
}).strict().superRefine((item, context) => {
  if (item.kind === "repository" && !item.location) context.addIssue({ code: "custom", message: "Repository evidence requires a controller-verifiable graph_read location.", path: ["location"] });
  if (item.location && item.kind !== "repository") context.addIssue({ code: "custom", message: "Only repository evidence may carry a repository location.", path: ["location"] });
  if (item.kind === "repository" && item.assertion && item.assertion !== "repository-presence") context.addIssue({ code: "custom", message: "Repository reads establish presence; correctness and fitness must be separate inference claims.", path: ["assertion"] });
  if (item.kind === "inference" && item.assertion === "repository-presence") context.addIssue({ code: "custom", message: "Repository presence requires a controller-verified repository observation.", path: ["assertion"] });
});
/** Tool-free roles may only author hypotheses; confirmed observations come from inspection. */
const HypothesisEvidenceSchema = z.object({
  text: z.string().min(1), source: z.string().min(1),
  kind: z.literal("inference").default("inference").describe("Omit or set to 'inference'. This role cannot create confirmed repository/tool/user evidence; cite supplied fact IDs instead."),
  assertion: z.enum(["correctness-claim", "fitness-claim", "other-claim"]).default("other-claim"),
}).strict();
const GeneratedCandidateSchema = z.object({
  key: z.string().min(1), proposition: z.string().min(1), evidenceRefs: z.array(z.string()).default([]), coordinates: z.array(z.discriminatedUnion("applicability", [
    z.object({ variableId: z.string().min(1), applicability: z.literal("applies"), stances: z.array(z.object({ relation: z.enum(["requires", "excludes", "prefers"]), valueLabel: z.string().min(1) }).strict()).min(1).describe("A candidate may require at most one option for this categorical shared choice. Combine inseparable requirements into one composite option or decompose the work.") }).strict(),
    z.object({ variableId: z.string().min(1), applicability: z.literal("not-applicable"), reason: z.string().min(1) }).strict(),
  ])).default([]),
}).strict();
const ConstraintSchema = z.object({
  kind: z.enum(["requires", "excludes", "supports", "refutes", "equivalent"]), subject: z.string().min(1), target: z.string().min(1), reason: z.string().default(""), evidenceRefs: z.array(z.string()).default([]), sourceKind: z.enum(["user-task", "repo-evidence", "model-inference"]).default("model-inference"),
}).strict();
const ActivationRequestSchema = z.object({
  capability: z.enum(["inspect", "synthesize", "refine", "implement", "verify", "present"]), regionId: z.string().optional(), request: z.string().min(1), expectedDelta: z.string().min(1), contextRefs: z.array(z.string()).default([]), requiredCapabilities: z.array(z.enum(SOLUTION_EXECUTION_CAPABILITIES)).min(1),
}).strict();

export const DecisionBoundaryProposalSchema = z.object({
  basisRevision: z.number().int().nonnegative().default(0).describe("The exact supplied graph revision, overwritten by the controller from the activation for compatibility."),
  variables: z.array(z.object({
    key: z.string().min(1).describe("A proposal-local stable key used by permittedPairs."),
    name: z.string().min(1).describe("The shared decision owned at this boundary, not a chosen solution."),
    ownerRegionId: z.string().default("").describe("The supplied region that owns this variable, assigned by the controller from the activation."),
    seedLabels: z.array(z.string()).default([]).describe("Canonical labels for options already established by supplied facts; preserve exact spelling and do not invent choices."),
    evidenceRefs: z.array(z.string()).default([]).describe("Supplied fact IDs that establish this variable, its ownership, or its seed labels."),
  }).strict().describe("One required shared variable and the evidence establishing its ownership and known labels.")).default([]).describe("Every shared variable required to describe the decision topology."),
  permittedPairs: z.array(z.object({
    leftVariableKey: z.string().min(1).describe("The key of one variable endpoint."),
    rightVariableKey: z.string().min(1).describe("The key of the other variable endpoint."),
    evidenceRefs: z.array(z.string()).default([]).describe("Supplied fact IDs establishing that these variables may be coupled."),
  }).strict().describe("An evidence-backed undirected topology edge between two proposed variables, not a selected value pair.")).default([]).describe("Every permitted pair edge in the proposed decision topology."),
}).strict().describe("An inspector's evidence-backed decision topology proposal. It declares variables and permitted coupling edges at a supplied revision; it does not choose a solution.");

export const DomainGenerationOutputSchema = z.object({
  outcome: z.literal("candidates"),
  evidence: z.array(HypothesisEvidenceSchema).default([]),
  candidates: z.array(GeneratedCandidateSchema).min(1).max(7)
    .describe("Every genuinely distinct solution family the boundary contains — usually several. Return exactly ONE family only when the boundary truly admits no materially different alternative; a fresh challenger independently verifies that nothing is missing."),
}).strict();
export type DomainGenerationOutput = z.infer<typeof DomainGenerationOutputSchema>;

export const DomainChallengeOutputSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("accept"), boundDomainFingerprint: z.string().default(""), viableCandidateIds: z.array(z.string()).default([]) }).strict(),
  z.object({ outcome: z.literal("counterexample"), boundDomainFingerprint: z.string().default(""), candidate: GeneratedCandidateSchema, reason: z.string().min(1), evidenceRefs: z.array(z.string()).default([]) }).strict(),
  z.object({ outcome: z.literal("boundary-counterexample"), boundDomainFingerprint: z.string().default(""), missingFamily: z.object({ key: z.string().min(1), proposition: z.string().min(1) }).strict(), defect: z.object({ kind: z.enum(["missing-variable", "missing-pair"]), description: z.string().min(1) }).strict(), evidenceRefs: z.array(z.string()).default([]) }).strict(),
  z.object({ outcome: z.literal("needs-fact"), boundDomainFingerprint: z.string().default(""), request: z.string().min(1), expectedDelta: z.string().min(1), contextRefs: z.array(z.string()).default([]), requiredCapabilities: z.array(z.enum(SOLUTION_EXECUTION_CAPABILITIES)).min(1) }).strict(),
]);
export type DomainChallengeOutput = z.infer<typeof DomainChallengeOutputSchema>;

const PreferenceValueSchema = z.enum(["preferred", "neutral", "disfavored"]);
const CandidateSelectionBaseSchema = z.object({
  boundDomainFingerprint: z.string().default(""),
  comparisons: z.array(z.object({
    candidateId: z.string().min(1), userPreference: PreferenceValueSchema, repositoryCompatibility: PreferenceValueSchema, changeScope: PreferenceValueSchema, irreversibleRisk: PreferenceValueSchema, evidenceRefs: z.array(z.string()).default([]),
  }).strict()).min(1),
}).strict();
export const CandidateSelectionOutputSchema = z.discriminatedUnion("outcome", [
  CandidateSelectionBaseSchema.extend({ outcome: z.literal("selected"), selectedCandidateId: z.string().min(1) }),
  CandidateSelectionBaseSchema.extend({ outcome: z.literal("hard-constraint"), hardConstraints: z.array(ConstraintSchema).min(1) }),
  CandidateSelectionBaseSchema.extend({ outcome: z.literal("needs-fact"), inspectionRequest: z.object({ request: z.string().min(1), expectedDelta: z.string().min(1), contextRefs: z.array(z.string()).default([]), requiredCapabilities: z.array(z.enum(SOLUTION_EXECUTION_CAPABILITIES)).min(1) }).strict() }),
]);
export type CandidateSelectionOutput = z.infer<typeof CandidateSelectionOutputSchema>;
export type SynthesisOutput = DomainGenerationOutput | DomainChallengeOutput | CandidateSelectionOutput;

export const SolutionDeltaSchema = z.object({
  decisionBoundary: DecisionBoundaryProposalSchema.optional(),
  region: z.object({
    objective: z.string().optional().describe("The goal to decide or deliver. Inspectors must omit this field entirely — never restate the assigned goal."),
    delivery: z.enum(["answer", "change"]).optional().describe("Only settable together with a complete resolvedAnswer, and only after every implementation alternative is settled; a change goal may not be quietly downgraded to Q&A."),
    allowedVariables: z.array(z.string()).optional().describe("The only aspects that may be chosen here."),
    acceptanceCriteria: z.array(z.string()).optional().describe("Observable conditions that prove the goal is complete."),
  }).optional().describe("Use only to clarify the current goal or its success criteria."),
  evidence: z.array(EvidenceSchema).default([]).describe("New claims used in this result. Inference always enters as an unconfirmed hypothesis. Only inspection may report repository/tool observations, which enter as confirmed evidence. Model output may not create user evidence; cite the immutable task reference instead."),
  factIds: z.array(z.string().min(1)).default([]).describe("ReferenceIds of facts already supplied in the FACTS section that this result reuses. Leave empty when no supplied fact matches; never place chunkIds, file names, or new observations here — report new observations in evidence with their exact chunkId."),
  validations: z.array(z.object({
    claimRef: z.string().min(1).describe("Existing hypothesis id being checked."),
    verdict: z.enum(["confirmed", "rejected", "unresolved"]),
    evidenceRefs: z.array(z.string()).default([]).describe("Confirmed repository/tool/user evidence proving confirmed or rejected. Use existing ids or sources supplied in this result."),
    reason: z.string().min(1),
  })).optional().describe("Kernel-checked validation results for existing hypotheses. Confirmed/rejected require independent evidence; unresolved has no effect."),
  criterionEvidence: z.array(z.object({
    criterionIndex: z.number().int().nonnegative(),
    verdict: z.enum(["satisfied", "unsatisfied", "blocked", "unknown"]).optional().describe("Repository verdict for this criterion. Omit only for compatibility; omission means satisfied."),
    evidenceRefs: z.array(z.string().min(1)).min(1),
    reason: z.string().min(1).optional(),
  }).strict()).default([]).describe("Inspection-only mapping from a success criterion to the task or confirmed facts sufficient to stop inspecting that criterion. Criteria proposed in this same result are obligations of this result: map every proposed criterion index before returning a boundary."),
  variables: z.array(z.object({
    name: z.string().min(1).describe("A short stable name for a new shared choice that several moves depend on, e.g. 'http-client'. Declare it only when moves genuinely differ on it; reuse the established name instead of inventing a variant."),
    seedLabels: z.array(z.string()).default([]).describe("Options already known for this choice, stated exactly. Informational; new options may still appear later."),
  })).default([]).describe("New shared choices declared at this decision level. Leave empty unless one is genuinely needed."),
  candidates: z.array(z.object({
    key: z.string().min(1).describe("A short stable name for this alternative."),
    proposition: z.string().min(1).describe("The complete approach this alternative proposes."),
    outcome: z.enum(["possible", "eliminated", "selected"]).default("possible").describe("Legacy proposed disposition. 'selected' is rejected outside select-candidate. Use 'eliminated' only with a confirmed-evidence refutation; the kernel stores the candidate as possible and derives elimination."),
    reasons: z.array(z.string()).default([]).describe("For a rejected alternative, explain why it should not be chosen. Do not put supporting facts here."),
    evidenceRefs: z.array(z.string()).default([]).describe("References to facts that justify the stated outcome."),
    stances: z.array(z.object({
      variable: z.string().min(1).describe("Name of a shared choice declared for this goal or inherited from an earlier one."),
      relation: z.enum(["requires", "excludes", "prefers"]).describe("'requires' = this move is viable only with that option. 'excludes' = this move cannot coexist with that option. 'prefers' = when nothing else distinguishes moves, favor that option."),
      valueLabel: z.string().min(1).describe("The option itself. Reuse the exact established spelling of an existing option instead of paraphrasing it."),
    })).default([]).describe("How this move positions on shared choices. Omit when the move touches none."),
  })).default([]).describe("Complete alternatives to the same choice. They must not be combined, and exactly one should be chosen. Put independent deliverables under the chosen alternative as 'partOf' children, not as competing alternatives."),
  constraints: z.array(z.object({
    kind: z.enum(["requires", "excludes", "supports", "refutes", "equivalent"]),
    subject: z.string().min(1).describe("Key or reference of the item this statement is about."),
    target: z.string().min(1).describe("Key or reference of the related item. For 'refutes' this may also be a shared choice with an option, written as choiceName:option."),
    reason: z.string().default("").describe("Why this relationship is true, using supplied facts."),
    evidenceRefs: z.array(z.string()).default([]).describe("Facts backing this statement. Required when refuting a shared choice option; an uncited refutation of a shared choice is rejected."),
    sourceKind: z.enum(["user-task", "repo-evidence", "model-inference"]).default("model-inference").describe("Where this relationship comes from: stated by the user, grounded in repository facts, or inferred while comparing alternatives."),
  })).default([]).describe("Relationships between referenced items: 'requires' means one needs another; 'excludes' means they cannot coexist; 'supports' means one strengthens another; 'refutes' means one contradicts another; 'equivalent' means they are interchangeable."),
  select: z.array(z.string()).default([]).describe("Legacy transport field. Model-authored selection is rejected; only select-candidate may commit a family."),
  answer: z.string().optional().describe("Answer text for a goal already marked as answer-only."),
  resolvedAnswer: z.object({
    answer: z.string().min(1).describe("The complete answer to give the user."),
    acceptanceCriteria: z.array(z.string().min(1)).min(1).describe("Conditions showing that this answer fully satisfies the request."),
    evidenceRefs: z.array(z.string()).default([]).describe("References to facts that support the answer. Cite at least one existing fact or a fact supplied with this result; an uncited answer is rejected."),
  }).optional().describe("Use only when the user's request can be fully answered without changing files. On a change goal, first settle the solution space through select-candidate or evidence-backed elimination and cite the task reference in evidenceRefs."),
  taskScopes: z.array(z.object({
    key: z.string().min(1), objective: z.string().min(1), delivery: z.enum(["answer", "change"]).default("change"), allowedVariables: z.array(z.string()).default([]), acceptanceCriteria: z.array(z.string().min(1)).min(1), requirementKeys: z.array(z.string()).optional(), dependencyScopeIds: z.array(z.string()).optional(), mutationResources: z.array(z.string()).optional(),
  }).strict()).optional().describe("Inspector-only root AND decomposition for two or more independently verifiable material tasks."),
  taskDispositions: z.array(z.object({ key: z.string().min(1), request: z.string().min(1), disposition: z.enum(["conflicting", "external", "speculative"]), reason: z.string().min(1), evidenceRefs: z.array(z.string().min(1)).min(1) }).strict()).optional().describe("Explicit evidence-backed disposition only for requested items that cannot become aligned root partOf scopes. Never use this to choose a subset of aligned deliverables."),
  materialRequirements: z.array(z.object({
    key: z.string().min(1),
    text: z.string().min(1),
    evidenceRefs: z.array(z.string().min(1)).min(1).describe("Confirmed fact IDs, repository chunk IDs, or the task reference establishing this requirement. These dependencies follow the requirement into refinement."),
    scopeKey: z.string().min(1).optional().describe("Preferred binding: for a non-decomposed root boundary use the current regionId from TASK LINEAGE (for example r1); for decomposition use the exact key of the owning taskScope. Never use variable, criterion, requirement, or scope IDs."),
    criterionIndex: z.number().int().nonnegative().optional().describe("Preferred binding: the owning scope's acceptanceCriteria position (0-based). Cite scopeKey + criterionIndex instead of echoing criterion text."),
    criterion: z.string().min(1).optional().describe("Legacy binding by exact criterion text. Prefer scopeKey + criterionIndex; echoed text must match a task scope's criterion character for character after whitespace normalization."),
  }).strict()).optional().describe("Complete inventory of every gating root requirement, each bound to exactly one observable criterion and its evidence. Author it only during initial root inspection; once admitted, the controller owns its identity, text, scope, and criterion. Omission is not a disposition; use taskDispositions for evidence-backed exclusions."),
  materialRequirementEvidence: z.array(z.object({
    requirementId: z.string().min(1).describe("Exact supplied material requirement ID whose evidence is being refreshed."),
    evidenceRefs: z.array(z.string().min(1)).min(1).describe("Current confirmed facts or same-result repository chunks establishing this requirement."),
  }).strict()).optional().describe("Evidence-only refresh for established material requirements. Never repeat their key, text, scope, or criterion."),
  certifiedVerdict: z.object({ proposition: z.string().min(1), implementationScope: z.string().min(1), evidenceRefs: z.array(z.string()).min(1), mutationResources: z.array(z.string().min(1)).min(1) }).strict().optional().describe("Mechanically fixed small correction whose exact repository evidence, implementation scope, and mutation paths leave no genuine solution choice."),
  alreadySatisfied: z.object({
    proposition: z.string().min(1),
    criterionEvidence: z.array(z.object({ criterionIndex: z.number().int().nonnegative(), evidenceRefs: z.array(z.string().min(1)).min(1) }).strict()).min(1),
    verificationResources: z.array(z.string().min(1)).default([]),
  }).strict().optional().describe("Current repository state already satisfies every criterion. Evidence is mapped by criterion position and the controller proceeds directly to independent verification without implementation."),
  activations: z.array(z.object({
    capability: z.enum(["inspect", "synthesize", "refine", "implement", "verify", "present"]).describe("The kind of help needed."),
    regionId: z.string().optional().describe("The supplied goal reference. Omit it to use the current goal."),
    request: z.string().min(1).describe("One specific task for the requested helper."),
    expectedDelta: z.string().min(1).describe("A short stable name for the expected new information or work. It prevents duplicate requests."),
    contextRefs: z.array(z.string()).default([]).describe("References the helper needs to see."),
    requiredCapabilities: z.array(z.enum(SOLUTION_EXECUTION_CAPABILITIES)).min(1).describe("Operational capabilities the helper must have. The controller rejects incompatible routing."),
  })).default([]).describe("Requests for another helper. Leave empty unless one missing fact or proven conflict prevents your assigned work."),
});
export type SolutionDelta = z.infer<typeof SolutionDeltaSchema>;

const InspectionEvidenceSchema = z.discriminatedUnion("kind", [
  z.object({
    text: z.string().min(1),
    source: z.string().min(1),
    kind: z.literal("repository"),
    chunkId: z.string().min(1).describe("The exact chunkId or observation digest returned by graph_read, graph_inspect_worktrees, or graph_read_worktree_diff. The controller derives and verifies provenance."),
  }).strict(),
  z.object({ text: z.string().min(1), source: z.string().min(1), kind: z.literal("inference"), assertion: z.enum(["correctness-claim", "fitness-claim", "other-claim"]).default("other-claim") }).strict(),
]);

const InspectionRequestSchema = z.object({
  request: z.string().min(1).describe("The one specific repository fact still needed."),
  expectedDelta: z.string().min(1).describe("A stable semantic name for that fact; reuse it for equivalent requests."),
  contextRefs: z.array(z.string()).default([]),
  requiredCapabilities: z.array(z.enum(SOLUTION_EXECUTION_CAPABILITIES)).min(1).describe("Use external-worktree-observe for linked worktree inventory or diffs; otherwise use repository-observe."),
}).strict();

const InspectionOutputBaseSchema = z.object({
  region: SolutionDeltaSchema.shape.region.unwrap().omit({ objective: true, delivery: true }).strict().optional(),
  evidence: z.array(InspectionEvidenceSchema).default([]),
  factIds: SolutionDeltaSchema.shape.factIds,
  validations: SolutionDeltaSchema.shape.validations,
  criterionEvidence: SolutionDeltaSchema.shape.criterionEvidence,
  materialRequirementEvidence: SolutionDeltaSchema.shape.materialRequirementEvidence,
}).strict();
const ChangeInspectionOutputOptions = [
  InspectionOutputBaseSchema.extend({ outcome: z.literal("facts") }),
  InspectionOutputBaseSchema.extend({ outcome: z.literal("boundary"), decisionBoundary: DecisionBoundaryProposalSchema, materialRequirements: SolutionDeltaSchema.shape.materialRequirements }),
  InspectionOutputBaseSchema.extend({ outcome: z.literal("need-fact"), inspection: InspectionRequestSchema }),
  InspectionOutputBaseSchema.extend({ outcome: z.literal("decompose"), taskScopes: SolutionDeltaSchema.shape.taskScopes.unwrap().min(2), taskDispositions: SolutionDeltaSchema.shape.taskDispositions, materialRequirements: SolutionDeltaSchema.shape.materialRequirements }),
  InspectionOutputBaseSchema.extend({ outcome: z.literal("certified"), certifiedVerdict: SolutionDeltaSchema.shape.certifiedVerdict.unwrap() }),
  InspectionOutputBaseSchema.extend({ outcome: z.literal("already-satisfied"), alreadySatisfied: SolutionDeltaSchema.shape.alreadySatisfied.unwrap() }),
] as const;
export const ChangeInspectionOutputSchema = z.discriminatedUnion("outcome", ChangeInspectionOutputOptions);
export const EstablishedChangeInspectionOutputSchema = z.discriminatedUnion("outcome", [
  InspectionOutputBaseSchema.extend({ outcome: z.literal("facts") }),
  InspectionOutputBaseSchema.extend({ outcome: z.literal("boundary"), decisionBoundary: DecisionBoundaryProposalSchema }),
  InspectionOutputBaseSchema.extend({ outcome: z.literal("need-fact"), inspection: InspectionRequestSchema }),
  InspectionOutputBaseSchema.extend({ outcome: z.literal("certified"), certifiedVerdict: SolutionDeltaSchema.shape.certifiedVerdict.unwrap() }),
  InspectionOutputBaseSchema.extend({ outcome: z.literal("already-satisfied"), alreadySatisfied: SolutionDeltaSchema.shape.alreadySatisfied.unwrap() }),
]);
export const InspectionOutputSchema = z.discriminatedUnion("outcome", [
  ...ChangeInspectionOutputOptions,
  InspectionOutputBaseSchema.extend({ outcome: z.literal("answer"), resolvedAnswer: SolutionDeltaSchema.shape.resolvedAnswer.unwrap() }),
]);
export type InspectionOutput = z.infer<typeof InspectionOutputSchema>;

const RefinementOutputBaseSchema = z.object({
  evidence: z.array(HypothesisEvidenceSchema).default([]),
}).strict();
const CertifiedLeafSchema = z.object({
    implementationScope: z.string().min(1),
    criterionIds: z.array(z.string().min(1)).default([]),
    requirementIds: z.array(z.string().min(1)).default([]),
    evidenceRefs: z.array(z.string()).default([]),
    mutationResources: z.array(z.string().min(1)).default([]),
    checks: z.array(z.object({ criterionId: z.string().min(1), commandOrObservation: z.string().min(1) }).strict()).min(1),
}).strict();
const AtomicityWitnessSchema = z.object({
  outcome: z.string().min(1).describe("The single coherent behavioral outcome delivered by this leaf."),
  criterionIds: z.array(z.string().min(1)),
  requirementIds: z.array(z.string().min(1)),
  mutationResources: z.array(z.string().min(1)),
  whySplittingFails: z.string().min(1).describe("Why a two-way partition would overlap mutation ownership, require unresolved coordination, or merely wrap the same change."),
}).strict();
export const LeafRefinementOutputSchema = RefinementOutputBaseSchema.extend({ outcome: z.literal("leaf"), certifiedLeaf: CertifiedLeafSchema, atomicityWitness: AtomicityWitnessSchema });
export const RefinementOutputSchema = z.discriminatedUnion("outcome", [
  RefinementOutputBaseSchema.extend({ outcome: z.literal("boundary"), decisionBoundary: DecisionBoundaryProposalSchema }),
  RefinementOutputBaseSchema.extend({ outcome: z.literal("need-fact"), inspection: InspectionRequestSchema }),
  RefinementOutputBaseSchema.extend({ outcome: z.literal("children"), children: z.array(ChildRegionSchema).min(1).describe("Next conditional work regions that together cover every criterion.") }),
  LeafRefinementOutputSchema,
]);
export type RefinementOutput = z.infer<typeof RefinementOutputSchema>;

const ImplementationOutputBaseSchema = z.object({
  summary: z.string().default(""),
  changedFiles: z.array(z.string()).default([]),
  checks: z.array(z.object({ name: z.string(), passed: z.boolean(), evidence: z.string().default("") })).default([]),
  todoDisposition: z.string().optional(),
}).strict();
export const ImplementationOutputSchema = z.discriminatedUnion("outcome", [
  ImplementationOutputBaseSchema.extend({ outcome: z.literal("completed") }),
  ImplementationOutputBaseSchema.extend({ outcome: z.literal("already-satisfied") }),
  ImplementationOutputBaseSchema.extend({ outcome: z.literal("blocked"), blocker: z.string().min(1) }),
]);
export type ImplementationOutput = z.infer<typeof ImplementationOutputSchema>;

const VerificationOutputBaseSchema = z.object({
  summary: z.string().default(""),
  findings: z.array(z.object({ criterionId: z.string().min(1), regionId: z.string(), severity: z.enum(["low", "medium", "high"]), target: z.discriminatedUnion("kind", [z.object({ kind: z.literal("files"), refs: z.array(z.string().min(1)).min(1) }).strict(), z.object({ kind: z.literal("answer"), refs: z.array(z.string().min(1)).default([]) }).strict(), z.object({ kind: z.literal("environment"), refs: z.array(z.string().min(1)).default([]) }).strict(), z.object({ kind: z.literal("external"), refs: z.array(z.string().min(1)).default([]) }).strict()]), problem: z.string(), regressionCriterion: z.string().min(1), evidence: z.string().min(1), evidenceRefs: z.array(z.string().min(1)).default([]), invalidatedPremiseRefs: z.array(z.string().min(1)).optional(), resolutionOwner: z.string().min(1).optional(), requiredEvidence: z.array(z.string().min(1)).optional() }).strict()).default([]),
  checks: z.array(z.object({
    name: z.string(), passed: z.boolean(), evidence: z.string().default(""),
    disposition: z.enum(["criterion-gating", "release-gating", "preexisting", "out-of-scope", "environmental"]).default("criterion-gating"),
    criterionIds: z.array(z.string().min(1)).default([]), reason: z.string().optional(), baselineEvidenceRefs: z.array(z.string().min(1)).default([]), resolutionOwner: z.string().optional(), requiredEvidence: z.array(z.string().min(1)).default([]),
  }).strict()).default([]),
  completionEvidence: z.object({ implementationOutcome: z.enum(["changed", "already-satisfied"]).optional(), implementation: z.string().min(1), directTest: z.string().min(1), correctnessReview: z.string().min(1), releaseGate: z.string().min(1), changedFiles: z.array(z.string().min(1)).default([]), focusedTests: z.array(z.string().min(1)).min(1), fullChecks: z.array(z.string().min(1)).min(1), criterionIds: z.array(z.string().min(1)).optional(), inspectionEvidenceRefs: z.array(z.string().min(1)).default([]), todoDisposition: z.string().optional() }).strict().optional(),
}).strict();
export const VerificationOutputSchema = z.discriminatedUnion("outcome", [
  VerificationOutputBaseSchema.extend({ outcome: z.literal("pass") }),
  VerificationOutputBaseSchema.extend({ outcome: z.literal("repair") }),
  VerificationOutputBaseSchema.extend({ outcome: z.literal("reopen") }),
  VerificationOutputBaseSchema.extend({ outcome: z.literal("fail") }),
]);
export type VerificationOutput = z.infer<typeof VerificationOutputSchema>;

export const PresentationOutputSchema = z.object({ outcome: z.literal("answer"), answer: z.string().min(1) }).strict();

export interface SolutionLodState extends Record<string, unknown> {
  stateVersion: 11;
  runId: string;
  diagnosticContext?: string;
  directory: string;
  worktree: string;
  phase: string;
  activeActivationId?: string;
  activeBatch: ActiveBatchEntry[];
  network: SolutionNetwork;
  results: ActivationTaskResult[];
  usage: AgentUsage;
  callsUsed: number;
  startedAt: number;
  result: string;
}
