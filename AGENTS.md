# AGENTS.md

This repository operates in strict documentation-first mode. Its structure and
documentation are part of the product. Keep code, tests, and the documents that
explain their contracts in sync.

## Start with the contract

Before changing code, read `README.md` and the smallest relevant canonical
document:

| Concern | Canonical document |
|---|---|
| Shipped package, public seam, design principles, and repository map | `README.md` |
| Shipped graph topology, state, routing, and failure mechanics | `src/solution-lod/README.md` |
| Desired normative solution-graph behavior | `src/solution-lod/SPEC.md` |
| Script ownership and generated documentation | `scripts/README.md` |
| Known gaps between shipped and desired behavior | `TODO.md` and the relevant `TODO-*.md` file |

Follow links from those documents only as far as the changed concern requires.
Keep the three documentation layers distinct:

- **README: what exists.** A README describes behavior implemented by current
  code and protected by current tests. Do not put aspirations there.
- **SPEC: what must eventually be true.** A SPEC defines desired invariants and
  acceptance criteria. It may intentionally lead the implementation.
- **TODO: the known gap.** A TODO records concrete work required to move current
  behavior toward the specification.

When implementation and a README disagree, correct the README or code in the
same change. When implementation differs from the SPEC, do not falsify either
document to make them agree: record or update the gap in the appropriate TODO.
Change the SPEC only when the desired contract itself changes.

## Documentation topology (C4)

C4 levels describe documentation scope, not runtime architecture. Use the
smallest level that accurately owns a contract:

- **System — always:** the root `README.md` explains the project purpose,
  public seam, technology and repository conventions, major containers or
  components, and critical project-wide flows.
- **Container — optional:** add a README only for a separately deployable unit
  that runs independently. Do not treat an ordinary source directory as a
  container.
- **Component — required for non-obvious functional units:** a nearby README
  explains the component's responsibility, architecture, dependencies, data
  flow, extension points, and validation.
- **Code — optional:** document a subcomponent only when several files share a
  complex local contract that is not clear from the component README and code.

When creating or changing a README:

1. Determine its C4 level and exact ownership boundary.
2. Read the actual code and identify only the entry points, dependencies, data
   structures, flows, patterns, and unusual decisions needed to maintain it.
3. Write concise, current facts. Do not guess, add placeholders, reproduce
   obvious file structure, or duplicate a canonical contract.
4. Link the parent, related components, and project-wide flows where the
   relationship matters.

## Keep the codebase legible while it grows

- Put domain behavior under `src/solution-lod/`; keep generic connector and
  runtime contracts in the top-level `src/` modules.
- Put tests under `test/` and name them after the behavior or regression they
  protect.
- Put deterministic maintenance scripts under `scripts/` and expose recurring
  checks through `package.json`.
- When a new directory or subsystem develops a non-obvious local contract, add
  a nearby `README.md`. Explain its responsibility, boundaries, data flow, and
  validation command. Do not create READMEs for directories whose contents are
  already obvious.
- Update a local README when its subsystem changes. Update the root README only
  when the public purpose, conceptual invariants, repository map, or onboarding
  path changes.
- Update the corresponding TODO when implementation closes, changes, or reveals
  a known SPEC gap. Do not describe completed behavior as pending.
- Keep one canonical explanation for each contract. Other documents should link
  to it instead of copying it.
- Keep generated documentation generated. The role graph in
  `src/solution-lod/README.md` comes from `src/solution-lod/roles.ts`; run
  `npm run graph:write` to update it and `npm run graph:check` to verify it.

## Engineering rules

- State risky assumptions before making changes.
- Prefer the smallest implementation that satisfies the requested behavior.
- Change only files and code directly required by the task.
- Follow existing structures, helpers, names, and conventions.
- Do not add speculative abstractions or future-proofing without a measured
  need.
- Preserve unrelated user changes in a dirty worktree.
- Do not use destructive Git commands unless the user explicitly requests them.
- Preserve public contracts unless the task explicitly authorizes a breaking
  release. When a contract changes, update its types, implementation, examples,
  and tests together.
- Models propose semantic changes; deterministic controller code validates,
  merges, derives lifecycle state, and decides completion. Do not move controller
  authority into prompts.
- Keep every exploration and retry mechanism deterministically bounded.
- Add telemetry before adding optimization machinery, and require measured
  evidence that the machinery improves its target.

## Task workflow

### Phase 0: verify documentation

Before implementation, verify that the System README and the nearest relevant
Component README exist and contain enough accurate architecture, contracts,
flows, and links to proceed without guessing. Create or correct the owning
documentation before, or together with, implementation.

### Phase 1: assemble context

Read the canonical README/SPEC/TODO documents and only the directly relevant
code. Follow links far enough to understand every contract consumed or changed
by the task. If code and documentation disagree, resolve the discrepancy rather
than silently choosing one.

### Phase 2: implement completely

Implement the full requested outcome without placeholders or speculative scope.
Handle the relevant edge cases, change only task-owned code, follow existing
patterns, and continue until implementation, documentation, and validation are
complete or a concrete blocker is reported.

### Phase 3: synchronize documentation

Update the owning README whenever implementation changes architecture, public
contracts, data flow, extension points, or unusual behavior. Update the relevant
TODO when a known SPEC gap is closed, changed, or newly discovered. Do not alter
another agent's notes or claim unfinished work as complete.

### Phase 4: commit safely

Completed work must be committed unless the user explicitly asks for an
uncommitted handoff. Before staging, inspect `git status --short`, preserve
unrelated work, and stage only task-owned files.

1. Commit implementation and tests first with an appropriate conventional
   prefix such as `feat:`, `fix:`, `refactor:`, or `test:`.
2. Documentation and task-ledger changes may accompany the implementation when
   inseparable, or use a separate `docs:` commit when that keeps ownership
   clearer.
3. If the repository has a designated integration branch, use that branch and
   its documented worktree/merge protocol; do not invent a replacement branch
   convention.
4. Use an isolated Git worktree when parallel agents or overlapping tasks could
   interfere. A dedicated worktree is unnecessary for read-only review or an
   explicitly shared single-user change.
5. Do not amend, rewrite, revert, or otherwise alter existing history unless the
   user explicitly requests it.

At handoff, report commit hashes, validation performed, and remaining untracked
or unstaged files. Push only when requested or required by the surrounding
workflow.

## Tests

Tests should demonstrate behavior, not restate constants or manually construct
the conclusion they claim to prove.

- Exercise pure reducer invariants directly when reviewing deterministic state
  transformations.
- Exercise the compiled graph for routing, batching, retry, checkpoint, and
  terminal-state claims.
- Build fixtures through current public constructors where practical. If a test
  creates internal state directly, keep it on the current checkpoint version
  and explain any intentionally unreachable state.
- Every regression test must fail when the regression is reintroduced.
- Prefer exact semantic outcomes and stable identifiers over snapshots of large
  prompts or state objects.
- Keep generated/property tests deterministic and report the failing seed.
- Do not hide failures with broad `catch` handlers or assertions that cannot
  fail based on production behavior.

## Validation

Run the narrowest relevant check while developing, then the repository gate
before handoff when practical:

```sh
npx vitest run test/<relevant-file>.test.ts
npm run check
```

`npm run check` performs TypeScript validation, the complete Vitest suite, and
the generated role-graph consistency check. Run `npm run build` when validating
published output or packaging behavior.

At handoff, report what changed, which validation ran, and any known gap or
environmental blocker. Do not claim completion while the documented contract or
official validation is knowingly stale.
