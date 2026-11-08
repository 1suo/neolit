# Neolit

Neolit is a thin, editor-native layer for connecting repository intent to actual
Git changes. It reads ordinary Markdown documentation and Git metadata, then
derives task, requirement, file, and hunk views for editor integrations.

**Git is the source of truth for code changes.** README files describe current
behavior; SPEC files describe desired behavior; TODO files record actionable
work. Neolit reads these sources in place and never maintains a second
authoritative plan, patch store, task lifecycle, or agent conversation.

## Planning core

The deterministic TypeScript core provides:

- linked README/SPEC/TODO discovery and Markdown parsing;
- stable SPEC requirement and acceptance-criterion references;
- TODO-to-SPEC traceability and diagnostics;
- Git status, comparison-base, diff, rename, untracked-file, and hunk indexing;
- conservative file/hunk candidate associations and derived task/requirement
  states;
- stale-checked file, hunk, and line-range anchors;
- compact contextual question packets for an existing coding-agent session.

It does not call an LLM, generate or apply patches, stage or commit files, or
send messages to an agent. If an editor cannot address an existing agent
session through a supported host API, it can copy the contextual packet for
the user to send.

Import the shared API from either the package root or its explicit subpath:

```ts
import {
  loadPlanningWorkspace,
  derivePlanningStates,
  buildDiffQuestionPacket,
} from "neolit";

// Equivalent explicit import:
// import { ... } from "neolit/planning";
```

See [the planning core reference](./src/planning/README.md) for API details.

## Editor integrations

- [Neovim companion](https://github.com/1suo/neolit.nvim/tree/rewrite/planning-workspace)
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
