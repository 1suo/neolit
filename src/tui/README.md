# Neolit TUI

`src/tui/` is the standalone planned-diff terminal interface. It embeds the same in-memory `AugmentServer` used by the protocol and renders the resulting filesystem-shaped plan with [Ink](https://github.com/vademedes/ink) and React.

## Layout

The left pane is the complete repository file tree with plan state integrated into it. Repository-only paths remain visible but muted and unlabeled; planned and drafted paths are marked in place. `F` folds a directory shut (`▸`, subtree hidden) and `H` filters the tree down to related paths — planned entries, restriction-plain marks, and the ancestors that connect them (a `[RELATED]` chip in the header marks the active filter; the full tree is one keypress away).

```text
FILES
◆ repo/                   chosen 78%
└─ src/
   ├─ augment/
   │  └─ state.ts         modify
   ├─ auth/               planned
   │  └─ session.ts       new
   └─ tui/
      └─ augment.tsx
├─ test/
│  └─ state.test.ts       modify
├─ package.json           locked
└─ README.md              delete
```

Indicators (tree rows carry the indicator and color only; extra glyphs are counts and confidence, never words):

```text
⠋ working (animated)   × failed            # marked restriction
? explained (count)     ! needs refresh     ✓ applied (n/m)
+ ~ - drafted new/modified/deleted  Δ several drafts  +n −n line changes (folders sum)
~ planned               ● ready             ◇ choice (n·best%)   ◆ chosen (conf%)
```
text
⠋ working     an operation is running on this path (animated while busy)
× failed      the last operation on this path failed; the preview shows why
◇ possible   path appears in a possible approach
◆ chosen     selected approach, with model confidence
~ planned    concrete path in the current plan
+ new        drafted new file
~ modify     drafted modification
- delete     drafted deletion
✓ applied    drafted patch was applied to the working tree; nothing is committed
! stale      repository basis changed
# locked     path cannot change in this run
○ allowed    allowlist entry; while any exist, only allowed paths may change
● ready      path has its drafted patch complete
? explained  path is relevant to the current explanation topic
```

The right pane carries exactly two content sections. **DESCRIPTION** holds why the selected path changes: node reasons, a folder's planned children with their per-path reasons (unchanged entries omitted), open approach choices, explanations, and messages. **CHANGES** holds the actual drafted patches — the aggregated change summary plus the exact diffs (complete for files, previews for folders) with `applied` marks. When neither section has anything to show, the pane shows contextual **KEYS** suggestions instead (`[N]`, `1-7`, `[D]`/`[A]`). Approaches appear only while a choice is still open on the node; once an approach is chosen they are history and never rendered. The pane scrolls with `j`/`k` while it is focused (`Tab`), and long lines wrap natively through Ink. Candidate confidence is a model estimate for presentation only; the controller never selects an approach from it.

Press `E` to start an explanation task. Explanation tasks highlight related files and folders with `?` marks and show their role, summary, and confidence in the selected-path pane. Explanation tasks do not create approaches or patches.

While an operation runs, its target path animates in the tree (`⠋` with the lowercased operation name) and the preview leads with the live operation and its target path. A failed operation marks its path with `× failed`; the preview shows the failed operation and the first line of its error, and the mark clears when the same path succeeds on retry.

Every frame derives its vertical budget from the exported `frameLayout()`: fixed chrome (root padding, header, legend, the permanent three-row message panel, pane borders and titles) is subtracted from the terminal height first, so a frame never exceeds the viewport and repaints never clear and scroll the terminal; below the panel's own chrome the panes degrade to one row. The message panel is always present — it shows the live operation with its spinner while busy, the first line of the last error in red, the standing message otherwise, and the input line while typing — so the frame's chrome height never changes between modes. Preview lines wrap natively through Ink; the scroll window counts logical lines.

## Flow

After a task is entered and a model is configured, the TUI automatically generates approaches. A domain with exactly one viable candidate is adopted automatically (through a real `node/select`), so `D` works immediately; multiple candidates still ask for `1-7`. The intended flow is:

```text
1. describe the change
2. inspect the suggested file tree
3. choose an approach with 1-7
4. press D to develop it: refine into files, then crystallize, refine, and
   draft every undrafted file under the selected path, stopping only where an
   approach choice (1-7) needs a human
5. press D on any single file to draft just its patch
6. press Enter on any path to attach a message/constraint
```

File, hunk, and virtual targets always draft — their lifecycle state never reroutes them into refinement or an approach chooser.

## Operations

```text
N  start a new change plan
E  explain — with an active task it explains the selected path; without one it starts a repository-wide explanation task
Enter  the universal prompt for the selected path — on a file it saves the message and regenerates that file's patch directly (drafted or repaired, never approach options); on the root or a folder it regenerates approaches for that subtree; submitting empty rethinks the same way; folders holding drafted files refuse the auto-rethink and point at [O] instead
1-7  choose the numbered approach
D  develop the selected path and everything under it — a chosen approach expands into files, then every undrafted file below is drafted in ONE batched model call (all files of the subtree in a single prompt; the whole batch is validated all-or-nothing before anything lands); when the batch or a single file fails, files fall back to individual drafts — one file's failure never stops the rest, failures are marked × and summarized ("Drafted 6/9 — press D to retry"). A file, hunk, or virtual target always drafts its exact patch
A  apply the selected path's drafted patch(es) to the working tree
C  commit exactly the paths this session applied (pathspec commit; unrelated dirty or staged files stay untouched)
L  mark/unmark the selected path in the restriction plain, lock polarity: marked (`#`, red) paths must not change, everything else may
W  mark/unmark the selected path, allow polarity: marked (`#`, accent) paths are the only ones that may change. One plain, one marked set: pressing the other polarity key inverts it (the set stays, its meaning flips). Marks made before a task starts are applied before its first model run
F  fold/unfold the selected directory (folded folders show `▸` and hide their subtree)
H  toggle the related-only filter: show only planned paths (nodes, approaches, drafts, explanations) and restriction-plain marks with their connecting ancestors; press again for the full repository tree. A `[RELATED]` chip marks the active filter
M  switch the live runtime's default/draft/challenge model — arrow-key picker over the backend's current catalog, applied without restarting the session
O  reopen selected node with a reason
S  mark a real path changed outside the plan
Tab  switch pane
Q  quit
```

## Model runtime and configuration

The executable uses `CliAgentRuntime`, a backend-neutral agent runner: prompt
construction, retries, corrective feedback, session persistence, timeouts,
and per-operation model routing are shared, while each backend contributes
only its argv shape and output parsing in `src/tui/agent-backends.ts`.
Single-file drafts (`draft-patch`, `repair-patch`) ask for the raw unified
diff itself — assumptions as trailing `Assumption:` lines — and the runtime
falls back to the JSON envelope when a model still answers that way; the
batch draft stays JSON. Backends today: `opencode` (`opencode run --format
json`, default), `claude` (`claude -p --output-format json --permission-mode
plan`), and `codex` (`codex exec --json --sandbox read-only`). Claude
sessions resume via `--resume`; codex sessions are not continued yet. Vendor
flags drift — when one does, the fix is one object in that file. Adding an
agent is the same: implement the `CliAgentBackend` interface and register it.

## Agent socket

While the TUI runs it serves its embedded `AugmentServer` on a Unix socket
(default `$XDG_RUNTIME_DIR/neolit/augment.sock`; `AUGMENT_TUI_SOCKET`
overrides the path, `AUGMENT_TUI_NO_SOCKET=1` disables it). An external
agent attaches with:

```sh
augmentd --mcp --connect "$XDG_RUNTIME_DIR/neolit/augment.sock"
```

and its MCP tool calls (`draft_file`, `select_approach`, …) mutate the task
the TUI is rendering: each adopted change repaints the tree and detail panes
while the TUI is idle, and the winbar-style header shows the served address.
A write that races a running TUI operation queues behind it and then fails
the optimistic-concurrency check, exactly like any other stale writer.
`AugmentTuiController` exposes `server` for hosts that want to serve the
same store on additional transports, `subscribe` for repaint-on-change, and
`dispose` to release the socket.

Configuration lives in `$XDG_CONFIG_HOME/neolit/augment.json` (default
`~/.config/neolit/`). `augment setup` is the interface: it lists the agents
with PATH availability, lists the chosen agent's actual models (OpenCode via
its API, Claude via `claude model list` with alias fallback, others accept a
typed id), and picks the default/draft/challenge roles into the file. The
wizard also runs automatically on first start when no model is configured.
`augment config` prints the file and the effective merge.
Authentication is each backend's own concern (`opencode auth login`,
`claude` login, `codex` auth). Precedence: CLI flags > environment variables
> the config file > defaults. Environment variables remain the one-off
escape hatch:

```text
AUGMENT_BACKEND                (opencode | claude | codex; default opencode)
AUGMENT_OPENCODE_COMMAND       (command name; applies to any backend)
AUGMENT_OPENCODE_MODEL
AUGMENT_OPENCODE_DRAFT_MODEL
AUGMENT_OPENCODE_CHALLENGE_MODEL
AUGMENT_OPENCODE_AGENT
AUGMENT_OPENCODE_TIMEOUT_MS    (default 600000; slow model runs are killed after this budget)
AUGMENT_OPENCODE_SESSIONS      (default on; set 0 to start a fresh session for every call)
AUGMENT_OPENCODE_SERVER        (OpenCode URL; every call connects to this server — no implicit service spawn)
AUGMENT_OPENCODE_RETRIES       (default 2; extra attempts for rate limits, disconnects, and unparseable output)
AUGMENT_CHALLENGE_ROUNDS       (0-2, default 2; 0 skips challenge rounds for much faster domains)
AUGMENT_TUI_TASKS              (default on; set 0 to disable persisting and resuming the active task)
AUGMENT_TUI_NO_MODEL=1
```

## Architecture

`controller.ts` is UI-independent: it drives `AugmentServer`, computes selectable rows, and exposes a snapshot. `opencode-runtime.ts` is the standalone host adapter. `apply.ts` owns the host-side apply and commit transactions (sequential worktree preflight, pathspec commit). `detail.ts` is the pure view model — theme, per-entry state, the two-section pane content, and the frame budget — with no Ink or React. `augment.tsx` renders the controller snapshot through it. The develop policy itself is not the TUI's: `nextDevelopmentStep` in `src/augment/kernel.ts` decides it and the controller dispatches the result. This keeps interaction testable separately from rendering, and rendering from lifecycle.

Frames paint incrementally: `tuiRenderOptions()` in `augment.tsx` enables Ink's
`incrementalRendering`, so a repaint rewrites only the lines whose content changed
instead of erasing the previous frame and rewriting it whole, and `alternateScreen`
keeps the plan in a dedicated terminal buffer. `frameLayout` keeps every frame inside
the viewport: the root box is pinned to the window height, and the fixed chrome (root
padding 2, header 1, legend 2, status line 1 or the bordered input box 3) plus each
pane's borders and labels (3) is subtracted before the file tree and detail pane get
their row limits. A frame taller than the viewport would still make Ink clear and scroll the terminal.

## Validation

```sh
npx vitest run test/augment-tui.test.ts
npm run check
```
