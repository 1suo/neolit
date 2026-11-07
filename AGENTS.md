# AGENTS.md

Neolit is a documentation- and Git-native repository companion. Keep repository
instructions useful to ordinary coding agents; do not require a Neolit-owned
agent runtime, chat, session, patch store, or model protocol.

## Canonical project documents

Read the root README first, then the smallest relevant canonical docs:

| Purpose | Canonical source |
|---|---|
| Current shipped product, public seam, repository map | README.md |
| Git-native target behavior and invariants | REWRITE-SPEC.md |
| Ordered implementation gaps | TODO-rewrite.md |
| Shared Markdown/Git core contract | src/planning/README.md |
| Current legacy planned-diff implementation | src/augment/README.md, src/augment/SPEC.md |
| Legacy daemon and TUI behavior | src/augmentd/README.md, src/tui/README.md |
| Legacy planned-diff gaps during migration | TODO-augment.md, SOTA-GAPS.md |

The rewrite spec is the target for new Git-native work. Legacy docs remain
authoritative only for maintaining the legacy implementation until it is
retired. Do not infer the new architecture from the legacy SPEC.

## Documentation contract

Keep three layers distinct:

- **README — what exists now.** Describe behavior implemented and validated by
  current code. Do not write future behavior as if shipped.
- **SPEC — what must be true.** State observable behavior, invariants, edge
  cases, and acceptance criteria using stable requirement IDs.
- **TODO — what remains.** Each actionable task must link to exact SPEC
  requirement IDs and name concrete files or components. Update the task ledger
  when work lands; never mark work complete before its validation passes.

Use the smallest documentation owner. Keep one canonical explanation for each
contract and link to it rather than duplicating it. Update the nearest component
README when its API, data flow, or extension points change; update the root
README only when the public product or onboarding changes.

Detailed templates and procedures are available in
.agents/skills/neolit-doc-workflow/SKILL.md. The workflow below is complete on
its own; the Skill is optional.

## Required workflow

1. **Read:** root README, relevant SPEC requirement(s), matching TODO task(s),
   and the nearest component README. Follow only the links needed to understand
   the affected behavior.
2. **Inspect:** check Git status and the exact current diff before editing.
   Preserve unrelated user changes. Use exact file/line/hunk context when the
   target is ambiguous; ask one focused question rather than guessing.
3. **Plan:** identify the observable acceptance criteria and the smallest
   vertical slice. Do not add an agent session, prompt router, shadow plan,
   patch model, or workflow stage unless the SPEC explicitly requires it.
4. **Implement:** change production code, tests, and types together. Prefer
   deterministic parsing, Git evidence, and host-native editor/agent APIs.
5. **Verify:** run the narrowest relevant tests, then npm run check; run
   npm run build when validating published output or host integration. Tests
   must exercise behavior and fail if the regression returns.
6. **Reconcile:** update the owning README with current facts and the TODO with
   the remaining gap. Change the SPEC only when the desired contract itself
   changes.
7. **Commit safely:** inspect git status --short, stage only task-owned
   files, and commit completed work with a conventional prefix. Do not amend,
   rewrite, push, or discard user changes unless explicitly requested.

## Implementation rules

- The Git-native core is deterministic and has no LLM, chat, session, provider,
  or agent-protocol dependency.
- Git and repository files are the source of truth. Never invent a synthetic
  diff or treat a TODO checkbox as implementation/verification evidence.
- File-path associations are file-level evidence, not proof that every hunk
  fulfills a task. Surface ambiguity and unplanned changes instead of guessing.
- Verification must identify the command/check, observed result, base commit,
  and exact diff identity. Stale evidence does not verify current changes.
- Context anchors must retain path, side, line/hunk range, base identity, and
  diff identity. Refresh or warn if the anchor becomes stale.
- Do not stage, commit, push, reset, clean, apply, or discard implicitly.
- Keep exploration, retries, file reads, and model-assisted work bounded.
- Avoid speculative abstractions and unrelated refactors.

## Tests and validation

Use the repository's existing test conventions. Prefer exact semantic outcomes
and stable IDs over large snapshots. Do not hide failures with broad catches or
assertions that cannot fail based on production behavior.

Run:
- npx vitest run test/<relevant-file>.test.ts
- npm run check
- npm run build (when validating published output or host integration)

Report the validation actually performed and any environmental blocker. Never
claim tests passed if they were not run.
