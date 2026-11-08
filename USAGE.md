# Using Neolit

Neolit connects repository documentation to the Git changes you are actually making. It is a read-only planning and review interface: Git remains the source of truth for changes, and your existing README, SPEC, and TODO files remain authoritative.

This guide covers the shared core and the Neovim companion.

## 1. Prepare a repository

Neolit discovers planning documents by following local Markdown links from the repository README. Keep the documentation graph explicit:

- README: describe the current product and link to the relevant SPEC and TODO documents.
- SPEC: describe intended behavior using stable requirement IDs such as `R-01` and acceptance-criterion IDs such as `AC-01`.
- TODO: list actionable checkbox tasks and link each task to the relevant SPEC requirement or criterion.

A TODO task can include optional `File:` hints. A file hint narrows the review context; it is not proof that a source-code change implements the task. A checked TODO box is not implementation or verification evidence.

See [REWRITE-SPEC.md](./REWRITE-SPEC.md) for the supported document contract and [TODO-rewrite.md](./TODO-rewrite.md) for implementation and outstanding validation status.

## 2. Build the shared core

Requirements: Node.js 22.12+.

From a checkout of this repository:

```sh
npm install
npm run build
```

The Neovim companion loads the generated `dist/index.js` and `dist/planning/` files from this checkout.

The core API can also be consumed directly by TypeScript:

```ts
import {
  loadPlanningWorkspace,
  derivePlanningStates,
  buildDiffQuestionPacket,
} from "neolit/planning";

const workspace = await loadPlanningWorkspace("/path/to/repository");
const states = derivePlanningStates(workspace);
```

The loader reads linked Markdown documents and Git metadata. It does not execute repository scripts, call an LLM, modify files, stage changes, or apply patches. See [the planning API reference](./src/planning/README.md).

## 3. Install the Neovim companion

Requirements:

- Neovim 0.10+
- Node.js 22.12+
- The built Neolit core described above

With lazy.nvim, add:

```lua
{
  "1suo/neolit.nvim",
  opts = {
    neolit_dir = "/absolute/path/to/neolit",
    -- directory = "/path/to/target/repository", -- defaults to Neovim's cwd
    -- comparison_base = "HEAD",                -- defaults to HEAD
    -- node = "node",
  },
  cmd = { "Neolit", "NeolitPlan", "NeolitClose" },
}
```

If the plugin manager does not use the options table, configure it explicitly:

```lua
require("neolit").setup({
  neolit_dir = "/absolute/path/to/neolit",
  directory = nil, -- current working directory
  comparison_base = "HEAD",
  node = "node",
})
```

You can also set `NEOLIT_DIR` to the core checkout path. The plugin README documents the supported lookup order and configuration.

## 4. Review work in Neovim

Open the planning workspace from the target Git repository:

```vim
:Neolit
```

`:NeolitPlan` is an alias. The view is read-only.

- Move to a TODO task or SPEC requirement and press `<CR>` to open its Markdown source.
- Move to a planned file and press `<CR>` to open the file, or its actual Git diff when it has changes.
- Move to a changed file or hunk and press `<CR>` to open a native side-by-side diff against the configured comparison base.
- Press `x` on a task, requirement, planned file, or hunk to build a bounded contextual question packet.
- In a native diff buffer, use `<leader>nx` on the current line or a visual line selection to build context for those exact lines.
- Press `r` to refresh.
- Press `q` or run `:NeolitClose` to close the workspace.

The context packet is copied to the editor clipboard (with the unnamed register as fallback). Paste it into the relevant existing coding-agent session yourself. Neolit does not create a chat, start an agent, or send the packet automatically.

To compare against another commit or ref, set `comparison_base` in the plugin configuration. The resolved base is shown in the workspace and participates in stale-context checks.

## 5. Read the review signals correctly

The workspace deliberately distinguishes evidence from guesses:

- A file hint is a candidate relationship, not proof of implementation.
- A hunk that edits TODO or SPEC documentation can be attributed to the exact task/requirement lines it changes.
- Source-code hunks are not declared to implement a task based only on a path hint.
- Unmatched changes remain visible as unplanned; ambiguous matches remain candidates.
- A task is not marked verified because its checkbox is checked. Verification requires passing evidence tied to the applicable criteria and the exact Git base/diff identity.
- Stale file/hunk/line context is rejected rather than silently replaced with a different diff.

The view is useful now as a manual planning and diff-review workflow. The remaining host-level and end-to-end validation items are tracked in [TODO-rewrite.md](./TODO-rewrite.md); this guide does not imply those checks have been completed.
