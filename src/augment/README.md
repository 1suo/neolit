# Augment planned-diff core

`src/augment/` is the pure state machine behind Neolit's planned-diff product. It owns task state, candidate domains, constraints, collapse, refinement, planned patches, and staleness. It performs no filesystem, model-provider, editor, or process I/O.

## Responsibility

A task is a long-lived **planned diff tree** shaped like the repository:

- a root node represents the current objective;
- candidate domains represent materially different approaches for a node;
- constraints come from the user, repository policy, or validated model output;
- refinement turns a collapsed node into child directory/file/hunk nodes;
- planned diffs are stored by node and basis revision;
- changing a basis path marks only the affected subtree stale.

The tree is a projection and plan, never a copy of source code. Applying a plan is a host responsibility.

## Data flow

```text
host operation
  -> validate revision/node/candidate
  -> pure reducer merge
  -> propagation and filesystem-shaped tree projection
  -> updated task snapshot
```

Model runtimes execute outside this module. `crystallize` and `refine` in `kernel.ts` call the injected `ModelRuntime` port, validate typed proposals with Zod, challenge the candidate domain, and then merge only legal deltas. Patch operations record model-reported assumptions as model-source constraints so they stay inspectable. The standalone OpenCode CLI adapter lives with the TUI host in `src/tui/opencode-runtime.ts`; it is not part of the pure core.

## Public surface

- `types.ts`: task, node, candidate, constraint, evidence, patch, model, and view contracts.
- `state.ts`: pure task operations and the filesystem-shaped `planTree` projection.
- `schemas.ts`: Zod contracts for model proposals.
- `kernel.ts`: bounded model-driven `crystallize` and `refine` operations.

## Invariants

- IDs are stable and controller-authored.
- Model output enters only through parsed, validated deltas.
- A node must have a non-empty accepted candidate domain before collapse.
- Selection eliminates sibling candidates with an explicit witness.
- Refinement is legal only after a selected candidate.
- Patches and refinement carry the task basis revision.
- A stale node cannot become ready without an explicit `refreshNode`; refresh restores each stale node to its last live lifecycle point and may re-anchor the task to a new basis revision, while existing diffs keep the basis they record.
- Candidate and refinement counts are bounded to prevent model-driven bloat.
- Candidate confidence is presentation metadata and never selects or eliminates a candidate.
- Initial domains contain at most five candidates; two challenge slots keep the live bound at seven. Exhausting the challenge budget records `challengeExhausted` and permits human selection without claiming acceptance. Any model proposal — initial candidates and challenge additions alike — whose paths escape the node's scope is split by the one `candidateScopeEscapes` predicate: in-scope work proceeds, escaping paths are recorded as constraints on the node ("Out-of-scope dependency") so the omission survives, and only a proposal with nothing in scope fails, with a message naming the escapes. A challenge candidate touching a locked path stays a failure: the restriction plain is controller authority. `nextDevelopmentStep` derives the next deterministic step for any node (crystallize, refine, draft, descend, choose, done, stalled) so hosts never re-derive the lifecycle.
- Locked paths are controller authority and reject candidate, refinement, or patch mutations inside them.
- Patch text is validated, not just the node's own path: a file or hunk node's patch may touch exactly its file, a virtual node's patch may touch any concrete path the restriction plain allows, and violations are typed failures naming the paths. Headerless patches keep the legacy node-path check. Virtual diffs derive their projection path from the patch header.
- A label eliminated by explicit rejection or collapse cannot return as a candidate; labels superseded only by domain regeneration may.
- Obligations are inspectable refinement metadata; they never gate readiness.
- Planned diffs preserve exact patch text and derive only presentation kinds (`new`, `modify`, `delete`, `unknown`).
- Descendant candidate domains are not generated implicitly by refinement; each node is crystallized only when explicitly opened.
- Controller failures carry a typed `PlanStateError` code; hosts and the protocol branch on codes, never on message prose.
- Explanations accumulate per topic: re-explaining a topic replaces only that topic's entries.
- The event log is bounded (`MAX_TASK_EVENTS`); tasks restored from outside pass `PlanTaskSchema` and `assertTaskIntegrity` before entering the controller.

## Validation

```sh
npx vitest run test/augment-state.test.ts test/augment-kernel.test.ts
npm run check
```

The desired long-term behavior, including persistent multi-client sessions and apply transactions, is specified in [`SPEC.md`](./SPEC.md).
