# Focused graph context and domain-generation correction

This proposal fixes the failures observed in run
`f53428fa-73b7-4eb0-9402-3e90af100c3a` without adding a second dependency
engine or splitting one model judgment across unnecessary activations.

## Measured problem

The run accumulated about 1.93 million input tokens and 15.31 million
cache-read tokens across 35 calls, while the sum of projected prompt content
was about 329,657 characters. It performed repeated repository work, had eight
structured-validation failures, and never reached implementation or
verification.

The evidence supports four immediate changes:

1. Measure context composition and replay the failure before redesigning more
   protocol.
2. Replace shared generic context with typed, dependency-projected role packets.
3. Deduplicate and scope repository reads within each activation or immutable
   workspace snapshot.
4. Admit shared-choice topology before generation, then let generation return
   complete candidates with admitted variable IDs and canonical value labels.

The evidence does not yet justify durable cross-run repository chunks, a
transitive chunk dependency graph, authority-fragment classification, a general
cyclic CSP solver, or a separate candidate-binding activation.

## Preserved invariants

- The original user task and relevant conversation remain immutable authority.
- Models propose semantic content; schemas, validators, reducers, and the kernel
  determine what is admitted and what follows from it.
- Every activation receives a locally exhaustive packet for its role, not a
  clipped transcript or token-budget approximation.
- Stable IDs carry requirements, criteria, decisions, evidence, constraints,
  and artifacts between activations.
- Candidate stances preserve existing `requires`, `excludes`, and `prefers`
  semantics, including multiple stances on one variable.
- Preferences may rank but never prune, bind, or force selection.
- Challenge acceptance and selection are tied to every semantic input that can
  change viability or propagation.
- Operational limits, watchdogs, cancellation, retries, and no-progress guards
  remain separate from semantic outcomes.

No semantic context is dropped merely to satisfy a size target. Context is
reduced only by typed reachability, reference reuse, and scoped retrieval.

## 1. Telemetry and replay first

Add telemetry before changing context or synthesis contracts:

```ts
interface ActivationContextTelemetry {
  activationId: string;
  role: "inspect" | "synthesize" | "refine" | "implement" | "verify" | "present";
  operation?: string;
  projectedCharsBySection: Record<string, number>;
  repositoryReadChars: number;
  otherToolOutputChars: number;
  duplicateReadCharsAvoided: number;
  accumulatedSessionInput: number;
  cacheReadInput: number;
  structuredRepairAttempts: number;
  outcome: string;
}
```

Record these values per activation and aggregate them by role and operation.
Capture a replay fixture from the failing run that records:

- Activation order and role
- Packet section sizes
- Repository and other tool output separately
- Repeated path/range reads
- Session accumulation and cache reads
- Structured-output repairs
- Semantic state transitions and terminal outcome

The replay is the baseline for later phases. Each phase must show which measured
source of accumulation it reduces without changing the expected semantic
outcome, except where the fixture represents the coupling defect being fixed.

Replay is a gate, not a final audit. Run it immediately after typed packet
projection and again after activation-scoped repository reads. Record the delta
from the same baseline by role and operation before proceeding. A phase that
does not reduce its targeted packet, tool-output, repeated-read, or session
metric is revised or dropped; later phases cannot be credited for hiding its
failure.

## 2. Typed dependency-projected packets

Replace generic context objects and broad object spreads with a discriminated
union:

```ts
type ActivationPacket =
  | InspectPacket
  | SynthesizePacket
  | RefinePacket
  | ImplementPacket
  | VerifyPacket
  | PresentPacket;
```

Every packet contains the exact immutable original task once, every exact
authoritative conversation message that amends or clarifies its scope, stable
requirement and criterion records relevant to the region, and only semantic
objects reachable from that activation. Authoritative conversation means user
messages and host-authorized system messages; assistant/tool text is evidence,
not authority. If conversation relevance cannot be established
deterministically, include the complete authoritative conversation frame. Do not
add authority range fragmentation in this phase.

