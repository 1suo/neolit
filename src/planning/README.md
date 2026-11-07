# Planning document core

This component parses the repository's ordinary Markdown planning documents and connects them to actual Git diff metadata. The Markdown parser is deterministic and I/O-free; the workspace adapter is a read-only Node host boundary for filesystem discovery and Git commands.

## Public API

- `parseSpecDocument(path, content)` extracts stable `R-NN` requirement IDs and `AC-NN` acceptance criteria, their explicit `R-NN` links, heading paths, and source line ranges.
- `parseTodoDocument(path, content)` extracts Markdown checkbox tasks, `SPEC:` references, optional `File:` hints, descriptions, and source ranges.
- `resolvePlanningDocuments({ specs, todos })` resolves each task's requirement references, attaches acceptance criteria that explicitly name those requirements, and returns diagnostics for missing SPEC documents, missing requirement IDs, and tasks without references.
- `parseUnifiedDiff(diff)` extracts changed paths and hunk line ranges from ordinary Git unified diff output.
- `mapDiffToTasks(files, tasks)` associates changed paths with TODO tasks using exact file-path matches. Associations are explicitly file-level; no claim is made that every hunk fulfills the task.
- `derivePlanningStates(input)` projects task and requirement states from Git path associations and verification evidence bound to the exact base commit and diff identity. TODO checkbox values are never treated as implementation or verification proof.
- `createDiffAnchor(input)`, `checkDiffAnchorCurrent(anchor, current)`, and `buildDiffQuestionPacket(input)` create path/side/line-or-hunk anchors tied to a base commit and SHA-256 diff identity, reject stale anchors, and build a compact packet with selected diff text and related plan context.
- `remapTaskIdentity(previous, current)` conservatively relates tasks across revisions of the same TODO document. It prefers unique structural keys, then unique task text, then unique SPEC-reference sets; duplicate/competing candidates are returned as one ambiguous candidate group with all previous/current task keys. It never transfers identity across TODO documents or resolves ties by line order.

## Markdown contract

A SPEC requirement is a list item with a bold stable ID, for example `- **R-01** The client refreshes expired sessions.`

A TODO task uses ordinary checkbox syntax and nested metadata:

```md
- [ ] Implement session refresh
  - SPEC: `src/auth/SPEC.md#R-01, R-02`
  - File: `src/auth/session.ts`
  - Description: Refresh the session and retry once.
```

SPEC paths are resolved relative to the TODO document. Requirement IDs—not line numbers—are the cross-document identity. Source line ranges are navigation hints. Task keys are disposable projections of the owning TODO path, heading path, and task text; callers must use `remapTaskIdentity` when comparing document revisions rather than assuming a key survives edits.

## Boundaries

This module consumes file contents and diff text supplied by its host. It does not discover files, invoke Git, watch the filesystem, infer semantic hunk coverage, or communicate with an agent. Hosts supply the current diff/base/blob identities and remain responsible for sending a ready packet to the existing agent. Those are separate host responsibilities.

## Validation

```sh
npx vitest run test/planning-markdown.test.ts test/planning-workspace.test.ts test/planning-context.test.ts test/planning-state.test.ts
npm run check
```

## Workspace adapter

`workspace.ts` exports `loadPlanningWorkspace(directory)`. It follows relative Markdown links from the root README to linked component READMEs and their SPEC/TODO documents, parses them, then reads the current branch, HEAD, porcelain status, and `git diff HEAD`. Untracked paths are included in changed-file navigation without inventing diff hunks. Its workspace diff identity covers HEAD, tracked diff, porcelain status, and hashes of untracked file contents; derived task/requirement states are returned alongside the raw evidence. The adapter does not write files or alter the index/history. The adapter is read-only and does not stage, apply, commit, or modify repository files. Its Git comparison is currently HEAD against the combined index and working tree; comparison-base selection and expanded status fixtures remain pending.
