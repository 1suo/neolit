import { createHash } from "node:crypto";
import type { ActivationContextTelemetry, AgentToolTrace, SolutionExecutionCapability } from "../types.js";
import type { Activation, ActivationOutput, ActivationReadRef, ActivationTaskResult, CandidateSelectionOutput, Capability, CandidateStance, ChangeIntegrationResult, CompletionCertificate, ContextRefKind, CriterionId, DecisionBoundaryProposal, DecisionVariable, DomainChallengeOutput, DomainGenerationOutput, FindingRoute, ImplementationOutput, InspectionCriterionResult, InspectionOutput, ProgressLedgerEntry, RefinementOutput, RepositoryEvidenceLocation, RequirementId, ScopeId, SemanticCycleKind, SolutionAuthorityFrame, SolutionCandidate, SolutionConstraint, SolutionDelta, SolutionFinding, SolutionLodState, SolutionNetwork, SolutionRegion, SolutionTelemetry, StanceRelation, SynthesisOperation, SynthesisOutput, VerificationFinding, VerificationOutput } from "./types.js";
import { DEFAULT_ACTIVATION_CAPABILITIES, roleSupportsCapabilities } from "./roles.js";

const normalize = (value: string) => value.trim().replace(/\s+/g, " ");
const slug = (value: string) => normalize(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "candidate";
const propositionSignature = (value: string) => normalize(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const SAME_REVISION_RETRY_POLICY = { maxAttempts: 3 } as const;
export const MAX_SCHEMA_ATTEMPTS = 3;
export const MAX_CEGAR_ROUNDS = 2;
export const MAX_DOMAIN_CANDIDATES = 7;
export const MAX_NO_PROGRESS_CYCLES = 2;
export const MAX_SEMANTIC_CYCLES = 2;
const INTERRUPTED_SCHEMA_ATTEMPT = "Host process exited during a reserved schema attempt;";
const DEFERRED_WORK = /\b(?:estimate|eta|defer(?:red)?|follow(?:-| )up|future work)\b|\b\d+\s*(?:hours?|days?|weeks?)\b|\boptional(?:ly)?\s+(?:later|follow(?:-| )up|future|subsequent)\b|\b(?:do|finish|implement|address|handle|complete|revisit)\b.{0,40}\blater\b/i;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
export function assertNever(value: never): never { throw new Error(`Unexpected outcome: ${String(value)}`); }
const EMPTY_USAGE = { turns: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
const EMPTY_CONTEXT_TELEMETRY: ActivationContextTelemetry = { repositoryReadChars: 0, repositoryOutputChars: 0, otherToolOutputChars: 0, bashOutputChars: 0, duplicateReadCharsAvoided: 0, accumulatedSessionInput: 0, cacheReadInput: 0, structuredRepairAttempts: 0 };
function mutationPath(resource: string): string {
  const value = resource.trim().replace(/\\/g, "/").replace(/\/$/, "");
  if (!value || value.startsWith("/") || /^[a-z]:/i.test(value) || value.split("/").some((part) => !part || part === "." || part === ".." || part === ".git")) throw new Error(`Unsafe mutation resource path: ${resource}`);
  return value;
}
const normalizeMutationPath = (value: string): string => value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
const pathWithin = (child: string, parent: string): boolean => {
  const childPath = normalizeMutationPath(child);
  const parentPath = normalizeMutationPath(parent);
  return childPath === parentPath || childPath.startsWith(`${parentPath}/`);
};

const INITIAL_INSPECTION_REQUEST = "First preserve task structure: separate requested product behaviors at an unpartitioned root require decompose with taskScopes and any execution dependencies. Keep each behavior together with its tests and documentation, not separate supporting-activity scopes. A prescribed implementation does not erase those scope boundaries. Within one cohesive scope, if confirmed repository evidence grounds a fixed correction, return certified with its bounded mutation paths; if it is already satisfied, return already-satisfied. Do not invent alternatives for execution tactics. Otherwise find the repository facts needed to form complete alternatives for this goal, then return the local decision boundary, root decomposition, or mechanically certified terminal result in this activation. Investigate lower-level details when they affect that choice, but do not turn them into choices yet. A facts-only result is valid only when it closes an explicit supplied proof or validation obligation.";
const emptyTelemetry = (): SolutionTelemetry => ({ activations: 0, physicalActivations: 0, promptAttempts: 0, schemaRetries: 0, schemaRepairs: 0, operationCalls: {}, counterexampleRepairs: 0, retries: 0, reopens: 0, cycles: 0, candidates: 0, regionCount: 0, promptChars: 0, schemaChars: 0, projectedContextChars: 0, validationFailures: 0, elapsedMs: 0, queueMs: 0, roleMs: {}, implementationMs: 0, verificationMs: 0, usage: { ...EMPTY_USAGE }, blockedReasons: [], regions: {}, contextTelemetry: { ...EMPTY_CONTEXT_TELEMETRY }, recordedActivationIds: [], activationRecords: [] });
const progressEntry = (): ProgressLedgerEntry => ({ count: 0, fingerprint: null, unresolvedCriterionIds: [] });
const emptyProgress = (): SolutionRegion["progress"] => ({ inspectionNoProgress: progressEntry(), cegarRounds: progressEntry(), selectionNoProgress: progressEntry(), reopenAttempts: progressEntry(), repairCycles: progressEntry() });
const addContextTelemetry = (target: ActivationContextTelemetry, source?: ActivationContextTelemetry): void => { for (const key of Object.keys(EMPTY_CONTEXT_TELEMETRY) as Array<keyof ActivationContextTelemetry>) target[key] = (target[key] ?? 0) + (source?.[key] ?? 0); };
function clearImplementationContinuation(region: SolutionRegion): void {
  region.retainedImplementationActivationId = undefined;
  region.implementationRecoveryAttempts = 0;
  if (region.integration?.status === "pending") region.integration = undefined;
}

function recordRecovery(network: SolutionNetwork, kind: "invalidation" | "prune" | "reopen" | "implementation-retry", regionId: string, reason: string): void {
  const telemetry = network.telemetry ??= emptyTelemetry();
  (telemetry.recoveryEvents ??= []).push({ kind, regionId, revision: network.revision + 1, reason });
}

function rejectUnrequestedDeferredWork(state: Pick<SolutionLodState, "network">, values: Array<string | undefined>): void {
  if (/\b(?:estimate|eta|how long|time|effort|hours?|days?|weeks?)\b/i.test(state.network.authority.task.exactText)) return;
  const rejected = values.find((value) => value && DEFERRED_WORK.test(value));
  if (rejected) throw new Error(`Unrequested estimate, optionalization, or deferred work is not a valid authored result: "${normalize(rejected)}".`);
}
export const taskReferencesTodo = (task: string) => /\bTODO\b/.test(task);

function taskAuthority(task: string): SolutionAuthorityFrame {
  return { task: { id: "task", exactText: task }, authoritativeMessages: [], admissions: [{ messageId: "task", scopeIds: "all", admittedRevision: 0, source: "provisional-all" }] };
}

export function initialNetwork(input: string | SolutionAuthorityFrame): SolutionNetwork {
  const authority = typeof input === "string" ? taskAuthority(input) : structuredClone(input);
  const task = authority.task.exactText;
  const network: SolutionNetwork = {
    authority,
    revision: 0, nextRegionId: 2, nextEvidenceId: 1, nextConstraintId: 1, nextActivationId: 2, nextArtifactId: 1, nextVariableId: 1, nextFindingId: 1, nextCertificateId: 1,
    regions: [{ id: "r1", key: "root", edge: "root", lod: 0, objective: task, delivery: "change", allowedVariables: ["solution family"], acceptanceCriteria: [], status: "unformed", progress: emptyProgress(), candidateIds: [], selectedCandidateIds: [], constraintIds: [], evidenceIds: [], activationIds: ["a1"], artifactIds: [], scopeId: "scope:r1", criterionIds: [], inspectionObligationIds: [], domainPhase: "inspecting", enumerationFingerprint: null, boundDomainFingerprint: null, domainFingerprint: null, acceptedFingerprint: null, challengeVerdict: null, requirementIds: [], dependencyScopeIds: [], mutationResources: [], selectionAge: 0 }],
    candidates: [], constraints: [], evidence: [], artifacts: [],
    activations: [{ id: "a1", capability: "inspect", requiredCapabilities: ["repository-observe"], regionId: "r1", request: INITIAL_INSPECTION_REQUEST, expectedDelta: "inspection:r1:0", contextRefs: ["r1"], status: "queued", basisRevision: 0, idempotencyKey: hash(["inspect", "", "r1", "inspection:r1:0", ["repository-observe"]]), mutationResources: [], queuedAt: Date.now() }],
    variables: [], findings: [], certificates: [], materialRequirements: [], taskDispositions: [], schemaRetries: {}, telemetry: emptyTelemetry(),
  };
  network.activations[0]!.readRefs = activationReadRefs(network, ["r1"]);
  network.activations[0]!.logicalActivationId = activationContextFingerprint(network.activations[0]!);
  return network;
}

function cloneNetwork(network: SolutionNetwork): SolutionNetwork {
  return {
    ...network,
    authority: structuredClone(network.authority),
    repositoryEpochs: network.repositoryEpochs ? structuredClone(network.repositoryEpochs) : undefined,
    regions: network.regions.map((item) => ({ ...item, progress: structuredClone(item.progress), decisionBoundary: item.decisionBoundary ? structuredClone(item.decisionBoundary) : undefined, allowedVariables: [...item.allowedVariables], acceptanceCriteria: [...item.acceptanceCriteria], criterionIds: [...(item.criterionIds ?? [])], inspectionObligationIds: item.inspectionObligationIds ? [...item.inspectionObligationIds] : undefined, criterionVerdicts: item.criterionVerdicts?.map((verdict) => ({ ...verdict, evidenceRefs: [...verdict.evidenceRefs] })), candidateIds: [...item.candidateIds], selectedCandidateIds: [...item.selectedCandidateIds], constraintIds: [...item.constraintIds], evidenceIds: [...item.evidenceIds], activationIds: [...item.activationIds], artifactIds: [...item.artifactIds], coveredCriteria: item.coveredCriteria ? [...item.coveredCriteria] : undefined, requirementIds: [...(item.requirementIds ?? [])], dependencyScopeIds: [...(item.dependencyScopeIds ?? [])], mutationResources: [...(item.mutationResources ?? [])], selectionPremiseRefs: item.selectionPremiseRefs ? [...item.selectionPremiseRefs] : undefined, implementationPremiseRefs: item.implementationPremiseRefs ? [...item.implementationPremiseRefs] : undefined, verificationPremiseRefs: item.verificationPremiseRefs ? [...item.verificationPremiseRefs] : undefined, convergenceCycles: item.convergenceCycles?.map((cycle) => ({ ...cycle, unresolvedCriterionIds: [...cycle.unresolvedCriterionIds] })), blockedDetails: item.blockedDetails ? structuredClone(item.blockedDetails) : undefined, certifiedLeaf: item.certifiedLeaf ? { ...item.certifiedLeaf, criterionIds: [...item.certifiedLeaf.criterionIds], requirementIds: [...(item.certifiedLeaf.requirementIds ?? [])], evidenceRefs: [...item.certifiedLeaf.evidenceRefs] } : undefined })),
    candidates: network.candidates.map((item) => ({ ...item, evidenceIds: [...item.evidenceIds], declaredEvidenceIds: item.declaredEvidenceIds ? [...item.declaredEvidenceIds] : undefined, eliminationReasons: [...item.eliminationReasons], declaredEliminationReasons: item.declaredEliminationReasons ? [...item.declaredEliminationReasons] : undefined, stances: (item.stances ?? []).map((stance) => ({ ...stance })) })),
    constraints: network.constraints.map((item) => ({ ...item })), evidence: network.evidence.map((item) => ({ ...item, location: item.location ? { ...item.location, range: [...item.location.range] } : undefined, controllerVerified: item.controllerVerified ? { ...item.controllerVerified } : undefined, validationEvidenceRefs: item.validationEvidenceRefs ? [...item.validationEvidenceRefs] : undefined, statusTimeline: item.statusTimeline?.map((event) => ({ ...event, evidenceRefs: [...event.evidenceRefs] })) })), activations: network.activations.map((item) => ({ ...item, contextRefs: [...item.contextRefs], requiredCapabilities: item.requiredCapabilities ? [...item.requiredCapabilities] : undefined, readRefs: item.readRefs?.map((ref) => ({ ...ref })), mutationResources: [...(item.mutationResources ?? [])], findingIds: [...(item.findingIds ?? [])], recovery: item.recovery ? { ...item.recovery, retryTrace: item.recovery.retryTrace?.map((trace) => ({ ...trace })) } : undefined })), artifacts: network.artifacts.map((item) => ({ ...item, evidenceRefs: item.evidenceRefs ? [...item.evidenceRefs] : undefined, requiredEvidence: item.requiredEvidence ? [...item.requiredEvidence] : undefined })),
    variables: network.variables.map((item) => ({ ...item, seedLabels: [...(item.seedLabels ?? [])], evidenceRefs: [...(item.evidenceRefs ?? [])] })), findings: network.findings.map((item) => ({ ...item, target: { ...item.target, refs: [...item.target.refs] }, route: structuredClone(item.route), evidenceRefs: [...item.evidenceRefs], repairActivationIds: [...item.repairActivationIds] })), certificates: network.certificates.map((item) => ({ ...item, criterionIds: [...item.criterionIds], requirementIds: [...(item.requirementIds ?? [])], selectedFamilyIds: [...item.selectedFamilyIds], equivalenceProofConstraintIds: [...item.equivalenceProofConstraintIds], premiseRefs: [...item.premiseRefs], dependencyCertificateRefs: [...item.dependencyCertificateRefs], measuredArtifactIds: item.measuredArtifactIds ? [...item.measuredArtifactIds] : undefined, focusedCheckArtifactIds: item.focusedCheckArtifactIds ? [...item.focusedCheckArtifactIds] : undefined, releaseCheckArtifactIds: item.releaseCheckArtifactIds ? [...item.releaseCheckArtifactIds] : undefined, artifactFingerprints: { ...item.artifactFingerprints }, resolvedFindingIds: [...item.resolvedFindingIds] })), materialRequirements: network.materialRequirements?.map((item) => ({ ...item, evidenceRefs: [...(item.evidenceRefs ?? [])] })) as SolutionNetwork["materialRequirements"], taskDispositions: network.taskDispositions?.map((item) => ({ ...item, evidenceRefs: [...item.evidenceRefs] })), schemaRetries: structuredClone(network.schemaRetries), telemetry: network.telemetry ? structuredClone(network.telemetry) : emptyTelemetry(),
  };
}

function candidateId(regionId: string, key: string): string {
  const normalized = normalize(key);
  return normalized.startsWith(`${regionId}:`) ? `${regionId}:${slug(normalized.slice(regionId.length + 1))}` : `${regionId}:${slug(normalized)}`;
}
function candidateRef(network: SolutionNetwork, regionId: string, ref: string): string {
  if (knownRef(network, ref)) return ref;
  return candidateId(regionId, ref);
}

function candidateSignature(proposition: string, stances: readonly CandidateStance[]): string {
  return JSON.stringify(stances.length
    ? stances.map((stance) => [stance.variableId, stance.relation, slug(stance.valueLabel)]).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
    : [propositionSignature(proposition)]);
}

/** Unconditional hard consequences. Commitment-dependent excludes/refutes belong to propagation, not domain viability. */
function hardEliminations(network: SolutionNetwork): Map<string, Set<string>> {
  const eliminated = new Map<string, Set<string>>();
  const refutedCoordinates = new Map<string, Set<string>>();
  const candidateIds = new Set(network.candidates.filter((item) => !item.historical).map((item) => item.id));
  const confirmed = (ref: string) => ref === "task" || isConfirmedEvidence(network, ref);
  const grounded = (constraint: SolutionConstraint) => constraint.evidenceRefs.every(confirmed)
    && (!network.evidence.some((item) => item.id === constraint.subject) || confirmed(constraint.subject));
  const add = (id: string, reason: string) => {
    if (!candidateIds.has(id)) return;
    if (!eliminated.has(id)) eliminated.set(id, new Set());
    eliminated.get(id)!.add(reason);
  };
  for (const constraint of network.constraints.filter((item) => !item.historical)) {
    if (constraint.kind !== "refutes" || candidateIds.has(constraint.subject) || !grounded(constraint)) continue;
    const reason = constraint.reason || "refuted by confirmed evidence";
    const coordinate = coordinateOf(network, constraint.target);
    if (!coordinate) add(constraint.target, reason);
    else {
      if (!constraint.evidenceRefs.length) continue;
      const key = `${coordinate.variableId}\0${slug(coordinate.valueLabel)}`;
      if (!refutedCoordinates.has(key)) refutedCoordinates.set(key, new Set());
      refutedCoordinates.get(key)!.add(reason);
    }
  }
  for (const candidate of network.candidates.filter((item) => !item.historical)) {
    for (const stance of candidate.stances ?? []) {
      if (stance.relation !== "requires") continue;
      const reasons = refutedCoordinates.get(`${stance.variableId}\0${slug(stance.valueLabel)}`);
      for (const reason of reasons ?? []) add(candidate.id, reason);
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const constraint of network.constraints.filter((item) => !item.historical)) {
      if (constraint.kind !== "requires" || !eliminated.has(constraint.target) || eliminated.has(constraint.subject)) continue;
      add(constraint.subject, constraint.reason || `requires ${constraint.target}, which is unavailable`);
      changed = true;
    }
  }
  return eliminated;
}

export function enumerationFingerprint(network: SolutionNetwork, regionId: string): string | null {
  const region = network.regions.find((item) => item.id === regionId);
  if (!region || !region.candidateIds.length) return null;
  const candidates = region.candidateIds.map((id) => network.candidates.find((item) => item.id === id)).filter((item): item is SolutionCandidate => Boolean(item)).map((item) => ({
    id: item.id, key: item.key, proposition: propositionSignature(item.proposition), evidenceRefs: [...new Set(item.declaredEvidenceIds ?? item.evidenceIds)].sort(),
  })).sort((left, right) => left.id.localeCompare(right.id));
  return hash({ boundaryFingerprint: region.decisionBoundary?.fingerprint ?? hash({ variables: [], permittedPairs: [] }), candidates });
}

export function boundDomainFingerprint(network: SolutionNetwork, regionId: string): string | null {
  const region = network.regions.find((item) => item.id === regionId);
  const enumeration = enumerationFingerprint(network, regionId);
  if (!region || !enumeration) return null;
  const ancestry = regionAncestryIds(network, region.id);
  const visibleVariables = network.variables.filter((item) => !item.historical && ancestry.has(item.ownerRegionId));
  const variableIds = new Set(visibleVariables.map((item) => item.id));
  const localCandidateIds = new Set(region.candidateIds);
  const canonicalCoordinates = region.candidateIds.flatMap((candidateId) => {
    const candidate = network.candidates.find((item) => item.id === candidateId && !item.historical);
    return visibleVariables.map((variable) => ({ candidateId, variableId: variable.id, applicable: Boolean(candidate?.stances.some((stance) => stance.variableId === variable.id)), stances: (candidate?.stances ?? []).filter((stance) => stance.variableId === variable.id).map((stance) => ({ relation: stance.relation, valueLabel: normalize(stance.valueLabel) })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))) }));
  }).sort((left, right) => `${left.candidateId}\0${left.variableId}`.localeCompare(`${right.candidateId}\0${right.variableId}`));
  const relevantConstraints = network.constraints.filter((item) => !item.historical && (region.constraintIds.includes(item.id) || localCandidateIds.has(item.subject) || localCandidateIds.has(item.target) || coordinateOf(network, item.subject) && variableIds.has(coordinateOf(network, item.subject)!.variableId) || coordinateOf(network, item.target) && variableIds.has(coordinateOf(network, item.target)!.variableId))).map((item) => ({ id: item.id, kind: item.kind, subject: item.subject, target: item.target, reason: normalize(item.reason), sourceKind: item.sourceKind, evidenceRefs: [...item.evidenceRefs].sort() })).sort((left, right) => left.id.localeCompare(right.id));
  const evidenceIds = new Set<string>([...(region.decisionBoundary?.variables.flatMap((item) => item.evidenceRefs) ?? []), ...(region.decisionBoundary?.permittedPairs.flatMap((item) => item.evidenceRefs) ?? []), ...region.candidateIds.flatMap((id) => network.candidates.find((item) => item.id === id)?.evidenceIds ?? []), ...relevantConstraints.flatMap((item) => item.evidenceRefs)]);
  for (const queue = [...evidenceIds]; queue.length;) { const id = queue.shift(); const item = network.evidence.find((entry) => entry.id === id); for (const ref of item?.validationEvidenceRefs ?? []) if (!evidenceIds.has(ref)) { evidenceIds.add(ref); queue.push(ref); } }
  const evidenceState = [...evidenceIds].map((id) => network.evidence.find((item) => item.id === id)).filter((item): item is NonNullable<typeof item> => Boolean(item)).map((item) => ({ id: item.id, fingerprint: item.fingerprint, kind: item.kind, status: item.status ?? (item.kind === "inference" ? "hypothesis" : "confirmed"), validationEvidenceRefs: [...(item.validationEvidenceRefs ?? [])].sort() })).sort((left, right) => left.id.localeCompare(right.id));
  const visibleCommitmentState = visibleVariables.map((variable) => {
    const bindingWitnesses = network.candidates.filter((item) => !item.historical && item.status === "selected" && item.regionId !== regionId).flatMap((candidate) => candidate.stances.filter((stance) => stance.variableId === variable.id && stance.relation === "requires").map((stance) => ({ candidateId: candidate.id, regionId: candidate.regionId, relation: "requires" as const, valueLabel: normalize(stance.valueLabel) }))).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    const unavailabilityWitnesses = relevantConstraints.flatMap((constraint) => { const coordinate = coordinateOf(network, constraint.target); return coordinate?.variableId === variable.id && (constraint.kind === "refutes" || constraint.kind === "excludes") && constraint.evidenceRefs.every((ref) => isConfirmedEvidence(network, ref)) ? [{ constraintId: constraint.id, valueLabel: normalize(coordinate.valueLabel), evidenceRefs: [...constraint.evidenceRefs].sort() }] : []; }).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    const labels = [...new Set(bindingWitnesses.map((item) => slug(item.valueLabel)))].sort();
    return { variableId: variable.id, bindingWitnesses, unavailabilityWitnesses, conflictValues: labels.length > 1 ? labels : [] };
  }).sort((left, right) => left.variableId.localeCompare(right.variableId));
  return hash({ enumerationFingerprint: enumeration, canonicalCoordinates, relevantConstraints, evidenceState, visibleCommitmentState });
}

/** @deprecated use boundDomainFingerprint. */
export const domainFingerprint = boundDomainFingerprint;

function accepted(network: SolutionNetwork, region: SolutionRegion): boolean {
  const fingerprint = boundDomainFingerprint(network, region.id);
  return Boolean(fingerprint && region.acceptedFingerprint === fingerprint);
}

const LEGAL_REGION_TRANSITIONS: Record<SolutionRegion["status"], SolutionRegion["status"][]> = {
  unformed: ["unformed", "superposed", "collapsed", "actionable", "implemented", "contradiction", "blocked", "stalled"], superposed: ["unformed", "superposed", "unrefined", "collapsed", "actionable", "implemented", "contradiction", "blocked", "stalled"], unrefined: ["unformed", "unrefined", "collapsed", "actionable", "implemented", "superposed", "contradiction", "blocked", "stalled"], collapsed: ["unformed", "collapsed", "superposed", "verified", "contradiction", "blocked", "stalled"], actionable: ["unformed", "unrefined", "actionable", "implementing", "implemented", "superposed", "contradiction", "blocked", "stalled"], implementing: ["unformed", "unrefined", "implementing", "implemented", "actionable", "superposed", "contradiction", "blocked", "stalled"], implemented: ["unformed", "unrefined", "implemented", "verified", "actionable", "superposed", "contradiction", "blocked", "stalled"], verified: ["unformed", "unrefined", "implemented", "verified", "actionable", "superposed", "contradiction", "blocked", "stalled"], contradiction: ["unformed", "contradiction", "superposed", "unrefined", "collapsed", "actionable", "implemented", "blocked", "stalled"], blocked: ["blocked", "superposed", "unformed", "actionable", "contradiction", "stalled"], stalled: ["stalled", "superposed", "unformed", "contradiction"],
};

/** The only production authority for region lifecycle changes. */
function transitionRegion(region: SolutionRegion, phase: SolutionRegion["domainPhase"], blockedReason?: string, status?: SolutionRegion["status"]): void {
  const nextStatus = status ?? (phase === "blocked" ? "blocked" : undefined);
  if (nextStatus && !LEGAL_REGION_TRANSITIONS[region.status].includes(nextStatus)) throw new Error(`Illegal region transition ${region.id}: ${region.status} -> ${nextStatus}`);
  region.domainPhase = phase;
  if (nextStatus) region.status = nextStatus;
  region.blockedReason = blockedReason;
  if (phase === "blocked") {
    region.contradiction = blockedReason;
    region.blockedDetails ??= { kind: "workflow", fingerprints: Object.values(region.progress).flatMap((entry) => entry.fingerprint ? [entry.fingerprint] : []), unresolvedCriterionIds: [...region.criterionIds] };
  }
}

function refreshDomainControls(network: SolutionNetwork): boolean {
  let changed = false;
  for (const region of network.regions) {
    const liveCandidateIds = region.candidateIds.filter((id) => network.candidates.some((item) => item.id === id && !item.historical));
    if (!exactSet(liveCandidateIds, region.candidateIds)) {
      region.candidateIds = liveCandidateIds;
      region.selectedCandidateIds = region.selectedCandidateIds.filter((id) => liveCandidateIds.includes(id));
      changed = true;
    }
    if (!region.candidateIds.length && (region.domainPhase === "challenging" || region.domainPhase === "selecting")) {
      region.acceptedFingerprint = null;
      region.challengeVerdict = null;
      region.selectedCandidateIds = [];
      transitionRegion(region, region.decisionBoundary ? "ungenerated" : "inspecting");
      changed = true;
    }
    const enumeration = enumerationFingerprint(network, region.id);
    const fingerprint = boundDomainFingerprint(network, region.id);
    if (region.enumerationFingerprint !== enumeration || region.boundDomainFingerprint !== fingerprint || region.domainFingerprint !== fingerprint) { region.enumerationFingerprint = enumeration; region.boundDomainFingerprint = fingerprint; region.domainFingerprint = fingerprint; changed = true; }
    if (region.acceptedFingerprint && region.acceptedFingerprint !== fingerprint) {
      region.acceptedFingerprint = null;
      region.challengeVerdict = null;
      const resolvedAnswer = network.candidates.find((item) => item.regionId === region.id && item.key === "resolved-answer" && region.delivery === "answer");
      transitionRegion(region, resolvedAnswer ? "selected" : region.candidateIds.length ? "challenging" : region.decisionBoundary ? "ungenerated" : "inspecting");
      region.selectedCandidateIds = resolvedAnswer ? [resolvedAnswer.id] : [];
      for (const candidate of network.candidates.filter((item) => item.regionId === region.id && item.declaredStatus === "selected" && item.id !== resolvedAnswer?.id)) { candidate.declaredStatus = "possible"; candidate.status = "possible"; }
      purgeDescendants(network, region.id);
      changed = true;
    }
  }
  for (const activation of network.activations) {
    if (activation.status !== "queued" || activationAdmitted(network, activation)) continue;
    activation.status = "superseded";
    activation.error = `Superseded: ${activation.operation ?? activation.capability} no longer matches its typed read-set, current phase, or fingerprint.`;
    changed = true;
  }
  return changed;
}
function knownRef(network: SolutionNetwork, ref: string): boolean {
  return Boolean(resolveContextReference(network, ref));
}

export interface ResolvedContextReference { ref: string; kind: ContextRefKind; revision: number; fingerprint: string; value: unknown }

function regionContextValue(region: SolutionRegion) {
  return {
    id: region.id, scopeId: region.scopeId, parentId: region.parentId, parentCandidateId: region.parentCandidateId, edge: region.edge,
    objective: region.objective, delivery: region.delivery, allowedVariables: region.allowedVariables, criteria: region.acceptanceCriteria,
    criterionIds: region.criterionIds, requirementIds: region.requirementIds ?? [], dependencyScopeIds: region.dependencyScopeIds ?? [],
    mutationResources: region.mutationResources ?? [], coveredCriteria: region.coveredCriteria ?? [],
    candidateIds: region.candidateIds, selectedCandidateIds: region.selectedCandidateIds, constraintIds: region.constraintIds,
    evidenceIds: region.evidenceIds, artifactIds: region.artifactIds, domainPhase: region.domainPhase,
    domainFingerprint: region.domainFingerprint, acceptedFingerprint: region.acceptedFingerprint,
  };
}

export function resolveContextReference(network: SolutionNetwork, ref: string): ResolvedContextReference | undefined {
  let kind: ContextRefKind; let value: unknown; let fingerprintValue: unknown; let revision = network.revision;
  if (ref === "task") { kind = "task"; value = network.authority.task; revision = 0; }
  else {
    // Prompts expose both region IDs and controller-owned scope IDs.  Either is a
    // valid read reference to the same region context.
    const region = network.regions.find((item) => item.id === ref || item.scopeId === ref);
    const criterionOwner = network.regions.find((item) => item.criterionIds.includes(ref as CriterionId));
    const requirement = network.materialRequirements?.find((item) => item.id === ref);
    const candidate = network.candidates.find((item) => item.id === ref && !item.historical);
    const evidence = network.evidence.find((item) => item.id === ref);
    const constraint = network.constraints.find((item) => item.id === ref && !item.historical);
    const artifact = network.artifacts.find((item) => item.id === ref && !item.historical);
    const finding = network.findings.find((item) => item.id === ref && item.status !== "superseded");
    const activation = network.activations.find((item) => item.id === ref && !item.historical);
    const coordinate = coordinateOf(network, ref);
    if (region) {
      kind = "region";
      value = regionContextValue(region);
      const ancestry = regionAncestryIds(network, region.id);
      const variables = network.variables.filter((item) => !item.historical && ancestry.has(item.ownerRegionId));
      const variableIds = new Set(variables.map((item) => item.id));
      const candidates = network.candidates.filter((item) => !item.historical && (item.regionId === region.id || ancestry.has(item.regionId) && item.status === "selected" || item.status === "selected" && item.stances?.some((stance) => variableIds.has(stance.variableId))));
      const candidateIds = new Set(candidates.map((item) => item.id));
      const constraints = network.constraints.filter((item) => {
        const separator = item.target.indexOf(":");
        return !item.historical && (candidateIds.has(item.subject) || candidateIds.has(item.target) || separator > 0 && variableIds.has(item.target.slice(0, separator)));
      });
      const evidenceIds = new Set(constraints.flatMap((item) => item.evidenceRefs ?? []));
      const projectedRegions = network.regions.filter((item) => ancestry.has(item.id)).map(regionContextValue);
      fingerprintValue = { value, authority: network.authority, projectedRegions, variables, candidates, constraints, evidence: network.evidence.filter((item) => evidenceIds.has(item.id)) };
    }
    else if (criterionOwner) { kind = "criterion"; const index = criterionOwner.criterionIds.indexOf(ref as CriterionId); value = { criterionId: ref, criterion: criterionOwner.acceptanceCriteria[index], regionId: criterionOwner.id }; }
    else if (requirement) { kind = "requirement"; value = requirement; fingerprintValue = { requirement, evidence: requirement.evidenceRefs.map((id) => id === "task" ? { id, fingerprint: hash(network.authority.task) } : (() => { const item = network.evidence.find((entry) => entry.id === id); return item ? { id, fingerprint: item.fingerprint, status: item.status } : { id, missing: true }; })()) }; }
    else if (candidate) { kind = "candidate"; value = candidate; revision = candidate.createdRevision ?? network.revision; }
    else if (evidence) { kind = "evidence"; value = evidence; revision = evidence.createdRevision ?? network.revision; }
    else if (constraint) { kind = "constraint"; value = constraint; revision = constraint.createdRevision ?? network.revision; }
    else if (artifact) { kind = "artifact"; value = artifact; revision = artifact.createdRevision ?? network.revision; }
    else if (finding) { kind = "finding"; value = finding; revision = finding.createdRevision; }
    else if (activation) { kind = "activation"; value = { id: activation.id, capability: activation.capability, operation: activation.operation, status: activation.status, expectedDelta: activation.expectedDelta }; }
    else if (coordinate) { kind = "coordinate"; value = coordinate; }
    else return undefined;
  }
  return { ref, kind, revision, value, fingerprint: hash(fingerprintValue ?? value) };
}

function activationReadRefs(network: SolutionNetwork, refs: string[]): ActivationReadRef[] {
  return [...new Set(refs)].sort().map((ref) => { const resolved = resolveContextReference(network, ref); if (!resolved) throw new Error(`Unknown activation context reference ${ref}.`); return { ref, kind: resolved.kind, revision: resolved.revision, fingerprint: resolved.fingerprint }; });
}

function activationReadsCurrent(network: SolutionNetwork, activation: Activation): boolean {
  return (activation.readRefs ?? activationReadRefs(network, activation.contextRefs)).every((read) => {
    const current = resolveContextReference(network, read.ref);
    return current?.kind === read.kind && current.fingerprint === read.fingerprint;
  });
}

export function activationContextFingerprint(activation: Pick<Activation, "idempotencyKey" | "readRefs">): string {
  return hash([activation.idempotencyKey ?? "", activation.readRefs ?? []]);
}

export function reserveSchemaAttempts(networkInput: SolutionNetwork, activationId: string): SolutionNetwork {
  const network = cloneNetwork(networkInput);
  const activation = network.activations.find((item) => item.id === activationId);
  if (!activation) return network;
  const logicalActivationId = activation.logicalActivationId ?? activationContextFingerprint(activation);
  activation.logicalActivationId = logicalActivationId;
  const ledger = network.schemaRetries[logicalActivationId] ??= { logicalActivationId, contextFingerprint: logicalActivationId, attempts: 0, retries: 0, repairs: 0, reservedAttempts: 0, trace: [] };
  if (ledger.reservationActivationId === activation.id) return network;
  const remaining = Math.max(0, MAX_SCHEMA_ATTEMPTS - ledger.attempts - ledger.reservedAttempts);
  ledger.reservedAttempts += remaining;
  ledger.reservationActivationId = activation.id;
  activation.schemaReservation = { attemptOrdinal: ledger.attempts + 1, maxAttempts: remaining };
  return network;
}

/** A process can die after submission but before a result checkpoint; charge the uncertain in-flight attempt and release the unused allowance. */
export function consumeInterruptedSchemaReservations(networkInput: SolutionNetwork): SolutionNetwork {
  const network = cloneNetwork(networkInput);
  for (const activation of network.activations.filter((item) => item.status === "running" && item.schemaReservation)) {
    const reservation = activation.schemaReservation!;
    const logicalActivationId = activation.logicalActivationId ?? activationContextFingerprint(activation);
    const ledger = network.schemaRetries[logicalActivationId] ??= { logicalActivationId, contextFingerprint: logicalActivationId, attempts: 0, retries: 0, repairs: 0, reservedAttempts: 0, trace: [] };
    ledger.trace.push({ physicalActivationId: activation.id, logicalActivationId, attemptOrdinal: reservation.attemptOrdinal, kind: reservation.attemptOrdinal > 1 ? "schema-repair" : "initial", outcome: "interrupted" });
    ledger.attempts++;
    if (reservation.attemptOrdinal > 1) { ledger.retries++; ledger.repairs++; }
    ledger.reservedAttempts = Math.max(0, ledger.reservedAttempts - reservation.maxAttempts);
    ledger.reservationActivationId = undefined;
    activation.schemaReservation = undefined;
    activation.status = "failed";
    activation.error = "Host process exited during a reserved schema attempt; the uncertain attempt was consumed and unused retries were released.";
    const region = network.regions.find((item) => item.id === activation.regionId);
    if (region?.status === "implementing") region.status = "actionable";
  }
  return network;
}

function settleSchemaAttempts(network: SolutionNetwork, record: ActivationTaskResult): void {
  const activation = network.activations.find((item) => item.id === record.activationId);
  const logicalActivationId = record.logicalActivationId ?? activation?.logicalActivationId;
  if (!logicalActivationId) return;
  const ledger = network.schemaRetries[logicalActivationId] ??= { logicalActivationId, contextFingerprint: logicalActivationId, attempts: 0, retries: 0, repairs: 0, reservedAttempts: 0, trace: [] };
  if (ledger.reservationActivationId === record.activationId) {
    ledger.reservedAttempts = Math.max(0, ledger.reservedAttempts - (activation?.schemaReservation?.maxAttempts ?? ledger.reservedAttempts));
    ledger.reservationActivationId = undefined;
  }
  const seen = new Set(ledger.trace.map((item) => `${item.physicalActivationId ?? ""}:${item.attemptOrdinal}`));
  const attempts = (record.promptAttempts ?? []).filter((item) => !seen.has(`${item.physicalActivationId ?? ""}:${item.attemptOrdinal}`));
  ledger.attempts += attempts.length;
  ledger.retries += attempts.filter((item) => item.kind === "schema-repair").length;
  ledger.repairs += attempts.filter((item) => item.kind === "schema-repair" && item.outcome !== "submitted").length;
  ledger.trace.push(...attempts.map((item) => ({ ...item })));
  if (activation) activation.schemaReservation = undefined;
}

export function activationRecovery(matches: Activation[], operation: SynthesisOperation | undefined, idempotencyKey: string, readRefs: ActivationReadRef[]): Activation["recovery"] {
  if (operation === "challenge-domain") return undefined;
  const recovery = [...matches].reverse().find((item) => item.status === "failed" && item.recovery && item.idempotencyKey === idempotencyKey && item.recovery.contextFingerprint === activationContextFingerprint({ idempotencyKey, readRefs }))?.recovery;
  return recovery ? { ...recovery, retryTrace: recovery.retryTrace.map((trace) => ({ ...trace })) } : undefined;
}

/** A shared choice with an option, written `choiceName:option` or `vN:option` — the coordinate a refutation can target. */
export function knownCoordinate(network: SolutionNetwork, ref: string): boolean {
  return Boolean(coordinateOf(network, ref));
}

export interface SolutionCoordinate { variableId: string; variableName: string; valueLabel: string }

function coordinateOf(network: SolutionNetwork, ref: string): SolutionCoordinate | undefined {
  const index = ref.indexOf(":");
  if (index <= 0) return undefined;
  const variable = findVariable(network, ref.slice(0, index));
  const valueLabel = normalize(ref.slice(index + 1));
  if (!variable || !valueLabel) return undefined;
  return { variableId: variable.id, variableName: variable.name, valueLabel };
}

function findVariable(network: SolutionNetwork, ref: string): DecisionVariable | undefined {
  const name = slug(ref);
  return network.variables.find((item) => !item.historical && (item.id === ref || (name.length > 0 && item.name === name)));
}

function regionAncestryIds(network: SolutionNetwork, regionId: string): Set<string> {
  const ids = new Set<string>();
  let cursor = network.regions.find((item) => item.id === regionId);
  while (cursor) { ids.add(cursor.id); cursor = cursor.parentId ? network.regions.find((item) => item.id === cursor?.parentId) : undefined; }
  return ids;
}

function activationContextReferenceIds(network: SolutionNetwork, regionId: string, explicitRefs: string[]): string[] {
  const refs = new Set([regionId, ...explicitRefs]);
  const validCertificates = network.certificates.filter((certificate) => isCompletionCertificateValid(network, certificate));
  for (const requirement of network.materialRequirements ?? []) {
    if (!validCertificates.some((certificate) => certificate.requirementIds.includes(requirement.id))) refs.add(requirement.id);
  }
  return [...refs];
}

function inspectionProgressFingerprint(network: SolutionNetwork, region: SolutionRegion): string {
  const evidence = region.evidenceIds.map((id) => network.evidence.find((item) => item.id === id)).filter((item): item is NonNullable<typeof item> => Boolean(item)).filter((item) => (item.status ?? (item.kind === "inference" ? "hypothesis" : "confirmed")) === "confirmed" || item.kind === "inference" && (item.status === "rejected" || item.status === "confirmed")).map((item) => [item.fingerprint, item.status ?? "confirmed"]).sort();
  const verdicts = (region.criterionVerdicts ?? []).map((item) => [item.criterionId, item.verdict, [...item.evidenceRefs].sort()]).sort();
  return hash({ evidence, verdicts, boundary: region.decisionBoundary?.fingerprint ?? null });
}

/** Reject paraphrased duplicates of an established option so pruning cannot silently miss near-spellings. */
function canonicalLabel(network: SolutionNetwork, variableId: string, rawLabel: string): string {
  const normalized = normalize(rawLabel);
  if (!normalized) throw new Error("A shared-choice option must be stated plainly instead of left empty.");
  const variable = network.variables.find((item) => item.id === variableId);
  for (const established of variable?.seedLabels ?? []) {
    if (slug(established) === slug(normalized) && established !== normalized)
      throw new Error(`Reuse the established option spelling "${established}" instead of "${rawLabel}" — near-duplicate spellings would split one option into two.`);
  }
  for (const candidate of network.candidates.filter((item) => !item.historical)) {
    for (const stance of candidate.stances ?? []) {
      if (stance.variableId !== variableId) continue;
      if (slug(stance.valueLabel) === slug(normalized) && stance.valueLabel !== normalized)
        throw new Error(`Reuse the established option spelling "${stance.valueLabel}" instead of "${rawLabel}" — near-duplicate spellings would split one option into two.`);
    }
  }
  return normalized;
}

/** Resolve authored stances against declared shared choices, enforcing visibility and canonical labels. */
function resolveStances(network: SolutionNetwork, regionId: string, stances: ReadonlyArray<{ variable: string; relation: StanceRelation; valueLabel: string }>): CandidateStance[] {
  const ancestry = regionAncestryIds(network, regionId);
  return stances.map((stance) => {
    const variable = findVariable(network, stance.variable);
    if (!variable) throw new Error(`Unknown shared choice "${stance.variable}". Declare it in this result's 'variables' field first, or use an established choice name.`);
    if (!ancestry.has(variable.ownerRegionId)) throw new Error(`Shared choice "${variable.name}" was declared at ${variable.ownerRegionId} and is not visible here — regions couple only through choices declared at or above them.`);
    return { variableId: variable.id, relation: stance.relation, valueLabel: canonicalLabel(network, variable.id, stance.valueLabel) };
  });
}

type ActivationInput = Omit<Activation, "id" | "status" | "basisRevision" | "idempotencyKey" | "readRefs" | "requiredCapabilities"> & Partial<Pick<Activation, "idempotencyKey">> & { requiredCapabilities: SolutionExecutionCapability[] };

export function activationRequiredCapabilities(activation: Pick<Activation, "capability" | "requiredCapabilities">): readonly SolutionExecutionCapability[] {
  return activation.requiredCapabilities ?? DEFAULT_ACTIVATION_CAPABILITIES[activation.capability];
}

function addActivation(network: SolutionNetwork, input: ActivationInput): Activation | undefined {
  const contextRefs = activationContextReferenceIds(network, input.regionId, [...input.contextRefs, ...(input.findingIds ?? [])]);
  const readRefs = activationReadRefs(network, contextRefs);
  if (!roleSupportsCapabilities(input.capability, input.requiredCapabilities)) throw new Error(`${input.capability} cannot satisfy required capabilities: ${input.requiredCapabilities.join(", ")}.`);
  const requiredCapabilities = [...new Set(input.requiredCapabilities)].sort();
  const idempotencyKey = input.idempotencyKey ?? hash([input.capability, input.operation ?? "", input.regionId, normalize(input.expectedDelta), requiredCapabilities]);
  const matches = network.activations.filter((item) => !item.historical && (item.idempotencyKey === idempotencyKey || !item.idempotencyKey && hash([item.capability, item.operation ?? "", item.regionId, normalize(item.expectedDelta), [...activationRequiredCapabilities(item)].sort()]) === idempotencyKey));
  // Only activations whose outcome actually landed (or is still in flight) occupy their
  // signature. Failed and superseded attempts produced nothing, so they must free the
  // slot — otherwise a killed-and-resumed run deadlocks behind its own superseded record.
  const duplicate = matches.some((item) => item.status !== "failed" && item.status !== "superseded");
  const readFingerprint = hash(readRefs.map(({ ref, kind, fingerprint }) => ({ ref, kind, fingerprint })));
  // A host death has already consumed the uncertain prompt in its schema ledger.
  // It must not also consume the semantic retry budget for the next activation.
  const failedAttempts = network.activations.filter((item) => !item.historical && item.regionId === input.regionId && item.capability === input.capability && item.operation === input.operation && item.status === "failed" && !item.error?.startsWith(INTERRUPTED_SCHEMA_ATTEMPT) && (item.readRefs ? hash(item.readRefs.map(({ ref, kind, fingerprint }) => ({ ref, kind, fingerprint }))) === readFingerprint : item.basisRevision === network.revision)).length;
  const region = network.regions.find((item) => item.id === input.regionId);
  if (duplicate || failedAttempts >= SAME_REVISION_RETRY_POLICY.maxAttempts || !region || input.contextRefs.some((ref) => !knownRef(network, ref)) || input.capability === "synthesize" && !input.operation) return undefined;
  if (input.capability === "implement" && region.status !== "actionable" || input.capability === "verify" && region.status !== "implemented" || input.capability === "present" && (region.status !== "actionable" || region.delivery !== "answer") || input.capability === "refine" && region.status !== "unrefined" || input.capability === "synthesize" && !["unformed", "superposed", "contradiction"].includes(region.status)) return undefined;
  const recovery = activationRecovery(matches, input.operation, idempotencyKey, readRefs);
  const logicalActivationId = activationContextFingerprint({ idempotencyKey, readRefs });
  const schema = network.schemaRetries[logicalActivationId];
  if (schema && schema.attempts + schema.reservedAttempts >= MAX_SCHEMA_ATTEMPTS) return undefined;
  const activation: Activation = { ...input, requiredCapabilities, id: `a${network.nextActivationId++}`, contextRefs, readRefs, idempotencyKey, logicalActivationId, mutationResources: [...new Set(input.mutationResources ?? region.mutationResources ?? [])].sort(), queuedAt: Date.now(), status: "queued", basisRevision: network.revision, ...(recovery ? { recovery: { ...recovery, retryTrace: recovery.retryTrace.map((trace) => ({ ...trace })) } } : {}) };
  network.activations.push(activation);
  network.regions.find((region) => region.id === input.regionId)?.activationIds.push(activation.id);
  return activation;
}

export function purgeDescendants(network: SolutionNetwork, regionId: string): boolean {
  const descendants = new Set<string>(); let expanded = true;
  while (expanded) { expanded = false; for (const item of network.regions) if (item.parentId && (item.parentId === regionId || descendants.has(item.parentId)) && !descendants.has(item.id)) { descendants.add(item.id); expanded = true; } }
  if (!descendants.size) return false;
  network.regions = network.regions.filter((item) => !descendants.has(item.id));
  const survivingRegionIds = new Set(network.regions.map((item) => item.id));
  network.candidates = network.candidates.filter((item) => survivingRegionIds.has(item.regionId));
  network.artifacts = network.artifacts.map((item) => survivingRegionIds.has(item.regionId) ? item : { ...item, historical: true });
  // Shared choices owned by removed regions die with them; nothing outside their subtree could see them anyway.
  network.variables = network.variables.filter((item) => survivingRegionIds.has(item.ownerRegionId));
  // Live activations of removed regions stay visible but can no longer land: their region is gone.
  network.activations = network.activations.map((item) => survivingRegionIds.has(item.regionId) ? item : { ...item, historical: true, status: item.status === "queued" || item.status === "running" ? "superseded" as const : item.status, error: item.error ?? `Historical activation: region ${item.regionId} was removed from the current solution.` });
  const survivingEndpoint = (ref: string) => ref === "task" || survivingRegionIds.has(ref) || network.candidates.some((item) => item.id === ref) || network.evidence.some((item) => item.id === ref) || network.artifacts.some((item) => item.id === ref) || knownCoordinate(network, ref);
  network.constraints = network.constraints.filter((item) => survivingEndpoint(item.subject) && survivingEndpoint(item.target));
  return true;
}

function equivalenceClasses(network: SolutionNetwork): Map<string, string> {
  const adjacent = new Map<string, string[]>();
  for (const candidate of network.candidates.filter((item) => !item.historical)) adjacent.set(candidate.id, []);
  for (const constraint of network.constraints.filter((item) => !item.historical)) {
    if (constraint.kind !== "equivalent" || !adjacent.has(constraint.subject) || !adjacent.has(constraint.target)) continue;
    adjacent.get(constraint.subject)!.push(constraint.target);
    adjacent.get(constraint.target)!.push(constraint.subject);
  }
  const classes = new Map<string, string>();
  for (const start of adjacent.keys()) {
    if (classes.has(start)) continue;
    const stack = [start]; classes.set(start, start);
    while (stack.length) {
      const current = stack.pop()!;
      for (const next of adjacent.get(current)!) if (!classes.has(next)) { classes.set(next, start); stack.push(next); }
    }
  }
  return classes;
}

function hasSelectedImplementationFamily(network: SolutionNetwork, region: SolutionRegion): boolean {
  if (!region.selectedCandidateIds.length || !accepted(network, region)) return false;
  const classes = equivalenceClasses(network);
  const selected = region.selectedCandidateIds.map((id) => network.candidates.find((item) => item.id === id));
  return selected.every((item) => item?.regionId === region.id && item.status === "selected")
    && new Set(region.selectedCandidateIds.map((id) => classes.get(id) ?? id)).size === 1;
}

const pairKey = (left: string, right: string) => left < right ? `${left}\0${right}` : `${right}\0${left}`;

export function admitDecisionBoundary(networkInput: SolutionNetwork, regionId: string, proposal: DecisionBoundaryProposal): SolutionNetwork {
  const network = cloneNetwork(networkInput);
  const region = network.regions.find((item) => item.id === regionId);
  if (!region) throw new Error(`Unknown decision-boundary region ${regionId}.`);
  if (proposal.basisRevision !== network.revision) throw new Error(`Stale decision boundary: expected basis revision ${network.revision}, received ${proposal.basisRevision}.`);
  if (region.candidateIds.some((id) => network.candidates.some((item) => item.id === id && !item.historical))) throw new Error("A decision boundary must be admitted before candidate generation.");
  const keys = proposal.variables.map((item) => slug(item.key));
  const requestedNames = proposal.variables.map((item) => slug(item.name));
  if (keys.some((item) => !item) || new Set(keys).size !== keys.length || requestedNames.some((item) => !item) || new Set(requestedNames).size !== requestedNames.length) throw new Error("Decision-boundary variable keys and canonical names must be unique and non-empty.");
  if (proposal.variables.some((item) => item.ownerRegionId !== regionId)) throw new Error(`Decision-boundary variables proposed for ${regionId} must be owned by that region.`);
  const reservedNames = new Set(network.variables.filter((item) => !item.historical && item.ownerRegionId !== regionId).map((item) => item.name));
  const names = requestedNames.map((requested) => {
    let name = requested;
    for (let suffix = 2; reservedNames.has(name); suffix++) name = `${requested}-${slug(regionId)}${suffix > 2 ? `-${suffix}` : ""}`;
    reservedNames.add(name);
    return name;
  });
  for (const item of proposal.variables) for (const ref of item.evidenceRefs) if (!isConfirmedEvidence(network, ref)) throw new Error(`Decision-boundary variable ${item.key} cites unresolved or stale evidence ${ref}.`);
  const variables = proposal.variables.map((item, index) => {
    const seedLabels = item.seedLabels.map(normalize).filter(Boolean).sort((left, right) => left.localeCompare(right));
    if (new Set(seedLabels.map(slug)).size !== seedLabels.length) throw new Error(`Decision-boundary variable ${item.key} has duplicate or non-canonical seed labels.`);
    return { id: `v${network.nextVariableId++}`, name: names[index]!, ownerRegionId: regionId, seedLabels, evidenceRefs: [...new Set(item.evidenceRefs)].sort() };
  });
  const byKey = new Map(keys.map((key, index) => [key, variables[index]!]));
  const seenPairs = new Set<string>();
  const permittedPairs = proposal.permittedPairs.map((item) => {
    const left = byKey.get(slug(item.leftVariableKey)); const right = byKey.get(slug(item.rightVariableKey));
    if (!left || !right || left.id === right.id) throw new Error(`Decision-boundary pair ${item.leftVariableKey} + ${item.rightVariableKey} must reference two distinct proposed variables.`);
    const key = pairKey(left.id, right.id); if (seenPairs.has(key)) throw new Error("Decision-boundary permitted pairs must be unique undirected edges."); seenPairs.add(key);
    for (const ref of item.evidenceRefs) if (!isConfirmedEvidence(network, ref)) throw new Error(`Decision-boundary pair cites unresolved or stale evidence ${ref}.`);
    return { leftVariableId: left.id, rightVariableId: right.id, evidenceRefs: [...new Set(item.evidenceRefs)].sort() };
  });
  network.variables = network.variables.map((item) => item.ownerRegionId === regionId && !item.historical ? { ...item, historical: true } : item).concat(variables);
  region.decisionBoundary = { fingerprint: hash({ variables, permittedPairs }), variables: variables.map((item) => ({ ...item })), permittedPairs };
  assertAcyclicPrimalGraph(network);
  network.revision++;
  return network;
}

/** The primal graph is declared only by controller-admitted undirected pairs. */
export function assertAcyclicPrimalGraph(network: SolutionNetwork): void {
  const parent = new Map<string, string>();
  const find = (id: string): string => { let root = id; while (parent.get(root) !== root) root = parent.get(root)!; while (parent.get(id) !== id) { const next = parent.get(id)!; parent.set(id, root); id = next; } return root; };
  const union = (left: string, right: string): boolean => { for (const id of [left, right]) if (!parent.has(id)) parent.set(id, id); const a = find(left); const b = find(right); if (a === b) return false; parent.set(a, b); return true; };
  const nameOf = new Map(network.variables.map((item) => [item.id, item.name]));
  const edgeLabel = (left: string, right: string) => `${nameOf.get(left) ?? left} + ${nameOf.get(right) ?? right}`;
  // Parallel edges (the same variable pair coupled again by another move or statement) are
  // legal; only an edge joining vertices already connected through other edges closes a cycle.
  const knownEdges = new Set<string>();
  const registerEdge = (left: string, right: string): boolean => {
    const key = pairKey(left, right);
    if (knownEdges.has(key)) return true;
    if (!union(left, right)) return false;
    knownEdges.add(key);
    return true;
  };
  for (const boundary of network.regions.map((item) => item.decisionBoundary).filter((item): item is NonNullable<typeof item> => Boolean(item))) for (const pair of boundary.permittedPairs) if (!registerEdge(pair.leftVariableId, pair.rightVariableId)) throw new Error(`Admitted shared choices "${edgeLabel(pair.leftVariableId, pair.rightVariableId)}" close a global coupling cycle.`);
  const admittedPairs = new Set(network.regions.flatMap((item) => item.decisionBoundary?.permittedPairs.map((pair) => pairKey(pair.leftVariableId, pair.rightVariableId)) ?? []));
  for (const constraint of network.constraints.filter((item) => !item.historical)) {
    const left = coordinateOf(network, constraint.subject); const right = coordinateOf(network, constraint.target);
    if (left && right && left.variableId !== right.variableId && !admittedPairs.has(pairKey(left.variableId, right.variableId))) throw new Error(`Constraint touches unadmitted variable pair ${edgeLabel(left.variableId, right.variableId)}.`);
  }
  for (const candidate of network.candidates.filter((item) => !item.historical)) {
    const touched = [...new Set((candidate.stances ?? []).map((stance) => stance.variableId))];
    if (touched.length > 2) throw new Error(`"${candidate.key}" touches more than two shared choices; use a composite variable or decompose the decision.`);
    if (touched.length === 2 && !admittedPairs.has(pairKey(touched[0]!, touched[1]!))) throw new Error(`"${candidate.key}" touches unadmitted shared-choice pair ${edgeLabel(touched[0]!, touched[1]!)}.`);
  }
}

export function isConfirmedEvidence(network: SolutionNetwork, id: string): boolean {
  if (id === "task") return true;
  const item = network.evidence.find((entry) => entry.id === id);
  if (!item || (item.status ?? (item.kind === "inference" ? "hypothesis" : "confirmed")) !== "confirmed") return false;
  if (item.kind === "repository") return Boolean(item.location && item.controllerVerified);
  if (item.kind !== "inference") return true;
  return Boolean(item.validationEvidenceRefs?.length && item.validationEvidenceRefs.every((ref) => ref === "task" || network.evidence.some((ground) => ground.id === ref && ground.kind !== "inference" && (ground.status ?? "confirmed") === "confirmed")));
}

export function invalidateStaleEvidence(networkInput: SolutionNetwork, evidenceIds: string[]): SolutionNetwork {
  const network = cloneNetwork(networkInput);
  const stale = new Set(evidenceIds);
  for (const queue = [...stale]; queue.length;) {
    const id = queue.shift()!;
    const evidence = network.evidence.find((item) => item.id === id);
    if (!evidence) throw new Error(`Cannot invalidate unknown evidence ${id}.`);
    appendEvidenceStatus(evidence, "stale", network.revision + 1, "Repository evidence or one of its validation premises changed.", [id]);
    for (const dependent of network.evidence) if (dependent.validationEvidenceRefs?.includes(id) && !stale.has(dependent.id)) { stale.add(dependent.id); queue.push(dependent.id); }
  }
  const citesStale = (refs: readonly string[] | undefined) => Boolean(refs?.some((ref) => stale.has(ref)));
  for (const constraint of network.constraints) if (!constraint.historical && citesStale(constraint.evidenceRefs)) constraint.historical = true;
  for (const region of network.regions) {
    const staleCriterionIds = (region.criterionVerdicts ?? []).filter((item) => citesStale(item.evidenceRefs)).map((item) => item.criterionId);
    if (staleCriterionIds.length) {
      region.criterionVerdicts = region.criterionVerdicts?.filter((item) => !staleCriterionIds.includes(item.criterionId));
      region.inspectionObligationIds = [...new Set([...(region.inspectionObligationIds ?? []), ...staleCriterionIds])];
      region.inspectionAttempts = 0;
    }
    const boundaryStale = Boolean(staleCriterionIds.length || region.decisionBoundary?.variables.some((item) => citesStale(item.evidenceRefs)) || region.decisionBoundary?.permittedPairs.some((item) => citesStale(item.evidenceRefs)));
    const domainStale = region.candidateIds.some((id) => citesStale(network.candidates.find((item) => item.id === id)?.evidenceIds)) || region.constraintIds.some((id) => network.constraints.find((item) => item.id === id)?.historical);
    const selectionStale = citesStale(region.selectionPremiseRefs);
    const refinementStale = citesStale(region.certifiedLeaf?.evidenceRefs);
    const implementationStale = citesStale(region.implementationPremiseRefs);
    const verificationStale = citesStale(region.verificationPremiseRefs);
    const frontier = boundaryStale ? "boundary" : domainStale ? "domain" : selectionStale ? "selection" : refinementStale ? "refinement" : implementationStale ? "implementation" : verificationStale ? "verification" : undefined;
    if (!frontier) continue;
    recordRecovery(network, "invalidation", region.id, `${frontier}: ${[...stale].sort().join(", ")}`);
    if (["boundary", "domain", "selection", "refinement"].includes(frontier)) {
      for (const child of [...network.regions].filter((item) => item.parentId === region.id && item.parentCandidateId)) retractRegion(network, child.id);
    }
    const artifactThreshold = frontier === "verification" ? 5 : 4;
    const capabilityRank: Partial<Record<Capability, number>> = { implement: 4, verify: 5, present: 5 };
    for (const artifact of network.artifacts.filter((item) => item.regionId === region.id && !item.historical)) {
      const capability = network.activations.find((item) => item.id === artifact.activationId)?.capability;
      if ((capabilityRank[capability!] ?? 0) >= artifactThreshold) artifact.historical = true;
    }
    if (frontier === "boundary") {
      for (const candidate of network.candidates.filter((item) => item.regionId === region.id && !item.historical)) candidate.historical = true;
      for (const variable of network.variables.filter((item) => item.ownerRegionId === region.id && !item.historical)) variable.historical = true;
      for (const constraint of network.constraints.filter((item) => region.constraintIds.includes(item.id) && !item.historical)) constraint.historical = true;
      region.candidateIds = []; region.constraintIds = []; region.decisionBoundary = undefined; region.enumerationFingerprint = null; region.boundDomainFingerprint = null; region.domainFingerprint = null;
      region.selectedCandidateIds = []; region.acceptedFingerprint = null; region.challengeVerdict = null; region.selectionPremiseRefs = undefined; region.certifiedLeaf = undefined; clearImplementationContinuation(region); region.implementationPremiseRefs = undefined; region.verificationPremiseRefs = undefined; region.answer = undefined;
      transitionRegion(region, "inspecting", undefined, "superposed");
    } else if (frontier === "domain") {
      for (const candidate of network.candidates.filter((item) => item.regionId === region.id && !item.historical)) { candidate.evidenceIds = candidate.evidenceIds.filter((id) => !stale.has(id)); candidate.declaredEvidenceIds = candidate.declaredEvidenceIds?.filter((id) => !stale.has(id)); }
      region.constraintIds = region.constraintIds.filter((id) => !network.constraints.find((item) => item.id === id)?.historical); region.selectedCandidateIds = []; region.acceptedFingerprint = null; region.challengeVerdict = null; region.selectionPremiseRefs = undefined; region.certifiedLeaf = undefined; clearImplementationContinuation(region); region.implementationPremiseRefs = undefined; region.verificationPremiseRefs = undefined; region.answer = undefined;
      for (const candidate of network.candidates.filter((item) => item.regionId === region.id && !item.historical)) { candidate.status = "possible"; candidate.declaredStatus = "possible"; }
      transitionRegion(region, "challenging", undefined, "superposed");
    } else if (frontier === "selection") {
      region.selectedCandidateIds = []; region.selectionPremiseRefs = undefined; region.certifiedLeaf = undefined; clearImplementationContinuation(region); region.implementationPremiseRefs = undefined; region.verificationPremiseRefs = undefined; region.answer = undefined;
      for (const candidate of network.candidates.filter((item) => item.regionId === region.id && !item.historical && item.status === "selected")) { candidate.status = "possible"; candidate.declaredStatus = "possible"; }
      transitionRegion(region, "selecting", undefined, "superposed");
    } else if (frontier === "refinement") {
      region.certifiedLeaf = undefined; clearImplementationContinuation(region); region.implementationPremiseRefs = undefined; region.verificationPremiseRefs = undefined; region.answer = undefined;
      transitionRegion(region, "selected", undefined, "unrefined");
    } else if (frontier === "implementation") {
      region.implementationPremiseRefs = undefined; region.verificationPremiseRefs = undefined;
      transitionRegion(region, "selected", undefined, "actionable");
    } else {
      region.verificationPremiseRefs = undefined;
      transitionRegion(region, "selected", undefined, "implemented");
    }
  }
  for (const activation of network.activations.filter((item) => item.status === "queued" || item.status === "running")) {
    if (activation.readRefs?.some((read) => stale.has(read.ref)) || !activationReadsCurrent(network, activation)) { activation.status = "superseded"; activation.error = "Superseded: an evidence premise became stale."; }
  }
  network.revision++;
  return network;
}

function repositoryEpochs(network: SolutionNetwork): NonNullable<SolutionNetwork["repositoryEpochs"]> {
  return network.repositoryEpochs ?? Object.fromEntries(network.regions
    .filter((region) => region.integration?.status === "landed")
    .sort((left, right) => Number(left.integration!.implementationActivationId.slice(1)) - Number(right.integration!.implementationActivationId.slice(1)))
    .flatMap((region) => Object.entries({ ...region.integration?.landedFileFingerprints, ...region.integration?.landedObservationFingerprints }).map(([file, digest]) => [file, { digest, revision: network.revision }])));
}

export function invalidateEvidenceDigestMismatches(network: SolutionNetwork, currentDigests: Readonly<Record<string, string>>): SolutionNetwork {
  const epochs = repositoryEpochs(network);
  const stale = network.evidence.filter((item) => {
    if (item.kind !== "repository" || item.status === "stale" || !item.location) return false;
    const file = item.location.canonicalPath;
    const epoch = epochs[file];
    const expected = epoch && (item.createdRevision ?? 0) <= epoch.revision ? epoch.digest : item.location.fileDigest;
    return currentDigests[file] !== undefined && currentDigests[file] !== expected;
  }).map((item) => item.id);
  const result = stale.length ? invalidateStaleEvidence(network, stale) : cloneNetwork(network);
  if (network.repositoryEpochs || Object.keys(epochs).length) result.repositoryEpochs = structuredClone(epochs);
  for (const [file, epoch] of Object.entries(epochs)) if (currentDigests[file] !== undefined && currentDigests[file] !== epoch.digest) delete result.repositoryEpochs![file];
  return result;
}

export function propagateNetwork(input: SolutionNetwork): SolutionNetwork {
  const network = cloneNetwork(input);
  const retainedCandidates = network.candidates;
  const retainedConstraints = network.constraints;
  network.candidates = retainedCandidates.filter((item) => !item.historical);
  network.constraints = retainedConstraints.filter((item) => !item.historical);
  refreshDomainControls(network);
  const confirmedEvidence = (id: string) => isConfirmedEvidence(network, id);
  const derivedSnapshot = (value: SolutionNetwork) => JSON.stringify({
    candidates: value.candidates.map(({ id, status, evidenceIds, eliminationReasons }) => ({ id, status, evidenceIds, eliminationReasons })),
    regions: value.regions.map(({ id, status, selectedCandidateIds, contradiction, domainPhase, domainFingerprint, acceptedFingerprint, challengeVerdict }) => ({ id, status, selectedCandidateIds, contradiction, domainPhase, domainFingerprint, acceptedFingerprint, challengeVerdict })),
    waiting: value.activations.filter((item) => item.status === "queued").map(({ id, status }) => ({ id, status })),
  });
  const beforeDerived = derivedSnapshot(network);
  // Derived statuses never become new solver input. Rebuild the domain from the
  // authored dispositions before applying the complete constraint set.
  for (const candidate of network.candidates) {
    const region = network.regions.find((item) => item.id === candidate.regionId);
    const directAnswer = candidate.key === "resolved-answer" && region?.delivery === "answer";
    if (candidate.declaredStatus === "selected" && !directAnswer && (!region || !accepted(network, region))) candidate.declaredStatus = "possible";
    candidate.status = candidate.declaredStatus ?? candidate.status;
    candidate.declaredEvidenceIds ??= [...candidate.evidenceIds];
    candidate.evidenceIds = [...candidate.declaredEvidenceIds];
    candidate.eliminationReasons = [...(candidate.declaredEliminationReasons ?? (candidate.status === "eliminated" ? candidate.eliminationReasons : []))];
  }
  const equivalence = equivalenceClasses(network);
  let changed = true;
  let anyChange = false;
  while (changed) {
    changed = false;
    const select = (id: string, reason: string) => {
      const candidate = network.candidates.find((item) => item.id === id);
      const region = candidate && network.regions.find((item) => item.id === candidate.regionId);
      if (!candidate || !region || !accepted(network, region) || candidate.status === "eliminated" || candidate.status === "selected") return;
      candidate.status = "selected"; candidate.eliminationReasons = candidate.eliminationReasons.filter((item) => item !== reason); changed = anyChange = true;
    };
    const eliminate = (id: string, reason: string) => {
      const candidate = network.candidates.find((item) => item.id === id);
      if (!candidate || candidate.status === "eliminated") return;
      candidate.status = "eliminated"; candidate.eliminationReasons = [...new Set([...candidate.eliminationReasons, reason])]; changed = anyChange = true;
    };
    for (const [id, reasons] of hardEliminations(network)) for (const reason of reasons) eliminate(id, reason);
    // Two-stage synchronous pass. Stage 1 applies fact-based kills (refutations, unavailable
    // requirements) — facts override commitments. Stage 2 then evaluates commitment-based rules
    // (excludes / requires-selection / equivalents) against the post-fact snapshot, so premise
    // validity never depends on constraint array order.
    const statusAtPassStart = new Map(network.candidates.map((item) => [item.id, item.status]));
    const isRegionSubject = (ref: string) => network.regions.some((item) => item.id === ref);
    const runConstraintSweeps = (statuses: Map<string, SolutionCandidate["status"]>, kinds: "facts" | "commitments") => {
      const pendingElims = new Map<string, Set<string>>();
      const pendingSelects = new Map<string, string>();
      const snapSelected = (ref: string) => statuses.get(ref) === "selected" || isRegionSubject(ref);
      const snapActive = (ref: string) => !statuses.has(ref) || statuses.get(ref) === "selected";
      const snapKnown = (ref: string) => statuses.has(ref);
      const queueEliminate = (id: string, reason: string) => {
        if (!statuses.has(id)) return;
        if (!pendingElims.has(id)) pendingElims.set(id, new Set());
        pendingElims.get(id)!.add(reason);
      };
      const effectivelyEliminated = (ref: string) => snapKnown(ref) && (statuses.get(ref) === "eliminated" || pendingElims.has(ref));
      const effectivelySelected = (ref: string) => snapSelected(ref) && !pendingElims.has(ref);
      for (let sweep = 0; sweep < 16; sweep += 1) {
        const eliminationsBefore = [...pendingElims.values()].reduce((total, reasons) => total + reasons.size, 0);
        const selectsBefore = pendingSelects.size;
        for (const constraint of network.constraints) {
          if (kinds === "facts") {
            if (constraint.kind === "refutes" && network.candidates.some((item) => item.id === constraint.subject) && snapActive(constraint.subject) && constraint.evidenceRefs.every(confirmedEvidence) && snapKnown(constraint.target)) queueEliminate(constraint.target, constraint.reason || constraint.kind);
            continue;
          }
          if (constraint.kind === "supports") {
            const candidate = network.candidates.find((item) => item.id === constraint.target);
            if (candidate && network.evidence.some((item) => item.id === constraint.subject) && !candidate.evidenceIds.includes(constraint.subject)) { candidate.evidenceIds.push(constraint.subject); changed = anyChange = true; }
            continue;
          }
          if (constraint.kind === "equivalent") {
            if (effectivelySelected(constraint.subject)) { const right = network.candidates.find((item) => item.id === constraint.target); if (right && !effectivelyEliminated(constraint.target)) pendingSelects.set(constraint.target, constraint.reason || "equivalent"); }
            if (effectivelySelected(constraint.target)) { const left = network.candidates.find((item) => item.id === constraint.subject); if (left && !effectivelyEliminated(constraint.subject)) pendingSelects.set(constraint.subject, constraint.reason || "equivalent"); }
            continue;
          }
          if (constraint.kind === "requires") {
            if (effectivelySelected(constraint.subject) && snapKnown(constraint.target) && !effectivelyEliminated(constraint.target)) pendingSelects.set(constraint.target, constraint.reason || constraint.kind);
            continue;
          }
          // excludes (both directions premised on live commitments)
          if (effectivelySelected(constraint.subject) && snapKnown(constraint.target)) queueEliminate(constraint.target, constraint.reason || "mutually exclusive alternatives");
          if (effectivelySelected(constraint.target) && snapKnown(constraint.subject)) queueEliminate(constraint.subject, constraint.reason || "mutually exclusive alternatives");
        }
        const eliminationsAfter = [...pendingElims.values()].reduce((total, reasons) => total + reasons.size, 0);
        if (eliminationsAfter === eliminationsBefore && pendingSelects.size === selectsBefore) break;
      }
      return { pendingElims, pendingSelects };
    };
    // Stage order matters: stance-facts (overlay) settle BEFORE commitment rules evaluate, so a
    // doomed commitment can never fire excludes/requires against its siblings on the way out.
const factStage = runConstraintSweeps(statusAtPassStart, "facts");
    for (const [id, reasons] of factStage.pendingElims) {
      for (const reason of reasons) eliminate(id, reason);
      // Fact-killed commitments release: facts override authored selections.
      const killed = network.candidates.find((item) => item.id === id);
      if (killed?.declaredStatus === "selected") killed.declaredStatus = "possible";
    }
    if (refreshDomainControls(network)) changed = anyChange = true;
    for (const candidate of network.candidates) {
      const region = network.regions.find((item) => item.id === candidate.regionId);
      if (candidate.status === "selected" && region && candidate.key !== "resolved-answer" && !accepted(network, region)) candidate.status = "possible";
    }
    // Shared-choice coordinates: cited refutations prune requiring moves everywhere visible;
    // committed selections bind options and prune excluding/requiring-other moves. prefers never eliminates.
    // Kills derive on a pure overlay to a fixed point first — a dead binder releases its binding
    // before anything else is killed off it — and only settled kills apply stickily.
    const refuted = new Set<string>();
    for (const constraint of network.constraints) {
      if (constraint.kind !== "refutes") continue;
      const coordinate = coordinateOf(network, constraint.target);
      if (!coordinate || !constraint.evidenceRefs?.length) continue;
      if (!constraint.evidenceRefs.every(confirmedEvidence)) continue;
      const subjectCandidate = network.candidates.find((item) => item.id === constraint.subject);
      if (subjectCandidate && subjectCandidate.status !== "selected") continue;
      refuted.add(`${coordinate.variableId}\u0000${slug(coordinate.valueLabel)}`);
    }
    const holders = network.candidates.filter((candidate) => (candidate.stances ?? []).length > 0);
    if (holders.length && (refuted.size > 0 || holders.some((holder) => holder.status === "selected"))) {
      const variableById = new Map(network.variables.map((item) => [item.id, item]));
      const baseDead = new Set(holders.filter((holder) => holder.status === "eliminated").map((holder) => holder.id));
      // Contested bindings: two live commitments demanding different options of one shared
      // choice is a contradiction to surface, never a silent first-writer-wins choice.
      const selectedStances = new Map<string, Array<{ variableId: string; valueLabel: string }>>();
      for (const holder of holders) {
        if (holder.status !== "selected" || baseDead.has(holder.id)) continue;
        // Only requires-stances are demands. An excludes-stance states incompatibility, not
        // commitment — counting it here made a lone holder contest itself against its own
        // exclusions and locked the region forever.
        selectedStances.set(holder.id, (holder.stances ?? []).filter((stance) => stance.relation === "requires").map((stance) => ({ variableId: stance.variableId, valueLabel: stance.valueLabel })));
      }
      const contestedVariables = new Set<string>();
      const contestedRegionIds = new Set<string>();
      {
        const labelsByVariable = new Map<string, Map<string, string>>();
        const regionByHolder = new Map<string, string>();
        for (const [holderId, stances] of selectedStances) {
          const holder = holders.find((item) => item.id === holderId)!;
          regionByHolder.set(holderId, holder.regionId);
          for (const stance of stances) {
            const slugLabel = slug(stance.valueLabel);
            if (!labelsByVariable.has(stance.variableId)) labelsByVariable.set(stance.variableId, new Map());
            labelsByVariable.get(stance.variableId)!.set(slugLabel, stance.valueLabel);
          }
        }
        for (const [variableId, labels] of labelsByVariable) {
          if (labels.size <= 1) continue;
          contestedVariables.add(variableId);
          for (const [holderId, stances] of selectedStances) if (stances.some((stance) => stance.variableId === variableId)) contestedRegionIds.add(regionByHolder.get(holderId)!);
        }
      }
      // Stale conflict locks clear themselves once the commitments that caused them are gone.
      for (const region of network.regions) {
        if (!region.contradiction?.startsWith("Commitments conflict")) continue;
        if (!contestedRegionIds.has(region.id)) { region.contradiction = undefined; changed = anyChange = true; }
      }
      for (const regionId of contestedRegionIds) {
        const region = network.regions.find((item) => item.id === regionId);
        const name = variableById.get([...contestedVariables][0]!)?.name ?? "shared choice";
        void name;
        if (region && !region.contradiction?.startsWith("Commitments conflict")) {
          transitionRegion(region, region.domainPhase, undefined, "contradiction");
          region.contradiction = "Commitments conflict on shared choice: committed moves demand different options.";
          changed = anyChange = true;
        }
      }
      // Iterate the decreasing operator K ← conflicts(bindings(selected ∖ baseDead ∖ K)):
      // a kill must never outlive the binder that caused it. Contested variables are excluded
      // from binding entirely — their conflict is surfaced above instead of resolved silently.
      // Kill grounds are collected for every stance-holder, dead ones included: a candidate
      // felled early by one rule must still record the grounds that arise later in the same
      // derivation (e.g. a binding materialized by this pass's forced selection), otherwise
      // the next pass revives and re-kills it with a different reason and idempotence breaks.
      let excluded: Set<string> = new Set();
      let killed = new Map<string, Set<string>>();
      let fingerprint = "";
      for (let iteration = 0; iteration < 16; iteration += 1) {
        killed = new Map<string, Set<string>>();
        const boundLabels = new Map<string, string>();
        const boundBy = new Map<string, string>();
        for (const holder of holders) {
          if (holder.status !== "selected" || baseDead.has(holder.id) || excluded.has(holder.id)) continue;
          for (const stance of holder.stances ?? []) {
            if (stance.relation !== "requires" || contestedVariables.has(stance.variableId)) continue;
            const key = `${stance.variableId}\u0000${slug(stance.valueLabel)}`;
            if (!boundLabels.has(key)) { boundLabels.set(key, stance.valueLabel); boundBy.set(key, holder.id); }
            else if (holder.id.localeCompare(boundBy.get(key)!) < 0) boundBy.set(key, holder.id);
          }
        }
        const boundsPerVariable = new Map<string, Array<[string, string, string]>>();
        for (const [key, label] of boundLabels) {
          const variableId = key.split("\u0000")[0]!;
          if (!boundsPerVariable.has(variableId)) boundsPerVariable.set(variableId, []);
          boundsPerVariable.get(variableId)!.push([key, label, boundBy.get(key)!]);
        }
        for (const entries of boundsPerVariable.values()) entries.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
        for (const holder of holders) {
          for (const stance of holder.stances ?? []) {
            const variable = variableById.get(stance.variableId);
            if (!variable || stance.relation === "prefers") continue;
            const labelKey = `${stance.variableId}\u0000${slug(stance.valueLabel)}`;
            let reason: string | undefined;
            if (stance.relation === "requires") {
              if (refuted.has(labelKey)) reason = `shared choice ${variable.name}="${stance.valueLabel}" was refuted by cited evidence`;
              else for (const [key, label, by] of boundsPerVariable.get(stance.variableId) ?? []) {
                if (key === labelKey) continue;
                reason = `requires ${variable.name}="${stance.valueLabel}" but ${by} bound it to "${label}"`;
                break;
              }
            } else if (stance.relation === "excludes" && boundLabels.has(labelKey)) {
              reason = `move excludes ${variable.name}="${stance.valueLabel}", which was bound to that option by ${boundBy.get(labelKey)}`;
            }
            if (reason) {
              if (!killed.has(holder.id)) killed.set(holder.id, new Set());
              killed.get(holder.id)!.add(reason);
            }
          }
        }
        const fingerprintNow = [...killed.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([id, reasons]) => `${id}:${[...reasons].sort().join("|")}`).join(";");
        if (fingerprintNow === fingerprint) break;
        fingerprint = fingerprintNow;
        excluded = new Set(killed.keys());
      }
      for (const [id, reasons] of killed) {
        const candidate = network.candidates.find((item) => item.id === id);
        for (const reason of reasons) if (candidate && !candidate.eliminationReasons.includes(reason)) { candidate.eliminationReasons.push(reason); changed = anyChange = true; }
        if (candidate && reasons.size && candidate.status !== "eliminated") candidate.status = "eliminated";
        if (candidate?.declaredStatus === "selected") candidate.declaredStatus = "possible";
      }
    } else {
      // A previously contested region can lose every stance-holding commitment between
      // activations. Conflict locks are derived state, so absence of live contestants
      // must clear them even when there is no remaining holder to enter the overlay.
      for (const region of network.regions) {
        if (!region.contradiction?.startsWith("Commitments conflict")) continue;
        region.contradiction = undefined;
        changed = anyChange = true;
      }
    }
    // Commitment rules (excludes / requires-selection / equivalents / supports) evaluate only
    // after stance-facts have settled above.
    const postOverlayStatuses = new Map(network.candidates.map((item) => [item.id, item.status]));
    for (const constraint of network.constraints) {
      if (constraint.kind !== "requires" || postOverlayStatuses.get(constraint.subject) === "eliminated" || postOverlayStatuses.get(constraint.target) !== "eliminated") continue;
      const subjectCandidate = network.candidates.find((item) => item.id === constraint.subject);
      eliminate(constraint.subject, constraint.reason || `requires ${constraint.target}, which is unavailable`);
      if (subjectCandidate?.declaredStatus === "selected") subjectCandidate.declaredStatus = "possible";
    }
    const commitmentStage = runConstraintSweeps(postOverlayStatuses, "commitments");
    for (const [id, reasons] of commitmentStage.pendingElims) for (const reason of reasons) eliminate(id, reason);
    for (const [id, reason] of commitmentStage.pendingSelects) select(id, reason);
    for (const region of network.regions) {
      const domain = region.candidateIds.map((id) => network.candidates.find((item) => item.id === id)).filter((item): item is SolutionCandidate => Boolean(item));
      const viable = domain.filter((item) => item.status !== "eliminated");
      let selected = viable.filter((item) => item.status === "selected");
      if (domain.length && !viable.length) {
        if (region.selectedCandidateIds.length) { region.selectedCandidateIds = []; changed = anyChange = true; }
        if (region.status !== "contradiction") { transitionRegion(region, region.domainPhase, undefined, "contradiction"); region.contradiction = "Every candidate was eliminated."; changed = anyChange = true; }
        continue;
      }
      if (!accepted(network, region) && selected.some((candidate) => candidate.key !== "resolved-answer")) {
        for (const candidate of selected) candidate.status = "possible";
        selected = [];
      }
      if (selected.length) {
        const equivalent = (left: string, right: string) => equivalence.get(left) === equivalence.get(right);
        if (selected.some((candidate, index) => selected.slice(index + 1).some((other) => !equivalent(candidate.id, other.id)))) {
          const contradiction = "Multiple incompatible alternatives were chosen. Choose one complete approach.";
          if (region.status !== "contradiction" || region.contradiction !== contradiction) { transitionRegion(region, region.domainPhase, undefined, "contradiction"); region.contradiction = contradiction; changed = anyChange = true; }
          continue;
        }
        for (const candidate of viable) if (!selected.some((item) => item.id === candidate.id) && !selected.every((item) => equivalent(item.id, candidate.id))) eliminate(candidate.id, "a different non-equivalent approach was chosen");
        selected = viable.filter((item) => item.status === "selected" || selected.every((choice) => equivalent(choice.id, item.id)));
        const ids = selected.map((item) => item.id);
        if (region.selectedCandidateIds.join("\0") !== ids.join("\0")) { region.selectedCandidateIds = ids; changed = anyChange = true; }
        const children = network.regions.filter((item) => item.parentId === region.id);
        const status = children.length ? "collapsed" : region.certifiedLeaf ? "actionable" : "unrefined";
        transitionRegion(region, "selected");
        const conflictLocked = region.status === "contradiction" && Boolean(region.contradiction?.startsWith("Commitments conflict"));
        if (!conflictLocked && region.status !== status && !["implementing", "implemented", "verified", "blocked", "stalled"].includes(region.status)) { transitionRegion(region, "selected", undefined, status); changed = anyChange = true; }
      } else {
        if (region.selectedCandidateIds.length) { region.selectedCandidateIds = []; changed = anyChange = true; }
        if (domain.length && region.status !== "superposed" && region.status !== "stalled" && region.status !== "blocked") { transitionRegion(region, region.domainPhase, undefined, "superposed"); changed = anyChange = true; }
      }
    }
    // Coordinate excludes from live commitments: once the excluding move is selected, every
    // other move requiring that exact option dies. Evaluated AFTER the region block so this
    // pass's forced selections are visible — the outcome never depends on intra-pass ordering.
    const forbiddenBy = new Map<string, string>();
    for (const constraint of network.constraints) {
      if (constraint.kind !== "excludes") continue;
      const coordinate = coordinateOf(network, constraint.target);
      if (!coordinate) continue;
      const subjectCandidate = network.candidates.find((item) => item.id === constraint.subject);
      // Authoritative commitments only: derived forced-singletons would make this rule
      // order-dependent across permutations of the same facts. Structurally unsatisfiable
      // commitments (same-region requires toward a different sibling) release instead of firing.
      if (!subjectCandidate || subjectCandidate.declaredStatus !== "selected" || subjectCandidate.status !== "selected") continue;
      const ownRegionId = subjectCandidate.regionId;
      const structurallyUnsatisfiable = network.constraints.some((constraint) => constraint.kind === "requires" && constraint.subject === subjectCandidate.id && constraint.target !== subjectCandidate.id && constraint.target.startsWith(`${ownRegionId}:`));
      if (structurallyUnsatisfiable) continue;
      const key = `${coordinate.variableId}\u0000${slug(coordinate.valueLabel)}`;
      if (!forbiddenBy.has(key)) forbiddenBy.set(key, subjectCandidate.id);
    }
    if (forbiddenBy.size) {
      const variableByIdAfter = new Map(network.variables.map((item) => [item.id, item]));
      for (const candidate of network.candidates) {
        if (candidate.status === "eliminated") continue;
        for (const stance of candidate.stances ?? []) {
          if (stance.relation !== "requires") continue;
          const variable = variableByIdAfter.get(stance.variableId);
          if (!variable) continue;
          const sourceId = forbiddenBy.get(`${stance.variableId}\u0000${slug(stance.valueLabel)}`);
          if (sourceId && sourceId !== candidate.id) {
            eliminate(candidate.id, `another committed move rules out shared choice ${variable.name}="${stance.valueLabel}"`);
            break;
          }
        }
      }
    }
  }
  refreshDomainControls(network);
  network.revision = input.revision + (derivedSnapshot(network) === beforeDerived ? 0 : 1);
  const liveCandidates = new Map(network.candidates.map((item) => [item.id, item]));
  const liveConstraints = new Map(network.constraints.map((item) => [item.id, item]));
  network.candidates = retainedCandidates.flatMap((item) => item.historical ? [item] : liveCandidates.has(item.id) ? [liveCandidates.get(item.id)!] : []);
  network.constraints = retainedConstraints.flatMap((item) => item.historical ? [item] : liveConstraints.has(item.id) ? [liveConstraints.get(item.id)!] : []);
  return network;
}

type RepositoryObservationTool = "graph_read" | "graph_inspect_worktrees" | "graph_read_worktree_diff";

function successfulRepositoryReads(tools: readonly AgentToolTrace[] | undefined): Array<{ chunkId?: string; location: RepositoryEvidenceLocation; tool: RepositoryObservationTool }> {
  return (tools ?? []).flatMap((trace) => {
    const tool = trace.tool === "graph_read" || trace.tool === "graph_inspect_worktrees" || trace.tool === "graph_read_worktree_diff" ? trace.tool : undefined;
    const descriptor = tool && trace.status === "completed" ? trace.metadata?.repositoryDescriptor : undefined;
    if (!tool || !descriptor || typeof descriptor !== "object") return [];
    const value = descriptor as Record<string, unknown>;
    return typeof value.canonicalPath === "string" && Array.isArray(value.range) && value.range.length === 2 && value.range.every(Number.isInteger) && typeof value.fileDigest === "string" && Number.isInteger(value.snapshotEpoch)
      ? [{ chunkId: typeof value.chunkId === "string" ? value.chunkId : undefined, location: { canonicalPath: value.canonicalPath, range: value.range as [number, number], fileDigest: value.fileDigest, snapshotEpoch: value.snapshotEpoch as number, ...(value.observation === "worktrees" ? { observation: "worktrees" as const } : {}) }, tool }] : [];
  });
}

function successfulRepositoryDescriptors(tools: readonly AgentToolTrace[] | undefined): Map<string, RepositoryObservationTool> {
  return new Map(successfulRepositoryReads(tools).map((item) => [JSON.stringify(item.location), item.tool]));
}

export function inspectionOutputToDelta(output: InspectionOutput, tools?: readonly AgentToolTrace[]): SolutionDelta {
  const reads = new Map(successfulRepositoryReads(tools).flatMap((item) => item.chunkId ? [[item.chunkId, item.location] as const] : []));
  const authoredChunks = new Set(output.evidence.flatMap((item) => item.kind === "repository" ? [item.chunkId] : []));
  const evidenceRefs = (value: unknown): string[] => Array.isArray(value)
    ? value.flatMap(evidenceRefs)
    : value && typeof value === "object"
      ? Object.entries(value).flatMap(([key, item]) => key === "evidenceRefs" && Array.isArray(item) ? item.filter((ref): ref is string => typeof ref === "string") : evidenceRefs(item))
      : [];
  for (const chunkId of new Set(evidenceRefs(output))) if (reads.has(chunkId) && !authoredChunks.has(chunkId)) throw new Error(`Repository chunk ${chunkId} requires a matching evidence entry that states the observed fact.`);
  const evidence = output.evidence.map((item) => {
    if (item.kind === "inference") return item;
    const location = reads.get(item.chunkId);
    if (!location) throw new Error(`Repository evidence chunk ${item.chunkId} does not match a successful repository observation from this activation.`);
    return { text: item.text, source: item.source, kind: "repository" as const, assertion: "repository-presence" as const, location };
  });
  const delta: SolutionDelta = {
    region: output.region,
    evidence,
    factIds: output.factIds,
    validations: output.validations,
    criterionEvidence: output.criterionEvidence,
    materialRequirementEvidence: output.materialRequirementEvidence,
    variables: [], candidates: [], constraints: [], select: [], activations: [],
  };
  switch (output.outcome) {
    case "facts": return delta;
    case "boundary": delta.decisionBoundary = output.decisionBoundary; delta.materialRequirements = output.materialRequirements; break;
    case "need-fact": delta.activations = [{ capability: "inspect", ...output.inspection }]; break;
    case "decompose": delta.taskScopes = output.taskScopes; delta.taskDispositions = output.taskDispositions; delta.materialRequirements = output.materialRequirements; break;
    case "certified": delta.certifiedVerdict = output.certifiedVerdict; break;
    case "already-satisfied": delta.alreadySatisfied = output.alreadySatisfied; break;
    case "answer": delta.region = { ...output.region, delivery: "answer" }; delta.resolvedAnswer = output.resolvedAnswer; break;
    default: assertNever(output);
  }
  return delta;
}

export function validateInspectionOutputProgress(state: SolutionLodState, activation: Activation, output: InspectionOutput): void {
  if (output.outcome !== "facts") return;
  const region = state.network.regions.find((item) => item.id === activation.regionId);
  if (!region) return;
  const liveValidationTargets = new Set(region.evidenceIds.filter((id) => state.network.evidence.find((item) => item.id === id)?.status === "hypothesis"));
  const closesSuppliedValidation = output.validations?.some((item) => liveValidationTargets.has(item.claimRef)) ?? false;
  const hasSuppliedCriterion = (region.inspectionObligationIds?.length ?? region.criterionIds.length) > 0;
  if (!hasSuppliedCriterion && !closesSuppliedValidation && output.evidence.some((item) => item.kind === "inference"))
    throw new Error("Facts-only inspection may not author inference claims when no supplied proof or validation obligation exists. Return the evidence-backed decision boundary, root decomposition, or mechanically certified terminal result in this activation; do not manufacture another inspection pass.");
}

function validateRepositoryProvenance(items: SolutionDelta["evidence"], tools: readonly AgentToolTrace[] | undefined): void {
  const descriptors = successfulRepositoryDescriptors(tools);
  for (const item of items) {
    if (item.kind !== "repository") continue;
    if (!item.location) throw new Error("Repository evidence requires a controller-issued repository observation location.");
    if (!descriptors.has(JSON.stringify(item.location))) throw new Error(`Repository evidence location ${item.location.canonicalPath}:${item.location.range.join("-")} does not exactly match a successful repository observation descriptor from this activation.`);
  }
}

function evidenceAssertion(item: Pick<SolutionNetwork["evidence"][number], "kind" | "assertion">): NonNullable<SolutionNetwork["evidence"][number]["assertion"]> {
  return item.assertion ?? (item.kind === "repository" ? "repository-presence" : "other-claim");
}

function appendEvidenceStatus(evidence: SolutionNetwork["evidence"][number], status: NonNullable<SolutionNetwork["evidence"][number]["status"]>, revision: number, reason: string, evidenceRefs: string[] = [], activationId?: string): void {
  evidence.statusTimeline ??= [{ status: evidence.status ?? (evidence.kind === "inference" ? "hypothesis" : "confirmed"), revision: evidence.createdRevision ?? 0, reason: "Evidence admitted.", evidenceRefs: [] }];
  const event = { status, revision, ...(activationId ? { activationId } : {}), reason, evidenceRefs: [...new Set(evidenceRefs)].sort() };
  const previous = evidence.statusTimeline.at(-1);
  if (!previous || JSON.stringify(previous) !== JSON.stringify(event)) evidence.statusTimeline.push(event);
  evidence.status = status;
}

function mergeEvidence(network: SolutionNetwork, region: SolutionRegion, items: SolutionDelta["evidence"], activationId?: string, tools?: readonly AgentToolTrace[], capability?: Capability): { refs: Map<string, string>; changed: boolean } {
  validateRepositoryProvenance(items, tools);
  if (capability === "inspect" && items.some((item) => item.kind === "tool")) throw new Error("Inspection cannot author confirmed tool evidence. Use kind 'repository' with an exact repository observation descriptor, or return an inference hypothesis.");
  const localEvidence = new Map<string, string>();
  let changed = false;
  for (const item of items) {
    const assertion = evidenceAssertion(item);
    const identity = `${item.kind}\0${propositionSignature(item.text)}\0${propositionSignature(item.source)}\0${assertion}\0${item.location ? JSON.stringify(item.location) : ""}`;
    const fingerprint = createHash("sha256").update(identity).digest("hex").slice(0, 16);
    const lineageKey = hash({ kind: item.kind, assertion, source: propositionSignature(item.source), location: item.location ? { canonicalPath: item.location.canonicalPath, range: item.location.range, observation: item.location.observation } : undefined });
    let evidence = network.evidence.find((existing) => existing.fingerprint === fingerprint || `${existing.kind}\0${propositionSignature(existing.text)}\0${propositionSignature(existing.source)}\0${evidenceAssertion(existing)}\0${existing.location ? JSON.stringify(existing.location) : ""}` === identity);
    const status = item.kind === "inference" ? "hypothesis" : "confirmed";
    const repositoryTool = item.location ? successfulRepositoryDescriptors(tools).get(JSON.stringify(item.location)) : undefined;
    const controllerVerified = item.kind === "repository" && activationId && repositoryTool ? { activationId, tool: repositoryTool } : undefined;
    if (!evidence) {
      const superseded = network.evidence.filter((existing) => (existing.lineageKey ?? hash({ kind: existing.kind, assertion: evidenceAssertion(existing), source: propositionSignature(existing.source), location: existing.location ? { canonicalPath: existing.location.canonicalPath, range: existing.location.range, observation: existing.location.observation } : undefined })) === lineageKey).sort((left, right) => (right.createdRevision ?? 0) - (left.createdRevision ?? 0))[0];
      evidence = { ...item, assertion, controllerVerified, status, text: normalize(item.text), source: normalize(item.source), id: `e${network.nextEvidenceId++}`, fingerprint, createdRevision: network.revision + 1, lineageKey, supersedesEvidenceId: superseded?.id, statusTimeline: [{ status, revision: network.revision + 1, ...(activationId ? { activationId } : {}), reason: "Evidence admitted.", evidenceRefs: [] }] };
      network.evidence.push(evidence); changed = true;
    } else {
      evidence.assertion ??= assertion;
      evidence.lineageKey ??= lineageKey;
      if (status === "confirmed" && evidence.status === "stale") { appendEvidenceStatus(evidence, "confirmed", network.revision + 1, "Repository evidence re-observed.", [], activationId); changed = true; }
    }
    if (controllerVerified && !evidence.controllerVerified) { evidence.controllerVerified = controllerVerified; changed = true; }
    if (!region.evidenceIds.includes(evidence.id)) { region.evidenceIds.push(evidence.id); changed = true; }
    localEvidence.set(item.source, evidence.id);
    if (item.location) for (const read of successfulRepositoryReads(tools)) if (read.chunkId && JSON.stringify(read.location) === JSON.stringify(item.location)) localEvidence.set(read.chunkId, evidence.id);
  }
  return { refs: localEvidence, changed };
}

function resolveDecisionBoundaryEvidence(proposal: DecisionBoundaryProposal, localEvidence: ReadonlyMap<string, string>): DecisionBoundaryProposal {
  const refs = (values: string[]) => values.map((ref) => localEvidence.get(ref) ?? ref);
  return { ...proposal, variables: proposal.variables.map((item) => ({ ...item, evidenceRefs: refs(item.evidenceRefs) })), permittedPairs: proposal.permittedPairs.map((item) => ({ ...item, evidenceRefs: refs(item.evidenceRefs) })) };
}

function applyEvidenceValidations(network: SolutionNetwork, validations: SolutionDelta["validations"], localEvidence: ReadonlyMap<string, string>): boolean {
  let changed = false;
  for (const validation of validations ?? []) {
    const claim = network.evidence.find((item) => item.id === validation.claimRef && item.kind === "inference");
    if (!claim || claim.status === "rejected" || validation.verdict === "unresolved") continue;
    const resolvedRefs = [...new Set(validation.evidenceRefs.map((ref) => localEvidence.get(ref) ?? ref))];
    const grounded = resolvedRefs.length > 0 && resolvedRefs.every((ref) => ref === "task" || network.evidence.some((item) => item.id === ref && item.kind !== "inference" && (item.status ?? "confirmed") === "confirmed"));
    if (!grounded) continue;
    appendEvidenceStatus(claim, validation.verdict, network.revision + 1, normalize(validation.reason), resolvedRefs);
    claim.validationEvidenceRefs = resolvedRefs;
    claim.validationReason = normalize(validation.reason);
    changed = true;
  }
  return changed;
}

/**
 * Bind one material requirement to exactly one owned criterion. Typed references
 * (scopeKey + criterionIndex) take precedence; echoed criterion text remains as a
 * legacy binding so older outputs keep landing.
 */
function bindRequirement(
  requirement: { key: string; scopeKey?: string; criterionIndex?: number; criterion?: string },
  scopes: ReadonlyArray<{ key: string; acceptanceCriteria: ReadonlyArray<string> }>,
  noun = "task scope",
): { ownerIndex: number; criterionIndex: number } {
  if (requirement.scopeKey !== undefined || requirement.criterionIndex !== undefined) {
    const ownerIndex = scopes.findIndex((scope) => slug(scope.key) === slug(requirement.scopeKey ?? ""));
    if (ownerIndex < 0) throw new Error(`Material requirement ${requirement.key} cites unknown ${noun} "${requirement.scopeKey ?? ""}". Use scopeKey ${scopes.map((scope) => `"${scope.key}"`).join(" or ")} with criterionIndex.`);
    const criteria = scopes[ownerIndex]!.acceptanceCriteria;
    if (!criteria.length) throw new Error(`Material requirement ${requirement.key} cannot bind because ${noun} "${scopes[ownerIndex]!.key}" has no acceptance criteria. In this same output, define observable region.acceptanceCriteria first, then bind every material requirement with scopeKey and its zero-based criterionIndex.`);
    const index = requirement.criterionIndex ?? -1;
    const criterion = criteria[index];
    if (criterion === undefined) throw new Error(`Material requirement ${requirement.key} cites criterion #${index} of ${noun} "${requirement.scopeKey ?? scopes[ownerIndex]!.key}", which has only ${criteria.length}.`);
    return { ownerIndex, criterionIndex: index };
  }
  const wanted = normalize(requirement.criterion ?? "");
  const matches = scopes.flatMap((scope, ownerIndex) => scope.acceptanceCriteria.flatMap((criterion, criterionIndex) => normalize(criterion) === wanted ? [{ ownerIndex, criterionIndex }] : []));
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) throw new Error(`Material requirement ${requirement.key} cites ambiguous legacy criterion "${requirement.criterion ?? ""}". Bind it with scopeKey and criterionIndex.`);
  throw new Error(`Material requirement ${requirement.key} cites criterion "${requirement.criterion ?? ""}" that no ${noun} owns. Bind it with scopeKey and criterionIndex instead of echoing text.`);
}