Version 9 replaces the lossy `conversationContext: string` authority source
with an append-only checkpointed frame:

```ts
interface AuthoritativeMessage {
  id: string;
  role: "user" | "system-authorized";
  exactText: string;
}

interface AuthorityScopeAdmission {
  messageId: string;
  scopeIds: string[] | "all";
  admittedRevision: number;
  source: "provisional-all" | "trusted-host-scope";
}

interface SolutionLodV10InitialInput {
  task: {
    id: string;
    exactText: string;
  };
  authoritativeMessages: AuthoritativeMessage[];
  diagnosticContext?: string;
  directory: string;
  worktree: string;
  runId: string;
}

interface DefaultConnectorInitialInput {
  task: string;
  conversationContext?: string;
  directory: string;
  worktree: string;
  runId: string;
}

interface ConnectorGraph<State, InitialInput = DefaultConnectorInitialInput> {
  initial(input: InitialInput): State;
}
```

The host assigns stable message IDs and stamps authorized system sources; model
output cannot create authority. On ingestion, the controller atomically gives
every authoritative message a provisional `scopeIds: "all"` admission before
any potentially affected activation can run. Root inspection therefore always
receives the complete authoritative frame.

Model output may annotate likely relevance but cannot replace or narrow a
provisional admission: deterministic code cannot prove complete semantic
extraction from arbitrary text. Narrowing is allowed only when the trusted host
or user supplies scope metadata whose coverage is complete by construction; the
controller validates those exact message/scope IDs and records
`source: "trusted-host-scope"`. Otherwise `"all"` remains for the life of this
phase. A newly formed child scope receives parent/`"all"` authority before its
first activation. Later authoritative messages receive the same provisional
`"all"` admission before scheduling resumes. Packet projection follows only
these controller-owned links and therefore reproduces the same exact authority
after checkpoint/resume without parsing a summary string. Semantic model-driven
narrowing remains deferred with authority fragmentation.

`initial()` accepts only `SolutionLodV10InitialInput`. `task` is the exact
initiating user message; `authoritativeMessages` contains only subsequent exact
user messages and system messages whose source is allowlisted by the host.
Assistant, tool, presenter, and model output is rejected from both authority
fields. The legacy `conversationContext` field is rejected for v10 rather than
wrapped in a synthetic user message. Optional `diagnosticContext` is explicitly
untrusted and cannot create requirements, permissions, prohibitions, or scope
links. Resume restores the authoritative frame and admissions from the durable
checkpoint exactly; runtime or diagnostic text cannot replace or reconstruct
them.

The shared connector is generic over its initial-input type. `defineGraph` and
related configuration helpers preserve `InitialInput`; they do not replace the
default for unrelated graphs. Existing/custom graphs continue to use
`DefaultConnectorInitialInput`. The solution-LOD preset binds
`ConnectorGraph<SolutionLodState, SolutionLodV10InitialInput>` and a trusted host
adapter constructs that input from host-native exact message records before
calling `initial()`. The adapter rejects legacy `conversationContext` as
authority and cannot wrap a summary in a synthetic user message.

The packet compiler starts from the activation and target region and traverses
these existing relationships:

```text
activation -> target region
region/scope -> original task and authoritative conversation messages
region -> scope, requirements, criteria, local candidates, constraints
selected region -> selected ancestor lineage and visible shared coordinates
visible shared coordinate -> binding holders, binding/unavailability witnesses, operative constraints
binding/unavailability witness -> candidate or constraint and cited evidence
candidate/constraint -> cited evidence and artifacts
region -> unresolved claims and questions
requirement -> owning criterion
implementation -> changed-file artifacts and checks
verification -> exact criteria, implementation artifacts, and unresolved failures
```

It then applies a role allowlist, deduplicates semantic bodies by stable ID, and
serializes in deterministic order. IDs may recur as graph references; object
bodies must not.

Coordinate traversal is mandatory before the role allowlist is applied. A role
that receives a visible shared coordinate also receives every current binding
and unavailability witness that can affect it, the operative constraints behind
those witnesses, and their cited evidence. It does not receive unrelated
constraints merely because they share an ancestor region.

