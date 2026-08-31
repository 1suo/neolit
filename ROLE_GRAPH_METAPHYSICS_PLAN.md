# Role Graph Repair Plan

Status: implemented on checkpoint schema v11.

## Goal

Make every advertised role transition executable, evidence-grounded, bounded, and auditable. Models propose typed acts; the controller alone admits facts, commitments, effects, repairs, and completion.

## Ontology

The graph has five durable kinds of entities:

1. **Claims**: hypotheses, confirmed facts, rejected claims, and stale facts.
2. **Decisions**: candidate domains, constraints, selections, and their premises.
3. **Work**: certified change or answer contracts with criteria and bounded resources.
4. **Defects**: criterion-linked findings with an explicit lifecycle and repair target.
5. **Certificates**: controller-produced proof that a transition or completion is admissible.

A valid transition has this form:

```text
typed proposal + admissible evidence + controller rule
    -> state change + provenance
```

A backward transition has this form:

```text
confirmed defeater + invalidated premise
    -> retract dependent commitments
    -> reopen the smallest affected frontier
```

## Already Applied

- Added `SOLUTION_ROLE_GRAPH` as the executable role-edge inventory.
- Added the Mermaid projection in `src/solution-lod/README.md` and role-contract coverage tests.
- Made refinement outcomes mutually exclusive and restricted refinement escalation to one inspection request.
- Removed implementation and verification helper delegation; escalation is controller-owned.
- Routed refinement inspection requests instead of silently discarding them.
- Bounded consecutive factless inspection requests independently of `expectedDelta` wording.
- Allowed fileless external findings while requiring files for local change repairs.
- Required confirmed evidence to reopen an earlier decision.
- Allowed high-severity repair work to run before terminal auditing.
- Retired failed review artifacts after successful repair work reaches re-verification.
- Rejected `already-satisfied` when measured workspace effects show a mutation.
- Denied graph lifecycle tools in every role's per-call tool map.
- Promoted defects into a durable finding ledger with typed targets, routes, and repair provenance.
- Added deterministic leaf completion certificates and certificate-backed dependency, audit, and final-result authority.

## Phase 1: Complete the Outcome Algebra (Implemented)

Replace remaining bags of optional fields with one discriminated outcome per role.

```text
inspect    = facts | boundary | need-fact | decompose | certified | answer
generate-domain = candidates
challenge-domain = accept | counterexample | boundary-counterexample | needs-fact
select-candidate = selected | hard-constraint | needs-fact
refine     = boundary | need-fact | children | leaf
implement  = completed | already-satisfied | blocked
verify     = pass | repair | reopen | fail
present    = answer
```

Metaphysics: one output is one speech act. Contradictory acts must be unrepresentable rather than resolved by reducer precedence.

Acceptance:

- Every role and synthesis-operation schema has exactly one discriminator.
- Every discriminator appears exactly once as an outcome vocabulary entry in `SOLUTION_ROLE_GRAPH`.
- Outcome vocabulary remains separate from state-dependent routing: one outcome may have several legal targets selected by delivery type, evidence state, or an exhausted bound.
- Every reducer uses an exhaustive switch over its role outcomes.
- Unknown fields are rejected at the model boundary.
- Existing happy-path and recovery tests pass without compatibility shims.

## Phase 2: Promote Defects to First-Class State (Implemented)

Add `SolutionFinding` records instead of storing the only finding state inside completion-review artifacts.

Minimum fields:

```ts
{
  id,
  regionId,
  criterionId,
  severity,
  target: { kind: "files" | "answer" | "environment" | "external"; refs: string[] },
  problem,
  evidenceRefs,
  regressionCriterion,
  status: "open" | "repairing" | "resolved" | "superseded",
  sourceActivationId,
  repairActivationIds,
}
```

Replace `repairRegionId` with a typed route:

```text
local-repair(regionId)
answer-repair(regionId)
reopen-decision(regionId, invalidatedPremiseRefs)
blocked-external(regionId, resolutionOwner, requiredEvidence)
```

Metaphysics: a defect is an entity that persists through observation, attempted repair, and resolution. A repair is a causal response to named defects, not merely another edit.

Acceptance:

- Repair activations cite one or more open finding IDs.
- Successful work moves cited findings to `repairing`, not directly to `resolved`.
- Only a later verification pass may mark them `resolved`.
- Failed repair leaves findings open and records the attempted activation.
- Environment or external defects with no graph-owned remedy remain `open` and route the region to controller-owned `blocked-external`; observation alone never marks them `repairing`.
- `blocked-external` records who or what can resolve the defect and the evidence required before resume.
- No leaf or run completion certificate is valid while a required finding remains open or repairing.
- Terminal auditing checks open findings rather than historical review artifacts.

Checkpoint impact: bump the state version because findings become persisted graph state. Keep the existing start-fresh policy unless migration of active persisted runs becomes an explicit requirement.

## Phase 3: Separate Progress Ledgers (Implemented)

Replace overloaded progress state with counters for distinct recurrence classes:

```text
inspectionNoProgress
cegarRounds
selectionNoProgress
reopenAttempts
repairCycles
schemaRetries
```

Reset a counter only on progress relevant to that loop:

| Loop | Progress |
|---|---|
| Inspection | New confirmed evidence, resolved claim, or admitted boundary change |
| CEGAR | New non-duplicate candidate or admitted boundary repair |
| Selection | Changed viable domain, new confirmed preference fact, or commitment |
| Reopen | New confirmed defeater or changed invalidated premise set |
| Repair | Changed measured effect or changed finding set |
| Schema | Structurally valid output |

