# Planning document core

This component parses the repository's ordinary Markdown planning documents and connects them to actual Git diff metadata. It is deliberately deterministic and has no filesystem, Git process, editor, model, or database dependency.

## Public API

- `parseSpecDocument(path, content)` extracts stable `R-NN` requirement IDs, text, heading paths, and source line ranges.
- `parseTodoDocument(path, content)` extracts Markdown checkbox tasks, `SPEC:` references, optional `File:` hints, descriptions, and source ranges.
- `resolvePlanningDocuments({ specs, todos })` resolves each task's references and returns explicit diagnostics for missing SPEC documents, missing requirement IDs, and tasks without references.
- `parseUnifiedDiff(diff)` extracts changed paths and hunk line ranges from ordinary Git unified diff output.
- `mapDiffToTasks(files, tasks)` associates changed paths with TODO tasks using exact file-path matches. Associations are explicitly file-level; no claim is made that every hunk fulfills the task.

## Markdown contract

A SPEC requirement is a list item with a bold stable ID, for example `- **R-01** The client refreshes expired sessions.`

A TODO task uses ordinary checkbox syntax and nested metadata:

```md
- [ ] Implement session refresh
  - SPEC: `src/auth/SPEC.md#R-01, R-02`
  - File: `src/auth/session.ts`
  - Description: Refresh the session and retry once.
```

SPEC paths are resolved relative to the TODO document. Requirement IDs—not line numbers—are the cross-document identity. Source line ranges are navigation hints.

## Boundaries

This module consumes file contents and diff text supplied by its host. It does not discover files, invoke Git, watch the filesystem, infer semantic hunk coverage, or communicate with an agent. Those are separate host responsibilities.

## Validation

```sh
npx vitest run test/planning-markdown.test.ts
npm run check
```