### Role packets

| Role | Required local content | Excluded content |
| --- | --- | --- |
| Inspect | objective, authority, relevant requirements/criteria, fixed decisions, known facts, unresolved questions/claims, repository scopes | unrelated candidates, sibling state, implementation artifacts |
| Synthesize | one operation, local objective, authority, requirements/criteria, admitted decision boundary, confirmed facts, relevant constraints and unresolved claims, current local domain | repository transcript, unrelated artifacts, sibling-private state |
| Refine | authority, selected approach, fixed ancestor choices, requirements/criteria, relevant constraints and unresolved claims, supporting facts/artifacts | rejected alternatives and unrelated ancestry |
| Implement | authority, certified leaf, selected lineage, exact criteria, relevant constraints, allowed paths, supporting facts/artifacts | unrelated domains and repository transcripts from prior roles |
| Verify | authority, exact criteria, selected lineage, relevant constraints, measured changes, implementation evidence, required checks | unrelated repository history and rejected alternatives |
| Present | authority, verified outputs, exact requirements, unresolved items that must be disclosed | mutable workflow state and raw tool transcripts |

Role packets are complete contracts. A missing required dependency is a blocked
activation with a precise missing reference, not permission to fetch the whole
graph or a recent transcript tail.

Reopening is controller-only. A region may reopen only when: authoritative task
or conversation changes one of its owned requirements/criteria; a current
premise of its boundary, domain, selection, refinement, implementation, or
verification becomes stale or invalid; an admitted boundary counterexample
targets it; a verification finding cites a failed criterion it owns; or the
operator explicitly prunes it. The controller reopens the nearest responsible
region to the earliest invalid phase and removes only state conditional on that
premise. Models cannot request an untyped generic reopen, and unrelated verified
regions survive.

## 3. Scoped repository reads for every tool-using role

Use content-addressed reads within one activation-local immutable workspace
snapshot:

```ts
interface SnapshotChunk {
  id: string;
  snapshotEpoch: number;
  canonicalPath: string;
  range: [number, number];
  fileDigest: string;
  content: string;
}
```

`id` is derived from canonical path, range, and complete file digest. The file
is read once for that snapshot, hashed from the same bytes, and sliced from that
content. Repeated reads return the existing chunk reference instead of appending
the same content to the session.

An implementation activation advances through immutable snapshot epochs. After
every successful mutating tool call, the controller records the actually changed
paths, increments `snapshotEpoch`, and invalidates current cached chunks only for
those paths. The next read of a changed path reads current bytes and computes a
new complete file digest in the new epoch. Unchanged-path chunks remain reusable
across epochs. Chunks from earlier epochs remain diagnostic history but
`graph_read` and ordinary reads cannot return them as current after their path
was invalidated. Interrupted or malformed tool output does not hide observed
writes; worktree reconciliation supplies the changed-path set before another
read or activation result is accepted.

Inspectors receive:

```text
graph_search(query, repositoryScopes)
graph_discover(query)
graph_read(chunkId)
graph_request_scope(paths, reason, evidenceRefs)
```

- Search returns descriptors and chunk IDs, not full matching files.
- Discovery returns bounded path/symbol descriptors without file bodies.
- Reads outside admitted canonical scopes are rejected.
- Scope expansion is model-proposed, controller-validated, and recorded.

Implementers and verifiers keep the mutation and test tools their roles require,
but ordinary file reads use the same snapshot/read-reference path wherever that
does not interfere with mutation. Their generic tool output is measured
separately so replay data can show whether further role-specific controls are
needed.

Repository evidence stores its canonical path, range, and file digest. Before
that evidence is used to prune, accept a domain, select, implement, certify, or
verify, the controller compares the current file digest. A mismatch marks the
evidence `status: "stale"`; this is a new non-confirmed `SolutionEvidence`
status, not a new dependency subsystem. One pure
`invalidateStaleEvidence(network, evidenceIds)` transition then atomically
computes the nearest responsible regions and earliest invalid lifecycle phase
before calling `propagateNetwork`/`refreshDomainControls`.