function resolveScopeDependency(network: SolutionNetwork, regionId: string, scopes: ReadonlyArray<{ key: string }>, dependency: string): ScopeId | undefined {
  const existing = network.regions.find((item) => item.scopeId === dependency)?.scopeId;
  if (existing) return existing;
  const normalized = slug(dependency);
  for (const scope of scopes) {
    const key = slug(scope.key);
    const scopeId = `scope:${regionId}:${key}` as ScopeId;
    if ([key, slug(scopeId)].includes(normalized)) return scopeId;
  }
  return undefined;
}

function assertAcyclicScopeDependencies(network: SolutionNetwork, proposed: ReadonlyArray<{ scopeId: ScopeId; dependencyScopeIds: ScopeId[] }>): void {
  const dependencies = new Map<ScopeId, ScopeId[]>(network.regions.map((item) => [item.scopeId, [...(item.dependencyScopeIds ?? [])]]));
  for (const item of proposed) dependencies.set(item.scopeId, item.dependencyScopeIds);
  const visiting = new Set<ScopeId>();
  const visited = new Set<ScopeId>();
  const visit = (scopeId: ScopeId): void => {
    if (visiting.has(scopeId)) throw new Error(`Semantic dependencies contain a cycle at ${scopeId}.`);
    if (visited.has(scopeId)) return;
    visiting.add(scopeId);
    for (const dependency of dependencies.get(scopeId) ?? []) visit(dependency);
    visiting.delete(scopeId);
    visited.add(scopeId);
  };
  for (const scopeId of dependencies.keys()) visit(scopeId);
}

