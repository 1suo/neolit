# neolit

A pure **solution graph**: a bounded CSP + CEGAR + AND/OR LOD solver that
drives LLM activations through LangGraph to solve repository tasks by
progressively forming, challenging, selecting, decomposing, implementing, and
verifying solution regions.

`neolit` contains no agent-harness code. It ships the kernel, prompts, schemas,
lifecycle, checkpointing, and post-run invariant checks — and asks its host for
exactly one thing: an async `AgentRuntime.call()`.

## Core ideas

### Explore broadly, then deepen conditionally

The graph progressively constructs and reduces a hierarchy of constrained
decision spaces. At each level of detail it first frames the local problem and
forms a compact set of materially different solution families. It then
challenges omissions, propagates evidence-backed constraints, selects a
justified survivor, and expands only that selected direction into finer choices
and required deliverables.

```text
frame local problem
  -> form materially distinct alternatives
  -> challenge omissions
  -> propagate facts and constraints
  -> choose a justified survivor
  -> decompose the chosen direction
  -> repeat independently in each unresolved child
```

Breadth is bounded but considered before depth. Rejected branches are not
elaborated, while plausible high-level directions are not silently lost merely
because the first model preferred one.

### Separate solution structure from execution

The solution graph represents the problem being solved:

- OR-candidates are mutually exclusive solution families inside one region.
- `partOf` children are AND-related deliverables required by a selected parent.
- `refines` children are lower-level decisions that become meaningful only
  after their parent direction is selected.

The activation graph represents work performed on that solution. An activation
is one bounded request to inspect, synthesize, refine, implement, verify, or
present. Activations receive a dependency-projected semantic packet and return
typed proposals; they do not own lifecycle bookkeeping.

The static LangGraph therefore remains a small controller loop rather than a
mirror of the dynamic solution tree:

```text
schedule -> acquire if mutation is needed -> activate -> validate/merge
         -> propagate -> schedule
```

### Combine bounded CSP, propagation, CEGAR, and AND/OR decomposition

Each region is a bounded local constraint problem with explicit variables,
candidate domains, evidence, and constraints. The controller recomputes derived
candidate states to a fixed point and eliminates a candidate only when a live
authored rule entails that elimination.

WFC-style propagation applies each new fact, constraint, and commitment
immediately. A singleton domain does not collapse merely because a generator
returned one item: a fresh challenger first reviews the domain for a materially
different missing family.

That review is a bounded CEGAR-like loop. A concrete counterexample enlarges the
domain and triggers another challenge; a missing distinguishing fact triggers
focused inspection. Acceptance means no concrete material omission was found
inside the admitted boundary and configured limits. It is operational coverage,
not proof of semantic exhaustiveness.

Selection resolves an OR-domain. Refinement then exposes the AND-related work
and later OR-decisions implied by the selected family. Children of rejected
choices never become live, and reopening a parent invalidates only the
conditional subtree and premises that depended on its previous choice.

Implementation and verification feed observations back into the same graph.
A local defect returns to bounded repair; confirmed evidence that invalidates an
earlier premise reopens the smallest responsible decision frontier. Execution
is therefore evidence-generating search, not a terminal ritual after planning.

### Models propose; deterministic code disposes

Every model output is untrusted input. Schemas establish shape, semantic
validators establish whether the proposed act is legal in the current state,
reducers merge accepted data, and the kernel derives mechanical consequences.

- Preference, uncertainty, or unsupported model interpretation cannot eliminate
  a candidate.
- Repository, tool, immutable user, and independently validated evidence can
  ground consequential decisions.
- Model inference begins as a hypothesis.
- Stable IDs carry authority and provenance between activations; later models do
  not reconstruct state by interpreting earlier prose.
- Completion is controller-certified from exact criteria, premises, measured
  artifacts, checks, dependencies, and resolved findings—not inferred from a
  status label or model confidence.

### Keep reasoning local and coupling explicit

A decision variable is visible only in its owner's subtree. Shared choices
connect regions through explicit coordinates and evidence-backed constraints,
not textual similarity. The admitted coupling graph stays sparse and acyclic.
A need for unrestricted cyclic coupling is evidence for adopting a general
CSP/SAT backend, not permission to hide coupling inside prompts.

Parents constrain descendants without dictating unrelated siblings.
AND-children collectively cover the parent's required outcomes. OR-candidates
answer one local decision and do not smuggle independent deliverables that
belong in children. Evidence is stored once and projected by reference only
where it can affect an activation.

### Treat LLM activations as lossy components

An activation may misunderstand a term, repeat a near-duplicate, invent
authority, or choose prematurely. Meaning therefore lives in one typed semantic
contract. Prompts, schemas, validation errors, UI projections, and downstream
assignments are deterministic views of that contract rather than independent
descriptions that can drift apart.

Each prompt is locally exhaustive but globally small: one operation, one local
goal, relevant authority and criteria, fixed choices, applicable facts and
constraints, legal mutations, forbidden overreach, and one narrow output
schema. Tool permissions follow the same separation: inspectors observe,
synthesizers and refiners reason over supplied evidence, implementers mutate a
certified scope, verifiers observe and test without editing, and presenters
render supported results.

### Make efficiency and termination controller properties

The scheduler works on the unresolved frontier, propagates before calling a
model, performs derivable transitions without a model, and may parallelize
independent read-only work. Change roles mutate isolated baseline mirrors;
clean replay, commit creation, and user-worktree landing are serialized behind
a repository lease and remain host-owned controller operations.

