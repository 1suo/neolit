# Solution LOD graph — desired-state specification

Status: normative desired behavior for the built-in `solution-lod` graph.

This document may lead the implementation. Shipped behavior is described in the
root [`README.md`](../../README.md) and this component's
[`README.md`](./README.md). Known gaps between current and desired behavior
belong in the root `TODO.md` or the relevant `TODO-*.md` file. A desired behavior
must not be presented as current until code and tests implement it.

## Purpose

The package is a harness-neutral LangGraph solution kernel. Its built-in graph
turns one authoritative task into a repository-grounded answer or verified
mutation by progressively resolving the solution at the resolution actually
required by the task.

Two structures are orthogonal:

1. The solution hierarchy represents the same problem at conditional levels of detail. WFC-style constraint propagation collapses its candidate domains.
2. The agent activation network is sparse message passing. Agents inspect, synthesize, refine, implement, verify, or present exact state deltas.

Agent routing is not WFC, and hierarchy depth is not automatically a LOD.

## LOD invariants

1. A region declares the variables permitted at its current LOD.
2. A region's candidates are mutually distinguishable solution families at that resolution.
3. Finer structure is created only by refinement after a candidate collapses; candidates never carry pre-committed child definitions.
4. Child regions materialize only from a successful refinement of a selected approach.
5. `refines` means the same solution at finer resolution; `partOf` means an independent deliverable region.
6. Different regions may remain at different LODs simultaneously.
7. Implementation begins when a required region is computed implementable, not at a configured depth.
8. Equivalent surviving candidates may be delegated as an implementer-local choice when no unresolved external constraint distinguishes them.
9. A contradiction reopens only the nearest implicated region. Unrelated collapsed regions and all observed artifacts survive.
10. Selection never implies actionability. Only successful refinement can create implementable leaves.
11. A genuine decision domain contains every materially distinct candidate — exactly one only when the boundary truly admits no materially different alternative — and must pass a fresh, fingerprint-bound challenge before selection or singleton collapse.
12. Challenge acceptance is bounded evidence that no concrete material omission was found, not a proof of semantic exhaustiveness.

## Terminality and refinement

Actionability is computed by the controller, never set directly by a model. Refinement returns exactly one certified leaf contract or one or more children, never both or neither. Children have unique names and collectively cover every parent criterion; multiple children may contribute to one cross-cutting criterion. Before returning a leaf, refinement attempts a two-way partition. Parent mutation-resource entries are exact partition units: children allocate every entry exactly once and may not substitute descendant paths; an inseparable coarse entry is evidence for a leaf rather than authority to refine the controller-owned scope. A certified leaf carries every stable criterion and material requirement ID, a bounded implementation scope and mutation resources, one executable check per criterion, only confirmed evidence references, and an exact atomicity witness explaining why splitting would overlap ownership, require unresolved coordination, or merely wrap the same change. Implementation additionally requires one selected candidate and acceptance of the exact current domain fingerprint; criterion count and LOD depth are not actionability rules. A new synthesis choice drops the previous refinement's subtree. Reopening does the same and returns an underspecified region to inspection.

## Solution state

Checkpoints are versioned. The desired schema retains exact controller-owned
authority, shared decision variables, candidate coordinates, constraint and
evidence provenance, authored/derived separation, typed findings, completion
certificates, independent progress ledgers, activation-local synthesis
operations, and fingerprinted domain phases. Checkpoints from incompatible
schemas are rejected with a precise start-fresh message unless an explicit
migration is implemented.

Hard constraint kinds are `requires`, `excludes`, and `equivalent`; evidence relations are `supports` and `refutes`. Acceptance criteria and permissions are policy fields rather than inert edges. Endpoints are validated by kind. Controller code recomputes derived domains to a fixed point, makes exclusion symmetric, and detects impossible requirements and empty domains. Forced selection and singleton collapse remain disabled until the current domain fingerprint is accepted.

## Activation network

The static LangGraph is an engine loop:

```text
schedule → acquire-if-mutating → activate → merge/propagate → schedule
```

Each activation specifies a capability, region, exact request, expected delta, stable context references, sender, basis revision, and status. Agents may propose downstream activations. Controller code validates region and context references and suppresses the same capability/region/delta at the same state revision.

Each activation sees only the downstream request forms currently legal for that role. It cannot create sessions, choose models, invent roles, or bypass the controller. Keeping the prompt local avoids presenting a degenerative model with irrelevant workflow choices.

The built-in capabilities are:

- `inspect`: gather only facts needed to form or distinguish the current alternatives;
- `synthesize`: perform exactly one of `generate-domain`, `challenge-domain`, or `select-candidate` without tools; it never generates and approves its own domain or declares work ready;
- `refine`: split the chosen approach into covering next-step children, each with its own criterion;
- `implement`: execute one computed-implementable change region;
- `verify`: check artifacts against exact criteria and target failures to regions;
- `present`: render a collapsed read-only answer.

Controller scheduling follows the region lifecycle:

```text
unformed → inspect
superposed → generate domain → challenge domain → select candidate
selected/unrefined → refine
refined with children → solve children
certified leaf + accepted selection (actionable) → implement
```

All capability contracts live in `src/solution-lod/roles.ts`. Graph nodes compile dependency-scoped semantic projections into role-native prompt sections; configuration chooses models and scheduling quanta.

After inspection, generation returns every materially distinct family the boundary contains (usually several; exactly one only when no materially different alternative exists) and cannot select or eliminate. A fresh challenge returns exactly one fingerprint-bound acceptance, one concrete missing family, or one decision-relevant fact request. At most one counterexample is merged per challenge and the enlarged domain is challenged again; `needs-fact` schedules focused inspection, then recomputes and rechallenges the domain. At most two counterexample repairs and seven total candidates are allowed. Selection compares every viable candidate only after acceptance, using user preference, confirmed repository compatibility, smaller scope/novelty, then lower irreversible risk as lexicographic soft tiers. A newly discovered hard constraint invalidates acceptance and returns to challenge instead of landing with selection. Preferences never become hard constraints. Bounds and repeated no-progress ties terminate as explicit blocks. Root material requirements bind to owning criteria structurally by `scopeKey` + `criterionIndex`; echoing criterion text remains only as a legacy binding. After admission, their definitions are controller-owned and reinspection may update only evidence through canonical requirement IDs; the model cannot re-emit or decompose the inventory.

Invalidation removes historical candidates from each region's live membership.
A challenging or selecting region left with no live candidates clears stale
acceptance and returns to generation when its boundary survives, otherwise to
inspection. Selection is never admissible without a non-empty domain and its
exact non-null bound fingerprint.

Inspection is bounded by a controller-owned obligation set initialized from the region's stable criterion IDs and by two physical passes: one breadth pass over every open obligation, then one gap pass over unresolved criteria and contradictions. A fact result must map task or confirmed repository evidence to at least one unresolved criterion through `criterionEvidence`; accumulating unrelated facts is not progress. Confirmed evidence that required behavior is absent, incomplete, unchecked, or contradicted produces `unsatisfied`; `unknown` is reserved for insufficient or conflicting evidence. `validations` may target only exact controller-projected live hypothesis IDs. An illegal optional validation target or meaningless evidence attachment on an `unresolved` validation does not invalidate independent, otherwise valid evidence or criterion verdicts; the controller drops and records only that field-local proposal. Once all obligations are closed, inspection compares the recorded verdicts for contradictions and returns the decision boundary; the comparison is not a hypothesis, and boundary admission is rejected while any criterion remains unresolved. Challenge and selection may reopen inspection only by naming exactly one concrete criterion ID; a boundary counterexample reopens the complete criterion set.

## Multi-task AND roots

One cohesive objective uses the normal root region. A request containing independently verifiable deliverables uses a root AND-container with one controller-assigned scope identity and one `partOf` child per material task. Each root requirement and acceptance criterion has exactly one typed owner; dependencies, inherited choices, and mutation conflicts use stable scope, criterion, variable, artifact, or path references rather than prose similarity.

Each child has its own lifecycle and follows normal inspection plus the bounded
domain/challenge/selection cycle whenever a decision domain is required.
Independent reads may run concurrently, while mutation remains fenced.
Terminality requires a deterministic bundle-coverage audit. Verified children
survive when another child blocks, and the result identifies every unresolved
scope and criterion. Repository-certified corrections take a focused inspect →
implement → verify path, while already-satisfied work proceeds from inspection
directly to verification.

## Context and failure semantics

An activation receives the exact admitted authority relevant to its scope,
stable-ID selected lineage, the current candidate slice, visible shared-variable
states with every binding or unavailability witness, and explicitly referenced
evidence, constraints, and artifacts. Diagnostic context is untrusted. Children
do not copy the parent's evidence set. Durable facts are stored once and passed
by ID.

Structured schemas enforce shape without small arbitrary prose limits. Invalid JSON, schema errors, timeouts, or a scheduling quantum stop fail the activation locally. The solution state remains available and another novel capability may run. Repeating failed work against an unchanged revision is forbidden. If no capability can produce a novel delta, the run returns a precise blocked result rather than looping.