export function validateSolutionDelta(state: SolutionLodState, regionId: string, capabilityOrDelta: Capability | SolutionDelta, maybeDelta?: SolutionDelta, tools?: readonly AgentToolTrace[]): void {
  const capability: Capability = typeof capabilityOrDelta === "string" ? capabilityOrDelta : capabilityOrDelta.resolvedAnswer ? "inspect" : "synthesize";
  const delta = normalizeDelta(typeof capabilityOrDelta === "string" ? maybeDelta! : capabilityOrDelta);
  const region = state.network.regions.find((item) => item.id === regionId);
  if (!region) return;
  const reads = successfulRepositoryReads(tools);
  const suppliedSources = new Set(delta.evidence.filter((item) => item.kind === "repository" || item.kind === "tool").flatMap((item) => [item.source, ...reads.filter((read) => read.chunkId && item.location && JSON.stringify(read.location) === JSON.stringify(item.location)).map((read) => read.chunkId!)]));
  const activation = state.network.activations.findLast((item) => item.regionId === regionId && item.capability === capability && (item.status === "queued" || item.status === "running"));
  const visibleRefs = activation?.readRefs ? new Set(activation.readRefs.map((item) => item.ref)) : undefined;
  for (const factId of delta.factIds) {
    const evidence = state.network.evidence.find((item) => item.id === factId);
    if (factId !== "task" && (!evidence || !isConfirmedEvidence(state.network, factId) || visibleRefs && !visibleRefs.has(factId))) throw new Error(`Unknown, stale, or unprojected graph fact ID ${factId}. factIds accepts only confirmed FACTS-section referenceIds or "task"; chunkIds and new observations belong in evidence with their exact chunkId.`);
  }
  if (new Set(delta.factIds).size !== delta.factIds.length) throw new Error("Graph fact IDs must be unique.");
  if (delta.materialRequirementEvidence?.length) {
    const ids = delta.materialRequirementEvidence.map((item) => item.requirementId);
    if (new Set(ids).size !== ids.length) throw new Error("A material requirement may have at most one evidence refresh per inspection result.");
    for (const refresh of delta.materialRequirementEvidence) {
      if (!(region.requirementIds ?? []).includes(refresh.requirementId as RequirementId)) throw new Error(`Material requirement evidence refresh cites unknown or non-local requirement ${refresh.requirementId}.`);
      if (!refresh.evidenceRefs.every((ref) => ref === "task" || isConfirmedEvidence(state.network, ref) || suppliedSources.has(ref))) throw new Error(`Material requirement ${refresh.requirementId} evidence refresh requires task or confirmed repository/tool evidence.`);
    }
  }
  rejectUnrequestedDeferredWork(state, [delta.region?.objective, ...(delta.region?.acceptanceCriteria ?? []), ...(delta.taskScopes ?? []).flatMap((item) => [item.objective, ...item.acceptanceCriteria]), ...(delta.materialRequirements ?? []).map((item) => item.text), delta.certifiedVerdict?.proposition, delta.certifiedVerdict?.implementationScope, ...delta.candidates.map((item) => item.proposition)]);
  for (const request of delta.activations) if (!roleSupportsCapabilities(request.capability, request.requiredCapabilities)) throw new Error(`${request.capability} cannot satisfy required capabilities: ${request.requiredCapabilities.join(", ")}.`);
  if (capability === "inspect") {
    validateRepositoryProvenance(delta.evidence, tools);
    if (delta.evidence.some((item) => item.kind === "tool")) throw new Error("Inspection cannot author confirmed tool evidence. Use kind 'repository' with an exact repository observation descriptor, or return an inference hypothesis.");
    if (delta.candidates.length || delta.constraints.length || delta.select.length || delta.variables?.length)
      throw new Error("Inspection may report sourced facts or a complete answer, but may not propose, reject, constrain, select solution alternatives, or declare shared choices.");
    const proposedCriteria = delta.region?.acceptanceCriteria?.length ? delta.region.acceptanceCriteria : undefined;
    const criteria = proposedCriteria ?? region.acceptanceCriteria;
    const criterionIds = proposedCriteria ? criteria.map((_, index) => `criterion:${region.scopeId}:${index}` as CriterionId) : region.criterionIds;
    const unresolved = new Set(proposedCriteria ? criterionIds : region.inspectionObligationIds ?? region.criterionIds);
    const mapped = new Set<number>();
    const settled = new Set<number>();
    for (const item of delta.criterionEvidence) {
      if (mapped.has(item.criterionIndex)) throw new Error(`Inspection criterion #${item.criterionIndex} is mapped more than once.`);
      mapped.add(item.criterionIndex);
      const criterionId = criterionIds[item.criterionIndex];
      if (!criterionId) throw new Error(`Inspection cites unknown criterion #${item.criterionIndex}.`);
      if (!unresolved.has(criterionId) && !proposedCriteria) throw new Error(`Inspection criterion ${criterionId} is already closed.`);
      if (!item.evidenceRefs.every((ref) => ref === "task" || isConfirmedEvidence(state.network, ref) || suppliedSources.has(ref))) throw new Error(`Inspection criterion ${criterionId} requires task or confirmed repository/tool evidence.`);
      const verdict = item.verdict ?? "satisfied";
      if (verdict !== "satisfied" && !item.reason) throw new Error(`Inspection criterion ${criterionId} requires a reason for verdict ${verdict}.`);
      if (verdict === "satisfied" || verdict === "unsatisfied") settled.add(item.criterionIndex);
    }
    const remaining = criterionIds.filter((id, index) => unresolved.has(id) && !settled.has(index));
    const terminalInspection = Boolean(delta.certifiedVerdict || delta.alreadySatisfied || delta.resolvedAnswer || delta.taskScopes?.length);
    if (delta.decisionBoundary && remaining.length) throw new Error(`A decision boundary requires evidence closure for every unresolved criterion: ${remaining.join(", ")}. Add criterionEvidence mapping every listed criterion index to "task" or an exact repository chunkId/source supplied in this result; criteria proposed in this same result are obligations of this result.`);
    if (!terminalInspection && !delta.decisionBoundary && delta.activations.length === 0 && criteria.length && delta.criterionEvidence.length === 0)
      throw new Error(`Inspection facts must close at least one unresolved criterion; remaining=${[...unresolved].join(", ") || "none"}. Return a decision boundary when none remain.`);
    for (const request of delta.activations.filter((item) => item.capability === "inspect")) {
      const targets = request.contextRefs.filter((ref): ref is CriterionId => unresolved.has(ref as CriterionId));
      if (unresolved.size && targets.length !== 1) throw new Error(`An inspection follow-up must target exactly one unresolved criterion ID in contextRefs: ${[...unresolved].join(", ")}.`);
    }
    if (delta.decisionBoundary) {
      if (region.allowedVariablesLocked && !exactSet(delta.decisionBoundary.variables.map((item) => slug(item.name)), region.allowedVariables.map(slug)))
        throw new Error(`The decision boundary must declare exactly the controller-locked allowed variables: ${region.allowedVariables.join(", ")}.`);
      const preview = cloneNetwork(state.network);
      const previewRegion = preview.regions.find((item) => item.id === regionId)!;
      const local = mergeEvidence(preview, previewRegion, delta.evidence, "preview", tools, "inspect").refs;
      applyEvidenceValidations(preview, delta.validations, local);
      admitDecisionBoundary(preview, regionId, resolveDecisionBoundaryEvidence(delta.decisionBoundary, local));
    }
    if (delta.materialRequirements?.length) {
      for (const requirement of delta.materialRequirements) {
        if (!requirement.evidenceRefs.every((ref) => ref === "task" || isConfirmedEvidence(state.network, ref) || suppliedSources.has(ref))) throw new Error(`Material requirement ${requirement.key} requires task or confirmed repository/tool evidence.`);
      }
      if (!delta.taskScopes?.length) {
        const criteria = proposedCriteria ?? region.acceptanceCriteria;
        for (const requirement of delta.materialRequirements) bindRequirement(requirement, [{ key: region.id, acceptanceCriteria: criteria }], "root criterion");
      }
    }
    if (delta.taskScopes?.length) {
      if (region.edge !== "root" || delta.taskScopes.length < 2) throw new Error("Root AND decomposition requires at least two independently verifiable task scopes and is valid only at the root.");
      const keys = delta.taskScopes.map((item) => slug(item.key));
      if (new Set(keys).size !== keys.length) throw new Error("Every root task scope requires a unique typed identity.");
      const proposedDependencies = delta.taskScopes.map((scope) => {
        const scopeId = `scope:${region.id}:${slug(scope.key)}` as ScopeId;
        const dependencyScopeIds = (scope.dependencyScopeIds ?? []).map((dependency) => {
          const resolved = resolveScopeDependency(state.network, region.id, delta.taskScopes!, dependency);
          if (!resolved) throw new Error(`Task scope ${scope.key} cites unknown semantic dependency ${dependency}. Use another task scope's exact key or canonical scope ID.`);
          if (resolved === region.scopeId) throw new Error(`Task scope ${scope.key} cannot depend on root scope ${resolved}; the root cannot complete until every task scope completes.`);
          return resolved;
        });
        return { scopeId, dependencyScopeIds };
      });
      assertAcyclicScopeDependencies(state.network, proposedDependencies);
      if (delta.materialRequirements?.length) {
        const requirementKeys = delta.materialRequirements.map((item) => slug(item.key));
        if (new Set(requirementKeys).size !== requirementKeys.length) throw new Error("Every material root requirement requires a unique typed identity.");
        for (const requirement of delta.materialRequirements) bindRequirement(requirement, delta.taskScopes);
        // Ownership is structural: a requirement bound by scopeKey is owned by that scope.
        // Legacy scope.requirementKeys echoes own only requirements that carry no scopeKey.
        const owners = new Map<string, number>(requirementKeys.map((key) => [key, 0]));
        const legacyOwned = new Set(delta.materialRequirements.filter((item) => item.scopeKey === undefined && item.criterionIndex === undefined).map((item) => slug(item.key)));
        for (const scope of delta.taskScopes) for (const key of scope.requirementKeys ?? []) {
          const normalized = slug(key);
          if (!owners.has(normalized)) throw new Error(`Task scope ${scope.key} cites unknown material requirement ${key}.`);
          if (!legacyOwned.has(normalized)) {
            const requirement = delta.materialRequirements.find((item) => slug(item.key) === normalized)!;
            if (slug(requirement.scopeKey ?? "") !== slug(scope.key)) throw new Error(`Task scope ${scope.key} cites structurally bound requirement ${key}, which belongs to ${requirement.scopeKey}.`);
            continue;
          }
          owners.set(normalized, owners.get(normalized)! + 1);
        }
        for (const requirement of delta.materialRequirements) {
          const normalized = slug(requirement.key);
          if (legacyOwned.has(normalized)) continue;
          const ownerIndex = delta.taskScopes.findIndex((scope) => slug(scope.key) === slug(requirement.scopeKey ?? ""));
          if (ownerIndex >= 0) owners.set(normalized, owners.get(normalized)! + 1);
        }
        const invalid = [...owners].filter(([, count]) => count !== 1);
        if (invalid.length) throw new Error(`Every material root requirement must have exactly one task-scope owner: ${invalid.map(([key, count]) => `${key}=${count}`).join(", ")}. Bind each requirement with scopeKey (+ criterionIndex), or list its key in exactly one scope's requirementKeys.`);
      }
      for (const disposition of delta.taskDispositions ?? []) {
        if (!normalize(disposition.reason)) throw new Error("Every non-scope task disposition requires an explicit reason.");
        if (!disposition.evidenceRefs.every((ref) => ref === "task" || isConfirmedEvidence(state.network, ref) || suppliedSources.has(ref))) throw new Error(`Task disposition ${disposition.key} requires task or confirmed repository/tool evidence.`);
      }
    }
    if (delta.materialRequirements?.length && region.edge !== "root") throw new Error("Material requirement inventory may be authored only once at the root.");
    const hasAuthoredRequirements = state.network.materialRequirements?.some((item) => !item.id.startsWith("requirement:root-criterion-"));
    if (delta.materialRequirements?.length && hasAuthoredRequirements) {
      const proposed = delta.materialRequirements.map((item) => {
        if (delta.taskScopes?.length) {
          const { ownerIndex, criterionIndex } = bindRequirement(item, delta.taskScopes);
          const scopeId = `scope:${region.id}:${slug(delta.taskScopes[ownerIndex]!.key)}` as ScopeId;
          return { id: `requirement:${slug(item.key)}`, key: slug(item.key), text: normalize(item.text), scopeId, criterionId: `criterion:${scopeId}:${criterionIndex}` };
        }
        const { criterionIndex } = bindRequirement(item, [{ key: region.id, acceptanceCriteria: criteria }], "root criterion");
        return { id: `requirement:${slug(item.key)}`, key: slug(item.key), text: normalize(item.text), scopeId: region.scopeId, criterionId: criterionIds[criterionIndex] };
      }).sort((left, right) => left.id.localeCompare(right.id));
      const existing = (state.network.materialRequirements ?? []).map(({ id, key, text, scopeId, criterionId }) => ({ id, key, text, scopeId, criterionId })).sort((left, right) => left.id.localeCompare(right.id));
      if (JSON.stringify(proposed) !== JSON.stringify(existing)) throw new Error("The typed root material-requirement identities and ownership are immutable once established; only evidence references may be refreshed.");
    }
    if (delta.certifiedVerdict) {
      if (region.delivery !== "change" || delta.candidates.length || delta.constraints.length || delta.taskScopes?.length) throw new Error("A certified supplied verdict is valid only for one mechanically fixed change without a competing domain or task split.");
      if (!region.acceptanceCriteria.length && !delta.region?.acceptanceCriteria?.length) throw new Error("A certified supplied verdict requires observable acceptance criteria.");
      if (!delta.certifiedVerdict.evidenceRefs.every((ref) => isConfirmedEvidence(state.network, ref) || suppliedSources.has(ref))) throw new Error("A certified supplied verdict requires only confirmed repository/tool evidence references.");
      const certifiedCheckIndexes = delta.certifiedVerdict.checks.map((check) => check.criterionIndex);
      const certifiedCriterionIndexes = Array.from({ length: region.criterionIds.length || delta.region?.acceptanceCriteria?.length || 1 }, (_, index) => index);
      if (new Set(certifiedCheckIndexes).size !== certifiedCheckIndexes.length || JSON.stringify([...certifiedCheckIndexes].sort((left, right) => left - right)) !== JSON.stringify(certifiedCriterionIndexes)) throw new Error("A certified verdict requires exactly one executable behavioral check witness for every current criterion index.");
      if (delta.certifiedVerdict.checks.some((check) => /^(verify the criterion|run (a )?focused test|test works)\.?$/i.test(normalize(check.commandOrObservation)))) throw new Error("A certified verdict check witness must name a concrete command or observation and its expected semantic result.");
      for (const resource of delta.certifiedVerdict.mutationResources) {
        const admitted = mutationPath(resource);
        const authorizedExpansion = state.network.activations.some((item) => item.regionId === region.id && item.capability === "implement" && item.expectedDelta.startsWith("scope-expansion:"));
        if (region.mutationResources?.length && !region.mutationResources.some((parent) => pathWithin(admitted, mutationPath(parent))) && !(region.edge === "root" && authorizedExpansion)) throw new Error(`Certified correction mutation resource ${resource} is outside its parent scope.`);
      }
      if (delta.certifiedVerdict.evidenceRefs.some((ref) => ref === "task")) throw new Error("A certified supplied verdict requires repository-grounded evidence, not the request alone.");
    }
    if (delta.alreadySatisfied) {
      if (region.delivery !== "change" || delta.candidates.length || delta.constraints.length || delta.taskScopes?.length || delta.certifiedVerdict) throw new Error("Already-satisfied inspection is valid only for one unchanged repository state without a competing domain or task split.");
      const criteria = proposedCriteria ?? region.acceptanceCriteria;
      const indexes = delta.alreadySatisfied.criterionEvidence.map((item) => item.criterionIndex).sort((left, right) => left - right);
      if (!criteria.length || JSON.stringify(indexes) !== JSON.stringify(criteria.map((_, index) => index))) throw new Error("Already-satisfied inspection requires exactly one evidence mapping for every criterion position.");
      for (const item of delta.alreadySatisfied.criterionEvidence) if (!item.evidenceRefs.every((ref) => isConfirmedEvidence(state.network, ref) || suppliedSources.has(ref))) throw new Error(`Already-satisfied criterion #${item.criterionIndex} requires confirmed repository/tool evidence.`);
    }
    if (delta.region?.objective) {
      const sameGoal = slug(delta.region.objective) === slug(region.objective);
      if (!sameGoal)
        throw new Error("Inspection may not rewrite the assigned objective. Omit the optional 'objective' field entirely — never restate, summarize, or paraphrase the goal in your result.");
    }
    if (region.allowedVariablesLocked && delta.region?.allowedVariables && !exactSet(delta.region.allowedVariables.map(slug), region.allowedVariables.map(slug)))
      throw new Error(`Inspection may not rewrite controller-locked allowed variables: ${region.allowedVariables.join(", ")}.`);
  } else if (capability === "synthesize" && (delta.taskScopes?.length || delta.taskDispositions?.length || delta.materialRequirements?.length || delta.materialRequirementEvidence?.length || delta.certifiedVerdict || delta.alreadySatisfied || delta.decisionBoundary)) throw new Error("Synthesis cannot create or reassign root scopes, boundaries, dispositions, requirements, or inspection verdicts.");
  else if (capability === "synthesize" && delta.region && Object.keys(delta.region).length) {
    const sameCriteria = JSON.stringify([...(delta.region.acceptanceCriteria ?? region.acceptanceCriteria).map((item) => normalize(item))].sort()) === JSON.stringify([...region.acceptanceCriteria.map((item) => normalize(item))].sort());
    const sameVariables = JSON.stringify([...(delta.region.allowedVariables ?? region.allowedVariables)].sort()) === JSON.stringify([...region.allowedVariables].sort());
    const rewrote = (delta.region.objective !== undefined && slug(delta.region.objective) !== slug(region.objective))
      || (delta.region.delivery !== undefined && delta.region.delivery !== region.delivery)
      || !sameCriteria || !sameVariables;
    if (rewrote) throw new Error("Synthesis may compare alternatives, but may not rewrite the objective, delivery type, allowed variables, or success criteria.");
  }
  if (capability === "synthesize" && (delta.select.length || delta.candidates.some((item) => item.outcome === "selected")))
    throw new Error("Synthesis deltas may not author or derive selections. A commitment can be created only by the select-candidate operation after fresh challenge acceptance.");
  if (delta.variables?.length || delta.candidates.some((item) => item.stances?.length)) {
    const declaredNames = new Set(state.network.variables.filter((item) => !item.historical).map((item) => item.name));
    const previewVariables = state.network.variables.filter((item) => !item.historical);
    for (const declaration of delta.variables ?? []) {
      const name = slug(declaration.name);
      if (!name || name === "task") continue;
      if (declaredNames.has(name)) throw new Error(`A shared choice named "${name}" already exists — reuse it instead of declaring it again.`);
      declaredNames.add(name);
      const seedLabels: string[] = [];
      for (const raw of declaration.seedLabels ?? []) {
        const label = normalize(raw);
        if (label && !seedLabels.some((existing) => slug(existing) === slug(label))) seedLabels.push(label);
      }
      previewVariables.push({ id: `preview:${name}`, name, ownerRegionId: regionId, seedLabels });
    }
    const preview = { ...state.network, variables: previewVariables } as SolutionNetwork;
    for (const item of delta.candidates) resolveStances(preview, regionId, item.stances ?? []);
  }
  // Mirror mergeSolutionDelta: an answer is honored only when the delta marks the goal as answer-only.
  const resolvedAnswer = delta.region?.delivery === "answer" ? delta.resolvedAnswer : undefined;
  if (delta.region?.delivery && delta.region.delivery !== region.delivery && !resolvedAnswer)
    throw new Error("Delivery type may change only through a complete resolvedAnswer. A standalone delivery rewrite is not a clarification — return resolvedAnswer with the evidence-backed answer instead.");
  if (resolvedAnswer) {
    if (region.edge !== "root" && region.delivery === "change") throw new Error("A non-root change scope has controller-owned delivery and cannot be rewritten as an answer. Return the requested facts and preserve its implementation contract.");
    const known = new Set(["task", ...state.network.evidence.map((item) => item.id)]);
    const suppliedSources = new Set(delta.evidence.map((item) => item.source));
    if (!resolvedAnswer.evidenceRefs.some((ref) => known.has(ref) || suppliedSources.has(ref)))
      throw new Error("A resolved answer must cite at least one real fact: an existing evidence id or the source of a fact supplied with this result. An answer without evidence is a guess, not a resolution.");
    if (region.delivery !== "answer") {
      const open = state.network.candidates.filter((item) => item.regionId === regionId && item.status === "possible");
      if (open.length)
        throw new Error(`Resolving to an answer would downgrade this change goal while ${open.length} implementation alternative(s) remain possible. Commit to one approach through select, or eliminate each alternative with a refutes constraint backed by the task reference or confirmed evidence; only a settled solution space may be closed with an answer.`);
      if (!resolvedAnswer.evidenceRefs.includes("task"))
        throw new Error(`Closing a change goal with an answer requires user authority: cite the immutable task reference "task" in resolvedAnswer.evidenceRefs so the resolution is anchored to the original request, not to model preference.`);
    }
    return;
  }
  const statuses = new Map<string, string>();
  for (const candidate of state.network.candidates.filter((item) => !item.historical && item.regionId === regionId)) statuses.set(candidate.id, candidate.status);
  for (const item of delta.candidates) statuses.set(candidateId(regionId, item.key), item.outcome);
  const candidateRefs = new Set(statuses.keys());
  if (delta.evidence.some((item) => item.kind === "user")) throw new Error("Model output cannot create user evidence. User authority is the immutable task reference, cited as evidenceRefs: [\"task\"].");
  if (capability !== "inspect" && delta.evidence.some((item) => item.kind !== "inference")) throw new Error("This tool-free role cannot create confirmed repository/tool evidence. Reuse supplied evidence IDs, return a new inference hypothesis, or request one specific inspection.");
  const evidenceRefs = new Set(["task", ...state.network.evidence.map((item) => item.id), ...delta.evidence.map((item) => item.source)]);
  const suppliedEvidence = (ref: string) => delta.evidence.find((item) => item.source === ref || reads.some((read) => read.chunkId === ref && item.location && JSON.stringify(read.location) === JSON.stringify(item.location)));
  const confirmedRef = (ref: string) => {
    if (ref === "task") return true;
    const existing = state.network.evidence.find((item) => item.id === ref);
    if (existing) return isConfirmedEvidence(state.network, ref);
    const supplied = suppliedEvidence(ref);
    return Boolean(supplied && supplied.kind !== "inference" && supplied.kind !== "user");
  };
  const groundingKind = (ref: string) => ref === "task" ? "user" : state.network.evidence.find((item) => item.id === ref)?.kind ?? suppliedEvidence(ref)?.kind;
  if (capability !== "inspect" && (delta.validations?.length ?? 0) > 0) throw new Error("Only inspection may validate an unresolved claim.");
  for (const validation of delta.validations ?? []) {
    const claim = state.network.evidence.find((item) => item.id === validation.claimRef);
    if (!claim || claim.kind !== "inference" || claim.status === "rejected") throw new Error(`Validation target "${validation.claimRef}" is not a live hypothesis.`);
    if (validation.verdict === "unresolved") {
      if (validation.evidenceRefs.length) throw new Error("An unresolved validation must not attach evidence as if it proved a verdict.");
      continue;
    }
    if (!validation.evidenceRefs.length) throw new Error(`${validation.verdict} validation of "${validation.claimRef}" requires independent repository, tool, or user evidence.`);
    for (const ref of validation.evidenceRefs) {
      if (!confirmedRef(ref) || groundingKind(ref) === "inference") throw new Error(`Validation evidence "${ref}" is not independent confirmed repository/tool/user evidence.`);
    }
  }
  const endpoint = (ref: string) => {
    const canonical = candidateRef(state.network, regionId, ref);
    if (candidateRefs.has(canonical)) return "candidate";
    if (evidenceRefs.has(ref)) return "evidence";
    if (ref === "task") return "task";
    if (state.network.regions.some((item) => item.id === ref)) return "region";
    if (knownCoordinate(state.network, ref)) return "coordinate";
    return "unknown";
  };
  for (const constraint of delta.constraints) {
    const subject = endpoint(constraint.subject); const target = endpoint(constraint.target);
    const valid = constraint.kind === "supports" ? subject === "evidence" && target === "candidate"
      : constraint.kind === "refutes" ? (subject === "evidence" || subject === "candidate" || subject === "task") && (target === "candidate" || target === "coordinate")
      : constraint.kind === "excludes" ? subject === "candidate" && (target === "candidate" || target === "coordinate")
      : subject === "candidate" && target === "candidate";
    if (!valid)
      throw new Error(
        `Invalid ${constraint.kind} endpoints: ${constraint.subject} (${subject}) -> ${constraint.target} (${target}). ` +
        `Allowed shapes: supports = factId -> candidateKey. refutes = factId|task|candidateKey -> candidateKey (or -> choiceName:option when citing why an option dies). requires/excludes/equivalent = candidateKey -> candidateKey within this goal. ` +
        `To say one approach strengthens another, attach its facts as supporting evidenceRefs on the candidate instead.`,
      );
    for (const ref of constraint.evidenceRefs ?? []) {
      if (!evidenceRefs.has(ref)) throw new Error(`Constraint cites unknown fact "${ref}" — cite an established fact id or supply the fact with this result.`);
      if (!confirmedRef(ref)) throw new Error(`Constraint cites unresolved claim "${ref}" — validate it before using it as a constraint.`);
    }
    if (constraint.kind === "refutes" && subject === "evidence" && !confirmedRef(constraint.subject))
      throw new Error(`Refutation source "${constraint.subject}" is unresolved — validate it before using it to eliminate an alternative.`);
    if (constraint.sourceKind === "user-task")
      throw new Error(`Model output cannot assert user-task authority. Use model-inference for your interpretation, or cite confirmed repository/tool evidence with repo-evidence; only trusted controller state may create user-task constraints.`);
    if (constraint.sourceKind === "repo-evidence" && subject !== "evidence" && !(constraint.evidenceRefs ?? []).some((ref) => confirmedRef(ref) && (groundingKind(ref) === "repository" || groundingKind(ref) === "tool")))
      throw new Error(`Constraint claims repository authority but cites no confirmed repository/tool evidence.`);
    if (target === "coordinate") {
      if (!(constraint.evidenceRefs ?? []).length)
        throw new Error(`Refuting shared choice "${constraint.target}" requires at least one cited fact in evidenceRefs — an uncited kill of a shared option is a guess, not a constraint.`);
    }
  }
  if (capability === "synthesize") {
    for (const item of delta.candidates) {
      if (item.outcome === "eliminated") {
        const id = candidateId(regionId, item.key);
        const proof = delta.constraints.some((constraint) => constraint.kind === "refutes" && candidateId(regionId, constraint.target) === id && (confirmedRef(constraint.subject) || constraint.evidenceRefs.some(confirmedRef)));
        if (!proof) throw new Error(`Alternative "${item.key}" cannot be directly eliminated. Return it as possible and provide a refutes constraint backed by the exact task reference or confirmed evidence; keep sourceKind=model-inference for your interpretation of the task. The kernel will derive elimination.`);
      }
    }
  }
  const domain = [...statuses.values()];
  if (domain.length && domain.every((status) => status === "eliminated"))
    throw new Error(`Every alternative for ${regionId} was rejected. Leave at least one alternative possible or chosen. Reject an alternative only for a reason that argues against choosing it; supporting evidence is not a rejection reason.`);
}