The invalidation transition handles every checkpoint-visible consequence:

| Earliest stale premise | Atomic rollback |
| --- | --- |
| Boundary | Clear the admitted boundary and both fingerprints; retire its candidate domain; clear acceptance, challenge verdict, selection, certified leaf, answer, implementation/verification state and artifacts; purge conditional descendants; reopen inspection/refinement. |
| Domain | Clear accepted fingerprint, challenge verdict, selection, certified leaf, answer, implementation/verification state and artifacts; purge conditional descendants; retain the unaccepted domain and return to challenge. |
| Selection only | Preserve the accepted fingerprint, challenge verdict, and domain; clear selection, certified leaf, answer, implementation/verification state and artifacts; purge selection-conditional descendants and return to selection. |
| Refinement/certification | Clear the certified leaf/refinement result, answer, implementation/verification state and artifacts; purge refinement descendants; retain the accepted selection and return to refine. |
| Implementation | Clear implementation completion/premises and answer; retire implementation and verification artifacts/verdict; retain the certified leaf and return to actionable. |
| Verification | Clear the verification verdict and answer; retire verification artifacts; retain implementation and return to verify. |

Retired artifacts remain historical for audit but cannot satisfy current
criteria. Queued activations whose typed read sets contain a stale premise are
superseded. Running activations are cooperatively cancelled when possible, and
their results are rejected on landing by basis/read-set validation. No partial
rollback is checkpointed.

Rollback is semantic only. It never resets, checks out, overwrites, stashes, or
discards files already changed in the worktree. Actual file contents remain the
authoritative observed workspace state, and changed paths remain recorded in
worktree observations and activation history even when their completion
artifacts are retired. A later implementation packet receives those current
changes and must reconcile them against the renewed contract; it cannot assume a
clean pre-implementation workspace. Pre-existing and unrelated user changes
remain distinct and untouched.

The transition applies only to regions that cite the stale premise and chooses
the nearest owner of the affected criterion or semantic state. Unrelated
siblings and already verified regions remain unchanged. Fixed-point propagation
then retracts derived consequences whose premises are no longer confirmed.

If stale evidence is referenced by the admitted decision boundary itself, the
controller invalidates that boundary, retires its local candidate domain, and
reopens inspection/refinement. Rechallenging against the same unsupported
boundary is not permitted.

This phase deliberately does not persist chunk bodies across runs and does not
add a reverse chunk-to-graph dependency network. Add durable caching only if
role telemetry shows repeated reads across activations are a material remaining
cost.

Before adding such a cache, reuse exact semantic work across activations:

- Current confirmed evidence IDs instead of repeating their text or inspection
- Persisted canonical path/range/file-digest references when their digest is
  still current
- Existing activation suppression for identical capability, expected delta, and
  typed read-set fingerprints at the same semantic revision

Do not fuzzy-match inspection prose or infer reuse from textual similarity. A
new activation is suppressed only by exact IDs and fingerprints.

## 4. Admit topology before generation

Inspection or refinement may propose semantic variables, known canonical seed
labels, and permitted pair couplings before a domain is generated:

```ts
interface DecisionBoundaryProposal {
  basisRevision: number;
  variables: Array<{
    key: string;
    name: string;
    ownerRegionId: string;
    seedLabels: string[];
    evidenceRefs: string[];
  }>;
  permittedPairs: Array<{
    leftVariableKey: string;
    rightVariableKey: string;
    evidenceRefs: string[];
  }>;
}

interface DecisionBoundary {
  fingerprint: string;
  variables: Array<{
    id: string;
    name: string;
    ownerRegionId: string;
    seedLabels: string[];
    evidenceRefs: string[];
  }>;
  permittedPairs: Array<{
    leftVariableId: string;
    rightVariableId: string;
    evidenceRefs: string[];
  }>;
}
```

