# Neolit

Neolit is a thin, editor-native layer for connecting repository intent to actual
Git changes. It reads ordinary Markdown documentation and Git metadata, then
derives task, requirement, file, and hunk views for editor integrations.

**Git is the source of truth for code changes.** README files describe current
behavior; SPEC files describe desired behavior; TODO files record actionable
work. Adjacent `TODO.archive.md` / `SPEC.archive.md` files retain completed or
obsolete entries without bloating active plans. TODO `Description:` records
intent; `Agent notes:` records the implementation explanation. Neolit reads
these Markdown sources in place and never maintains a second authoritative
plan, patch store, task lifecycle, or agent conversation.

## Planning core

The deterministic TypeScript core provides:

- linked README/SPEC/TODO discovery and Markdown parsing;
- stable SPEC requirement and acceptance-criterion references;
- TODO-to-SPEC traceability and diagnostics;
- Git status, comparison-base, diff, rename, untracked-file, and hunk indexing;
- conservative file/hunk candidate associations and derived task/requirement
  states;
- stale-checked file, hunk, and line-range anchors;
- derived task/requirement evidence and explicit reasons for unresolved hunk attribution.

It does not call an LLM, generate or apply patches, stage or commit files, or
send messages to an agent. Editor integrations expose repository text and
source paths directly; Neolit does not require generated prompts or a
Neolit-owned conversation.

Import the shared API from either the package root or its explicit subpath:

```ts
import {
  loadPlanningWorkspace,
  derivePlanningStates,
} from "neolit";

// Equivalent explicit import:
// import { ... } from "neolit/planning";
```

## Getting started

Build the shared core with Node.js 22.12 or newer:

```sh
npm install
npm run build
```

The Neovim companion requires this checkout's generated `dist/index.js` and
`dist/planning/` files. Install `1suo/neolit.nvim` with your plugin manager
and point `neolit_dir` at this checkout:

```lua
{
  "1suo/neolit.nvim",
  opts = { neolit_dir = "/absolute/path/to/neolit" },
  cmd = { "Neolit", "NeolitPlan", "NeolitClose" },
}
```

Run `:Neolit` from the target repository. Expand TODO documents to inspect
parsed tasks, descriptions, linked requirements, acceptance criteria, and
derived change evidence. Expand SPEC documents and individual requirements to
see linked tasks, criterion coverage, and related hunks. Expand changed files
to inspect task candidates and hunk-attribution reasons. Press `x` to copy the
selected text or diff/hunk, and `y` to copy its repository path and source
line. Press `f` to show affected paths together with their related TODO/SPEC
documents. Press `r` to refresh and `q` to close.

Set `comparison_base` to another commit/ref when needed; it defaults to
`HEAD`. The workspace is read-only. File hints are candidates, not proof of
implementation, and TODO checkboxes are not verification evidence.

See [the Neovim companion README](https://github.com/1suo/neolit.nvim) for
configuration details and [the planning core reference](./src/planning/README.md)
for the shared API.

## Editor integrations

- [Neovim companion](https://github.com/1suo/neolit.nvim)
  — the Git-native workspace, opened by `:Neolit` (`:NeolitPlan` remains an
  explicit alias).
- [VS Code companion](./editors/vscode/README.md) — Explorer task/requirement navigation, documentation diagnostics,
  planned-file annotations, changed-file/hunk review, and contextual handoff
  using the same core.

Both adapters consume the shared planning API and leave native file, Git, and
diff interfaces in control.

## Repository contract

- [REWRITE-SPEC.md](./REWRITE-SPEC.md) is the normative product contract.
- [TODO-rewrite.md](./TODO-rewrite.md) tracks implementation and outstanding
  host/validation work.
- [AGENTS.md](./AGENTS.md) defines the documentation-first agent workflow.

Existing README/SPEC/TODO files are repository data and are not rewritten or
migrated by Neolit. The former planned-diff implementation and its `augment`/`augmentd` commands
have been retired. Older gap ledgers remain in the repository as archive
material, not active product contracts.

## Development

```sh
npm install
npm run build
```

The shared core is read-only with respect to the worktree and Git index. Opening
a planning view does not execute repository scripts or modify files.