/** Direct reducer callers may omit defaulted delta arrays; Zod-normalized graph paths never do. */
function normalizeDelta(delta: SolutionDelta): SolutionDelta {  return { ...delta, candidates: delta.candidates ?? [], constraints: delta.constraints ?? [], evidence: delta.evidence ?? [], factIds: delta.factIds ?? [], validations: delta.validations ?? [], criterionEvidence: delta.criterionEvidence ?? [], select: delta.select ?? [], activations: delta.activations ?? [], variables: delta.variables ?? [], taskScopes: delta.taskScopes ?? [], taskDispositions: delta.taskDispositions ?? [] };
}

const generatedStances = (item: DomainGenerationOutput["candidates"][number]) => item.coordinates.flatMap((coordinate) => coordinate.applicability === "applies" ? coordinate.stances.map((stance) => ({ variable: coordinate.variableId, ...stance })) : []);
const synthesisDelta = (output: DomainGenerationOutput, candidateItems = output.candidates): SolutionDelta => ({
  region: {}, evidence: output.evidence, factIds: [], variables: [],
  candidates: candidateItems.map((item) => ({ key: item.key, proposition: item.proposition, evidenceRefs: item.evidenceRefs, stances: generatedStances(item), outcome: "possible" as const, reasons: [] })),
  constraints: [], select: [], activations: [], validations: [], criterionEvidence: [],
});

function exactSet(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && [...actual].sort().every((item, index) => item === [...expected].sort()[index]);
}

export function validateSynthesisOutput(state: SolutionLodState, activation: Activation, output: SynthesisOutput): void {
  if (activation.capability !== "synthesize" || !activation.operation) throw new Error("Synthesis requires a trusted activation operation.");
  const region = state.network.regions.find((item) => item.id === activation.regionId);
  if (!region) throw new Error(`Unknown synthesis region ${activation.regionId}.`);
  const fingerprint = boundDomainFingerprint(state.network, region.id);
  if (activation.operation === "generate-domain") {
    const generated = output as DomainGenerationOutput;
    if (generated.outcome !== "candidates") throw new Error(`generate-domain cannot return ${output.outcome}.`);
    rejectUnrequestedDeferredWork(state, generated.candidates.map((item) => item.proposition));
    if (region.candidateIds.length) throw new Error(`generate-domain requires an ungenerated region; ${region.id} already has a domain.`);
    if (!region.decisionBoundary) throw new Error("generate-domain requires a controller-admitted decision boundary.");
    if (generated.candidates.some((item) => /^(other|something else|miscellaneous|none of the above)$/i.test(normalize(item.proposition)))) throw new Error("A generated candidate must be a concrete material solution family, not a vague residual alternative.");
    const variableIds = region.decisionBoundary.variables.map((item) => item.id).sort();
    if (!region.allowedVariables.length && generated.candidates.length !== 1) throw new Error("A fixed boundary with no allowed variables admits exactly one implementation family.");
    const admittedPairs = new Set(region.decisionBoundary.permittedPairs.map((item) => pairKey(item.leftVariableId, item.rightVariableId)));
    const semanticSignatures = new Set<string>();
    for (const candidate of generated.candidates) {
      if (!exactSet(candidate.coordinates.map((item) => item.variableId), variableIds)) throw new Error(`Generated candidate ${candidate.key} requires exactly one applicability record for every admitted boundary variable.`);
      const touched = candidate.coordinates.filter((item) => item.applicability === "applies").map((item) => item.variableId);
      if (touched.length > 2) throw new Error(`Generated candidate ${candidate.key} touches more than two shared variables; the decision boundary must use one composite variable or decompose the work.`);
      if (touched.length === 2 && !admittedPairs.has(pairKey(touched[0]!, touched[1]!))) throw new Error(`Generated candidate ${candidate.key} touches an unadmitted variable pair.`);
      for (const coordinate of candidate.coordinates) if (coordinate.applicability === "applies") {
        const canonical = coordinate.stances.map((stance) => `${stance.relation}\0${slug(canonicalLabel(state.network, coordinate.variableId, stance.valueLabel))}`);
        if (new Set(canonical).size !== canonical.length) throw new Error(`Generated candidate ${candidate.key} contains a duplicate stance.`);
        const required = new Set(coordinate.stances.filter((stance) => stance.relation === "requires").map((stance) => slug(canonicalLabel(state.network, coordinate.variableId, stance.valueLabel))));
        if (required.size > 1) throw new Error(`Generated candidate ${candidate.key} requires multiple options for shared choice ${coordinate.variableId}; use one composite option or decompose the work.`);
      }
      const signature = candidateSignature(candidate.proposition, resolveStances(state.network, region.id, generatedStances(candidate)));
      if (semanticSignatures.has(signature)) throw new Error("Generated candidates are duplicates unless they differ on an admitted structured decision; prose-only variants are one solution family.");
      semanticSignatures.add(signature);
    }
    validateSolutionDelta(state, region.id, "synthesize", synthesisDelta(generated));
    return;
  }
  if (output.outcome === "candidates" || !("boundDomainFingerprint" in output) || output.boundDomainFingerprint !== fingerprint || (activation.boundDomainFingerprint ?? activation.domainFingerprint) !== fingerprint)
    throw new Error(`Stale ${activation.operation} result: expected exact bound domain fingerprint ${fingerprint ?? "none"}, received ${"boundDomainFingerprint" in output ? output.boundDomainFingerprint : "none"}.`);
  const viable = region.candidateIds.filter((id) => state.network.candidates.find((item) => item.id === id)?.status !== "eliminated").sort();
  if (activation.operation === "challenge-domain") {
    const challenge = output as DomainChallengeOutput;
    rejectUnrequestedDeferredWork(state, [challenge.outcome === "counterexample" ? challenge.candidate.proposition : challenge.outcome === "boundary-counterexample" ? challenge.missingFamily.proposition : undefined, challenge.outcome === "needs-fact" ? challenge.request : undefined]);
    if (!region.allowedVariables.length && (challenge.outcome === "counterexample" || challenge.outcome === "boundary-counterexample")) throw new Error("A fixed boundary with no allowed variables has no alternative family to add; accept its sole viable candidate or request one precise missing fact.");
    if (challenge.outcome === "accept" && !exactSet(challenge.viableCandidateIds, viable)) throw new Error("Challenge acceptance must reference every and only currently viable candidate ID.");
    if (challenge.outcome === "counterexample") {
      for (const ref of [...challenge.evidenceRefs, ...challenge.candidate.evidenceRefs]) if (!isConfirmedEvidence(state.network, ref)) throw new Error(`Counterexample cites unresolved, invented, or stale evidence reference ${ref}.`);
      if (!region.decisionBoundary || !exactSet(challenge.candidate.coordinates.map((item) => item.variableId), region.decisionBoundary.variables.map((item) => item.id))) throw new Error("Challenge counterexample must position the missing family on every admitted boundary variable.");
      const stances = resolveStances(state.network, region.id, generatedStances(challenge.candidate));
      const id = candidateId(region.id, challenge.candidate.key);
      if (state.network.candidates.some((item) => !item.historical && item.id === id)) throw new Error(`Challenge counterexample must add one genuinely new candidate ID; ${id} already exists.`);
      const signature = candidateSignature(challenge.candidate.proposition, stances);
      if (state.network.candidates.some((item) => !item.historical && item.regionId === region.id && candidateSignature(item.proposition, item.stances ?? []) === signature)) throw new Error("Challenge counterexample must differ on an admitted structured decision; prose-only variants are one solution family.");
    } else if (challenge.outcome === "boundary-counterexample") {
      for (const ref of challenge.evidenceRefs) if (!isConfirmedEvidence(state.network, ref)) throw new Error(`Boundary counterexample cites unresolved, invented, or stale evidence reference ${ref}.`);
    } else if (challenge.outcome === "needs-fact") {
      for (const ref of challenge.contextRefs) if (!knownRef(state.network, ref)) throw new Error(`Challenge inspection request cites unknown context reference ${ref}.`);
      const targets = challenge.contextRefs.filter((ref) => region.criterionIds.includes(ref as CriterionId));
      if (region.criterionIds.length && targets.length !== 1) throw new Error(`Challenge may reopen inspection only for exactly one criterion ID: ${region.criterionIds.join(", ")}.`);
    }
    return;
  }
  const selection = output as CandidateSelectionOutput;
  rejectUnrequestedDeferredWork(state, [selection.outcome === "needs-fact" ? selection.inspectionRequest.request : undefined, ...(selection.outcome === "hard-constraint" ? selection.hardConstraints.map((item) => item.reason) : [])]);
  if (!region.acceptedFingerprint || region.acceptedFingerprint !== fingerprint) throw new Error("Candidate selection requires the exact current domain fingerprint to have a fresh accepted challenge verdict.");
  if (!exactSet(selection.comparisons.map((item) => item.candidateId), viable)) throw new Error("Candidate selection must compare every and only currently viable candidate ID.");
  if (selection.outcome === "hard-constraint") {
    if (!region.allowedVariables.length) throw new Error("A fixed boundary with no allowed variables must select its sole viable candidate or request one precise missing fact.");
    for (const constraint of selection.hardConstraints) {
      if (!["requires", "excludes", "refutes"].includes(constraint.kind)) throw new Error(`Selection hardConstraints may contain only requires, excludes, or refutes; ${constraint.kind} is not a hard elimination rule.`);
      if (!constraint.evidenceRefs.length || constraint.evidenceRefs.some((ref) => !isConfirmedEvidence(state.network, ref))) throw new Error(`Selection hard constraint ${constraint.subject} -> ${constraint.target} requires cited confirmed evidence.`);
    }
    validateSolutionDelta(state, region.id, "synthesize", { region: {}, evidence: [], factIds: [], variables: [], candidates: [], constraints: selection.hardConstraints, select: [], activations: [], validations: [], criterionEvidence: [] });
    return;
  }
  if (selection.outcome === "needs-fact") {
    for (const ref of selection.inspectionRequest.contextRefs) if (!knownRef(state.network, ref)) throw new Error(`Selection inspection request cites unknown context reference ${ref}.`);
    const targets = selection.inspectionRequest.contextRefs.filter((ref) => region.criterionIds.includes(ref as CriterionId));
    if (region.criterionIds.length && targets.length !== 1) throw new Error(`Selection may reopen inspection only for exactly one criterion ID: ${region.criterionIds.join(", ")}.`);
    return;
  }
  if (viable.length === 1) {
    if (viable.length !== 1 || selection.selectedCandidateId !== viable[0]) throw new Error("only-viable selection must name the sole viable candidate.");
    return;
  }
  const rank = { preferred: 0, neutral: 1, disfavored: 2 } as const;
  const tuples = selection.comparisons.map((item) => ({ id: item.candidateId, tuple: [rank[item.userPreference], rank[item.repositoryCompatibility], rank[item.changeScope], rank[item.irreversibleRisk]] as const }));
  for (const item of selection.comparisons) {
    if ((item.userPreference !== "neutral" || item.repositoryCompatibility !== "neutral") && !item.evidenceRefs.length) throw new Error(`Preference claims for ${item.candidateId} require corresponding user or repository references.`);
    if (item.evidenceRefs.some((ref) => !isConfirmedEvidence(state.network, ref))) throw new Error(`Preference comparison for ${item.candidateId} cites an unresolved or stale reference.`);
    if (item.userPreference !== "neutral" && !item.evidenceRefs.some((ref) => ref === "task" || state.network.evidence.find((evidence) => evidence.id === ref)?.kind === "user")) throw new Error(`User-preference comparison for ${item.candidateId} requires a user reference.`);
    if (item.repositoryCompatibility !== "neutral" && !item.evidenceRefs.some((ref) => ["repository", "tool"].includes(state.network.evidence.find((evidence) => evidence.id === ref)?.kind ?? ""))) throw new Error(`Repository-compatibility comparison for ${item.candidateId} requires a repository or tool reference.`);
  }
  tuples.sort((left, right) => { for (let index = 0; index < 4; index++) { const difference = left.tuple[index]! - right.tuple[index]!; if (difference) return difference; } return left.id.localeCompare(right.id); });
  const sameRank = (left: typeof tuples[number], right: typeof tuples[number]) => left.tuple.every((value, index) => value === right.tuple[index]);
  if (tuples[1] && sameRank(tuples[0]!, tuples[1]!)) throw new Error("The earliest applicable preference tier has no unique winner; request one grounding fact.");
  if (selection.selectedCandidateId !== tuples[0]?.id) throw new Error(`Lexicographic selection must choose ${tuples[0]?.id}.`);
}