Efficiency comes from bounded domains and counterexample rounds, MRV ordering,
lazy refinement, dependency-projected prompts, normalized deduplication,
semantic fingerprints, fixed-point propagation, no-progress limits, and
grounded fast paths. Runs have no activation ceiling unless their host configures one, with cumulative region inspection
and recovery limits that survive checkpoint resume and pruning. Telemetry must demonstrate a concrete bottleneck before new
reviewers, scoring layers, solver machinery, or learned scheduling are added.

### Mechanical guarantees and honest limits

The controller is designed to provide sound witnessed elimination, fixed-point
and idempotent propagation, order-independent canonical merges, explicit
contradictions, stale-result supersession, local invalidation, checkpointed
recovery, bounded retries, and criterion- and certificate-based completion.

It cannot prove that an LLM has enumerated every solution to an open-ended task.
It must not label bounded challenge as formal exhaustiveness, enumerate every
global combination, deepen rejected branches, treat LOD depth as correctness,
or use model confidence as evidence.

## Documentation

- This README describes the shipped package, its public seam, and its design
  invariants.
- [`src/solution-lod/README.md`](./src/solution-lod/README.md) describes the
  currently implemented graph topology, state, routing, and failure mechanics.
- [`src/solution-lod/SPEC.md`](./src/solution-lod/SPEC.md) describes what the
  graph must eventually guarantee. It may intentionally lead implementation.
- `TODO.md` and `TODO-*.md` record known gaps between shipped behavior and the
  desired specification.

## Install

```sh
npm install neolit
```

## Minimal embedding

```ts
import { MemorySaver } from "@langchain/langgraph";
import { solutionLodGraph } from "neolit";

const configured = solutionLodGraph({
  agents: { inspect: "inspector", synthesize: "synthesizer", refine: "refiner", implement: "builder", verify: "verifier", present: "presenter" },
  checkpointer: new MemorySaver(),
});

const result = await configured.graph.invoke(
  configured.initial({ task: "Add a shout() export with tests", directory: process.cwd(), worktree: process.cwd(), runId: "run-1" }),
  { recursionLimit: 512, configurable: { thread_id: "run-1", langgraphOpenCodeRuntime: myRuntime } },
);
console.log(configured.result?.(result));
```

`myRuntime` implements `call(input: AgentCall): Promise<AgentCallResult>`.

### Host runtime contract

| `AgentCall` field | Host responsibility |
|---|---|
| `agent` | Route to the configured role or persona. |
| `prompt` | Deliver the compiled role-native instruction verbatim. |
| `schema` | Obtain structured output and repair parse or validation failures in the same session. |
| `validateStructured` | Call the kernel validator before accepting output; a throw means the proposal is invalid. |
| `limits` | Enforce turn, token, and cost limits and report a `budgetStop`. |
| `session` | Honor fresh, continue, and fork strategies; challengers require fresh sessions. |
| `directory`, `worktree` | Run tools in the supplied execution sandbox. |

`AgentCallResult` carries text, optional structured output, usage, tool and retry
traces, and an optional budget stop. Failures use `OpenCodeRuntimeError` as the
harness-neutral error protocol: its kind distinguishes startup, transport,
inactivity, schema, and semantic failures and preserves session, tool, usage,
and progress evidence for bounded recovery.

Hosts may supply `langgraphAcquireWorktree`,
`langgraphPrepareImplementationWorkspace`, `langgraphPrepareVerifierWorkspace`,
`langgraphIntegrateVerifiedWorkspace`, `langgraphReleaseVerifierWorkspace`, and
`langgraphSnapshotWorkspace` through LangGraph's configurable state. The implementation preparation hook accepts an optional fourth
`resumeFromActivationId` argument for retained edits and verification repairs.
It returns `baselineWorktree` alongside `worktree` and `baselineFingerprint` when
continuing a cumulative delta; this preserves measurement against the original
baseline. Change
delivery requires the preparation and integration hooks; the host
owns process isolation, UI, persistence integration, and concrete tool
execution; Neolit owns state-machine legality, evidence authority, propagation,
CEGAR gating, refinement contracts, completion, and checkpoint semantics.

The reference host is [`opencode-langgraph`](https://github.com/1suo/opencode-langgraph),
an OpenCode plugin that wraps this package with child sessions, permissions,
a TUI, and run storage.

Repository worktree inspection reports every registration returned by Git.
Registrations whose paths no longer exist are marked unavailable and carry no
diff chunks; they do not prevent valid linked worktrees from being inspected.

Inspection outputs keep controller identities distinct: `factIds` reuses only
reference IDs supplied in the prompt, while new repository observations cite
their controller-issued chunk IDs through `evidence`; same-result references
use that chunk ID until the controller maps it directly to a durable evidence
ID. A non-decomposed root
boundary binds each `materialRequirement` with the current region ID as
`scopeKey` plus its zero-based `criterionIndex`; decomposed roots use the
owning `taskScope.key` instead. Generated families may require at most one
option for each categorical shared choice; inseparable requirements must be
represented as one composite option or decomposed before selection.

`verify.ts` exports harness-independent post-run checks including
`checkEvidenceDedup`, `checkConvergence`, and `checkSolverWorkflows`. Drivers can
apply these to real final networks as an additional regression gate.
Material-requirement identity and criterion ownership remain immutable after
admission. Reinspection schemas no longer accept full requirement definitions;
they may refresh stale provenance only through `materialRequirementEvidence`
entries keyed by the supplied canonical `requirementId`.

## Development

```sh
npm run check   # tsc --noEmit + vitest + generated role-graph check
npm run build   # emit dist/
```

Linked-worktree observations fingerprint changed tracked file contents as well as
Git metadata; same-size edits to an already-dirty file invalidate the observation.
Deleted paths and symlink targets are fingerprinted without following symlinks
outside the worktree.