Metaphysics: progress is semantic novelty, not token expenditure, activation count, request wording, or a new identifier.

Schema retry ownership is shared but authority is not: the runtime harness records each validation/repair attempt and returns its retry trace; the controller persists the authoritative cumulative `schemaRetries` count in checkpointed activation state. The count is keyed by the logical activation identity (`idempotencyKey` plus admitted context fingerprint), survives session restart, continue, and fork recovery, and resets only when the controller admits genuinely new activation context. The harness receives the remaining allowance and cannot reset the bound by opening a new session.

Acceptance:

- Renaming requests cannot reset a no-progress limit.
- Unrelated evidence cannot reset a repair or selection loop.
- Restarting or forking an activation session cannot reset its schema retry bound.
- Every bounded loop reports its counter, semantic fingerprint, and unresolved criteria when blocked.
- Replay produces the same block decision regardless of activation completion order.

## Phase 4: Make the Role Graph Authoritative (Implemented)

Use `SOLUTION_ROLE_GRAPH` to validate contracts rather than duplicating topology in tests and documentation.

Add only the derivations needed now:

- Validate that every schema outcome has an edge.
- Validate that every executable nonterminal target resolves to either a capability role contract or a synthesis-operation contract.
- Define action requirements independently of edges: `producesObservation`, `consumesEvidence`, `mutatesWorkspace`, `executesChecks`, and `presentsResult`.
- Validate role tools against the actions that role performs, never against facts carried by an incoming edge.
- Keep `inspect` as the repository-observation producer, `synthesize` and `refine` as tool-free evidence consumers, `implement` as the bounded workspace mutator, and `verify` as a non-mutating check executor.
- Generate the Mermaid block in `src/solution-lod/README.md` from the edge inventory.

Do not rewrite the scheduler into a generic graph interpreter. Existing reducer branches remain clearer for state-dependent routing.

Metaphysics: topology describes legal causal succession; capabilities describe what an action may do. Evidence crossing an edge does not transfer the producer's authority to its consumer.

Acceptance:

- Adding or removing a role outcome without updating the edge inventory fails a test.
- A role permission incompatible with its declared action requirements fails a test.
- Tool-free consumers may receive repository evidence without receiving repository tools.
- Verification may consume measured mutation artifacts without receiving mutation authority.
- Generated Mermaid is stable and matches the committed document.
- The scheduler retains explicit state-dependent routing and existing behavior.

## Phase 5: Add Completion Certificates (Implemented)

Create a controller-derived leaf certificate immediately after a qualifying verification pass. Terminal auditing consumes valid leaf certificates and may produce an optional root/run completion certificate.

```ts
{
  regionId,
  criterionIds,
  selectedFamilyIds,
  premiseRefs,
  dependencyFingerprint,
  measuredArtifactIds,
  focusedCheckArtifactIds,
  releaseCheckArtifactIds,
  resolvedFindingIds,
  verificationActivationId,
  createdRevision,
}
```

`selectedFamilyIds` contains exactly one family unless the controller has proved that all listed selected candidates form the permitted equivalent set. Answer certificates omit mutation fields but still include criteria, evidence, findings, and verification.

Metaphysics: completion is a proof object, not a region label. `verified` means a verification act occurred; a certificate means the controller proved that all completion obligations hold together.

Certificate validity is a deterministic predicate over exact dependencies, not global revision equality. `createdRevision` records provenance only. Recompute `dependencyFingerprint` from:

- selected candidate IDs and their equivalence proof;
- selection, implementation, and verification premise evidence IDs plus evidence status/fingerprints;
- measured file/answer artifact IDs plus content fingerprints and historical state;
- focused and release check artifact IDs plus results;
- resolved finding IDs plus current status;
- the verifier activation ID, its admitted read references, and outcome.

Unrelated sibling revisions do not invalidate a certificate. A changed or historical dependency, stale evidence, reopened selection premise, changed measured effect, reopened finding, or superseded verifier activation does.

Acceptance:

- A qualifying verification pass creates or replaces that leaf's certificate immediately.
- `ensureRunnableWork` returns done only when every required leaf has a currently valid certificate.
- Stale evidence, reopened premises, historical artifacts, changed measured effects, reopened findings, or superseded verification invalidate only dependent certificates.
- Unrelated sibling progress leaves a valid leaf certificate intact.
- Final output cites certificate-backed artifacts rather than reconstructing completion from scattered state.
- Certificate derivation is deterministic and model-free.
- Root/run completion certification, if stored, is derived from the exact set of valid required leaf certificate IDs and their fingerprints.

## Implementation Order

1. Complete discriminated role schemas and exhaustive reducer switches.
2. Introduce first-class findings and typed repair routes.
3. Split and test semantic progress ledgers.
4. Derive contract, capability, and Mermaid checks from `SOLUTION_ROLE_GRAPH`.
5. Add completion certificates and simplify terminal auditing around them.
6. Run both repositories' complete tests, builds, connector validation, and `git diff --check` after every phase.

## Non-Goals

- No generic workflow engine inside the reducer.
- No new dependency for graph rendering or schema derivation.
- No migration layer for old checkpoints without a concrete persisted-run requirement.
- No model-authored facts, completion certificates, or lifecycle authority.
- No automatic repair selection based only on severity.

## Final Invariant

```text
Models propose interpretations and actions.
Tools produce observations and measured effects.
The controller admits evidence and commitments.
Verification produces findings.
Only controller rules produce repair routes and completion.
```