### Verified context behavior (measured on real runs)

The desired projection obeys these properties:

- Activation payloads resolve `contextRefs` rather than unconditionally unioning the region's accumulated evidence and artifacts.
- Selected lineage is emitted once as `{regionId,candidateId,choice}` records so downstream agents can cite or request reopening of the exact premise.
- Child regions begin with an empty evidence-reference set and receive facts through explicit activation references.
- Facts are stored once and deduplicated by fingerprint; the accumulation is by reference, not by byte-for-byte duplication.
- The host enforces each role's scheduling quantum and returns typed budget or
  runtime failures without discarding partial usage, tool, session, or progress
  evidence. Inactivity, context exhaustion, and transport failure remain
  distinct failure classes.

Candidate-domain relationships remain local to the current region; evidence and artifacts are sparse by explicit reference.

Before implementation, the host captures the exact target baseline: `HEAD`, working-tree/index content, untracked content digests, and admitted mutation resources. The role mutates an isolated mirror of that baseline. Actual changes are measured atomically against the captured baseline even when final model output is malformed or interrupted; pre-existing dirty content is never misclassified as activation output.

After semantic implementation, the host replays only the measured activation delta onto clean `HEAD` in another isolated workspace. Verification runs against that replay. A passing replay is committed independently with exactly the admitted paths, and the commit identity, tree fingerprint, patch fingerprint, and preserved run ref are checkpointed before the host attempts a deterministic three-way landing into the locked user worktree. A concurrent landing conflict preserves the verified artifact and commit and blocks only integration; it must not reopen inspection, selection, refinement, implementation, or verification. A delta that cannot replay on clean `HEAD` is reported as a precise dependency on pre-existing dirty content rather than staged together with that content. Retry is idempotent, and no operation automatically stashes, resets, discards, or commits user-owned changes.

Repository evidence invalidation is mutation-epoch aware. A current digest equal to the controller-recorded landed digest is an admitted self-mutation and does not stale ancestor planning evidence; a later different digest is an external defeater and invalidates normally.

Turns, tokens, cache reads, and cost are telemetry and per-call scheduling quanta. They do not cause human budget interruptions or discard solution state. Human input is reserved for genuine decisions or authority that repository inspection cannot supply.

## Completion

A change region moves through unrefined (selected), collapsed (split), actionable (computed implementable), implementing, implemented, and verified. Repository delivery has an orthogonal `pending → landed | conflict` lifecycle. A verifier pass completes semantic verification; a change run completes only after landing. A bounded defect returns it to actionable; a contradicted solution choice reopens the targeted region and drops its refinement. A read-only region completes after presentation.

## Node contracts

The static graph is an engine loop, not a pipeline of model calls. Each node has a fixed output contract:

- `schedule` (pure controller): returns `{ network, activeActivationId, phase }` for the next activation, or `{ network, activeActivationId: undefined, phase: "completed"|"blocked", result }` when no runnable work remains. It never calls a model.
- `acquire` (before every mutating `implement`, including after resume): takes a process-local worktree lease without persisting lease ownership in checkpoint state. It never calls a model.
- `activate` (the only model-calling node): given one activation, calls `runtime.call({ agent, node, state, schema, prompt })` and returns one `ActivationTaskResult` record containing a validated delta, a deferred budget stop, or a serialized local error.
- `merge` (pure controller): deterministically orders the batch records, applies each record, and propagates after every attempt so failed output cannot leave stale derived locks. It then clears the result log and returns to scheduling.
- `finish` (pure controller): returns `{ result }` from the final state. It never calls a model.

`mergeSolutionDelta`, `mergeRefinementOutput`, and propagation run only in
controller code; models never mutate bookkeeping directly. Inference always
enters as a hypothesis, model-authored evidence status is ignored, claim
validation requires independent proof, and model deltas cannot assert
`user-task` provenance. A proposed eliminated outcome is stored as possible and
becomes eliminated only if accepted refutation rules derive it. Invalid
structured output is retried in the same activation session with only the failed
precondition, admissible correction, and prior invalid output. Every
state-bearing transition is checkpointable for host-managed inspection and
recovery.

## Release acceptance

A release requires reducer tests for refinement certification, coverage
rejection, mixed LODs, propagation, equivalence, convergence, and selective
reopening; compiled-graph tests for answer and mutation paths, malformed-output
failure, artifact reconciliation, and verifier feedback; typecheck, build, pack,
and clean-package installation checks; and at least one measured mutation run
through a conforming host runtime.