The controller assigns IDs and atomically validates ownership, visibility,
evidence, basis revision, canonical names, and the complete global primal graph.
Each permitted pair is one undirected edge. Admission rejects an edge that would
close a cycle before generation starts.

The current forest solver is retained. Because one candidate taking stances on
multiple variables forms a primal clique, a candidate may touch two variables
only when that pair was admitted. A joint move over three or more distinct
variables cannot fit the forest and must be represented by a model-proposed
composite variable or a decomposition of the local decision before generation.
Deterministic code does not infer or merge semantic variables from prose.

Later candidate stances and cross-variable constraints may reference admitted
topology but cannot create edges. A genuinely missing family that cannot be
represented by the current boundary produces a boundary counterexample,
invalidates the current domain, and reopens inspection/refinement. It consumes
the existing bounded CEGAR repair round; exhaustion remains a semantic block.

```ts
interface BoundaryCounterexampleOutput {
  operation: "challenge-domain";
  verdict: "boundary-counterexample";
  boundDomainFingerprint: string;
  missingFamily: { key: string; proposition: string };
  defect: { kind: "missing-variable" | "missing-pair"; description: string };
  evidenceRefs: string[];
}
```

This result cannot declare topology. Its reducer validates the current bound
fingerprint and evidence, increments the existing CEGAR round, clears domain
acceptance and selection, retires the old candidates and coordinates, purges
descendants, and returns the now-ungenerated region to inspection/refinement for
a new boundary proposal. Regeneration after this transition preserves the
incremented CEGAR round instead of applying the normal new-domain reset.

## 5. Generate complete candidates with admitted stances

Do not add `bind-domain`. Generation is the one model judgment that enumerates
a complete family and positions it on the already admitted boundary:

```ts
type CandidateVariablePosition =
  | {
      variableId: string;
      applicability: "applies";
      stances: Array<{
        relation: "requires" | "excludes" | "prefers";
        valueLabel: string;
      }>;
    }
  | {
      variableId: string;
      applicability: "not-applicable";
      reason: string;
    };

interface DomainGenerationOutput {
  operation: "generate-domain";
  evidence: HypothesisEvidence[];
  candidates: Array<{
    key: string;
    proposition: string;
    evidenceRefs: string[];
    coordinates: CandidateVariablePosition[];
  }>;
}
```

Validation requires:

- One position for every variable in the admitted local boundary
- No duplicate variable positions
- At least one stance when applicability is `applies`
- Any number of distinct stances for one applicable variable
- Only admitted variable IDs and canonical value labels
- No duplicate identical stance
- Every pair of touched variables already present in `permittedPairs`
- No variables, edges, constraints, rankings, eliminations, or selections
  declared by generation

This preserves multivalued relations such as requiring A, excluding B and C,
and preferring A without requiring it. Value labels use the existing canonical
normalization and collision checks; generation may introduce a new canonical
label without changing topology. Merge stores the existing kernel
`CandidateStance` representation directly. Non-applicable positions and reasons remain
activation diagnostics rather than persisted semantic state. Because validation
requires one position per boundary variable and at least one stance for every
applicable position, later fingerprint computation reconstructs
non-applicability as the admitted-boundary variables absent from the candidate's
stances. No new candidate storage field or propagation rewrite is required.

Challenge counterexamples use the same complete candidate contract. If the
counterexample needs an unadmitted variable or pair, it returns a boundary
counterexample instead of smuggling topology into the candidate.

## 6. Fingerprint enumeration and bound semantics separately

Use two identities:

```ts
enumerationFingerprint = hash({
  boundaryFingerprint,
  candidates: canonicalUnboundCandidates,
});

boundDomainFingerprint = hash({
  enumerationFingerprint,
  canonicalCoordinates,
  relevantConstraints,
  evidenceState,
  visibleCommitmentState,
});
```

`canonicalUnboundCandidates` includes controller candidate ID, key,
proposition, and evidence references. `canonicalCoordinates` is reconstructed
for each candidate and each boundary variable, sorted by candidate ID then
variable ID, as:

```ts
{
  candidateId: string;
  variableId: string;
  applicable: boolean;
  stances: Array<{ relation: "requires" | "excludes" | "prefers"; valueLabel: string }>;
}
```

`applicable` is true exactly when the checkpointed candidate has at least one
stance on that variable. Stances are sorted by relation and canonical value label.
The diagnostic non-applicability reason is excluded from semantic state and both
fingerprints. `relevantConstraints` includes all live local or
visible-coordinate constraints that affect the domain.
`evidenceState` is the recursive closure of evidence referenced by the boundary,
candidates, relevant constraints, and each evidence item's validation
references. For every item it includes the evidence ID, content fingerprint,
source authority/kind, confirmation status, and validation references. A
validation source becoming stale therefore changes the bound fingerprint even
when the candidate's direct evidence references are unchanged.
`visibleCommitmentState` preserves every inherited witness rather than
collapsing a coordinate to one holder:

```ts
interface VisibleCommitmentFingerprintEntry {
  variableId: string;
  bindingWitnesses: Array<{
    candidateId: string;
    regionId: string;
    relation: "requires";
    valueLabel: string;
  }>;
  unavailabilityWitnesses: Array<{
    constraintId: string;
    valueLabel: string;
    evidenceRefs: string[];
  }>;
  conflictValues: string[];
}
```

Entries sort by variable ID. Only selected `requires` stances become binding
witnesses; `excludes` and `prefers` remain in persisted candidate stances and
never contribute to binding or conflict derivation. Binding witnesses sort by
candidate ID, region ID, and canonical value label. Unavailability witnesses
sort by constraint ID, canonical value label, and sorted evidence references.
`conflictValues` is the sorted set derived from conflicting binding-witness
labels and is checked against that derivation before hashing. Adding, removing,
or changing any witness therefore invalidates acceptance even when another
witness still binds the same coordinate.

Both fingerprints are pure functions of checkpointed boundaries, candidates,
stances, constraints, evidence records, selected stance holders, and their
stable IDs. They must recompute byte-identically after serialize/restart; no
activation-local diagnostic or model output object is an input.

The controller computes both fingerprints after generation or a normal
counterexample merge. Challenge, challenge acceptance, selection, refinement,
implementation, and certification use only `boundDomainFingerprint`. Any
change to boundary, candidate content, stances, relevant constraints, or cited
evidence authority/status recomputes the bound fingerprint and revokes stale
acceptance and downstream decisions through the existing lifecycle.

`enumerationFingerprint` exists to identify the unbound candidate enumeration
for validation and telemetry. It is never sufficient for acceptance or
selection.

## 7. Use one semantic transition

Structured validation and committed merge must execute the same pure semantic
transition:

```ts
const preview = applyActivationOutput(snapshot, activation, parsedOutput);
```

Validation runs the transition on a snapshot; merge commits the same result.
Invalid structured output is repaired in the same child session with the exact
failed precondition. Deterministic failures are not retried against unchanged
state.

## 8. Version checkpoint-visible semantics

Bump `SolutionLodState.stateVersion` from `9` to `10` before persisting durable
findings, artifact fingerprints, typed check artifacts, and completion
certificates. Version 10 retains the v9 admitted decision boundary, authority,
evidence, and fingerprint inputs and adds the exact dependencies needed to
recompute certificate validity without global-revision invalidation.

There is no automatic v9-to-v10 migration for active runs: v9 did not record
durable finding lifecycle or enough artifact provenance to derive certificates
safely. Resume, prune, or mutation of an older checkpoint returns the precise
`incompatible-checkpoint; start a fresh run` result. Archived data remains an
analysis input, but replay starts fresh v10 state rather than inventing proof
objects for historical work.

Progress and TUI serialization are updated with:

- Boundary fingerprint and admitted variable/pair counts in compact region rows
- Enumeration and bound-domain fingerprints, domain phase, and CEGAR round
- Stale evidence status and the affected region/phase
- Full admitted variables, seed labels, permitted pairs, candidate stances,
  constraints, and evidence provenance in region detail
