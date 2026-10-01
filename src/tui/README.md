# Neolit TUI

`src/tui/` is the standalone planned-diff terminal interface. It embeds the same in-memory `AugmentServer` used by the protocol and renders the resulting filesystem-shaped plan with [Ink](https://github.com/vademedes/ink) and React.

## Layout

The left pane is the complete repository file tree with plan state integrated into it. Repository-only paths remain visible but muted and unlabeled; planned and drafted paths are marked in place.

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
+ ~ - drafted new/modified/deleted (count)  Δ several drafts
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
● ready      path and obligations are complete
? explained  path is relevant to the current explanation topic
```

The right pane carries exactly two content sections. **DESCRIPTION** holds why the selected path changes: node reasons, a folder's planned children with their per-path reasons (unchanged entries omitted), open approach choices, explanations, and messages. **CHANGES** holds the actual drafted patches — the aggregated change summary plus the exact diffs (complete for files, previews for folders) with `applied` marks. When neither section has anything to show, the pane shows contextual **KEYS** suggestions instead (`[N]`, `1-7`, `[D]`/`[A]`). Approaches appear only while a choice is still open on the node; once an approach is chosen they are history and never rendered. The pane scrolls with `j`/`k` while it is focused (`Tab`), and long lines wrap natively through Ink. Candidate confidence is a model estimate for presentation only; the controller never selects an approach from it.

Press `E` to start an explanation task. Explanation tasks highlight related files and folders with `?` marks and show their role, summary, and confidence in the selected-path pane. Explanation tasks do not create approaches or patches.

While an operation runs, its target path animates in the tree (`⠋` with the lowercased operation name) and the preview leads with the live operation and its target path. A failed operation marks its path with `× failed`; the preview shows the failed operation and the first line of its error, and the mark clears when the same path succeeds on retry.

Every frame derives its vertical budget from the exported `frameLayout()`: fixed chrome (root padding, header, legend, the permanent three-row message panel, pane borders and titles) is subtracted from the terminal height first, so a frame never exceeds the viewport and repaints never clear and scroll the terminal; below the panel's own chrome the panes degrade to one row. The message panel is always present — it shows the live operation with its spinner while busy, the first line of the last error in red, the standing message otherwise, and the input line while typing — so the frame's chrome height never changes between modes. Preview lines wrap natively through Ink; the scroll window counts logical lines.

## Flow

After a task is entered and a model is configured, the TUI automatically generates approaches. A domain with exactly one viable candidate is adopted automatically (through a real `node/select`), so `F` works immediately; multiple candidates still ask for `1-7`. The intended flow is:

```text
1. describe the change
2. inspect the suggested file tree
3. choose an approach with 1-7
4. press D to develop the chosen approach into concrete files
5. select a file and press D again to draft its patch
6. press Enter on any path to attach a message/constraint
```

## Operations

```text
N  start a new change plan
E  explain — with an active task it explains the selected path; without one it starts a repository-wide explanation task
Enter  the universal prompt for the selected path: text becomes a message that regenerates its subtree; submitting empty rethinks it
1-7  choose the numbered approach
D  develop the selected path — a chosen approach expands into files; on a refined folder or the root it advances to the next undrafted file, selects it, and drafts it; a planned file drafts its exact patch
A  apply the selected path's drafted patch(es) to the working tree
C  commit exactly the paths this session applied (pathspec commit; unrelated dirty or staged files stay untouched)
L  mark/unmark the selected path in the restriction plain, lock polarity: marked (`#`, red) paths must not change, everything else may
W  mark/unmark the selected path, allow polarity: marked (`#`, accent) paths are the only ones that may change. One plain, one marked set: pressing the other polarity key inverts it (the set stays, its meaning flips). Marks made before a task starts are applied before its first model run
O  reopen selected node with a reason
S  mark a real path changed outside the plan
Tab  switch pane
Q  quit
```

## Model runtime

The executable uses `OpenCodeCliRuntime`, which invokes:

```text
opencode run --format json --auto
```

Select a working model explicitly with `--model provider/model` or `AUGMENT_OPENCODE_MODEL`. OpenCode's implicit default may point at an unavailable paid model and fail with a quota/authentication error. Configure the runtime with:

```text
AUGMENT_OPENCODE_COMMAND
AUGMENT_OPENCODE_MODEL
AUGMENT_OPENCODE_DRAFT_MODEL
AUGMENT_OPENCODE_CHALLENGE_MODEL  (optional faster model for challenge-domain coverage checks)
AUGMENT_OPENCODE_AGENT
AUGMENT_OPENCODE_TIMEOUT_MS    (default 600000; slow model runs are killed after this budget)
AUGMENT_OPENCODE_SESSIONS      (default on; set 0 to start a fresh OpenCode session for every call)
AUGMENT_OPENCODE_RETRIES       (default 2; extra attempts for rate limits, disconnects, and unparseable output)
AUGMENT_CHALLENGE_ROUNDS       (0-2, default 2; 0 skips challenge rounds for much faster domains)
AUGMENT_TUI_TASKS            (default on; set 0 to disable persisting and resuming the active task)
AUGMENT_TUI_NO_MODEL=1
```

Model calls reuse one OpenCode session per task — the session id is captured
from the run's event stream and continued with `--session`, with a fresh
session as fallback when continuation fails — so repeat operations keep the
model's earlier exploration instead of cold-starting each call. Each prompt
still states that its context packet is the current authoritative state.
Session mappings persist to `$XDG_STATE_HOME/neolit/augment-sessions.json`
(default `~/.local/state/neolit/`, newest 64 tasks), so a restarted TUI
continues the same sessions. Transient provider failures (rate limits,
disconnects, timeouts) and unparseable model output retry up to
`AUGMENT_OPENCODE_RETRIES` extra times with linear backoff; validation
failures still fail fast.

`AUGMENT_OPENCODE_DRAFT_MODEL` optionally routes only `draft-patch` and
`repair-patch` to a faster model. Draft and repair calls embed the target
file's exact content in the prompt and instruct the model to answer in one
shot without tools, so a small quick model is usually enough; domain
generation and challenges keep using `AUGMENT_OPENCODE_MODEL`. Drafts are
also preflighted with `git apply --check` against the working tree AND
together with every other drafted patch in the same task, then retried
once with git's diagnostic — so stored diffs reach `A` already known to
apply jointly.

The TUI requires an interactive terminal (`process.stdin.isTTY`). It edits planned state and, on request, applies drafted patches to the working tree through `src/tui/apply.ts`: a shared `git apply --check` preflight followed by one atomic `git apply` for all selected patches. It never stages or commits.

## Architecture

`controller.ts` is UI-independent: it drives `AugmentServer`, computes selectable rows, and exposes a snapshot. `opencode-runtime.ts` is the standalone host adapter. `apply.ts` owns the host-side apply transaction (preflighted, atomic, uncommitted `git apply`). `augment.tsx` renders the controller snapshot with Ink/React. This keeps interaction testable separately from rendering.

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