export function mergeSynthesisOutput(state: SolutionLodState, activationId: string, output: SynthesisOutput): SolutionNetwork {
  const activation = state.network.activations.find((item) => item.id === activationId);
  if (!activation) throw new Error(`Unknown activation ${activationId}`);
  validateSynthesisOutput(state, activation, output);
  if (activation.operation === "generate-domain") {
    const generated = output as DomainGenerationOutput;
    let network = mergeSolutionDelta(state, activationId, synthesisDelta(generated));
    const region = network.regions.find((item) => item.id === activation.regionId)!;
    region.acceptedFingerprint = null; region.challengeVerdict = null; transitionRegion(region, "challenging");
    refreshDomainControls(network); network.revision++;
    return network;
  }
  let network = cloneNetwork(state.network);
  let region = network.regions.find((item) => item.id === activation.regionId)!;
  if (activation.operation === "challenge-domain") {
    const challenge = output as DomainChallengeOutput;
    region.challengeVerdict = challenge.outcome;
    switch (challenge.outcome) {
    case "accept": region.acceptedFingerprint = challenge.boundDomainFingerprint; transitionRegion(region, "selecting"); break;
    case "counterexample": {
      const diagnostic = JSON.stringify({ key: challenge.candidate.key, proposition: challenge.candidate.proposition, coordinates: challenge.candidate.coordinates, reason: challenge.reason, evidence: { counterexample: challenge.evidenceRefs, candidate: challenge.candidate.evidenceRefs } });
      if (region.progress.cegarRounds.count >= MAX_CEGAR_ROUNDS || region.candidateIds.length >= MAX_DOMAIN_CANDIDATES) {
        const bound = region.candidateIds.length >= MAX_DOMAIN_CANDIDATES ? `candidate bound ${MAX_DOMAIN_CANDIDATES} reached` : "CEGAR repair bound exceeded";
        transitionRegion(region, "blocked", `${bound}: unresolved counterexample ${challenge.candidate.proposition}; details=${diagnostic}`);
        network.revision++;
        return network;
      }
      const beforeIds = new Set(region.candidateIds);
      const delta: SolutionDelta = synthesisDelta({ outcome: "candidates", evidence: [], candidates: [challenge.candidate] });
      network = mergeSolutionDelta({ ...state, network } as SolutionLodState, activationId, delta);
      region = network.regions.find((item) => item.id === activation.regionId)!;
      const addedIds = region.candidateIds.filter((id) => !beforeIds.has(id));
      if (addedIds.length !== 1 || addedIds[0] !== candidateId(region.id, challenge.candidate.key)) throw new Error("Counterexample repair must add exactly one genuinely new candidate ID.");
      region.progress.cegarRounds = { count: region.progress.cegarRounds.count + 1, fingerprint: boundDomainFingerprint(network, region.id), unresolvedCriterionIds: [...region.criterionIds] }; region.acceptedFingerprint = null; transitionRegion(region, "challenging");
      break;
    }
    case "boundary-counterexample":
      if (region.progress.cegarRounds.count >= MAX_CEGAR_ROUNDS) transitionRegion(region, "blocked", `CEGAR repair bound exceeded: unresolved boundary counterexample ${challenge.missingFamily.proposition}.`);
      else {
        region.progress.cegarRounds = { count: region.progress.cegarRounds.count + 1, fingerprint: hash(challenge.missingFamily), unresolvedCriterionIds: [...(region.inspectionObligationIds ?? [])] };
        for (const candidate of network.candidates.filter((item) => item.regionId === region.id && !item.historical)) candidate.historical = true;
        for (const variable of network.variables.filter((item) => item.ownerRegionId === region.id && !item.historical)) variable.historical = true;
        region.candidateIds = []; region.selectedCandidateIds = []; region.decisionBoundary = undefined; region.enumerationFingerprint = null; region.boundDomainFingerprint = null; region.domainFingerprint = null; region.acceptedFingerprint = null; region.challengeVerdict = null; region.certifiedLeaf = undefined; clearImplementationContinuation(region); region.answer = undefined;
        purgeDescendants(network, region.id); transitionRegion(region, "inspecting", undefined, "superposed");
        const diagnostic = JSON.stringify({ missingFamily: challenge.missingFamily, defect: challenge.defect, evidenceRefs: challenge.evidenceRefs });
        recordRecovery(network, "reopen", region.id, `Boundary counterexample: ${diagnostic}`);
        network.revision++;
        addActivation(network, { capability: "inspect", requiredCapabilities: ["repository-observe"], regionId: region.id,
          request: `Rebuild the decision boundary to represent this concrete missing family and boundary defect: ${diagnostic}. Preserve settled criterion observations; the counterexample changes the decision representation, not repository state. Return boundary using supplied confirmed evidence. Inspect only a fact specifically needed to resolve this defect; do not repeat general inspection or reopen settled criteria.`,
          expectedDelta: `boundary-rebuild:${region.id}:${region.progress.cegarRounds.count}:${hash(diagnostic)}`,
          contextRefs: [region.id, ...challenge.evidenceRefs], senderActivationId: activation.id });
        return propagateNetwork(network);
      }
      break;
    case "needs-fact":
      region.inspectionObligationIds = challenge.contextRefs.filter((ref): ref is CriterionId => region.criterionIds.includes(ref as CriterionId));
      transitionRegion(region, "inspecting");
      addActivation(network, { capability: "inspect", requiredCapabilities: challenge.requiredCapabilities, regionId: region.id, request: challenge.request, expectedDelta: challenge.expectedDelta, contextRefs: challenge.contextRefs, senderActivationId: activation.id });
      break;
    default: assertNever(challenge);
    }
    network.revision++; return propagateNetwork(network);
  }
  const selection = output as CandidateSelectionOutput;
  switch (selection.outcome) {
  case "hard-constraint": {
    const delta: SolutionDelta = { region: {}, evidence: [], factIds: [], variables: [], candidates: [], constraints: selection.hardConstraints, select: [], activations: [], validations: [], criterionEvidence: [] };
    network = mergeSolutionDelta({ ...state, network } as SolutionLodState, activationId, delta);
    region = network.regions.find((item) => item.id === activation.regionId)!;
    region.acceptedFingerprint = null; region.challengeVerdict = null; region.progress.selectionNoProgress = progressEntry(); transitionRegion(region, "challenging"); network.revision++;
    return propagateNetwork(network);
  }
  case "needs-fact": {
    const comparisons = selection.comparisons.map((item) => ({ ...item, evidenceRefs: [...item.evidenceRefs].sort() })).sort((left, right) => left.candidateId.localeCompare(right.candidateId));
    const signature = hash({ viableDomain: region.candidateIds.filter((id) => network.candidates.find((item) => item.id === id)?.status !== "eliminated").sort(), confirmedPreferenceFacts: comparisons.flatMap((item) => item.evidenceRefs).filter((ref) => isConfirmedEvidence(network, ref)).map((ref) => resolveContextReference(network, ref)?.fingerprint).filter(Boolean).sort(), commitment: region.selectedCandidateIds });
    const ledger = region.progress.selectionNoProgress;
    ledger.count = ledger.fingerprint === signature ? ledger.count + 1 : 1;
    ledger.fingerprint = signature;
    ledger.unresolvedCriterionIds = [...region.criterionIds];
    if (ledger.count >= MAX_NO_PROGRESS_CYCLES) transitionRegion(region, "blocked", `Selection for ${region.id} made no progress for two semantic comparison cycles; fingerprint=${signature}; unresolvedCriterionIds=${region.criterionIds.join(",") || "none"}.`);
    else { region.inspectionObligationIds = selection.inspectionRequest.contextRefs.filter((ref): ref is CriterionId => region.criterionIds.includes(ref as CriterionId)); transitionRegion(region, "inspecting"); addActivation(network, { capability: "inspect", requiredCapabilities: selection.inspectionRequest.requiredCapabilities, regionId: region.id, request: selection.inspectionRequest.request, expectedDelta: selection.inspectionRequest.expectedDelta, contextRefs: selection.inspectionRequest.contextRefs, senderActivationId: activation.id }); }
    network.revision++; return network;
  }
  case "selected": break;
  default: assertNever(selection);
  }
  const selected = network.candidates.find((item) => item.id === selection.selectedCandidateId)!;
  for (const candidate of network.candidates.filter((item) => item.regionId === region.id)) candidate.declaredStatus = candidate.id === selected.id ? "selected" : "possible";
  purgeDescendants(network, region.id);
  region.selectionPremiseRefs = [...new Set([...selection.comparisons.flatMap((item) => item.evidenceRefs), ...region.constraintIds.flatMap((id) => network.constraints.find((item) => item.id === id)?.evidenceRefs ?? [])])].sort();
  region.implementationPremiseRefs = undefined; region.verificationPremiseRefs = undefined;
  region.progress.selectionNoProgress = progressEntry(); transitionRegion(region, "selected"); network.revision++;
  return propagateNetwork(network);
}

export function mergeSolutionDelta(state: SolutionLodState, activationId: string, rawDelta: SolutionDelta, tools?: readonly AgentToolTrace[]): SolutionNetwork {
  const delta = normalizeDelta(rawDelta);
  const sourceActivation = state.network.activations.find((item) => item.id === activationId);
  const sourceRegion = state.network.regions.find((item) => item.id === sourceActivation?.regionId);
  const inspectionBefore = sourceRegion ? inspectionProgressFingerprint(state.network, sourceRegion) : null;
  let network = cloneNetwork(state.network);
  const activation = network.activations.find((item) => item.id === activationId);
  if (!activation) throw new Error(`Unknown activation ${activationId}`);
  const initialRegion = network.regions.find((item) => item.id === activation.regionId);
  if (!initialRegion) throw new Error(`Unknown activation region ${activation.regionId}`);
  let region: SolutionRegion = initialRegion;
  let changed = false;
  if (delta.region) {
    if (delta.region.objective && delta.region.objective !== region.objective) { region.objective = delta.region.objective; changed = true; }
    const mergeResolvedAnswer = delta.region.delivery === "answer" ? delta.resolvedAnswer : undefined;
    if (delta.region.delivery && delta.region.delivery !== region.delivery && !mergeResolvedAnswer) throw new Error(`Delivery rewrite from "${region.delivery}" to "${delta.region.delivery}" is only valid through a complete resolvedAnswer.`);
    if (delta.region.delivery && delta.region.delivery !== region.delivery) { region.delivery = delta.region.delivery; changed = true; }
    if (delta.region.allowedVariables) {
      const next = [...new Set(delta.region.allowedVariables.map(normalize).filter(Boolean))];
      if (JSON.stringify(next) !== JSON.stringify(region.allowedVariables)) { region.allowedVariables = next; changed = true; }
    }
    if (delta.region.acceptanceCriteria?.length) {
      const next = [...new Set(delta.region.acceptanceCriteria.map(normalize).filter(Boolean))];
      if (JSON.stringify(next) !== JSON.stringify(region.acceptanceCriteria)) { region.acceptanceCriteria = next; region.criterionIds = next.map((_, index) => `criterion:${region.scopeId}:${index}` as const); region.inspectionObligationIds = [...region.criterionIds]; region.criterionVerdicts = []; region.inspectionAttempts = 0; changed = true; }
    }
  }
  if (activation.capability === "inspect" && region.edge === "root" && delta.taskScopes?.length) {
    const taskScopes = delta.taskScopes;
    region.acceptanceCriteria = delta.taskScopes.map((item) => normalize(item.objective));
    region.criterionIds = region.acceptanceCriteria.map((_, index) => `criterion:${region.scopeId}:${index}` as const);
    const requirementDefinitions = delta.materialRequirements?.length ? delta.materialRequirements : taskScopes.map((item) => ({ key: item.key, text: item.objective, scopeKey: item.key, criterionIndex: 0, evidenceRefs: [] }));
    network.materialRequirements = requirementDefinitions.map((item) => {
      const { ownerIndex, criterionIndex } = bindRequirement(item, taskScopes);
      const owner = taskScopes[ownerIndex]!;
      const scopeId = `scope:${region.id}:${slug(owner.key)}` as ScopeId;
      return { id: `requirement:${slug(item.key)}` as RequirementId, key: slug(item.key), text: normalize(item.text), scopeId, criterionId: `criterion:${scopeId}:${criterionIndex}` as CriterionId, evidenceRefs: [...item.evidenceRefs] };
    });
    for (const [index, scope] of delta.taskScopes.entries()) {
      const scopeId = `scope:${region.id}:${slug(scope.key)}` as const;
      if (network.regions.some((item) => item.scopeId === scopeId)) throw new Error(`Duplicate root task scope ownership: ${scopeId}`);
      const childId = `r${network.nextRegionId++}`;
      const requirementIds = network.materialRequirements.filter((item) => item.scopeId === scopeId).map((item) => item.id);
      const dependencyScopeIds = [...new Set((scope.dependencyScopeIds ?? []).map((dependency) => resolveScopeDependency(network, region.id, taskScopes, dependency)).filter((item): item is ScopeId => Boolean(item)))];
      const criterionIds = scope.acceptanceCriteria.map((_, criterionIndex) => `criterion:${scopeId}:${criterionIndex}` as const);
      network.regions.push({ id: childId, key: normalize(scope.key), parentId: region.id, edge: "partOf", lod: region.lod + 1, objective: normalize(scope.objective), delivery: scope.delivery, allowedVariables: [...scope.allowedVariables], acceptanceCriteria: [...scope.acceptanceCriteria], coveredCriteria: [index], status: "unformed", progress: emptyProgress(), candidateIds: [], selectedCandidateIds: [], constraintIds: [], evidenceIds: [], activationIds: [], artifactIds: [], scopeId, criterionIds, inspectionObligationIds: [...criterionIds], domainPhase: "inspecting", domainFingerprint: null, acceptedFingerprint: null, challengeVerdict: null, requirementIds, dependencyScopeIds, mutationResources: [...new Set(scope.mutationResources ?? [])].sort(), selectionAge: 0 });
    }
    region.requirementIds = network.materialRequirements.map((item) => item.id);
    transitionRegion(region, "selected", undefined, "collapsed");
    changed = true;
  } else if (activation.capability === "inspect" && region.edge === "root" && delta.materialRequirements?.length) {
    const rootScopes = [{ key: region.id, acceptanceCriteria: region.acceptanceCriteria }];
    network.materialRequirements = delta.materialRequirements.map((item) => {
      const { criterionIndex } = bindRequirement(item, rootScopes, "root criterion");
      return { id: `requirement:${slug(item.key)}` as RequirementId, key: slug(item.key), text: normalize(item.text), scopeId: region.scopeId, criterionId: region.criterionIds[criterionIndex]!, evidenceRefs: [...item.evidenceRefs] };
    });
    region.requirementIds = network.materialRequirements.map((item) => item.id);
  } else if (activation.capability === "inspect" && region.edge === "root" && !network.materialRequirements?.length && region.acceptanceCriteria.length) {
    network.materialRequirements = region.acceptanceCriteria.map((criterion, index) => ({ id: `requirement:root-criterion-${index}` as RequirementId, key: `root-criterion-${index}`, text: criterion, scopeId: region.scopeId, criterionId: region.criterionIds[index]!, evidenceRefs: [] }));
    region.requirementIds = network.materialRequirements.map((item) => item.id);
  }
  const resolvedAnswer = delta.region?.delivery === "answer" ? delta.resolvedAnswer : undefined;
  const mergedEvidence = mergeEvidence(network, region, delta.evidence, activation.id, tools, activation.capability);
  const localEvidence = mergedEvidence.refs;
  changed ||= mergedEvidence.changed;
  for (const factId of delta.factIds) { const evidenceId = localEvidence.get(factId) ?? factId; if (!region.evidenceIds.includes(evidenceId)) { region.evidenceIds.push(evidenceId); changed = true; } }
  if (activation.capability === "inspect" && region.edge === "root") {
    const authored = new Map((delta.materialRequirements ?? []).map((item) => [`requirement:${slug(item.key)}`, item.evidenceRefs]));
    for (const refresh of delta.materialRequirementEvidence ?? []) authored.set(refresh.requirementId, refresh.evidenceRefs);
    for (const requirement of network.materialRequirements ?? []) if (authored.has(requirement.id)) {
      const refs = [...new Set(authored.get(requirement.id)!.map((ref) => localEvidence.get(ref) ?? ref))].sort();
      if (JSON.stringify(refs) !== JSON.stringify(requirement.evidenceRefs)) { requirement.evidenceRefs = refs; changed = true; }
    }
  }
  if (applyEvidenceValidations(network, delta.validations, localEvidence)) changed = true;
  if (activation.capability === "inspect" && delta.criterionEvidence.length) {
    region.inspectionObligationIds ??= [...region.criterionIds];
    region.criterionVerdicts ??= [];
    const closed = new Set<CriterionId>();
    for (const item of delta.criterionEvidence) {
      const criterionId = region.criterionIds[item.criterionIndex];
      if (!criterionId) continue;
      const verdict = item.verdict ?? "satisfied";
      const evidenceRefs = [...new Set(item.evidenceRefs.map((ref) => localEvidence.get(ref) ?? ref))].sort();
      const previous: InspectionCriterionResult | undefined = region.criterionVerdicts.find((entry) => entry.criterionId === criterionId);
      const contradictory: boolean = Boolean(previous && previous.verdict !== verdict && previous.verdict !== "unknown" && verdict !== "unknown");
      const next: InspectionCriterionResult = contradictory
        ? { criterionId, verdict: "unknown" as const, evidenceRefs: [...new Set([...previous!.evidenceRefs, ...evidenceRefs])].sort(), reason: `Contradictory inspection verdicts: ${previous!.verdict} and ${verdict}.` }
        : { criterionId, verdict, evidenceRefs, ...(item.reason ? { reason: normalize(item.reason) } : {}) };
      region.criterionVerdicts = region.criterionVerdicts.filter((entry) => entry.criterionId !== criterionId).concat(next);
      if (next.verdict === "satisfied" || next.verdict === "unsatisfied") closed.add(criterionId);
    }
    region.inspectionObligationIds = region.inspectionObligationIds.filter((id) => !closed.has(id));
    region.progress.inspectionNoProgress = { count: 0, fingerprint: inspectionProgressFingerprint(network, region), unresolvedCriterionIds: [...region.inspectionObligationIds] };
    changed = true;
  }
  if (activation.capability === "inspect" && delta.decisionBoundary) {
    network = admitDecisionBoundary(network, region.id, resolveDecisionBoundaryEvidence(delta.decisionBoundary, localEvidence));
    region = network.regions.find((item) => item.id === activation.regionId)!;
    changed = true;
  }
  if (activation.capability === "inspect" && region.edge === "root" && delta.taskDispositions?.length) {
    network.taskDispositions = delta.taskDispositions.map((item) => ({ ...item, key: slug(item.key), request: normalize(item.request), reason: normalize(item.reason), evidenceRefs: [...new Set(item.evidenceRefs.map((ref) => localEvidence.get(ref) ?? ref))].sort() }));
    changed = true;
  }
  for (const declaration of delta.variables ?? []) {
    const name = slug(declaration.name);
    if (!name || name === "task" || network.variables.some((item) => !item.historical && item.name === name)) continue;
    const seedLabels: string[] = [];
    for (const raw of declaration.seedLabels ?? []) {
      const label = normalize(raw);
      if (!label || seedLabels.some((existing) => slug(existing) === slug(label))) continue;
      seedLabels.push(label);
    }
    network.variables.push({ id: `v${network.nextVariableId++}`, name, ownerRegionId: region.id, seedLabels });
    changed = true;
  }
  if (activation.capability === "inspect" && delta.certifiedVerdict) {
    const evidenceIds = delta.certifiedVerdict.evidenceRefs.map((ref) => localEvidence.get(ref) ?? ref).filter((ref) => network.evidence.some((item) => item.id === ref));
    const id = candidateId(region.id, "certified-verdict");
    const candidate: SolutionCandidate = { id, regionId: region.id, key: "certified-verdict", proposition: normalize(delta.certifiedVerdict.proposition), status: "selected", declaredStatus: "selected", evidenceIds, declaredEvidenceIds: evidenceIds, eliminationReasons: [], declaredEliminationReasons: [], stances: [], createdRevision: network.revision + 1, sourceActivationId: activation.id };
    network.candidates = network.candidates.filter((item) => item.regionId !== region.id).concat(candidate);
    region.candidateIds = [id]; region.selectedCandidateIds = [id]; region.mutationResources = [...new Set(delta.certifiedVerdict.mutationResources)].sort();
    region.certifiedLeaf = { criterionIds: [...region.criterionIds], requirementIds: [...(region.requirementIds ?? [])], implementationScope: normalize(delta.certifiedVerdict.implementationScope), evidenceRefs: evidenceIds, mutationResources: [...region.mutationResources], checks: delta.certifiedVerdict.checks.map((check) => ({ criterionId: region.criterionIds[check.criterionIndex]!, commandOrObservation: normalize(check.commandOrObservation) })) };
    region.enumerationFingerprint = enumerationFingerprint(network, region.id); region.boundDomainFingerprint = boundDomainFingerprint(network, region.id); region.domainFingerprint = region.boundDomainFingerprint; region.acceptedFingerprint = region.boundDomainFingerprint; region.challengeVerdict = "accept";
    transitionRegion(region, "selected", undefined, "actionable");
    changed = true;
  }
  if (activation.capability === "inspect" && delta.alreadySatisfied) {
    const evidenceIds = [...new Set(delta.alreadySatisfied.criterionEvidence.flatMap((item) => item.evidenceRefs).map((ref) => localEvidence.get(ref) ?? ref).filter((ref) => network.evidence.some((item) => item.id === ref)))].sort();
    const id = candidateId(region.id, "already-satisfied");
    const candidate: SolutionCandidate = { id, regionId: region.id, key: "already-satisfied", proposition: normalize(delta.alreadySatisfied.proposition), status: "selected", declaredStatus: "selected", evidenceIds, declaredEvidenceIds: evidenceIds, eliminationReasons: [], declaredEliminationReasons: [], stances: [], createdRevision: network.revision + 1, sourceActivationId: activation.id };
    network.candidates = network.candidates.filter((item) => item.regionId !== region.id).concat(candidate);
    region.candidateIds = [id]; region.selectedCandidateIds = [id]; region.mutationResources = [...new Set(delta.alreadySatisfied.verificationResources)].sort();
    region.certifiedLeaf = { criterionIds: [...region.criterionIds], requirementIds: [...(region.requirementIds ?? [])], implementationScope: "Verify the already-satisfied repository state.", evidenceRefs: evidenceIds, mutationResources: [...region.mutationResources], checks: delta.alreadySatisfied.criterionEvidence.map((item) => ({ criterionId: region.criterionIds[item.criterionIndex]!, commandOrObservation: `Verify criterion #${item.criterionIndex + 1} against current repository state.` })) };
    region.implementationPremiseRefs = evidenceIds;
    region.enumerationFingerprint = enumerationFingerprint(network, region.id); region.boundDomainFingerprint = boundDomainFingerprint(network, region.id); region.domainFingerprint = region.boundDomainFingerprint; region.acceptedFingerprint = region.boundDomainFingerprint; region.challengeVerdict = "accept";
    transitionRegion(region, "selected", undefined, "implemented");
    changed = true;
  }
  const incomingCandidateIds = new Set<string>();
  for (const item of resolvedAnswer ? [] : delta.candidates) {
    const id = candidateId(region.id, item.key);
    if (incomingCandidateIds.has(id)) throw new Error(`Alternative "${item.key}" duplicates another candidate key in the same result.`);
    incomingCandidateIds.add(id);
  }
  for (const item of resolvedAnswer ? [] : delta.candidates) {
    const id = candidateId(region.id, item.key);
    let candidate = network.candidates.find((existing) => existing.id === id && !existing.historical);
    const evidenceIds = item.evidenceRefs.map((ref) => localEvidence.get(ref) ?? ref).filter((ref) => network.evidence.some((evidence) => evidence.id === ref));
    const stances = resolveStances(network, region.id, item.stances ?? []);
    const signature = candidateSignature(item.proposition, stances);
    const duplicate = network.candidates.find((existing) => !existing.historical && existing.regionId === region.id && existing.id !== id && candidateSignature(existing.proposition, existing.stances ?? []) === signature);
    if (duplicate) throw new Error(`Alternative "${item.key}" duplicates established candidate "${duplicate.key}" by structured decision stance. Reuse the established candidate key.`);
    // Legacy deltas can describe candidates, but cannot leave a latent commitment for a later acceptance to resurrect.
    const authoredStatus = item.outcome === "eliminated" || item.outcome === "selected" ? "possible" : item.outcome;
    if (!candidate) {
      candidate = network.candidates.find((existing) => existing.id === id && existing.historical);
    }
    if (!candidate) {
      candidate = { id, regionId: region.id, key: item.key, proposition: normalize(item.proposition), status: authoredStatus, declaredStatus: authoredStatus, evidenceIds, declaredEvidenceIds: evidenceIds, eliminationReasons: [], declaredEliminationReasons: [], stances, createdRevision: network.revision + 1, sourceActivationId: activation.id };
      network.candidates.push(candidate); region.candidateIds.push(id); changed = true;
    } else {
      const serialized = JSON.stringify(candidate);
      const historical = candidate.historical;
      candidate.historical = undefined; candidate.proposition = normalize(item.proposition); candidate.status = authoredStatus; candidate.declaredStatus = authoredStatus; candidate.evidenceIds = historical ? evidenceIds : [...new Set([...candidate.evidenceIds, ...evidenceIds])]; candidate.declaredEvidenceIds = [...candidate.evidenceIds]; candidate.eliminationReasons = []; candidate.declaredEliminationReasons = []; candidate.stances = stances; candidate.createdRevision = network.revision + 1; candidate.sourceActivationId = activation.id;
      if (!region.candidateIds.includes(id)) region.candidateIds.push(id);
      if (JSON.stringify(candidate) !== serialized) changed = true;
    }
  }
  if (resolvedAnswer) {
    region.delivery = "answer";
    region.answer = normalize(resolvedAnswer.answer);
    region.acceptanceCriteria = [...new Set(resolvedAnswer.acceptanceCriteria.map(normalize).filter(Boolean))];
    region.criterionIds = region.acceptanceCriteria.map((_, index) => `criterion:${region.scopeId}:${index}` as const);
    const id = candidateId(region.id, "resolved-answer");
    const evidenceIds = resolvedAnswer.evidenceRefs
      .map((ref) => localEvidence.get(ref) ?? ref)
      .filter((ref) => network.evidence.some((evidence) => evidence.id === ref));
    let candidate = network.candidates.find((item) => item.id === id && !item.historical) ?? network.candidates.find((item) => item.id === id && item.historical);
    if (!candidate) {
      candidate = { id, regionId: region.id, key: "resolved-answer", proposition: region.answer, status: "selected", declaredStatus: "selected", evidenceIds, declaredEvidenceIds: evidenceIds, eliminationReasons: [], declaredEliminationReasons: [], stances: [], createdRevision: network.revision + 1, sourceActivationId: activation.id };
      network.candidates.push(candidate);
      region.candidateIds.push(id);
    } else {
      const historical = candidate.historical;
      candidate.historical = undefined;
      candidate.proposition = region.answer;
      candidate.status = "selected";
      candidate.declaredStatus = "selected";
      candidate.evidenceIds = historical ? evidenceIds : [...new Set([...candidate.evidenceIds, ...evidenceIds])];
      candidate.declaredEvidenceIds = [...candidate.evidenceIds];
      candidate.createdRevision = network.revision + 1;
      candidate.sourceActivationId = activation.id;
      if (!region.candidateIds.includes(id)) region.candidateIds.push(id);
    }
    for (const other of network.candidates.filter((item) => item.regionId === region.id && item.id !== id && item.status === "selected")) { other.status = "possible"; other.declaredStatus = "possible"; }
    region.selectedCandidateIds = [id];
    addArtifact(network, region, activation.id, { kind: "answer", summary: region.answer });
    transitionRegion(region, "selected", undefined, "implemented");
    changed = true;
  }
  for (const item of resolvedAnswer ? [] : delta.constraints) {
    if (!["requires", "excludes", "supports", "refutes", "equivalent"].includes(item.kind)) throw new Error(`Unknown constraint kind "${String(item.kind)}".`);
    const coordinate = coordinateOf(network, item.target);
    const subject = localEvidence.get(item.subject) ?? candidateRef(network, region.id, item.subject); const target = localEvidence.get(item.target) ?? (coordinate ? `${coordinate.variableId}:${coordinate.valueLabel}` : candidateRef(network, region.id, item.target));
    if (!knownRef(network, subject) || !knownRef(network, target)) throw new Error(`Constraint ${item.kind} cites unknown endpoint(s): ${item.subject} -> ${item.target}.`);
    const evidenceRefs = [...new Set((item.evidenceRefs ?? []).map((ref) => localEvidence.get(ref) ?? ref).filter((ref) => ref === "task" || network.evidence.some((evidence) => evidence.id === ref)))];
    const incomingSourceKind = item.sourceKind ?? "model-inference";
    const candidatePair = network.candidates.some((candidate) => !candidate.historical && candidate.id === subject) && network.candidates.some((candidate) => !candidate.historical && candidate.id === target);
    const symmetric = candidatePair && (item.kind === "excludes" || item.kind === "equivalent");
    const [identitySubject, identityTarget] = symmetric && subject.localeCompare(target) > 0 ? [target, subject] : [subject, target];
    const existing = network.constraints.find((constraint) => {
      if (constraint.historical) return false;
      if (constraint.kind !== item.kind) return false;
      const existingCandidatePair = network.candidates.some((candidate) => candidate.id === constraint.subject) && network.candidates.some((candidate) => candidate.id === constraint.target);
      const existingSymmetric = existingCandidatePair && (constraint.kind === "excludes" || constraint.kind === "equivalent");
      const [left, right] = existingSymmetric && constraint.subject.localeCompare(constraint.target) > 0 ? [constraint.target, constraint.subject] : [constraint.subject, constraint.target];
      return left === identitySubject && right === identityTarget;
    });
    if (existing) {
      const mergedEvidenceRefs = [...new Set([...existing.evidenceRefs, ...evidenceRefs])].sort();
      const mergedReason = [normalize(existing.reason), normalize(item.reason)].filter(Boolean).sort()[0] ?? "";
      const provenanceRank: Record<SolutionConstraint["sourceKind"], number> = { "model-inference": 0, "repo-evidence": 1, "user-task": 2 };
      const existingSourceKind = existing.sourceKind ?? "model-inference";
      const mergedSourceKind = provenanceRank[incomingSourceKind] > provenanceRank[existingSourceKind] ? incomingSourceKind : existingSourceKind;
      if (existing.evidenceRefs.join("\0") !== mergedEvidenceRefs.join("\0") || existing.reason !== mergedReason || existing.sourceKind !== mergedSourceKind) {
        existing.evidenceRefs = mergedEvidenceRefs;
        existing.reason = mergedReason;
        existing.sourceKind = mergedSourceKind;
        changed = true;
      }
      if (!region.constraintIds.includes(existing.id)) region.constraintIds.push(existing.id);
      continue;
    }
    const constraint = { ...item, subject, target, reason: normalize(item.reason), id: `c${network.nextConstraintId++}`, sourceActivationId: activation.id, sourceKind: incomingSourceKind, evidenceRefs, createdRevision: network.revision + 1 };
    network.constraints.push(constraint); region.constraintIds.push(constraint.id); changed = true;
  }
  if (region.delivery === "answer" && delta.answer && delta.answer !== region.answer) { region.answer = normalize(delta.answer); changed = true; }
  let permitFollowup = true;
  if (activation.capability === "inspect" && delta.activations.some((request) => request.capability === "inspect")) {
    const fingerprint = inspectionProgressFingerprint(network, region);
    const ledger = region.progress.inspectionNoProgress;
    if (fingerprint !== inspectionBefore) region.progress.inspectionNoProgress = { count: 0, fingerprint, unresolvedCriterionIds: [...(region.inspectionObligationIds ?? region.criterionIds)] };
    else {
      ledger.count += 1;
      ledger.fingerprint = fingerprint;
      ledger.unresolvedCriterionIds = [...(region.inspectionObligationIds ?? region.criterionIds)];
      if (ledger.count >= MAX_NO_PROGRESS_CYCLES) {
        transitionRegion(region, "blocked", `Inspection for ${region.id} made no semantic progress for two consecutive follow-up requests; fingerprint=${fingerprint}; unresolvedCriterionIds=${ledger.unresolvedCriterionIds.join(",") || "none"}.`);
        permitFollowup = false;
        changed = true;
      }
    }
  }
  if (permitFollowup) for (const request of delta.activations) if (addActivation(network, { ...request, regionId: request.regionId ?? region.id, contextRefs: request.contextRefs, senderActivationId: activation.id })) changed = true;
  if (activation.capability === "inspect" && !delta.certifiedVerdict && !delta.taskScopes?.length && !resolvedAnswer && changed) {
    const phase = delta.decisionBoundary ? "ungenerated" : region.candidateIds.length ? "challenging" : "inspecting";
    if (region.domainPhase !== phase || region.status === "unformed") transitionRegion(region, phase, undefined, region.status === "unformed" ? "superposed" : undefined);
  }
  assertAcyclicPrimalGraph(network);
  if (changed && network.revision === state.network.revision) network.revision++;
  return propagateNetwork(network);
}