- Incompatible checkpoint status for v8 without attempting partial rendering as
  live v10 state

All connector snapshots, activation-task snapshots, progress projections, TUI
types, and test fixtures use state version 9 consistently.

## Required tests

Tests and replay fixtures must prove:

- Telemetry separates projected packets, repository reads, other tool output,
  session accumulation, cache reads, and repair attempts by role.
- Replay records and enforces separate measured gates after typed packets and
  after scoped repository reads.
- Replay reports a partial context improvement rather than completion when local
  duplicate reads fall but total accumulated session input does not.
- Every packet field is allowed for its role and reachable from its activation.
- A user clarification, permission, prohibition, or correction reaches every
  affected role packet as exact authoritative conversation text.
- A checkpoint/resume round trip preserves authoritative message IDs, roles,
  exact text, and scope links without reparsing a conversation summary.
- V10 `initial()` accepts the exact task and host-stamped authoritative messages,
  rejects assistant/tool/presenter authority and legacy `conversationContext`,
  and treats `diagnosticContext` as untrusted data.
- `ConnectorGraph<State, InitialInput>` and `defineGraph` preserve graph-specific
  input types; unrelated graphs retain `DefaultConnectorInitialInput`, while the
  trusted solution-LOD host adapter constructs `SolutionLodV10InitialInput` from
  exact message records and rejects summary-derived authority.
- Resume restores the checkpointed authority frame instead of rebuilding it
  from runtime or diagnostic text.
- Every authoritative message keeps controller-owned `"all"` coverage unless
  trusted host/user scope metadata establishes complete narrowing by
  construction; model-proposed relevance cannot replace that coverage.
- Every newly ingested authoritative message has a provisional controller-owned
  `"all"` admission before scheduling; omitting a message from proposed narrower
  links leaves that provisional admission and keeps the message visible.
- Refine receives relevant constraints and unresolved claims; implement and
  verify receive relevant constraints.
- Every projected visible coordinate includes its binding and unavailability
  witnesses, operative constraints, and cited evidence.
- Only the enumerated controller conditions can reopen a region, and reopening
  targets the nearest responsible phase.
- Semantic bodies and repository chunks are serialized once; stable IDs may
  recur as references.
- Unrelated graph changes do not alter a packet.
- Repository scope expansion is explicit and reads cannot escape admitted paths.
- Repeated reads in one activation-local snapshot return references.
- An implementer read, successful write, and reread returns the new bytes and
  digest in a new snapshot epoch while unchanged paths retain their cache.
- Implement and verify repository reads appear in role telemetry.
- Cross-activation reuse uses only current evidence IDs, exact
  path/range/digest references, and identical expected-delta/read-set
  fingerprints; prose similarity never suppresses work.
- A changed cited file digest makes repository evidence stale before
  consequential use.
- Stale boundary evidence retires the old domain and reopens boundary formation.
- Stale-premise invalidation atomically clears every field and artifact at or
  after the affected rollback frontier, supersedes stale queued work, rejects
  stale running results, and preserves unrelated verified regions.
- Semantic rollback retires completion evidence without changing worktree
  bytes, losing changed-path observations, or treating the next implementation
  as a clean checkout.
- Stale selection-only evidence preserves accepted domain/challenge state and
  returns to selection; stale domain evidence returns to challenge.
- Stale validation evidence makes dependent inference non-confirmed and changes
  the bound fingerprint through the recursive evidence closure.
- Boundary admission checks the complete global topology and rejects a
  cycle-closing pair before generation.
- Admitted variables and pairs retain their evidence references.
- Generation cannot declare or mutate topology.
- Generation emits no separate binding activation.
- One variable may carry multiple `requires`, `excludes`, and `prefers` stances.
- Stored stances plus the admitted boundary reconstruct every validated
  candidate position.
- Non-applicability reasons do not affect either fingerprint, and both
  fingerprints recompute identically from checkpoint state alone.
