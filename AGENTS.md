# AGENTS.md

This repository treats its structure and documentation as part of the product.
Keep code, tests, and the documents that explain their contracts in sync.

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

Use an isolated Git worktree when parallel agents or overlapping tasks could
otherwise interfere. A dedicated worktree is not required for a read-only
review or a single-user change already taking place in an explicitly shared
workspace. Commit or push only when the user asks or the surrounding workflow
explicitly requires it.

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