export function validateRefinementOutput(state: SolutionLodState, regionId: string, output: RefinementOutput): void {
  const region = state.network.regions.find((item) => item.id === regionId);
  if (!region) return;
  rejectUnrequestedDeferredWork(state, [output.outcome === "leaf" ? output.certifiedLeaf.implementationScope : undefined, ...(output.outcome === "children" ? output.children.flatMap((item) => [item.objective, ...item.acceptanceCriteria]) : [])]);
  if (output.evidence.some((item) => item.kind !== "inference")) throw new Error("Refinement is tool-free and cannot create confirmed repository/tool/user evidence. Reuse supplied facts or request one specific inspection.");
  // Degenerate case: an unauthored criteria list leaves one anonymous implicit criterion.
  // Any child then trivially addresses position 0 — normalize silently instead of demanding
  // impossible mappings, but keep genuine coverage errors loud for authored lists.
  const authoredCount = region.acceptanceCriteria.length;
  const criteriaCount = Math.max(authoredCount, 1);
  const inRange = (value: number) => Number.isInteger(value) && value >= 0 && value < criteriaCount;
  if (output.outcome === "boundary") { admitDecisionBoundary(state.network, regionId, output.decisionBoundary); return; }
  if (output.outcome === "need-fact") {
    for (const ref of output.inspection.contextRefs) if (!knownRef(state.network, ref)) throw new Error(`Refinement inspection request cites unknown context reference ${ref}.`);
    return;
  }
  if (output.outcome === "leaf") {
    if (/\b(?:estimate|later|defer(?:red)?|follow-up)\b/i.test(output.certifiedLeaf.implementationScope)) throw new Error("A certified leaf must name bounded implementable work, not an estimate or deferred follow-up.");
    if (JSON.stringify([...new Set(output.certifiedLeaf.criterionIds)].sort()) !== JSON.stringify([...region.criterionIds].sort())) throw new Error("A certified leaf must own every exact current criterion ID and no others.");
    if (!exactSet(output.certifiedLeaf.requirementIds ?? [], region.requirementIds ?? [])) throw new Error("A certified leaf must close every exact current material requirement ID and no others.");
    const checkIds = output.certifiedLeaf.checks.map((check) => check.criterionId);
    if (new Set(checkIds).size !== checkIds.length || JSON.stringify([...checkIds].sort()) !== JSON.stringify([...region.criterionIds].sort())) throw new Error("A certified leaf requires exactly one executable check witness per criterion ID.");
    if (region.delivery === "change" && !output.certifiedLeaf.mutationResources.length) throw new Error("A change-delivery certified leaf requires at least one bounded mutation resource path.");
    if (output.certifiedLeaf.mutationResources.some((resource) => !normalize(resource))) throw new Error("A certified leaf cannot contain an empty mutation resource path.");
    for (const resource of output.certifiedLeaf.mutationResources) {
      const childPath = mutationPath(resource);
      if (region.mutationResources?.length && !region.mutationResources.some((parent) => pathWithin(childPath, mutationPath(parent)))) throw new Error(`Certified leaf mutation resource ${resource} is outside its parent scope.`);
    }
    for (const ref of output.certifiedLeaf.evidenceRefs) if (!knownRef(state.network, ref) || !isConfirmedEvidence(state.network, ref)) throw new Error(`Certified leaf cites unresolved or stale evidence reference ${ref}.`);
    if (!exactSet(output.atomicityWitness.criterionIds, output.certifiedLeaf.criterionIds)) throw new Error("A leaf atomicity witness must cover every exact certified criterion ID and no others.");
    if (!exactSet(output.atomicityWitness.requirementIds, output.certifiedLeaf.requirementIds ?? [])) throw new Error("A leaf atomicity witness must cover every exact certified material requirement ID and no others.");
    if (!exactSet(output.atomicityWitness.mutationResources.map(normalize), output.certifiedLeaf.mutationResources.map(normalize))) throw new Error("A leaf atomicity witness must cover every exact certified mutation resource and no others.");
    return;
  }
  if (output.outcome !== "children") return assertNever(output);
  const criterionOwners = new Map(Array.from({ length: criteriaCount }, (_, index) => [index, 0]));
  const seenKeys = new Set<string>();
  const requirementOwners = new Map((region.requirementIds ?? []).map((id) => [id, 0]));
  const knownScopes = new Set(state.network.regions.map((item) => item.scopeId));
  const proposedScopes = new Set(output.children.map((item) => `scope:${region.id}:${normalize(item.key)}`));
  const ancestorScopes = new Set<ScopeId>();
  for (let ancestor: SolutionRegion | undefined = region; ancestor; ancestor = ancestor.parentId ? state.network.regions.find((item) => item.id === ancestor!.parentId) : undefined) ancestorScopes.add(ancestor.scopeId);
  for (const child of output.children) {
    const key = normalize(child.key);
    if (seenKeys.has(key)) throw new Error(`Two children share the name "${child.key}". Give each child a distinct stable name.`);
    seenKeys.add(key);
    if (!child.acceptanceCriteria.length)
      throw new Error(`Child "${child.key}" carries no success criterion of its own. Give every child at least one observable condition that proves it is done, so the scheduler can tell whether it needs further splitting.`);
    const normalizedCovered = authoredCount === 0 && child.coveredCriteria.length === 0 ? [0] : child.coveredCriteria;
    if (!normalizedCovered.length || !normalizedCovered.every(inRange))
      throw new Error(`Child "${child.key}" does not address any known success criterion. Link it to at least one criterion position of the parent — valid positions here: 0..${criteriaCount - 1}${region.acceptanceCriteria.map((criterion, index) => `; ${index}: ${criterion}`).join("")}.`);
    for (const index of new Set(normalizedCovered)) criterionOwners.set(index, criterionOwners.get(index)! + 1);
    for (const requirementId of child.requirementIds ?? []) {
      if (!requirementOwners.has(requirementId as RequirementId)) throw new Error(`Child "${child.key}" cites requirement ${requirementId} outside its parent scope.`);
      requirementOwners.set(requirementId as RequirementId, requirementOwners.get(requirementId as RequirementId)! + 1);
    }
    for (const dependency of child.dependencyScopeIds ?? []) {
      if (ancestorScopes.has(dependency as ScopeId)) throw new Error(`Child "${child.key}" cannot depend on ancestor scope ${dependency}; that scope cannot complete until this child completes.`);
      if (!knownScopes.has(dependency as ScopeId) && !proposedScopes.has(dependency)) throw new Error(`Child "${child.key}" cites unknown semantic dependency ${dependency}.`);
    }
    if (child.mutationResources?.some((resource) => !normalize(resource))) throw new Error(`Child "${child.key}" has an empty mutation resource path.`);
    const boundary = hash({ delivery: child.delivery ?? region.delivery, objective: propositionSignature(child.objective), criteria: child.acceptanceCriteria.map(propositionSignature).sort(), variables: child.allowedVariables.map(slug).sort(), requirements: [...(child.requirementIds ?? [])].sort(), resources: [...(child.mutationResources ?? [])].map(normalize).sort() });
    for (let ancestor: SolutionRegion | undefined = region; ancestor; ancestor = ancestor.parentId ? state.network.regions.find((item) => item.id === ancestor!.parentId) : undefined) {
      const ancestorBoundary = hash({ delivery: ancestor.delivery, objective: propositionSignature(ancestor.objective), criteria: ancestor.acceptanceCriteria.map(propositionSignature).sort(), variables: ancestor.allowedVariables.map(slug).sort(), requirements: [...(ancestor.requirementIds ?? [])].sort(), resources: [...(ancestor.mutationResources ?? [])].map(normalize).sort() });
      if (boundary === ancestorBoundary) throw new Error(`Child "${child.key}" repeats ancestor boundary ${ancestor.id}. Return certifiedLeaf for atomic work or identify a genuinely narrower decision/deliverable boundary.`);
    }
  }
  const missing = [...criterionOwners].filter(([, count]) => count === 0).map(([index]) => index);
  if (missing.length)
    throw new Error(`The children do not collectively cover the parent success criteria: no child addresses criterion position(s) ${missing.join(", ")}. Add or extend a child so every criterion is covered.`);
  const uncoveredRequirements = [...requirementOwners].filter(([, count]) => count === 0);
  if (uncoveredRequirements.length) throw new Error(`Every material requirement must be covered by at least one child: ${uncoveredRequirements.map(([id]) => id).join(", ")}.`);
  const overlappingRequirements = [...requirementOwners].filter(([, count]) => count > 1);
  if (overlappingRequirements.length) throw new Error(`Material requirement IDs must remain uniquely owned; sibling scopes overlap at ${overlappingRequirements.map(([id]) => id).join(", ")}.`);
  const parentResources = (region.mutationResources ?? []).map(mutationPath);
  for (const child of output.children) if ((child.delivery ?? region.delivery) === "change" && parentResources.length && !child.mutationResources?.length) throw new Error(`Child "${child.key}" must retain explicit mutation resources within its bounded parent scope.`);
  for (const child of output.children) for (const rawResource of child.mutationResources ?? []) {
    const resource = mutationPath(rawResource);
    if (parentResources.length && !parentResources.some((parent) => pathWithin(resource, parent))) throw new Error(`Child "${child.key}" cites mutation resource ${rawResource} outside its parent scope.`);
  }
  const parentMeasure = [criteriaCount, region.requirementIds?.length ?? 0, region.mutationResources?.length ?? 0, new Set(region.allowedVariables.map(slug)).size];
  const parentVariables = new Set(region.allowedVariables.map(slug));
  for (const child of output.children) {
    const childMeasure = [new Set(authoredCount === 0 && child.coveredCriteria.length === 0 ? [0] : child.coveredCriteria).size, new Set(child.requirementIds ?? []).size, region.mutationResources?.length ? new Set(child.mutationResources ?? []).size : 0, new Set(child.allowedVariables.map(slug).filter((variable) => parentVariables.has(variable))).size];
    if (!childMeasure.some((value, index) => value < parentMeasure[index]!)) throw new Error(`Child "${child.key}" does not strictly decrease an inherited refinement dimension; reject restatement or wrapper decomposition.`);
  }
  assertAcyclicScopeDependencies(state.network, output.children.map((child) => ({ scopeId: `scope:${region.id}:${normalize(child.key)}` as ScopeId, dependencyScopeIds: [...new Set(child.dependencyScopeIds ?? [])] as ScopeId[] })));
  for (const child of output.children) {
    if (child.edge === "refines") {
      const unresolved = slug(child.unresolvedVariable ?? "");
      if (!unresolved || !region.allowedVariables.some((variable) => slug(variable) === unresolved)) throw new Error(`Refines child "${child.key}" must name one exact unresolved allowed variable from its parent boundary.`);
      const variable = state.network.variables.find((item) => item.name === unresolved && !item.historical);
      if (variable) {
        const selectedLabels = new Set(state.network.candidates.filter((candidate) => region.selectedCandidateIds.includes(candidate.id)).flatMap((candidate) => candidate.stances.filter((stance) => stance.variableId === variable.id && stance.relation === "requires").map((stance) => slug(stance.valueLabel))));
        if (selectedLabels.size === 1) throw new Error(`Refines child "${child.key}" cites already-settled variable ${child.unresolvedVariable}.`);
      }
    } else {
      if (child.unresolvedVariable) throw new Error(`partOf child "${child.key}" cannot claim an unresolved decision variable.`);
      if (!region.requirementIds?.length && output.children.length < 2) throw new Error(`A lone partOf child does not partition independent work. Return certifiedLeaf for atomic work.`);
    }
  }
}

export function validateImplementationOutput(state: SolutionLodState, regionId: string, output: ImplementationOutput): void {
  const region = state.network.regions.find((item) => item.id === regionId);
  if (!region) throw new Error(`Unknown implementation region ${regionId}`);
  rejectUnrequestedDeferredWork(state, [output.summary, output.outcome === "blocked" ? output.blocker : undefined]);
  if (region.delivery === "change" && (!region.certifiedLeaf || !hasSelectedImplementationFamily(state.network, region))) throw new Error(`Implementation requires one accepted selected implementation family and a certified leaf contract for ${regionId}.`);
  if (region.certifiedLeaf && !exactSet(region.certifiedLeaf.requirementIds ?? [], region.requirementIds ?? [])) throw new Error(`Implementation requires exact material requirement closure for ${regionId}.`);
  if (output.outcome === "blocked") {
    if (!normalize(output.blocker ?? output.summary)) throw new Error("A blocked implementation must name the concrete missing fact or conflict.");
    return;
  }
  if (!output.checks.length) throw new Error("Implementation completion requires at least one focused check with observable evidence.");
  const failed = output.checks.filter((check) => !check.passed);
  if (failed.length) throw new Error(`Implementation cannot complete while checks fail: ${failed.map((item) => item.name).join(", ")}.`);
  if (output.checks.some((check) => !normalize(check.evidence))) throw new Error("Every implementation check must include observable evidence.");
  if (taskReferencesTodo(state.network.authority.task.exactText) && !normalize(output.todoDisposition ?? "")) throw new Error("A task that references TODO requires explicit TODO disposition evidence.");
}

export function validateVerificationOutput(state: SolutionLodState, regionId: string, output: VerificationOutput): void {
  const region = state.network.regions.find((item) => item.id === regionId);
  if (!region) throw new Error(`Unknown verification region ${regionId}`);
  rejectUnrequestedDeferredWork(state, [output.summary, ...output.findings.map((item) => item.problem)]);
  const live = new Map(state.network.regions.map((item) => [item.id, item]));
  const findingKeys = new Set<string>();
  const checks = output.checks.map((check) => ({ ...check, disposition: check.disposition ?? "criterion-gating" as const, criterionIds: check.criterionIds ?? [], baselineEvidenceRefs: check.baselineEvidenceRefs ?? [], requiredEvidence: check.requiredEvidence ?? [] }));
  const gatingChecks = checks.filter((check) => check.disposition === "criterion-gating" || check.disposition === "release-gating");
  for (const check of checks) {
    if (!normalize(check.evidence)) throw new Error("Every verification check requires observable evidence.");
    if (check.criterionIds.some((id) => !region.criterionIds.includes(id as CriterionId))) throw new Error(`Verification check ${check.name} cites a criterion outside ${regionId}.`);
    if (check.disposition === "criterion-gating" && check.criterionIds.length > 1) throw new Error("A criterion-gating check may own at most one exact criterion.");
    if (check.disposition === "release-gating" && check.criterionIds.length) throw new Error("A release-gating check must not impersonate a criterion check.");
    if (check.disposition === "preexisting" && (!normalize(check.reason ?? "") || !check.baselineEvidenceRefs.length || check.baselineEvidenceRefs.some((ref) => !isConfirmedEvidence(state.network, ref)))) throw new Error("A preexisting check failure requires a reason and confirmed baseline evidence.");
    if (check.disposition === "out-of-scope" && (!normalize(check.reason ?? "") || check.criterionIds.length)) throw new Error("An out-of-scope check requires a reason and cannot own a current criterion.");
    if (check.disposition === "environmental" && (check.passed || !normalize(check.resolutionOwner ?? "") || !check.requiredEvidence.length || output.outcome !== "fail")) throw new Error("An environmental check must fail with a resolution owner and required resume evidence under a fail verdict.");
  }
  for (const finding of output.findings) {
    const target = live.get(finding.regionId);
    if (!target) throw new Error(`Verification finding references missing region ${finding.regionId}.`);
    if (!target.criterionIds.includes(finding.criterionId as SolutionRegion["criterionIds"][number])) throw new Error(`Verification finding does not name an exact criterion identity of ${finding.regionId}: ${finding.criterionId}`);
    if (!normalize(finding.problem) || !normalize(finding.evidence)) throw new Error("Every verification finding requires a concrete problem and observed evidence.");
    const external = finding.target.kind === "environment" || finding.target.kind === "external";
    if (external && (!normalize(finding.resolutionOwner ?? "") || !finding.requiredEvidence?.length)) throw new Error("Environment and external findings require a resolution owner and required resume evidence.");
    if (output.outcome === "fail" && !external) throw new Error("A fail verdict is reserved for environment or external blockers.");
    if (external && output.outcome !== "fail") throw new Error("Environment and external findings must route through fail to controller-owned blocked-external.");
    if (output.outcome === "repair" && (finding.target.kind === "environment" || finding.target.kind === "external")) throw new Error("External findings have no graph-owned repair route.");
    if (output.outcome === "repair" && target.delivery === "change" && finding.target.kind !== "files") throw new Error("A local change repair finding must target one or more affected files.");
    if (output.outcome === "repair" && target.delivery === "answer" && finding.target.kind !== "answer") throw new Error("An answer repair finding must target the answer.");
    if (output.outcome === "reopen" && (!finding.invalidatedPremiseRefs?.length || finding.invalidatedPremiseRefs.some((ref) => !isConfirmedEvidence(state.network, ref)))) throw new Error("Reopening an earlier decision requires confirmed invalidated premise references.");
    const key = `${finding.regionId}\0${finding.criterionId}`;
    if (findingKeys.has(key)) throw new Error(`Verification contains multiple findings for the same exact criterion ${finding.criterionId}.`);
    findingKeys.add(key);
    if (output.outcome === "repair" && finding.regionId !== regionId) throw new Error("A repair verdict may target only the region being verified; use reopen for an earlier choice.");
  }
  if (output.outcome === "pass") {
    if (output.findings.length) throw new Error("A passing verification cannot contain defect findings.");
    if (!gatingChecks.length || gatingChecks.some((check) => !check.passed))
      throw new Error("Verification may pass only with passing checks containing observable evidence.");
    for (const [index, criterion] of region.acceptanceCriteria.entries()) {
      if (!gatingChecks.some((check) => check.disposition === "criterion-gating" && (check.criterionIds.includes(region.criterionIds[index]!) || !check.criterionIds.length && normalize(`${check.name} ${check.evidence}`).includes(normalize(criterion)))))
        throw new Error(`Verification pass has no criterion-specific evidence for: ${criterion}`);
    }
    const evidence = output.completionEvidence;
    if (evidence?.inspectionEvidenceRefs?.some((ref) => !isConfirmedEvidence(state.network, ref) && !state.network.artifacts.some((item) => item.id === ref && !item.historical && item.passed !== false))) throw new Error("Completion evidence references require confirmed inspection evidence or live non-failing artifacts.");
    if (region.delivery === "change" && !evidence) throw new Error("Verification pass requires deterministic implementation, direct-test, correctness-review, and release-gate completion evidence.");
    const measuredFiles = region.artifactIds.map((id) => state.network.artifacts.find((item) => item.id === id)).filter((item) => item?.kind === "file" && !item.historical).map((item) => item!.path!);
    if (region.delivery === "change") {
      const criterionIds = evidence!.criterionIds ?? region.criterionIds;
      const implementationOutcome = evidence!.implementationOutcome ?? (measuredFiles.length ? "changed" : "already-satisfied");
      if (JSON.stringify([...new Set(criterionIds)].sort()) !== JSON.stringify([...region.criterionIds].sort())) throw new Error("Verification must confirm every exact criterion identity.");
      if (evidence!.fullChecks.some((check) => !normalize(check))) throw new Error("Every configured release gate requires observable evidence.");
      if (taskReferencesTodo(state.network.authority.task.exactText) && !normalize(evidence!.todoDisposition ?? "")) throw new Error("A task that references TODO requires explicit TODO disposition evidence.");
      if (implementationOutcome === "changed" && (!measuredFiles.length || JSON.stringify([...new Set(evidence!.changedFiles)].sort()) !== JSON.stringify([...new Set(measuredFiles)].sort()))) throw new Error("Changed implementation evidence must exactly match non-empty measured implementation artifacts.");
      if (implementationOutcome === "already-satisfied" && (measuredFiles.length || evidence!.changedFiles.length || !evidence!.inspectionEvidenceRefs?.length || evidence!.inspectionEvidenceRefs.some((ref) => !isConfirmedEvidence(state.network, ref)))) throw new Error("Already-satisfied completion requires confirmed inspection evidence, no measured changes, and verifier confirmation of every criterion.");
    }
    const verifier = state.network.activations.findLast((item) => item.regionId === regionId && item.capability === "verify" && (item.status === "running" || item.status === "queued"));
    const unresolved = state.network.findings.filter((item) => item.regionId === regionId && region.criterionIds.includes(item.criterionId) && (item.status === "open" || item.status === "repairing"));
    if (unresolved.some((item) => item.status !== "repairing" || !verifier?.findingIds?.includes(item.id))) throw new Error("Verification pass must cite every repairing finding; open findings require a successful repair first.");
  } else if (!output.findings.length) throw new Error(`${output.outcome} verification requires at least one criterion-linked finding.`);
  if (gatingChecks.some((check) => !check.passed) && output.outcome === "pass") throw new Error("Failed criterion or release gates block completion.");
  for (const check of gatingChecks.filter((item) => !item.passed && item.criterionIds.length)) if (!output.findings.some((finding) => check.criterionIds.includes(finding.criterionId))) throw new Error(`Failed gating check ${check.name} requires a matching criterion finding.`);
  if (output.findings.some((finding) => finding.severity === "high") && output.outcome === "pass") throw new Error("High-severity review findings block completion.");
}

export function validatePresentationAnswer(state: SolutionLodState, regionId: string, answer: string): void {
  const region = state.network.regions.find((item) => item.id === regionId);
  if (!region || region.delivery !== "answer") throw new Error(`Unknown answer region ${regionId}.`);
  rejectUnrequestedDeferredWork(state, [answer]);
  if (!normalize(answer)) throw new Error("Presentation requires a non-empty answer.");
}

function retractRegion(network: SolutionNetwork, regionId: string): void {
  purgeDescendants(network, regionId);
  network.regions = network.regions.filter((item) => item.id !== regionId);
  network.candidates = network.candidates.map((item) => item.regionId === regionId ? { ...item, historical: true } : item);
  network.variables = network.variables.map((item) => item.ownerRegionId === regionId ? { ...item, historical: true } : item);
  network.artifacts = network.artifacts.map((item) => item.regionId === regionId ? { ...item, historical: true } : item);
  network.activations = network.activations.map((item) => item.regionId !== regionId ? item : { ...item, historical: true, status: item.status === "queued" || item.status === "running" ? "superseded" : item.status, error: item.error ?? `Historical activation: conditional region ${regionId} was retracted.` });
  const retired = new Set([...network.candidates.filter((item) => item.historical).map((item) => item.id), ...network.variables.filter((item) => item.historical).map((item) => item.id)]);
  network.constraints = network.constraints.map((item) => retired.has(item.subject) || retired.has(item.target) || [...retired].some((ref) => item.subject.startsWith(`${ref}:`) || item.target.startsWith(`${ref}:`)) ? { ...item, historical: true } : item);
}

function conditionalDefinition(definition: Extract<RefinementOutput, { outcome: "children" }>["children"][number]): string {
  return hash({ key: normalize(definition.key), objective: normalize(definition.objective), edge: definition.edge, delivery: definition.delivery, allowedVariables: [...definition.allowedVariables].map(normalize).sort(), acceptanceCriteria: [...definition.acceptanceCriteria].map(normalize), coveredCriteria: [...definition.coveredCriteria].sort((a, b) => a - b), requirementIds: [...(definition.requirementIds ?? [])].sort(), dependencyScopeIds: [...(definition.dependencyScopeIds ?? [])].sort(), mutationResources: [...(definition.mutationResources ?? [])].map(normalize).sort(), unresolvedVariable: definition.unresolvedVariable ? slug(definition.unresolvedVariable) : undefined });
}

function resetConditionalRegion(network: SolutionNetwork, region: SolutionRegion): void {
  purgeDescendants(network, region.id);
  network.candidates = network.candidates.map((item) => item.regionId === region.id ? { ...item, historical: true } : item);
  network.variables = network.variables.map((item) => item.ownerRegionId === region.id ? { ...item, historical: true } : item);
  network.artifacts = network.artifacts.map((item) => item.regionId === region.id ? { ...item, historical: true } : item);
  network.activations = network.activations.map((item) => item.regionId !== region.id ? item : { ...item, historical: true, status: item.status === "queued" || item.status === "running" ? "superseded" : item.status, error: item.error ?? `Historical activation: conditional definition for ${region.id} changed.` });
  const retired = new Set([...network.candidates.filter((item) => item.historical).map((item) => item.id), ...network.variables.filter((item) => item.historical).map((item) => item.id)]);
  network.constraints = network.constraints.map((item) => retired.has(item.subject) || retired.has(item.target) || [...retired].some((ref) => item.subject.startsWith(`${ref}:`) || item.target.startsWith(`${ref}:`)) ? { ...item, historical: true } : item);
  region.candidateIds = []; region.selectedCandidateIds = []; region.constraintIds = []; region.evidenceIds = []; region.activationIds = []; region.artifactIds = [];
  region.acceptedFingerprint = null; region.enumerationFingerprint = null; region.boundDomainFingerprint = null; region.domainFingerprint = null; region.decisionBoundary = undefined; region.challengeVerdict = null; region.certifiedLeaf = undefined; clearImplementationContinuation(region); region.answer = undefined; region.progress = emptyProgress(); region.convergenceCycles = undefined;
  region.inspectionAttempts = 0;
  transitionRegion(region, "inspecting", undefined, "unformed");
}

export function mergeRefinementOutput(networkInput: SolutionNetwork, activationId: string, output: RefinementOutput): SolutionNetwork {
  let network = cloneNetwork(networkInput);
  const activation = network.activations.find((item) => item.id === activationId);
  if (!activation) throw new Error(`Unknown activation ${activationId}`);
  let region = network.regions.find((item) => item.id === activation.regionId);
  if (!region) throw new Error(`Unknown activation region ${activation.regionId}`);
  activation.status = "completed";
  mergeEvidence(network, region, output.evidence, activation.id, undefined, "refine");
  if (output.outcome === "need-fact") {
    const request = output.inspection;
    transitionRegion(region, "inspecting", undefined, "superposed");
    addActivation(network, { capability: "inspect", ...request, regionId: region.id, senderActivationId: activation.id });
    network.revision++;
    return network;
  }
  if (output.outcome === "boundary") {
    network = admitDecisionBoundary(network, region.id, output.decisionBoundary);
    region = network.regions.find((item) => item.id === activation.regionId)!;
    transitionRegion(region, "ungenerated", undefined, "superposed");
    return network;
  }
  const parentSelection = region.selectedCandidateIds[0];
  if (output.outcome === "leaf") {
    region.certifiedLeaf = { criterionIds: [...output.certifiedLeaf.criterionIds] as CriterionId[], requirementIds: [...(output.certifiedLeaf.requirementIds ?? [])] as RequirementId[], implementationScope: normalize(output.certifiedLeaf.implementationScope), evidenceRefs: [...new Set(output.certifiedLeaf.evidenceRefs)], mutationResources: [...new Set(output.certifiedLeaf.mutationResources.map(normalize))].sort(), checks: output.certifiedLeaf.checks.map((check) => ({ criterionId: check.criterionId as CriterionId, commandOrObservation: normalize(check.commandOrObservation) })) };
    region.mutationResources = [...region.certifiedLeaf.mutationResources];
    transitionRegion(region, "selected", undefined, "actionable");
    network.revision++;
    return propagateNetwork(network);
  }
  if (output.outcome !== "children") return assertNever(output);
  const incomingKeys = new Set(output.children.map((item) => normalize(item.key)));
  for (const child of network.regions.filter((item) => item.parentId === region.id)) if (!incomingKeys.has(normalize(child.key))) retractRegion(network, child.id);
  for (const definition of output.children) {
    const key = normalize(definition.key);
    const existing = network.regions.find((item) => item.parentId === region.id && normalize(item.key) === key);
    // Mirror validation's degenerate-criteria normalization so stored children stay consistent.
    const coveredCriteria = region.acceptanceCriteria.length === 0 && definition.coveredCriteria.length === 0 ? [0] : [...definition.coveredCriteria];
    const definitionFingerprint = conditionalDefinition(definition);
    if (existing) {
      if (existing.definitionFingerprint !== definitionFingerprint) resetConditionalRegion(network, existing);
      existing.key = key; existing.objective = normalize(definition.objective); existing.edge = definition.edge; existing.delivery = definition.delivery ?? region.delivery; existing.allowedVariables = [...new Set(definition.allowedVariables.map(normalize).filter(Boolean))].sort(); existing.acceptanceCriteria = definition.acceptanceCriteria.map(normalize); existing.coveredCriteria = coveredCriteria.sort((a, b) => a - b); existing.criterionIds = definition.acceptanceCriteria.map((_, index) => `criterion:${existing.scopeId}:${index}` as const); existing.requirementIds = [...new Set(definition.requirementIds ?? [])].sort() as RequirementId[]; existing.dependencyScopeIds = [...new Set(definition.dependencyScopeIds ?? [])].sort() as ScopeId[]; existing.mutationResources = [...new Set((definition.mutationResources ?? []).map(normalize))].sort(); existing.definitionFingerprint = definitionFingerprint;
      continue;
    }
    network.regions.push({
      id: `r${network.nextRegionId++}`, key, parentId: region.id, parentCandidateId: parentSelection, edge: definition.edge,
      lod: region.lod + 1, objective: normalize(definition.objective), delivery: definition.delivery ?? region.delivery,
      allowedVariables: [...new Set(definition.allowedVariables.map(normalize).filter(Boolean))].sort(), acceptanceCriteria: definition.acceptanceCriteria.map(normalize), coveredCriteria: coveredCriteria.sort((a, b) => a - b),
      status: "unformed", progress: emptyProgress(), candidateIds: [], selectedCandidateIds: [], constraintIds: [], evidenceIds: [], activationIds: [], artifactIds: [], scopeId: `scope:${region.id}:${key}`, criterionIds: definition.acceptanceCriteria.map((_, index) => `criterion:${region.id}:${key}:${index}` as const), inspectionObligationIds: definition.acceptanceCriteria.map((_, index) => `criterion:${region.id}:${key}:${index}` as const), domainPhase: "inspecting", domainFingerprint: null, acceptedFingerprint: null, challengeVerdict: null, requirementIds: [...new Set(definition.requirementIds ?? [])].sort() as RequirementId[], dependencyScopeIds: [...new Set(definition.dependencyScopeIds ?? [])].sort() as ScopeId[], mutationResources: [...new Set((definition.mutationResources ?? []).map(normalize))].sort(), definitionFingerprint, selectionAge: 0,
    });
  }
  transitionRegion(region, "selected", undefined, "collapsed");
  network.revision++;
  return propagateNetwork(network);
}

export function queueActivation(networkInput: SolutionNetwork, capability: Capability, regionId: string, request: string, expectedDelta: string, contextRefs: string[] = [], findingIds: string[] = []): SolutionNetwork {
  const network = cloneNetwork(networkInput); addActivation(network, { capability, requiredCapabilities: [...DEFAULT_ACTIVATION_CAPABILITIES[capability]], regionId, request, expectedDelta, contextRefs, findingIds: [...new Set(findingIds)].sort() }); return network;
}

function queueSynthesis(networkInput: SolutionNetwork, operation: SynthesisOperation, regionId: string, request: string, expectedDelta: string, contextRefs: string[]): SolutionNetwork {
  const network = cloneNetwork(networkInput);
  const region = network.regions.find((item) => item.id === regionId);
  addActivation(network, { capability: "synthesize", requiredCapabilities: [...DEFAULT_ACTIVATION_CAPABILITIES.synthesize], operation, domainFingerprint: region?.boundDomainFingerprint, boundDomainFingerprint: region?.boundDomainFingerprint, regionId, request, expectedDelta, contextRefs });
  return network;
}

export function markActivation(networkInput: SolutionNetwork, activationId: string, status: Activation["status"], sessionId?: string, error?: string): SolutionNetwork {
  const network = cloneNetwork(networkInput); const activation = network.activations.find((item) => item.id === activationId); if (!activation) return network;
  if (status === "failed") for (const finding of network.findings.filter((item) => activation.findingIds?.includes(item.id) && item.status === "open")) if (!finding.repairActivationIds.includes(activationId)) finding.repairActivationIds.push(activationId);
  activation.status = status; activation.sessionId = sessionId ?? activation.sessionId; activation.error = error; return network;
}

export function setRegionStatus(networkInput: SolutionNetwork, regionId: string, status: SolutionRegion["status"]): SolutionNetwork {
  const network = cloneNetwork(networkInput); const region = network.regions.find((item) => item.id === regionId); if (region) transitionRegion(region, status === "blocked" || status === "stalled" ? "blocked" : region.domainPhase, region.blockedReason, status); return network;
}

function addArtifact(network: SolutionNetwork, region: SolutionRegion, activationId: string, artifact: Omit<SolutionNetwork["artifacts"][number], "id" | "regionId" | "activationId" | "fingerprint"> & { fingerprint?: string }): void {
  const fingerprint = artifact.fingerprint ?? hash({ kind: artifact.kind, path: artifact.path, summary: normalize(artifact.summary), passed: artifact.passed, checkKind: artifact.checkKind });
  const item = { ...artifact, fingerprint, id: `x${network.nextArtifactId++}`, regionId: region.id, activationId, createdRevision: network.revision + 1 };
  network.artifacts.push(item); region.artifactIds.push(item.id);
}