- Changing any stance changes `boundDomainFingerprint` but not
  `enumerationFingerprint`.
- Changing a relevant constraint or cited evidence authority/status changes the
  bound fingerprint and invalidates acceptance.
- Changing an inherited shared-coordinate commitment changes the bound
  fingerprint and invalidates acceptance.
- Adding, removing, or changing a second binding/unavailability witness or a
  conflict changes the bound fingerprint even when the first witness remains.
- Only selected `requires` stances become binding witnesses; selected `excludes`
  or `prefers` stances cannot create bindings or conflict values.
- Challenge and selection reject an enumeration fingerprint or stale bound
  fingerprint.
- Preferences never prune, bind, or force selection.
- Boundary counterexamples consume the existing CEGAR repair bound and reopen
  topology formation.
- Boundary repair retires the old candidate domain and regeneration preserves
  the consumed CEGAR round.
- Boundary-counterexample output cannot declare variables or edges.
- Structured validation and committed merge accept or reject the same output.
- A v10 durable-checkpointer round trip preserves boundaries, permitted pairs,
  stale evidence, both fingerprints, and byte-identical fingerprint
  recomputation.
- Active v8 resume and prune return the precise start-fresh incompatibility.
- Resume works from v10 checkpoints before generation, after bound generation,
  after challenge acceptance, and after boundary repair.
- Prune/reopen preserves unrelated verified regions while clearing the targeted
  boundary or downstream state required by its rollback frontier.
- Progress and TUI snapshots expose the new boundary, fingerprint, CEGAR, and
  stale-evidence fields.
- The recorded v9 failing run replays into a fresh v10 state with deterministic
  semantic transitions rather than loading the old checkpoint.
- The recorded coupling-cycle fixture no longer fails during candidate merge.
- Watchdogs, cancellation, operational caps, and no-progress guards remain
  behaviorally unchanged.

## Implementation order

1. Add per-role context/tool/session telemetry and capture the failing-run replay
   baseline.
2. Bump checkpoints to state version 9, make `ConnectorGraph`/`defineGraph`
   generic over initial input, add the trusted solution-LOD v10 host adapter,
   persist the structured authority frame, and update progress, TUI, and durable
   serialization with start-fresh rejection for v8 active runs.
3. Introduce provisional `"all"` authority coverage, trusted-metadata-only
   narrowing, typed role packets, and dependency projection without changing
   scheduler policy, then replay and pass the packet/session context gate.
4. Add activation-scoped content-addressed reads to every tool-using
   role, with digest revalidation for consequential evidence, then replay and
   pass the repository/tool-output context gate.
5. Move variable and pair-edge proposal/admission to inspection and
   refinement.
6. Change generation to return complete candidates with stance arrays against
   admitted variable IDs and canonical value labels; do not add a binding
   operation.
7. Add enumeration and bound-domain fingerprints, and switch challenge and all
   downstream admission checks to the bound fingerprint.
8. Route structured validation and merge through one transition, then replay the
   baseline and compare role-level measurements and semantic outcomes.

## Deferred until measured

- Authority source fragmentation and range classification
- Durable cross-activation or cross-run repository chunk storage
- A reverse repository-chunk dependency graph
- Additional implement/verify tool restrictions beyond scoped reads
- A general cyclic CSP/SAT backend

Add one of these only when telemetry identifies the concrete remaining cost or
correctness limitation it solves.

## Completion gate

Implementation is complete when the required tests pass and replay shows lower
measured repetition, repository/tool output, and total accumulated session input
against the same baseline, with preserved semantic outcomes and no
generation-time coupling-cycle failure. A scoped-read phase that reduces only
within-activation duplicate reads passes its local phase gate but does not prove
the overall context problem solved when total session input remains essentially
unchanged; that result is reported as partial and the measured cross-activation
remainder stays open. The result must retain exact original authority, complete
role-local context, current fixed-point propagation, bounded CEGAR, and all
operational safety behavior.
