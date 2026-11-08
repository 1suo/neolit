# Planning document core

This component parses the repository's ordinary Markdown planning documents and connects them to actual Git diff metadata. The Markdown parser is deterministic and I/O-free; the workspace adapter is a read-only Node host boundary for filesystem discovery and Git commands.

## Public API

- `parseSpecDocument(path, content)` extracts stable `R-NN` requirement IDs and `AC-NN` acceptance criteria, their explicit `R-NN` links, heading paths, and source line ranges.
- `parseTodoDocument(path, content)` extracts Markdown checkbox tasks, `SPEC:` references, optional `File:` hints, descriptions, and source ranges.
- `resolvePlanningDocuments({ specs, todos })` resolves each task's requirement references, attaches acceptance criteria that explicitly name a requirement or are directly referenced by the task, and returns diagnostics for missing SPEC documents, missing requirement IDs, and tasks without references.
- `parseUnifiedDiff(diff)` extracts changed paths, hunk line ranges, and each hunk’s added/removed source lines from ordinary Git unified diff output. Hunk content is retained as evidence input; it is not itself treated as proof that a TODO task was fulfilled.
- `mapDiffToTasks(files, tasks)` associates changed paths with TODO tasks using exact file-path matches. Associations are explicitly file-level; no claim is made that every hunk fulfills the task.
- `derivePlanningStates(input)` projects task and requirement states from Git path associations and verification evidence bound to the exact base commit and diff identity. TODO checkbox values are never treated as implementation or verification proof.
- `createDiffAnchor(input)`, `checkDiffAnchorCurrent(anchor, current)`, and `buildDiffQuestionPacket(input)` create path/side/line-or-hunk anchors tied to a base commit and SHA-256 diff identity, reject stale anchors, and build a compact packet with selected diff text, selected source lines, and related plan context. Defaults cap the question at 2,000 chars, diff at 24,000, selected lines at 8,000, related tasks at 8, and related plan text at 8,000 chars; hosts may lower or raise these limits explicitly.
- `remapTaskIdentity(previous, current)` conservatively relates tasks across revisions of the same TODO document. It prefers unique structural keys, then unique task text, then unique SPEC-reference sets; duplicate/competing candidates are returned as one ambiguous candidate group with all previous/current task keys. It never transfers identity across TODO documents or resolves ties by line order.

## Markdown contract

A SPEC requirement is a list item with a bold stable ID, for example `- **R-01** The client refreshes expired sessions.`

A TODO task uses ordinary checkbox syntax and nested metadata:

```md
- [ ] Implement session refresh
  - SPEC: `src/auth/SPEC.md#R-01, R-02, AC-01`
  - File: `src/auth/session.ts`
  - Description: Refresh the session and retry once.
```

SPEC paths are resolved relative to the TODO document. Every task needs at least one `R-NN` reference; optional `AC-NN` references attach acceptance criteria directly when they are not already linked by mentioning an `R-NN` in the criterion text. Requirement IDs—not line numbers—are the cross-document identity. Source line ranges are navigation hints. Task keys are disposable projections of the owning TODO path, heading path, and task text; callers must use `remapTaskIdentity` when comparing document revisions rather than assuming a key survives edits.

## Boundaries

The Markdown parser and state/context helpers are deterministic and I/O-free. The workspace adapter is the read-only host boundary that discovers linked documents and invokes Git. Neither layer communicates with an agent or writes repository state; hosts send a ready context packet to the existing agent.

## Validation

```sh
npx vitest run test/planning-markdown.test.ts test/planning-workspace.test.ts test/planning-context.test.ts test/planning-state.test.ts
npm run check
```

## Workspace adapter

`workspace.ts` exports `loadPlanningWorkspace(directory, { verificationEvidence? })`. It follows relative Markdown links from the root README to linked component READMEs and their SPEC/TODO documents, parses them, then reads the current branch, HEAD, porcelain status, and `git diff <resolved-base>` (default `HEAD`; callers may pass `comparisonBase` to select another commit/ref). The resolved immutable commit is exposed as `git.base` and included in diff identity and verification evidence. Untracked files receive actual `git diff --no-index` hunks and raw diff text. Workspace diff identity covers HEAD, tracked diff, porcelain status, and hashes of untracked file contents. Derived task/requirement states are returned alongside the raw evidence. The adapter does not write files or alter the index/history. The adapter is read-only and does not stage, apply, commit, or modify repository files. Its Git comparison is currently HEAD against the combined index and working tree; comparison-base selection is explicit through `comparisonBase`; expanded status and comparison-base fixtures are added but still need to be executed.
