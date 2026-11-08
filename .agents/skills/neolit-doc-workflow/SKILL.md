---
name: neolit-doc-workflow
description: Follow Neolit's README → SPEC → TODO → inspect → implement → verify → reconcile workflow when changing this repository.
---

# Neolit documentation-first workflow

Use this skill for repository changes. AGENTS.md remains the minimal always-on
contract; this skill supplies the detailed procedure and templates.

## 1. Select the governing contract

1. Read the root README for current shipped behavior and repository structure.
2. Identify the relevant requirement IDs in REWRITE-SPEC.md for Git-native work.
   For legacy maintenance, use the owning legacy SPEC instead.
3. Find the corresponding implementation entry in TODO-rewrite.md.
4. Read the nearest component README and only the code directly involved.
5. If the task does not map to an existing requirement, determine whether it is
   a bug within the current contract or whether the SPEC itself needs an
   explicit change. Do not silently invent product behavior.

## 2. Establish exact context

Before editing, inspect git status --short and the current diff. Preserve all
unrelated changes.

For an ambiguous implementation target, identify concrete alternatives using
repository evidence. Ask one focused question that names the exact file and
symbol or line range. Do not ask the user to restate context already present
in the repository.

For agent handoff, prefer:
- repository-relative path;
- base or working-tree side;
- exact line range or diff hunk;
- base commit and diff identity;
- the smallest relevant diff and linked SPEC/TODO text.

If an anchor has changed, refresh it or report it as stale. Never silently
substitute a nearby line or a different hunk.

## 3. Implement a vertical slice

Work from observable acceptance criteria, not from a speculative architecture.

- Keep Markdown parsing, link resolution, Git interpretation, state derivation,
  and context assembly deterministic.
- Treat Git and repository documents as the source of truth.
- Do not introduce a second task database, patch model, plan tree, agent
  session, chat UI, model router, or provider abstraction.
- Use ordinary filesystem edits and Git diff output.
- Treat file-path matches as file-level evidence only. Do not claim hunk-level
  semantic coverage without evidence.
- Bind verification to the exact base commit and diff identity.
- Make state derivation independent of TODO checkbox values.
- Keep editor integrations thin and reuse the shared core.

## 4. Respect the requested test scope

Do not create or modify tests unless the task owner explicitly requests test
work. When test work is requested, cover observable behavior and failure modes;
prefer stable IDs and exact semantic outcomes over broad snapshots. Never hide
failures with broad catches or assertions that cannot fail based on production
behavior.

## 5. Synchronize documentation

Update only the canonical owner:
- README: current, shipped behavior;
- SPEC: desired behavior and stable acceptance criteria;
- TODO: concrete unfinished work and its SPEC references;
- component README: local API, data flow, edge cases, and validation.

A TODO item should use this structure:

- [ ] Imperative task title
  - SPEC: REWRITE-SPEC.md#R-xx, REWRITE-SPEC.md#R-yy
  - File: src/path/to/file.ts, test/path/to/file.test.ts
  - Description: observable outcome, constraints, and remaining validation

Check an implementation item when the described code/documentation change is
complete. Keep its paired validation item open until the relevant independent
host/CI validation is actually performed. Do not move future behavior into README text.

## 6. Validate and commit

Run the narrowest relevant test first, then the repository check:
- npx vitest run test/<relevant-file>.test.ts
- npm run check
- npm run build when validating built output or an editor host

If a command cannot run, state the exact environmental reason and leave the
paired validation item open. Do not claim success based on source inspection alone.

Inspect git status --short again. Stage only task-owned files. Commit completed
implementation with a conventional prefix; include documentation when it
records the shipped behavior. Do not add tests unless the task owner explicitly
requests test work. Do not amend, rewrite, push, or discard
existing work unless explicitly requested.