export function completeImplementation(networkInput: SolutionNetwork, activationId: string, output: ImplementationOutput, actualChangedFiles: string[], changedFileFingerprints: Readonly<Record<string, string>> = {}, baselineFingerprint = "legacy-live-worktree"): SolutionNetwork {
  let network = cloneNetwork(networkInput); const activation = network.activations.find((item) => item.id === activationId); const region = network.regions.find((item) => item.id === activation?.regionId);
  if (!activation || !region) return network;
  for (const finding of network.findings.filter((item) => activation.findingIds?.includes(item.id) && item.status === "open")) if (!finding.repairActivationIds.includes(activationId)) finding.repairActivationIds.push(activationId);
  if (output.outcome === "completed" && !actualChangedFiles.length) {
    activation.status = "failed";
    activation.error = "Implementation rejected: no measured workspace change.";
    transitionRegion(region, "selected", "A change task cannot complete without a measured workspace-change artifact.", "actionable");
    network.revision++;
    return network;
  }
  if (output.outcome === "already-satisfied" && actualChangedFiles.length) {
    activation.status = "failed";
    activation.error = "Implementation rejected: already-satisfied output conflicts with a measured workspace change.";
    transitionRegion(region, "blocked", activation.error, "blocked");
    network.revision++;
    return network;
  }
  const allowed = [...new Set((region.certifiedLeaf?.mutationResources ?? region.mutationResources ?? []).map(normalizeMutationPath).filter(Boolean))];
  const outsideScope = actualChangedFiles.map(normalizeMutationPath).filter((file) => !allowed.some((resource) => file === resource || file.startsWith(`${resource}/`)));
  if (outsideScope.length) {
    for (const file of [...new Set(actualChangedFiles)]) addArtifact(network, region, activationId, { kind: "file", path: file, summary: `Changed ${file}`, fingerprint: changedFileFingerprints[file] ?? hash({ kind: "file", path: file, summary: `Changed ${file}` }) });
    activation.status = "failed";
    activation.error = `Implementation changed files outside the certified mutation scope: ${outsideScope.join(", ")}.`;
    transitionRegion(region, "blocked", activation.error, "blocked");
    network.revision++;
    return network;
  }
  activation.status = "completed";
  const repairedVerificationIds = new Set(network.findings.filter((item) => activation.findingIds?.includes(item.id)).map((item) => item.sourceActivationId));
  if (output.outcome !== "blocked" && activation.findingIds?.length) for (const artifact of network.artifacts) {
    const producer = network.activations.find((item) => item.id === artifact.activationId)?.capability;
    if (artifact.regionId === region.id && !artifact.historical && (producer === "implement" || producer === "present" || repairedVerificationIds.has(artifact.activationId))) artifact.historical = true;
  }
  region.implementationPremiseRefs = [...new Set([...(activation.readRefs ?? []).filter((ref) => ref.kind === "evidence").map((ref) => ref.ref), ...(region.certifiedLeaf?.evidenceRefs ?? [])])].sort();
  region.verificationPremiseRefs = undefined;
  for (const file of [...new Set(actualChangedFiles)]) addArtifact(network, region, activationId, { kind: "file", path: file, summary: `Changed ${file}`, fingerprint: changedFileFingerprints[file] ?? hash({ kind: "file", path: file, summary: `Changed ${file}` }) });
  for (const check of output.checks) addArtifact(network, region, activationId, { kind: "check", checkKind: "focused", summary: `${check.name}: ${check.evidence}`, passed: check.passed });
  switch (output.outcome) {
  case "already-satisfied":
    addArtifact(network, region, activationId, { kind: "check", summary: `Already-satisfied proof: ${output.checks.map((item) => `${item.name}: ${item.evidence}`).join("; ")}`, passed: true });
    transitionRegion(region, "selected", undefined, "implemented");
    break;
  case "completed":
    region.retainedImplementationActivationId = undefined;
    region.implementationRecoveryAttempts = 0;
    if (baselineFingerprint !== "legacy-live-worktree") region.integration = { status: "pending", implementationActivationId: activationId, baselineFingerprint, changedFiles: [...new Set(actualChangedFiles)].sort() };
    transitionRegion(region, "selected", undefined, "implemented");
    break;
  case "blocked": {
    // Older sessions did not have requiredMutationResources. Extract only clear
    // repository-relative source paths from their blocker so a crashed run can
    // still make the same evidence-backed recovery.
    const legacyPaths = (output.blocker ?? "").match(/(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:[cm]?[jt]s|json|md|vue)/g) ?? [];
    const requestedResources = [...new Set([...("requiredMutationResources" in output ? output.requiredMutationResources : []), ...legacyPaths].map(normalizeMutationPath).filter(Boolean))];
    if (region.edge === "root") {
    // The implementation found that the inspected root file inventory omitted an
    // execution seam.  Re-inspect that named seam before replacing the certificate.
    transitionRegion(region, "inspecting", undefined, "superposed");
    activation.expectedDelta = `scope-expansion:${requestedResources.join(",")}`;
    addActivation(network, { capability: "inspect", requiredCapabilities: [...DEFAULT_ACTIVATION_CAPABILITIES.inspect], regionId: region.id, request: `Inspect the execution seam that blocked implementation and, if confirmed, re-certify the root mutation resources. Report exact repository-relative paths; known paths: ${requestedResources.join(", ") || "none"}. ${output.blocker}`, expectedDelta: "Identify the implementation-blocking execution seams and re-certify the root mutation resources.", contextRefs: region.certifiedLeaf?.evidenceRefs ?? [] });
    } else if (countReopen(network, region)) {
    transitionRegion(region, "challenging", undefined, "superposed"); region.contradiction = output.blocker || output.summary || "Implementation reported a missing prerequisite."; region.selectedCandidateIds = [];
    region.acceptedFingerprint = null; region.challengeVerdict = null; region.certifiedLeaf = undefined; clearImplementationContinuation(region); transitionRegion(region, "challenging");
    for (const candidate of network.candidates.filter((item) => item.regionId === region.id && item.status === "selected")) { candidate.status = "possible"; candidate.declaredStatus = "possible"; }
    }
    break;
  }
  default: assertNever(output);
  }
  if (output.outcome !== "blocked") for (const finding of network.findings.filter((item) => activation.findingIds?.includes(item.id) && item.status === "open")) finding.status = "repairing";
  network.revision++; return network;
}

function retainImplementationMutation(networkInput: SolutionNetwork, activationId: string, regionId: string, changedFiles: string[], message: string, sessionId?: string): SolutionNetwork {
  const network = cloneNetwork(networkInput); const originalRegion = network.regions.find((item) => item.id === regionId); const region = originalRegion ?? network.regions.find((item) => item.edge === "root"); const activation = network.activations.find((item) => item.id === activationId);
  const ownershipMessage = originalRegion ? message : `${message} Original region ${regionId} no longer exists; ownership was retained at the root.`;
  if (!region) {
    for (const file of [...new Set(changedFiles)]) network.artifacts.push({ id: `x${network.nextArtifactId++}`, regionId, activationId, kind: "file", path: file, summary: `Changed ${file}`, fingerprint: hash({ kind: "file", path: file, summary: `Changed ${file}` }), createdRevision: network.revision + 1 });
    network.revision++;
    return network;
  }
  for (const file of [...new Set(changedFiles)]) if (!network.artifacts.some((item) => item.activationId === activationId && item.kind === "file" && item.path === file)) addArtifact(network, region, activationId, { kind: "file", path: file, summary: `Changed ${file}` });
  if (activation) { activation.status = "failed"; activation.sessionId = sessionId ?? activation.sessionId; activation.error = ownershipMessage; }
  const withinScope = region.certifiedLeaf && changedFiles.every((file) => region.certifiedLeaf!.mutationResources.some((resource) => pathWithin(file, resource)));
  const canContinue = originalRegion && activation && !activation.historical && region.certifiedLeaf && hasSelectedImplementationFamily(network, region) && withinScope;
  if (canContinue) {
    region.retainedImplementationActivationId = activationId;
    region.implementationRecoveryAttempts = (region.implementationRecoveryAttempts ?? 0) + 1;
    recordRecovery(network, "implementation-retry", regionId, ownershipMessage);
  }
  if (canContinue && region.implementationRecoveryAttempts! < 3) transitionRegion(region, "selected", undefined, "actionable");
  else transitionRegion(region, "blocked", ownershipMessage, "blocked");
  network.revision++;
  return network;
}

function findingRoute(finding: VerificationFinding, outcome: VerificationOutput["outcome"]): FindingRoute {
  if (finding.target.kind === "environment" || finding.target.kind === "external") return { kind: "blocked-external", regionId: finding.regionId, resolutionOwner: normalize(finding.resolutionOwner!), requiredEvidence: [...new Set(finding.requiredEvidence!)].sort() };
  if (outcome === "reopen") return { kind: "reopen-decision", regionId: finding.regionId, invalidatedPremiseRefs: [...new Set(finding.invalidatedPremiseRefs!)].sort() };
  return finding.target.kind === "answer" ? { kind: "answer-repair", regionId: finding.regionId } : { kind: "local-repair", regionId: finding.regionId };
}

function addFinding(network: SolutionNetwork, activationId: string, finding: VerificationFinding, outcome: VerificationOutput["outcome"]): SolutionFinding {
  const item: SolutionFinding = { ...finding, criterionId: finding.criterionId as CriterionId, target: { ...finding.target, refs: [...finding.target.refs].sort() }, evidenceRefs: [...finding.evidenceRefs].sort(), id: `f${network.nextFindingId++}`, route: findingRoute(finding, outcome), status: "open", sourceActivationId: activationId, repairActivationIds: [], createdRevision: network.revision + 1 };
  delete (item as SolutionFinding & { invalidatedPremiseRefs?: string[] }).invalidatedPremiseRefs;
  delete (item as SolutionFinding & { resolutionOwner?: string }).resolutionOwner;
  delete (item as SolutionFinding & { requiredEvidence?: string[] }).requiredEvidence;
  network.findings.push(item);
  return item;
}

function liveLeafCertificateIds(network: SolutionNetwork, scopeId: ScopeId): string[] {
  const root = network.regions.find((item) => item.scopeId === scopeId);
  if (!root) return [];
  const leaves = (region: SolutionRegion): SolutionRegion[] => { const children = network.regions.filter((item) => item.parentId === region.id); return children.length ? children.flatMap(leaves) : [region]; };
  return leaves(root).map((item) => item.completionCertificateId).filter((id): id is string => Boolean(id));
}

function certificateDependencyState(network: SolutionNetwork, certificate: CompletionCertificate, visiting = new Set<string>()): unknown {
  if (visiting.has(certificate.id)) return { cycle: certificate.id };
  visiting.add(certificate.id);
  const state = {
    criteria: network.regions.find((item) => item.id === certificate.regionId)?.criterionIds ?? [],
    requirements: network.regions.find((item) => item.id === certificate.regionId)?.requirementIds ?? [],
    selected: certificate.selectedFamilyIds.map((id) => { const item = network.candidates.find((candidate) => candidate.id === id); return item ? { id, status: item.status, historical: Boolean(item.historical) } : { id, missing: true }; }),
    equivalence: certificate.equivalenceProofConstraintIds.map((id) => { const item = network.constraints.find((constraint) => constraint.id === id); return item ? { id, kind: item.kind, subject: item.subject, target: item.target, historical: Boolean(item.historical), evidenceRefs: [...item.evidenceRefs].sort() } : { id, missing: true }; }),
    premises: certificate.premiseRefs.map((id) => {
      if (id === "task") return { id, fingerprint: hash(network.authority.task), status: "confirmed" };
      const evidence = network.evidence.find((item) => item.id === id);
      if (evidence) return { id, fingerprint: evidence.fingerprint, status: evidence.status ?? (evidence.kind === "inference" ? "hypothesis" : "confirmed") };
      const artifact = network.artifacts.find((item) => item.id === id);
      return artifact ? { id, fingerprint: artifact.fingerprint, historical: Boolean(artifact.historical), kind: artifact.kind, passed: artifact.passed } : { id, missing: true };
    }),
    dependencies: certificate.dependencyCertificateRefs.map((id) => { const item = network.certificates.find((entry) => entry.id === id); return item ? { id, fingerprint: item.fingerprint, valid: isCompletionCertificateValid(network, item, visiting) } : { id, missing: true }; }),
    artifacts: [...(certificate.measuredArtifactIds ?? []), ...(certificate.focusedCheckArtifactIds ?? []), ...(certificate.releaseCheckArtifactIds ?? [])].map((id) => { const item = network.artifacts.find((artifact) => artifact.id === id); return item ? { id, fingerprint: item.fingerprint, historical: Boolean(item.historical), passed: item.passed, kind: item.kind, checkKind: item.checkKind } : { id, missing: true }; }),
    findings: certificate.resolvedFindingIds.map((id) => { const item = network.findings.find((finding) => finding.id === id); return item ? { id, status: item.status } : { id, missing: true }; }),
    verifier: (() => { const item = network.activations.find((activation) => activation.id === certificate.verificationActivationId); return item ? { id: item.id, capability: item.capability, status: item.status, outcome: item.roleOutcome, historical: Boolean(item.historical), readRefs: item.readRefs ?? [], readsCurrent: verifierDependenciesCurrent(network, item) } : { id: certificate.verificationActivationId, missing: true }; })(),
  };
  visiting.delete(certificate.id);
  return state;
}

function verifierDependenciesCurrent(network: SolutionNetwork, activation: Activation): boolean {
  return (activation.readRefs ?? []).filter((item) => item.kind !== "region" && item.kind !== "finding").every((read) => { const current = resolveContextReference(network, read.ref); return current?.kind === read.kind && current.fingerprint === read.fingerprint; });
}

function selectedFamilyProofValid(network: SolutionNetwork, certificate: CompletionCertificate): boolean {
  const region = network.regions.find((item) => item.id === certificate.regionId);
  if (!region || !certificate.selectedFamilyIds.length || JSON.stringify([...certificate.selectedFamilyIds].sort()) !== JSON.stringify([...region.selectedCandidateIds].sort())) return false;
  if (certificate.selectedFamilyIds.some((id) => !network.candidates.some((item) => item.id === id && item.status === "selected" && !item.historical))) return false;
  if (certificate.selectedFamilyIds.length === 1) return certificate.equivalenceProofConstraintIds.length === 0;
  const adjacent = new Map(certificate.selectedFamilyIds.map((id) => [id, [] as string[]]));
  for (const id of certificate.equivalenceProofConstraintIds) { const item = network.constraints.find((constraint) => constraint.id === id && constraint.kind === "equivalent" && !constraint.historical); if (!item || !adjacent.has(item.subject) || !adjacent.has(item.target)) return false; adjacent.get(item.subject)!.push(item.target); adjacent.get(item.target)!.push(item.subject); }
  const reached = new Set<string>(); const queue = [certificate.selectedFamilyIds[0]!];
  while (queue.length) { const id = queue.shift()!; if (reached.has(id)) continue; reached.add(id); queue.push(...adjacent.get(id)!); }
  return reached.size === certificate.selectedFamilyIds.length;
}

export function isCompletionCertificateValid(network: SolutionNetwork, certificateOrId: CompletionCertificate | string, visiting = new Set<string>()): boolean {
  const certificate = typeof certificateOrId === "string" ? network.certificates.find((item) => item.id === certificateOrId) : certificateOrId;
  if (!certificate || certificate.fingerprint !== hash({ ...certificate, fingerprint: undefined }) || !selectedFamilyProofValid(network, certificate)) return false;
  const region = network.regions.find((item) => item.id === certificate.regionId);
  if (!region || !exactSet(region.criterionIds, certificate.criterionIds) || !exactSet(region.requirementIds ?? [], certificate.requirementIds ?? [])) return false;
  if (certificate.premiseRefs.some((id) => {
    if (id === "task") return false;
    const evidence = network.evidence.find((item) => item.id === id);
    if (evidence) return evidence.status === "stale" || evidence.status === "rejected";
    const artifact = network.artifacts.find((item) => item.id === id);
    return !artifact || artifact.historical || artifact.passed === false;
  })) return false;
  if ([...(certificate.focusedCheckArtifactIds ?? []), ...(certificate.releaseCheckArtifactIds ?? [])].some((id) => !network.artifacts.some((item) => item.id === id && !item.historical && item.kind === "check" && item.passed))) return false;
  if ((certificate.measuredArtifactIds ?? []).some((id) => !network.artifacts.some((item) => item.id === id && !item.historical && (item.kind === "file" || item.kind === "answer")))) return false;
  if (Object.entries(certificate.artifactFingerprints).some(([id, fingerprint]) => network.artifacts.find((item) => item.id === id)?.fingerprint !== fingerprint)) return false;
  if (certificate.resolvedFindingIds.some((id) => !network.findings.some((item) => item.id === id && item.status === "resolved"))) return false;
  if (network.findings.some((item) => item.regionId === region.id && region.criterionIds.includes(item.criterionId) && (item.status === "open" || item.status === "repairing"))) return false;
  const verifier = network.activations.find((item) => item.id === certificate.verificationActivationId);
  if (!verifier || verifier.capability !== "verify" || verifier.status !== "completed" || verifier.roleOutcome !== "pass" || verifier.historical || !verifierDependenciesCurrent(network, verifier)) return false;
  return certificate.dependencyFingerprint === hash(certificateDependencyState(network, certificate, visiting));
}

function createCompletionCertificate(network: SolutionNetwork, region: SolutionRegion, activation: Activation): void {
  const selectedFamilyIds = [...region.selectedCandidateIds].sort();
  const equivalenceProofConstraintIds = selectedFamilyIds.length > 1 ? network.constraints.filter((item) => !item.historical && item.kind === "equivalent" && selectedFamilyIds.includes(item.subject) && selectedFamilyIds.includes(item.target)).map((item) => item.id).sort() : [];
  const liveArtifacts = region.artifactIds.map((id) => network.artifacts.find((item) => item.id === id)).filter((item): item is NonNullable<typeof item> => Boolean(item)).filter((item) => !item.historical);
  const measuredArtifactIds = liveArtifacts.filter((item) => item.kind === (region.delivery === "answer" ? "answer" : "file")).map((item) => item.id).sort();
  const focusedCheckArtifactIds = liveArtifacts.filter((item) => item.kind === "check" && (item.checkDisposition === "criterion-gating" || !item.checkDisposition && (item.checkKind === "focused" || item.checkKind === "verification"))).map((item) => item.id).sort();
  const releaseCheckArtifactIds = liveArtifacts.filter((item) => item.kind === "check" && (item.checkDisposition === "release-gating" || !item.checkDisposition && item.checkKind === "release")).map((item) => item.id).sort();
  const dependencyCertificateRefs = [...new Set((region.dependencyScopeIds ?? []).flatMap((scopeId) => liveLeafCertificateIds(network, scopeId)))].sort();
  const requirementEvidenceRefs = (network.materialRequirements ?? []).filter((item) => (region.requirementIds ?? []).includes(item.id)).flatMap((item) => item.evidenceRefs);
  const premiseRefs = [...new Set([...(region.selectionPremiseRefs ?? []), ...(region.certifiedLeaf?.evidenceRefs ?? []), ...(region.implementationPremiseRefs ?? []), ...(region.verificationPremiseRefs ?? []), ...requirementEvidenceRefs])].sort();
  const resolvedFindingIds = network.findings.filter((item) => item.regionId === region.id && region.criterionIds.includes(item.criterionId) && item.status === "resolved").map((item) => item.id).sort();
  const artifactIds = [...measuredArtifactIds, ...focusedCheckArtifactIds, ...releaseCheckArtifactIds];
  const artifactFingerprints = Object.fromEntries(artifactIds.map((id) => [id, network.artifacts.find((item) => item.id === id)!.fingerprint]));
  const certificate: CompletionCertificate = { id: `k${network.nextCertificateId++}`, fingerprint: "", regionId: region.id, criterionIds: [...region.criterionIds].sort(), requirementIds: [...(region.requirementIds ?? [])].sort(), selectedFamilyIds, equivalenceProofConstraintIds, premiseRefs, dependencyCertificateRefs, dependencyFingerprint: "", measuredArtifactIds, focusedCheckArtifactIds, releaseCheckArtifactIds, artifactFingerprints, resolvedFindingIds, verificationActivationId: activation.id, createdRevision: network.revision + 1 };
  certificate.dependencyFingerprint = hash(certificateDependencyState(network, certificate));
  certificate.fingerprint = hash({ ...certificate, fingerprint: undefined });
  network.certificates.push(certificate);
  region.completionCertificateId = certificate.id;
}

export function completeVerification(networkInput: SolutionNetwork, activationId: string, output: VerificationOutput, integration?: ChangeIntegrationResult): SolutionNetwork {
  let network = cloneNetwork(networkInput); const activation = network.activations.find((item) => item.id === activationId); const region = network.regions.find((item) => item.id === activation?.regionId);
  if (!activation || !region) return network;
  activation.status = "completed";
  activation.roleOutcome = output.outcome;
  region.verificationPremiseRefs = [...new Set([...(activation.readRefs ?? []).filter((ref) => ref.kind === "evidence").map((ref) => ref.ref), ...(output.completionEvidence?.inspectionEvidenceRefs ?? [])])].sort();
  for (const raw of output.checks) {
    const check = { ...raw, disposition: raw.disposition ?? "criterion-gating" as const, criterionIds: raw.criterionIds ?? [], baselineEvidenceRefs: raw.baselineEvidenceRefs ?? [], requiredEvidence: raw.requiredEvidence ?? [] };
    addArtifact(network, region, activationId, { kind: "check", checkKind: check.disposition === "criterion-gating" ? "focused" : check.disposition === "release-gating" ? "release" : "verification", checkDisposition: check.disposition, summary: `${check.name}: ${check.evidence}`, passed: check.passed, criterionIds: check.criterionIds as CriterionId[], evidenceRefs: check.baselineEvidenceRefs, resolutionOwner: check.resolutionOwner, requiredEvidence: check.requiredEvidence });
  }
  if (output.outcome === "pass" && output.completionEvidence) addArtifact(network, region, activationId, { kind: "completion-review", summary: output.completionEvidence.correctnessReview, passed: true, implementationOutcome: output.completionEvidence.implementationOutcome ?? (output.completionEvidence.changedFiles.length ? "changed" : "already-satisfied"), criterionIds: (output.completionEvidence.criterionIds ?? region.criterionIds) as CriterionId[], focusedTests: output.completionEvidence.focusedTests, fullChecks: output.completionEvidence.fullChecks, todoDisposition: output.completionEvidence.todoDisposition });
  const admittedFindings = output.findings.map((finding) => addFinding(network, activationId, finding as VerificationFinding, output.outcome));
  const unresolved = [...new Set(output.findings.map((item) => item.criterionId as CriterionId))].sort();
  if (!recordSemanticCycle(network, region, "verify", semanticInputFingerprint(network, region), hash({ outcome: output.outcome, findings: output.findings.map((item) => ({ regionId: item.regionId, criterionId: item.criterionId, problem: normalize(item.problem), evidence: normalize(item.evidence) })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))) }), unresolved)) { network.revision++; return network; }
  switch (output.outcome) {
  case "pass":
    for (const finding of network.findings.filter((item) => activation.findingIds?.includes(item.id) && item.status === "repairing")) finding.status = "resolved";
    createCompletionCertificate(network, region, activation);
    if (integration?.outcome === "landed") network.repositoryEpochs = structuredClone(repositoryEpochs(network));
    if (integration) region.integration = {
      status: integration.outcome === "landed" ? "landed" : "conflict",
      implementationActivationId: integration.implementationActivationId,
      baselineFingerprint: integration.baselineFingerprint,
      changedFiles: [...integration.changedFiles],
      patchFingerprint: integration.patchFingerprint,
      commitId: integration.commitId,
      treeFingerprint: integration.treeFingerprint,
      preservedRef: integration.preservedRef,
      landedFileFingerprints: integration.landedFileFingerprints ? { ...integration.landedFileFingerprints } : undefined,
      landedObservationFingerprints: integration.landedObservationFingerprints ? Object.fromEntries(Object.entries(integration.landedObservationFingerprints).filter(([observation]) => network.evidence.some((item) => item.kind === "repository" && item.location?.observation === "worktrees" && item.location.canonicalPath === observation))) : undefined,
      reason: integration.reason,
    };
    if (integration?.outcome === "landed") {
      network.repositoryEpochs = structuredClone(repositoryEpochs(network));
      for (const [file, digest] of Object.entries(integration.landedFileFingerprints ?? {})) network.repositoryEpochs[file] = { digest, revision: network.revision + 1 };
      const observationPaths = new Set(network.evidence.filter((item) => item.kind === "repository" && item.location?.observation === "worktrees").map((item) => item.location!.canonicalPath));
      for (const [observation, digest] of Object.entries(integration.landedObservationFingerprints ?? {})) if (observationPaths.has(observation)) network.repositoryEpochs[observation] = { digest, revision: network.revision + 1 };
    }
    transitionRegion(region, "selected", undefined, "verified");
    break;
  case "repair":
    for (const targetId of new Set(admittedFindings.map((item) => item.route.regionId))) {
      const target = network.regions.find((item) => item.id === targetId);
      if (target) {
        const fingerprint = repairProgressFingerprint(network, target);
        const ledger = target.progress.repairCycles;
        target.progress.repairCycles = { count: ledger.fingerprint === fingerprint ? ledger.count + 1 : 1, fingerprint, unresolvedCriterionIds: unresolved.filter((id) => target.criterionIds.includes(id)) };
        if (recordSemanticCycle(network, target, "repair", semanticInputFingerprint(network, target), hash(unresolved.filter((id) => target.criterionIds.includes(id))), unresolved.filter((id) => target.criterionIds.includes(id)))) transitionRegion(target, "selected", undefined, "actionable");
      }
    }
    break;
  case "reopen":
    for (const targetId of new Set(admittedFindings.map((item) => item.route.regionId)))
      network = reopenRegion(network, targetId, output.summary || output.findings.filter((item) => item.regionId === targetId).map((item) => item.problem).join("; "));
    break;
  case "fail":
    transitionRegion(region, "blocked", admittedFindings.map((item) => { const route = item.route as Extract<FindingRoute, { kind: "blocked-external" }>; return `${item.problem} Resolution owner: ${route.resolutionOwner}. Required evidence: ${route.requiredEvidence.join(", ")}.`; }).join(" "), "blocked");
    region.blockedDetails = { kind: "blocked-external", unresolvedCriterionIds: admittedFindings.map((item) => item.criterionId) };
    break;
  default: assertNever(output);
  }
  network.revision++; return network;
}

export function completePresentation(networkInput: SolutionNetwork, activationId: string, answer: string): SolutionNetwork {
  const network = cloneNetwork(networkInput); const activation = network.activations.find((item) => item.id === activationId); const region = network.regions.find((item) => item.id === activation?.regionId);
  if (!activation || !region) return network;
  activation.status = "completed";
  for (const finding of network.findings.filter((item) => activation.findingIds?.includes(item.id) && item.status === "open")) { if (!finding.repairActivationIds.includes(activationId)) finding.repairActivationIds.push(activationId); finding.status = "repairing"; }
  if (activation.findingIds?.length) for (const artifact of network.artifacts.filter((item) => item.regionId === region.id && item.kind === "answer" && !item.historical)) artifact.historical = true;
  const input = semanticInputFingerprint(network, region); const output = hash(normalize(answer)); region.answer = answer; addArtifact(network, region, activationId, { kind: "answer", summary: answer }); if (recordSemanticCycle(network, region, "present", input, output, region.criterionIds)) transitionRegion(region, "selected", undefined, "implemented"); network.revision++; return network;
}

export function applyActivationOutput(snapshot: SolutionLodState | SolutionNetwork, activation: Activation, output: ActivationOutput, changedFiles: string[] = [], tools?: readonly AgentToolTrace[], changedFileFingerprints: Readonly<Record<string, string>> = {}, baselineFingerprint?: string, integration?: ChangeIntegrationResult): SolutionNetwork {
  const state = "network" in snapshot ? snapshot : stateForNetwork(snapshot);
  const live = state.network.activations.find((item) => item.id === activation.id);
  if (!live || live.capability !== activation.capability || live.operation !== activation.operation) throw new Error(`Activation ${activation.id} does not match the supplied snapshot.`);
  let network: SolutionNetwork;
  switch (activation.capability) {
  case "synthesize": network = mergeSynthesisOutput(state, activation.id, output as SynthesisOutput); break;
  case "inspect": validateSolutionDelta(state, activation.regionId, "inspect", output as SolutionDelta, tools); network = mergeSolutionDelta(state, activation.id, output as SolutionDelta, tools); break;
  case "refine": validateRefinementOutput(state, activation.regionId, output as RefinementOutput); network = mergeRefinementOutput(state.network, activation.id, output as RefinementOutput); break;
  case "implement": validateImplementationOutput(state, activation.regionId, output as ImplementationOutput); network = completeImplementation(state.network, activation.id, output as ImplementationOutput, changedFiles, changedFileFingerprints, baselineFingerprint); break;
  case "verify": validateVerificationOutput(state, activation.regionId, output as VerificationOutput); network = completeVerification(state.network, activation.id, output as VerificationOutput, integration); break;
  case "present": { const answer = (output as { outcome: "answer"; answer: string }).answer; validatePresentationAnswer(state, activation.regionId, answer); network = completePresentation(state.network, activation.id, answer); break; }
  default: assertNever(activation.capability);
  }
  const result = network.activations.find((item) => item.id === activation.id);
  if (result?.status === "failed") throw new Error(result.error ?? `Activation ${activation.id} output was rejected.`);
  if (activation.capability === "inspect") {
    const inspected = network.regions.find((item) => item.id === activation.regionId);
    if (inspected) inspected.inspectionAttempts = (inspected.inspectionAttempts ?? 0) + 1;
  }
  return propagateNetwork(result?.status === "completed" ? network : markActivation(network, activation.id, "completed"));
}

function reopenProgressFingerprint(network: SolutionNetwork, region: SolutionRegion): string {
  const premiseRefs = network.findings.filter((item) => item.regionId === region.id && item.status !== "superseded" && item.route.kind === "reopen-decision").flatMap((item) => item.route.kind === "reopen-decision" ? item.route.invalidatedPremiseRefs : []).filter((ref) => isConfirmedEvidence(network, ref)).sort();
  return hash(premiseRefs.map((ref) => [ref, resolveContextReference(network, ref)?.fingerprint]));
}

function repairProgressFingerprint(network: SolutionNetwork, region: SolutionRegion): string {
  const effects = region.artifactIds.map((id) => network.artifacts.find((item) => item.id === id && !item.historical && (item.kind === "file" || item.kind === "answer"))).filter(Boolean).map((item) => item!.fingerprint).sort();
  const findings = network.findings.filter((item) => item.regionId === region.id && item.status !== "superseded").map((item) => [item.criterionId, item.problem, item.status]).sort();
  return hash({ effects, findings });
}

function semanticInputFingerprint(network: SolutionNetwork, region: SolutionRegion): string {
  return hash({ objective: normalize(region.objective), criteria: region.criterionIds.map((id, index) => [id, normalize(region.acceptanceCriteria[index] ?? "")]).sort(), evidence: region.evidenceIds.map((id) => network.evidence.find((item) => item.id === id)?.fingerprint ?? `missing:${id}`).sort(), files: region.artifactIds.map((id) => network.artifacts.find((item) => item.id === id)).filter((item) => item && !item.historical && item.kind === "file").map((item) => [item!.path ?? "", item!.fingerprint]).sort() });
}

function recordSemanticCycle(network: SolutionNetwork, region: SolutionRegion, kind: SemanticCycleKind, inputFingerprint: string, outputFingerprint: string, unresolvedCriterionIds: CriterionId[]): boolean {
  const record = { kind, inputFingerprint, outputFingerprint, unresolvedCriterionIds: [...new Set(unresolvedCriterionIds)].sort(), revision: network.revision + 1 };
  region.convergenceCycles ??= [];
  region.convergenceCycles.push(record);
  const repeated = region.convergenceCycles.filter((item) => item.kind === kind && item.inputFingerprint === inputFingerprint && item.outputFingerprint === outputFingerprint);
  const latestPresent = [...region.convergenceCycles].reverse().find((item) => item.kind === "present");
  const answerLoop = kind === "repair" && Boolean(latestPresent) && region.convergenceCycles.some((item) => item.kind === "verify" && item.revision >= latestPresent!.revision) && latestPresent!.inputFingerprint === inputFingerprint;
  if (repeated.length < MAX_SEMANTIC_CYCLES && !answerLoop) return true;
  const fingerprints = [...new Set(repeated.flatMap((item) => [item.inputFingerprint, item.outputFingerprint]))].sort();
  const criteria = [...new Set(repeated.flatMap((item) => item.unresolvedCriterionIds))].sort();
  const reason = `Region ${region.id} blocked after repeated ${kind} semantic cycle; fingerprints=${fingerprints.join(",")}; unresolvedCriterionIds=${criteria.join(",") || "none"}`;
  region.blockedDetails = { kind: answerLoop ? "answer-present-verify-repair-loop" : `${kind}-limit`, fingerprints, unresolvedCriterionIds: criteria };
  transitionRegion(region, "blocked", reason, "blocked");
  return false;
}

/**
 * Count one reopen against a region: identical evidence/artifact content accumulates the counter,
 * genuinely new content resets it, and the contentless reopen past the shared retry policy converts
 * the region to terminal "stalled" instead of reopening. Returns whether the reopen may proceed.
 */
function countReopen(network: SolutionNetwork, region: SolutionRegion): boolean {
  const fingerprint = reopenProgressFingerprint(network, region);
  const ledger = region.progress.reopenAttempts;
  if (fingerprint !== ledger.fingerprint) { region.progress.reopenAttempts = { count: 1, fingerprint, unresolvedCriterionIds: [...region.criterionIds] }; return true; }
  if (ledger.count >= SAME_REVISION_RETRY_POLICY.maxAttempts) {
    transitionRegion(region, "blocked", undefined, "stalled");
    region.contradiction = `Region ${region.id} stalled: ${ledger.count} reopens without a new confirmed defeater; fingerprint=${fingerprint}; unresolvedCriterionIds=${region.criterionIds.join(",") || "none"}`;
    return false;
  }
  ledger.count += 1;
  return true;
}

export function reopenRegion(networkInput: SolutionNetwork, regionId: string, reason: string): SolutionNetwork {
  const network = cloneNetwork(networkInput); const region = network.regions.find((item) => item.id === regionId); if (!region) return network;
  recordRecovery(network, "reopen", regionId, reason);
  if (!recordSemanticCycle(network, region, "reopen", semanticInputFingerprint(network, region), hash(normalize(reason)), region.criterionIds)) { network.revision++; return network; }
  if (!countReopen(network, region)) return network;
  transitionRegion(region, region.candidateIds.length ? "challenging" : "inspecting", undefined, region.acceptanceCriteria.length ? "superposed" : "unformed"); region.contradiction = reason; region.selectedCandidateIds = [];
  region.acceptedFingerprint = null; region.challengeVerdict = null; region.certifiedLeaf = undefined; clearImplementationContinuation(region); transitionRegion(region, region.candidateIds.length ? "challenging" : "inspecting");
  region.coveredCriteria = undefined;
  for (const candidate of network.candidates.filter((item) => item.regionId === regionId)) { candidate.status = "possible"; candidate.declaredStatus = "possible"; }
  if (!region.acceptanceCriteria.length) {
    network.candidates = network.candidates.filter((item) => item.regionId !== regionId);
    region.candidateIds = [];
  }
  purgeDescendants(network, regionId);
  network.revision++; return network;
}

export function resetPrunedRegion(networkInput: SolutionNetwork, regionId: string): SolutionNetwork {
  const network = cloneNetwork(networkInput);
  const region = network.regions.find((item) => item.id === regionId);
  if (!region) return network;
  recordRecovery(network, "prune", regionId, "Explicit region prune");
  const retired = new Set(region.candidateIds);
  const retiredLogicalActivationIds = new Set(network.activations.flatMap((item) => item.regionId === regionId && item.logicalActivationId ? [item.logicalActivationId] : []));
  network.candidates = network.candidates.map((item) => retired.has(item.id) ? { ...item, historical: true } : item);
  network.constraints = network.constraints.map((item) => retired.has(item.subject) || retired.has(item.target) ? { ...item, historical: true } : item);
  network.activations = network.activations.map((item) => item.regionId !== regionId ? item : { ...item, historical: true, status: item.status === "queued" || item.status === "running" ? "superseded" : item.status, error: item.error ?? `Historical activation: region ${regionId} was pruned.` });
  for (const logicalActivationId of retiredLogicalActivationIds) delete network.schemaRetries[logicalActivationId];
  network.artifacts = network.artifacts.map((item) => item.regionId === regionId ? { ...item, historical: true } : item);
  network.findings = network.findings.map((item) => item.regionId === regionId && item.status !== "superseded" ? { ...item, status: "superseded" } : item);
  network.certificates = network.certificates.filter((item) => item.regionId !== regionId);
  region.candidateIds = [];
  region.selectedCandidateIds = [];
  region.constraintIds = region.constraintIds.filter((id) => !network.constraints.find((item) => item.id === id)?.historical);
  region.activationIds = [];
  region.artifactIds = [];
  region.enumerationFingerprint = null;
  region.boundDomainFingerprint = null;
  region.domainFingerprint = null;
  region.acceptedFingerprint = null;
  region.challengeVerdict = null;
  region.certifiedLeaf = undefined; clearImplementationContinuation(region);
  region.completionCertificateId = undefined;
  region.selectionPremiseRefs = undefined;
  region.implementationPremiseRefs = undefined;
  region.verificationPremiseRefs = undefined;
  region.answer = undefined;
  region.inspectionAttempts = 0;
  region.inspectionObligationIds = [...region.criterionIds];
  region.criterionVerdicts = [];
  region.progress = emptyProgress();
  region.convergenceCycles = [];
  region.contradiction = undefined;
  region.blockedDetails = undefined;
  transitionRegion(region, region.decisionBoundary ? "ungenerated" : "inspecting", undefined, region.acceptanceCriteria.length ? "superposed" : "unformed");
  network.revision++;
  return network;
}

export function nextQueuedActivation(network: SolutionNetwork): Activation | undefined {
  return network.activations.filter((item) => item.status === "queued" && activationAdmitted(network, item)).sort((left, right) => left.basisRevision - right.basisRevision || Number(left.id.slice(1)) - Number(right.id.slice(1)))[0];
}

export function activationAdmitted(network: SolutionNetwork, activation: Activation): boolean {
  const region = network.regions.find((item) => item.id === activation.regionId);
  if (!region || !activationReadsCurrent(network, activation) || !roleSupportsCapabilities(activation.capability, activationRequiredCapabilities(activation))) return false;
  if (activation.capability === "inspect") return (region.status === "unformed" || region.status === "superposed") && region.domainPhase === "inspecting";
  if (activation.capability === "synthesize") {
    if ((activation.boundDomainFingerprint ?? activation.domainFingerprint) !== region.boundDomainFingerprint) return false;
    return activation.operation === "generate-domain" ? region.domainPhase === "ungenerated" && Boolean(region.decisionBoundary) && region.candidateIds.length === 0
      : activation.operation === "challenge-domain" ? region.domainPhase === "challenging"
      : activation.operation === "select-candidate" && region.domainPhase === "selecting" && Boolean(region.boundDomainFingerprint) && region.candidateIds.length > 0;
  }
  if (activation.capability === "refine") return region.status === "unrefined";
  if (activation.capability === "implement") return region.status === "actionable" && region.delivery === "change";
  if (activation.capability === "present") return region.status === "actionable" && region.delivery === "answer";
  if (activation.capability === "verify") return region.status === "implemented";
  return false;
}

const MUTATING_CAPABILITIES: Capability[] = ["implement", "verify"];

function mutationResourcesOverlap(left: Activation, right: Activation): boolean {
  return (right.mutationResources ?? []).some((rightPath) => (left.mutationResources ?? []).some((leftPath) => pathWithin(rightPath, leftPath) || pathWithin(leftPath, rightPath)));
}

/**
 * Select the next activation batch. Mutating work is batched only when scopes and
 * mutation resources do not overlap; read-only work is batched on distinct regions.
 * A width of 1 reproduces sequential execution.
 */
export function selectActivationBatch(network: SolutionNetwork, width: number): Activation[] {
  const priority = (activation: Activation) => network.regions.find((item) => item.id === activation.regionId)?.selectionAge ?? 0;
  const queued = network.activations.filter((item) => item.status === "queued" && activationAdmitted(network, item) && dependenciesVerified(network, item.regionId)).sort((left, right) => priority(right) - priority(left) || left.basisRevision - right.basisRevision || Number(left.id.slice(1)) - Number(right.id.slice(1)));
  if (!queued.length) return [];
  const mutating = MUTATING_CAPABILITIES.includes(queued[0].capability);
  const batchCapability = queued[0].capability;
  const batch: Activation[] = [];
  const claimedRegions = new Set<string>();
  const claimedScopes = new Set<string>();
  for (const activation of queued) {
    if (batch.length >= width) break;
    if (MUTATING_CAPABILITIES.includes(activation.capability) !== mutating) continue;
    if (mutating && activation.capability !== batchCapability) continue;
    if (batchCapability === "implement" && batch.length) break;
    if (claimedRegions.has(activation.regionId)) continue;
    const scopeId = network.regions.find((item) => item.id === activation.regionId)?.scopeId;
    if (mutating && (!scopeId || claimedScopes.has(scopeId) || batch.some((item) => mutationResourcesOverlap(item, activation)))) continue;
    batch.push(activation);
    claimedRegions.add(activation.regionId);
    if (scopeId) claimedScopes.add(scopeId);
  }
  return batch;
}

function dependenciesVerified(network: SolutionNetwork, regionId: string): boolean {
  const region = network.regions.find((item) => item.id === regionId);
  const complete = (item: SolutionRegion): boolean => {
    if (item.completionCertificateId && isCompletionCertificateValid(network, item.completionCertificateId)) return true;
    const children = network.regions.filter((child) => child.parentId === item.id);
    return item.status === "collapsed" && children.length > 0 && children.every(complete);
  };
  return Boolean(region && (region.dependencyScopeIds ?? []).every((scopeId) => {
    const dependency = network.regions.find((item) => item.scopeId === scopeId);
    return dependency ? complete(dependency) : false;
  }));
}

function reconcileCompletionState(networkInput: SolutionNetwork): SolutionNetwork {
  const network = cloneNetwork(networkInput);
  for (const finding of network.findings) {
    const region = network.regions.find((item) => item.id === finding.regionId);
    if (finding.status !== "superseded" && (!region || !region.criterionIds.includes(finding.criterionId))) finding.status = "superseded";
  }
  for (const region of network.regions) {
    region.inspectionObligationIds ??= [...region.criterionIds];
    const certificate = network.certificates.find((item) => item.id === region.completionCertificateId);
    if (!certificate || isCompletionCertificateValid(network, certificate)) continue;
    region.completionCertificateId = undefined;
    const currentFindings = network.findings.filter((item) => item.regionId === region.id && region.criterionIds.includes(item.criterionId) && (item.status === "open" || item.status === "repairing"));
    const external = currentFindings.find((item) => item.route.kind === "blocked-external");
    if (external) { const route = external.route as Extract<FindingRoute, { kind: "blocked-external" }>; transitionRegion(region, "blocked", `${external.problem} Resolution owner: ${route.resolutionOwner}. Required evidence: ${route.requiredEvidence.join(", ")}.`, "blocked"); continue; }
    if (currentFindings.some((item) => item.status === "open")) { transitionRegion(region, "selected", undefined, "actionable"); continue; }
    if (currentFindings.length) { transitionRegion(region, "selected", undefined, "implemented"); continue; }
    if (!selectedFamilyProofValid(network, certificate) || certificate.premiseRefs.some((id) => region.selectionPremiseRefs?.includes(id) && !isConfirmedEvidence(network, id))) { transitionRegion(region, "selecting", undefined, "superposed"); continue; }
    const artifacts = [...(certificate.measuredArtifactIds ?? []), ...(certificate.focusedCheckArtifactIds ?? []), ...(certificate.releaseCheckArtifactIds ?? [])];
    if (artifacts.some((id) => { const item = network.artifacts.find((artifact) => artifact.id === id); return !item || item.historical || item.fingerprint !== certificate.artifactFingerprints[id]; })) { transitionRegion(region, "selected", undefined, "actionable"); continue; }
    transitionRegion(region, "selected", undefined, "implemented");
  }
  return network;
}

export function supersedeStaleQueuedActivations(networkInput: SolutionNetwork): SolutionNetwork {
  const network = cloneNetwork(networkInput);
  for (const activation of network.activations) {
    if (activation.status !== "queued" || activationAdmitted(network, activation)) continue;
    activation.status = "superseded";
    activation.error = "Superseded: activation context changed before admission.";
  }
  return network;
}

export interface BatchApplication {
  network: SolutionNetwork;
  applied: string[];
  deferred: string[];
  failed: string[];
  superseded: string[];
}

/**
 * Apply one batch of per-task records deterministically: records are ordered by
 * (basisRevision, activationId) regardless of completion order, existing reducers apply
 * them sequentially, and propagation runs after every attempted record. Failed activations
 * can still invalidate derived locks, so their absence of a delta is not a reason to skip
 * the kernel. A final idempotent pass also covers empty or wholly superseded batches.
 * A record whose basis is outdated and whose application lands its region in a
 * contradiction is rolled back and recorded as superseded — superseded outcomes never
 * consume the failed-activation retry limit.
 */
export function applyBatchRecords(networkInput: SolutionNetwork, records: ActivationTaskResult[]): BatchApplication {
  const ordered = [...records].sort((left, right) => left.basisRevision - right.basisRevision || Number(left.activationId.slice(1)) - Number(right.activationId.slice(1)));
  let current = networkInput;
  const application: BatchApplication = { network: networkInput, applied: [], deferred: [], failed: [], superseded: [] };
  const applyDelta = (network: SolutionNetwork, record: ActivationTaskResult): SolutionNetwork => {
    const delta = record.networkDelta!;
    const activation = network.activations.find((item) => item.id === record.activationId);
    if (!activation) throw new Error(`Unknown activation ${record.activationId}`);
    const output = delta.kind === "delta" ? delta.delta : delta.output;
    const applied = applyActivationOutput(network, activation, output, delta.kind === "implementation" ? delta.changedFiles : [], record.tools, delta.kind === "implementation" ? delta.changedFileFingerprints : {}, delta.kind === "implementation" ? delta.baselineFingerprint : undefined, delta.kind === "verification" ? delta.integration : undefined);
    const landed = applied.activations.find((item) => item.id === record.activationId)!;
    return markActivation(applied, record.activationId, landed.status, record.sessionId, landed.error);
  };
  for (const record of ordered) {
    settleSchemaAttempts(current, record);
    const before = current;
    const liveActivation = current.activations.find((item) => item.id === record.activationId);
    if (!liveActivation || liveActivation.status === "completed" || liveActivation.status === "superseded") {
      const changedFiles = record.networkDelta?.kind === "implementation" ? record.networkDelta.changedFiles : record.changedFiles ?? [];
      if (record.capability === "implement" && liveActivation?.status !== "completed" && changedFiles.length) {
        current = propagateNetwork(retainImplementationMutation(current, record.activationId, record.regionId, changedFiles, "Implementation result arrived after its activation was superseded or removed.", record.sessionId));
        application.failed.push(record.activationId);
      } else {
        application.superseded.push(record.activationId);
        current = propagateNetwork(markActivation(current, record.activationId, "superseded", record.sessionId, "Superseded: activation context changed before result admission."));
      }
      continue;
    }
    if (!activationReadsCurrent(current, liveActivation)) {
      const changedFiles = record.networkDelta?.kind === "implementation" ? record.networkDelta.changedFiles : record.changedFiles ?? [];
      if (record.capability === "implement" && changedFiles.length) {
        current = retainImplementationMutation(current, record.activationId, record.regionId, changedFiles, "Implementation context changed after workspace mutation.", record.sessionId);
        application.failed.push(record.activationId);
      } else {
        application.superseded.push(record.activationId);
        current = propagateNetwork(markActivation(current, record.activationId, "superseded", record.sessionId, "Superseded: activation context changed before result admission."));
      }
      continue;
    }
    const stale = current.revision !== record.basisRevision;
    let refused = false;
    let refusalReason = "the reducer rejected the result";
    try {
      if (record.outcome === "applied" && record.networkDelta) {
        current = applyDelta(current, record);
      } else {
        const message = record.error ?? "Activation task failed.";
        current = markActivation(current, record.activationId, "failed", record.sessionId, message);
        const failedActivation = current.activations.find((item) => item.id === record.activationId);
        if (failedActivation && record.retryable && record.sessionId && (record.failureKind === "transport" || record.failureKind === "inactivity")) failedActivation.recovery = { sessionId: record.sessionId, strategy: record.progressText || record.tools?.length ? "fork" : "continue", attempts: record.retries ?? 0, failureKind: record.failureKind, contextFingerprint: activationContextFingerprint(failedActivation), retryTrace: record.retryTrace?.map((trace) => ({ ...trace })) ?? [] };
        if (record.capability === "implement") {
          const changedFiles = record.changedFiles ?? [];
          if (changedFiles.length) {
            const summary = record.outcome === "deferred" ? message : `Implementation output failed but workspace mutation was retained: ${message}`;
            current = retainImplementationMutation(current, record.activationId, record.regionId, changedFiles, summary, record.sessionId);
          } else {
            const region = current.regions.find((item) => item.id === record.regionId);
            if (region) {
              region.implementationRecoveryAttempts = (region.implementationRecoveryAttempts ?? 0) + 1;
              recordRecovery(current, "implementation-retry", region.id, message);
              if (region.implementationRecoveryAttempts >= 3) transitionRegion(region, "blocked", `Implementation recovery exhausted after 3 attempts: ${message}`, "blocked");
              else transitionRegion(region, "selected", undefined, "actionable");
            }
          }
        }
      }
    } catch (error) {
      refused = true;
      refusalReason = error instanceof Error ? error.message : String(error);
    }
    current = propagateNetwork(current);
    const contradicted = stale && record.outcome === "applied" && current.regions.find((item) => item.id === record.regionId)?.status === "contradiction";
    let concurrencyConflict = false;
    if ((refused || contradicted) && stale && record.outcome === "applied" && record.networkDelta) {
      try {
        const basisResult = applyDelta(networkInput, record);
        concurrencyConflict = basisResult.regions.find((item) => item.id === record.regionId)?.status !== "contradiction";
      } catch { /* intrinsically invalid at the batch basis */ }
    }
    if ((refused || contradicted) && !concurrencyConflict) {
      if (contradicted) refusalReason = "the result contradicts the current solution state";
      current = markActivation(before, record.activationId, "failed", record.sessionId, `Reducer rejected the result: ${refusalReason}`);
      if (record.capability === "implement") {
        const changedFiles = record.networkDelta?.kind === "implementation" ? record.networkDelta.changedFiles : [];
        if (changedFiles.length) {
          current = retainImplementationMutation(current, record.activationId, record.regionId, changedFiles, `Implementation output was rejected after workspace mutation: ${refusalReason}`, record.sessionId);
        } else current = setRegionStatus(current, record.regionId, "actionable");
      }
      current = propagateNetwork(current);
      application.failed.push(record.activationId);
      continue;
    }
    if (refused || contradicted) {
      const changedFiles = record.networkDelta?.kind === "implementation" ? record.networkDelta.changedFiles : [];
      if (changedFiles.length) {
        current = retainImplementationMutation(before, record.activationId, record.regionId, changedFiles, "Implementation result became stale after workspace mutation.", record.sessionId);
        application.failed.push(record.activationId);
        continue;
      }
      current = propagateNetwork(markActivation(before, record.activationId, "superseded", record.sessionId, refused ? `Superseded: reducer rejected the result: ${refusalReason}` : "Superseded: the state revision moved past this activation's basis and its result now contradicts the newer state."));
      application.superseded.push(record.activationId);
      continue;
    }
    if (record.outcome === "applied" && current.activations.find((item) => item.id === record.activationId)?.status === "failed") application.failed.push(record.activationId);
    else if (record.outcome === "applied") application.applied.push(record.activationId);
    else if (record.outcome === "deferred") application.deferred.push(record.activationId);
    else application.failed.push(record.activationId);
  }
  application.network = propagateNetwork(current);
  const telemetry = application.network.telemetry ?? emptyTelemetry();
  for (const record of ordered) {
    telemetry.recordedActivationIds ??= [];
    if (telemetry.recordedActivationIds.includes(record.activationId)) continue;
    telemetry.recordedActivationIds.push(record.activationId);
    if (record.capability === "inspect" && !application.applied.includes(record.activationId)) {
      const inspected = application.network.regions.find((item) => item.id === record.regionId);
      if (inspected) inspected.inspectionAttempts = (inspected.inspectionAttempts ?? 0) + 1;
    }
    telemetry.activationRecords ??= [];
    const elapsed = Math.max(0, record.finishedAt - record.startedAt);
    const queueMs = Math.max(0, record.startedAt - (networkInput.activations.find((item) => item.id === record.activationId)?.queuedAt ?? record.startedAt));
    const operation = record.operation ?? record.capability;
    const region = telemetry.regions[record.regionId] ?? { operationCalls: {}, promptChars: 0, schemaChars: 0, validationFailures: 0, repairAttempts: 0, retries: 0, domainSizes: [], progressFingerprints: [], elapsedMs: 0, queueMs: 0, roleMs: {}, blockedReasons: [], contextTelemetry: { ...EMPTY_CONTEXT_TELEMETRY } };
    if (record.networkDelta?.kind === "verification" && record.networkDelta.integration?.outcome === "landed" && application.applied.includes(record.activationId)) telemetry.firstVerifiedChangeAt ??= record.finishedAt;
    telemetry.activations++;
    telemetry.physicalActivations++;
    telemetry.promptAttempts += record.promptAttempts?.length ?? 0;
    telemetry.schemaRetries += record.schemaRetries ?? 0;
    telemetry.schemaRepairs += record.schemaRepairs ?? 0;
    telemetry.operationCalls[operation] = (telemetry.operationCalls[operation] ?? 0) + 1;
    if (record.operation === "challenge-domain" && application.applied.includes(record.activationId) && record.networkDelta?.kind === "synthesis" && record.networkDelta.output.outcome === "counterexample") telemetry.counterexampleRepairs++;
    telemetry.retries += record.retries ?? 0;
    telemetry.schemaChars ??= 0;
    telemetry.promptChars += record.promptChars ?? 0;
    telemetry.schemaChars += record.schemaChars ?? 0;
    telemetry.projectedContextChars += (record.promptChars ?? 0) - (record.schemaChars ?? 0);
    telemetry.validationFailures += record.validationFailures?.length ?? 0;
    telemetry.queueMs += queueMs;
    telemetry.roleMs[record.capability] = (telemetry.roleMs[record.capability] ?? 0) + elapsed;
    if (record.capability === "implement") telemetry.implementationMs += elapsed;
    if (record.capability === "verify") telemetry.verificationMs += elapsed;
    for (const key of Object.keys(EMPTY_USAGE) as Array<keyof typeof EMPTY_USAGE>) telemetry.usage[key] += record.usage[key];
    telemetry.contextTelemetry ??= { ...EMPTY_CONTEXT_TELEMETRY };
    region.contextTelemetry ??= { ...EMPTY_CONTEXT_TELEMETRY };
    addContextTelemetry(telemetry.contextTelemetry, record.contextTelemetry);
    addContextTelemetry(region.contextTelemetry, record.contextTelemetry);
    telemetry.activationRecords.push({
      activationId: record.activationId, physicalActivationId: record.activationId, logicalActivationId: record.logicalActivationId ?? networkInput.activations.find((item) => item.id === record.activationId)?.logicalActivationId ?? record.activationId, regionId: record.regionId, role: record.capability, operation, outcome: record.outcome, roleOutcome: record.roleOutcome,
      promptChars: record.promptChars ?? 0, schemaChars: record.schemaChars ?? 0, projectedSectionChars: { ...(record.projectedSectionChars ?? {}) },
      repositoryReadChars: record.contextTelemetry?.repositoryReadChars ?? 0, otherToolOutputChars: record.contextTelemetry?.otherToolOutputChars ?? 0, bashOutputChars: record.contextTelemetry?.bashOutputChars ?? 0,
      duplicateReadCharsAvoided: record.contextTelemetry?.duplicateReadCharsAvoided ?? 0,
      accumulatedSessionInput: record.contextTelemetry?.accumulatedSessionInput ?? record.usage.input, cacheReadInput: record.contextTelemetry?.cacheReadInput ?? record.usage.cacheRead,
      repairAttempts: record.contextTelemetry?.structuredRepairAttempts ?? record.validationFailures?.length ?? 0, promptAttempts: record.promptAttempts?.length ?? 0, schemaRetries: record.schemaRetries ?? 0, schemaRepairs: record.schemaRepairs ?? 0, usage: { ...record.usage },
    });
    region.operationCalls[operation] = (region.operationCalls[operation] ?? 0) + 1;
    region.schemaChars ??= 0;
    region.promptChars += record.promptChars ?? 0; region.schemaChars += record.schemaChars ?? 0; region.validationFailures += record.validationFailures?.length ?? 0; region.retries += record.retries ?? 0; region.elapsedMs += elapsed; region.queueMs += queueMs;
    region.roleMs[record.capability] = (region.roleMs[record.capability] ?? 0) + elapsed;
    if (record.domainSize !== undefined) region.domainSizes.push(record.domainSize);
    region.repairAttempts += (record.validationFailures?.length ?? 0) || (record.outcome === "deferred" || application.failed.includes(record.activationId) ? 1 : 0);
    const progressFingerprints = Object.values(application.network.regions.find((item) => item.id === record.regionId)?.progress ?? {}).flatMap((item) => item.fingerprint ? [item.fingerprint] : []);
    for (const fingerprint of progressFingerprints) if (!region.progressFingerprints.includes(fingerprint)) region.progressFingerprints.push(fingerprint);
    telemetry.regions[record.regionId] = region;
  }
  telemetry.reopens = application.network.regions.reduce((sum, region) => sum + region.progress.reopenAttempts.count, 0);
  telemetry.cycles = application.network.regions.reduce((sum, region) => sum + (region.convergenceCycles?.length ?? 0), 0);
  telemetry.candidates = application.network.candidates.filter((item) => !item.historical).length;
  telemetry.regionCount = application.network.regions.length;
  telemetry.blockedReasons = application.network.regions.flatMap((region) => region.blockedReason ? [region.blockedReason] : []);
  for (const region of application.network.regions) if (telemetry.regions[region.id]) telemetry.regions[region.id]!.blockedReasons = region.blockedReason ? [region.blockedReason] : [];
  application.network.telemetry = telemetry;
  return application;
}

function stateForNetwork(network: SolutionNetwork): SolutionLodState {
  return { stateVersion: 11, runId: "", directory: "", worktree: "", phase: "", activeBatch: [], network, results: [], usage: { turns: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }, callsUsed: 0, startedAt: 0, result: "" };
}

function currentContextRefs(network: SolutionNetwork, refs: string[]): string[] {
  return refs.filter((ref) => { const evidence = network.evidence.find((item) => item.id === ref); return evidence ? evidence.status !== "stale" && evidence.status !== "rejected" : knownRef(network, ref); });
}

export function ensureRunnableWork(input: SolutionNetwork, width = 1, maxInspectionsPerRegion = Number.POSITIVE_INFINITY): { network: SolutionNetwork; done: boolean; blocked?: string } {
  let network = reconcileCompletionState(propagateNetwork(input));
  const inspectionLimit = Math.min(2, maxInspectionsPerRegion);
  let recoveredInspectionLimit = false;
  for (const region of network.regions) {
    if (region.status !== "blocked" || region.blockedDetails?.kind !== "inspection-pass-limit" || (region.inspectionAttempts ?? 0) >= inspectionLimit) continue;
    transitionRegion(region, "inspecting", undefined, region.evidenceIds.length ? "superposed" : "unformed");
    region.blockedDetails = undefined;
    region.contradiction = undefined;
    recoveredInspectionLimit = true;
  }
  if (recoveredInspectionLimit) network.revision++;
  for (const region of network.regions) {
    const inspections = network.telemetry?.regions[region.id]?.operationCalls.inspect ?? 0;
    const recoveries = network.telemetry?.recoveryEvents?.filter((event) => event.regionId === region.id).length ?? 0;
    const needsInspection = region.status === "unformed" || region.domainPhase === "inspecting";
    if (region.status === "verified" || region.status === "collapsed" || (!needsInspection || inspections < 16) && recoveries < 12) continue;
    const reason = `Cumulative recovery limit for ${region.id}: inspections=${inspections}/16 recoveries=${recoveries}/12; counts survive prune and resume.`;
    transitionRegion(region, "blocked", reason, "blocked");
    for (const activation of network.activations) if (activation.regionId === region.id && activation.status === "queued") { activation.status = "superseded"; activation.error = reason; }
  }
  if (selectActivationBatch(network, width).length) return { network, done: false };
  const required = network.regions;
  const deliveryComplete = (region: SolutionRegion): boolean => !region.integration || region.integration.status === "landed";
  const terminal = required.length > 0 && required.every((region) => region.completionCertificateId && isCompletionCertificateValid(network, region.completionCertificateId) && deliveryComplete(region) || region.status === "collapsed" && network.regions.some((child) => child.parentId === region.id));
  if (terminal) {
    for (const region of required) {
      const children = required.filter((item) => item.parentId === region.id);
      if (!children.length) continue;
      const expected = region.acceptanceCriteria.length || 1;
      const ownership = Array.from({ length: expected }, (_, index) => children.filter((child) => (child.coveredCriteria ?? []).includes(index)).length);
      if (ownership.some((count) => count === 0)) return { network, done: false, blocked: `Root coverage audit failed for ${region.scopeId}: every criterion must have at least one live child covering it.` };
    }
    const validCertificates = network.certificates.filter((certificate) => isCompletionCertificateValid(network, certificate));
    const requirementCoverage = (network.materialRequirements ?? []).map((requirement) => ({ id: requirement.id, count: validCertificates.filter((certificate) => certificate.requirementIds.includes(requirement.id)).length }));
    const uncoveredRequirements = requirementCoverage.filter((item) => item.count === 0);
    if (uncoveredRequirements.length) return { network, done: false, blocked: `Completion audit failed: every material requirement needs at least one valid leaf certificate (${uncoveredRequirements.map((item) => item.id).join(", ")}).` };
    const unresolvedFindings = network.findings.filter((item) => item.status === "open" || item.status === "repairing");
    if (unresolvedFindings.length) return { network, done: false, blocked: `Completion audit failed: unresolved finding IDs ${unresolvedFindings.map((item) => item.id).join(", ")}.` };
    return { network, done: true };
  }
  const integrationConflict = required.find((region) => region.integration?.status === "conflict");
  if (integrationConflict) return { network, done: false, blocked: `Integration conflict in ${integrationConflict.id}: ${integrationConflict.integration?.reason ?? "the verified commit could not be landed without overlapping concurrent changes"}. Preserved commit: ${integrationConflict.integration?.commitId ?? "unknown"}${integrationConflict.integration?.preservedRef ? ` (${integrationConflict.integration.preservedRef})` : ""}.` };
  const implementing = required.find((region) => region.status === "implementing");
  if (implementing) return { network, done: false, blocked: `Implementation activation for ${implementing.id} disappeared.` };
  const contradiction = required.find((region) => region.status === "contradiction");
  if (contradiction) return { network, done: false, blocked: `Contradiction in ${contradiction.id}: ${contradiction.contradiction ?? "every candidate was eliminated"}` };
  const runnable = required.filter((region) => ["actionable", "implemented", "unrefined", "unformed", "superposed"].includes(region.status) && dependenciesVerified(network, region.id));
  for (const region of runnable) region.selectionAge = (region.selectionAge ?? 0) + 1;
  const viable = (region: SolutionRegion) => region.candidateIds.filter((id) => network.candidates.find((candidate) => candidate.id === id)?.status !== "eliminated").length;
  runnable.sort((left, right) => (right.selectionAge ?? 0) - (left.selectionAge ?? 0) || viable(left) - viable(right) || right.lod - left.lod || left.id.localeCompare(right.id));
  let scheduledRegions = 0;
  for (const target of runnable) {
    if (scheduledRegions >= Math.max(1, width)) break;
    target.selectionAge = 0;
    if (target.status === "actionable") {
      const capability = target.delivery === "answer" ? "present" : "implement";
      const findingIds = network.findings.filter((item) => item.regionId === target.id && item.status === "open" && item.route.kind !== "blocked-external").map((item) => item.id);
      network = queueActivation(network, capability, target.id, capability === "present" ? "Answer the user using the supplied facts and choices." : "Make the required change and meet every success criterion.", `${capability}:${target.id}:${network.revision}`, currentContextRefs(network, [...target.evidenceIds, ...target.constraintIds, ...(target.requirementIds ?? [])]), findingIds);
    } else if (target.status === "implemented") {
      const previousFailure = network.activations.findLast((activation) => activation.regionId === target.id && activation.capability === "verify" && activation.status === "failed")?.error;
      const correction = previousFailure ? ` The previous verifier output was rejected: ${previousFailure} Correct that exact omission with criterion-specific execution evidence.` : "";
      const findingIds = network.findings.filter((item) => item.regionId === target.id && item.status === "repairing").map((item) => item.id);
      network = queueActivation(network, "verify", target.id, `Check the actual output (changed files or the answer) against every success criterion.${correction}`, `verification:${target.id}:${network.revision}`, currentContextRefs(network, [...target.artifactIds, ...(target.implementationPremiseRefs ?? []), ...(target.requirementIds ?? [])]), findingIds);
    } else if (target.status === "unrefined") {
      network = queueActivation(network, "refine", target.id, "Split the chosen approach into the next steps of work that together cover every success criterion and material requirement.", `refinement:${target.id}:${network.revision}`, currentContextRefs(network, [...target.evidenceIds, ...target.constraintIds, ...(target.requirementIds ?? [])]));
    } else if (target.domainPhase === "inspecting" || target.status === "unformed") {
      if ((target.inspectionAttempts ?? 0) >= inspectionLimit) {
        const unresolvedCriterionIds = target.inspectionObligationIds ?? target.criterionIds;
        const verdicts = (target.criterionVerdicts ?? []).filter((item) => unresolvedCriterionIds.includes(item.criterionId)).map((item) => `${item.criterionId}=${item.verdict}`).join(",") || "unreported";
        transitionRegion(target, "blocked", `Inspection pass limit reached for ${target.id}: used=${target.inspectionAttempts ?? 0} limit=${inspectionLimit}; unresolvedCriterionIds=${unresolvedCriterionIds.join(",") || "none"}; verdicts=${verdicts}.`, "blocked");
      target.blockedDetails = { kind: "inspection-pass-limit", unresolvedCriterionIds: [...unresolvedCriterionIds] };
      continue;
      }
      transitionRegion(target, "inspecting");
      const criterionIds = target.inspectionObligationIds ?? [];
      const inspectionPass = Math.min(2, (target.inspectionAttempts ?? 0) + 1);
      const failedInspections = network.activations.filter((item) => item.regionId === target.id && item.capability === "inspect" && !item.historical && item.status === "failed");
      const correction = failedInspections.length ? ` The previous inspection output was rejected: ${failedInspections.at(-1)!.error ?? "invalid structured output"} Correct that exact defect.` : "";
      const passInstruction = inspectionPass === 1 ? "Breadth pass: inspect the minimum dependency closure for every listed criterion." : "Gap pass: inspect only unresolved criteria and contradictions; return unknown or blocked rather than restarting general inspection.";
      const request = criterionIds.length ? `${passInstruction} ${criterionIds.map((criterionId) => `${criterionId}: ${target.acceptanceCriteria[target.criterionIds.indexOf(criterionId)]}`).join(" | ")}. Return one satisfied, unsatisfied, blocked, or unknown criterionEvidence verdict for every criterion addressed, with exact references.${correction}` : target.acceptanceCriteria.length ? `All inspection obligations are closed. Compare the recorded criterion verdicts for contradictions and return the evidence-backed decision boundary; do not create a validation claimRef for this comparison, and do not inspect generally.${correction}` : `${passInstruction} ${INITIAL_INSPECTION_REQUEST}${correction}`;
      const staleEvidence = target.evidenceIds.filter((id) => network.evidence.find((item) => item.id === id)?.status === "stale").sort();
      const recovery = staleEvidence.length ? `:${hash(staleEvidence)}` : "";
      network = queueActivation(network, "inspect", target.id, `${request} For a prescribed correction within this scope, prefer certified as soon as repository evidence establishes the concrete defect and bounded correction. Certification authorizes implementation; it does not assert completion. Tests and documentation that this implementation will add remain required implementation and verification checks; their current absence or unknown status alone does not require more inspection or a design domain. Use a decision boundary when a real design choice remains.`, `inspection:${target.id}:${criterionIds.join(",") || (target.acceptanceCriteria.length ? "boundary" : network.revision)}${recovery}`, currentContextRefs(network, [...target.evidenceIds, ...(target.requirementIds ?? []), ...criterionIds]));
    } else if (target.domainPhase === "ungenerated") {
      if (!target.decisionBoundary) {
        transitionRegion(target, "inspecting");
        network = queueActivation(network, "inspect", target.id, "Establish the missing evidence-backed decision boundary before generating solution families.", `decision-boundary:${target.id}:${network.revision}`, currentContextRefs(network, [...target.evidenceIds, ...(target.requirementIds ?? [])]));
      } else network = queueSynthesis(network, "generate-domain", target.id, "Generate every genuinely distinct solution family for this goal, without selecting or eliminating any. Return exactly one family only when no materially different alternative exists.", `generate-domain:${target.id}:${network.revision}`, currentContextRefs(network, [...target.evidenceIds, ...target.constraintIds, ...(target.requirementIds ?? [])]));
    } else if (target.domainPhase === "challenging") {
      network = queueSynthesis(network, "challenge-domain", target.id, "Freshly challenge the bounded local domain: accept it, give one complete missing family, report a boundary counterexample, or request one precise decision-relevant fact.", `challenge-domain:${target.id}:${target.boundDomainFingerprint}:${target.progress.reopenAttempts.count}:${target.progress.cegarRounds.count}:${network.revision}`, currentContextRefs(network, [...target.evidenceIds, ...target.constraintIds, ...target.candidateIds, ...(target.requirementIds ?? [])]));
    } else if (target.domainPhase === "selecting") {
      network = queueSynthesis(network, "select-candidate", target.id, "Compare every viable candidate by the deterministic preference tiers and select one, or request one grounding fact for an unresolved tie.", `select-candidate:${target.id}:${target.boundDomainFingerprint}:${target.progress.reopenAttempts.count}:${target.progress.selectionNoProgress.count}:${network.revision}`, currentContextRefs(network, [...target.evidenceIds, ...target.constraintIds, ...target.candidateIds, ...(target.requirementIds ?? [])]));
    }
    scheduledRegions++;
  }
  if (selectActivationBatch(network, width).length) return { network, done: false };
  const explicitlyBlocked = required.find((region) => region.status === "blocked");
  if (explicitlyBlocked) return { network, done: false, blocked: explicitlyBlocked.blockedReason ?? explicitlyBlocked.contradiction ?? `Region ${explicitlyBlocked.id} is blocked.` };
  if (runnable.length) {
    const first = runnable[0]!;
    const capability = first.status === "actionable" ? (first.delivery === "answer" ? "present" : "implement") : first.status === "implemented" ? "verify" : first.status === "unrefined" ? "refine" : first.domainPhase === "inspecting" || first.status === "unformed" ? "inspect" : "synthesize";
    const lastFailure = network.activations.filter((item) => item.regionId === first.id && !item.historical && item.status === "failed").at(-1)?.error;
    return { network, done: false, blocked: `Could not schedule ${capability} for ${first.id}; No activation can make a novel state delta.${lastFailure ? ` Last failure: ${lastFailure}` : ""}` };
  }
  const stalled = required.find((region) => region.status === "stalled");
  if (stalled) return { network, done: false, blocked: `Region ${stalled.id} stalled: ${stalled.progress.reopenAttempts.count} reopens without a new confirmed defeater` };
  return { network, done: false, blocked: "The solution network has no runnable activation and no completed root." };
}
