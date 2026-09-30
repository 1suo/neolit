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

Indicators:

```text
◇ possible   path appears in a possible approach
◆ chosen     selected approach, with model confidence
~ planned    concrete path in the current plan
+ new        drafted new file
~ modify     drafted modification
- delete     drafted deletion
! stale      repository basis changed
# locked     path cannot change in this run
● ready      path and obligations are complete
? explained  path is relevant to the current explanation topic
```

Directories inherit and aggregate descendant state. Selecting a directory immediately shows a contents summary listing only its planned children — each with its plan indicator, state, and the model's per-path change reason; unchanged entries are omitted — plus a folder change summary (`added`, `changed`, `removed`), every descendant change with its reason, and the beginning of each exact patch. Selecting a file immediately shows its reason and complete exact patch in the right pane; no secondary command is required. The pane scrolls with `j`/`k` while it is focused (`Tab`). Candidate confidence is a model estimate for presentation only; the controller never selects an approach from it.

Press `E` to start an explanation task. Explanation tasks highlight related files and folders with `?` marks and show their role, summary, and confidence in the selected-path pane. Explanation tasks do not create approaches or patches.

## Flow

After a task is entered and a model is configured, the TUI automatically generates approaches. The intended flow is:

```text
1. describe the change
2. inspect the suggested file tree
3. choose an approach with 1-7
4. press F to expand it into concrete files
5. select a file and press D to draft its patch
6. press Enter on any path to attach a message/constraint
```

## Operations

```text
N  start a new change plan
E  start an explanation task
Enter  attach a message and regenerate this path/subtree
1-7  choose the numbered approach
F  expand the chosen approach into files
D  draft the selected file patch
A  apply the selected path's drafted patch(es) to the working tree
G  rethink the selected path
L  lock/unlock the selected file or directory (before a task starts, locks are held for the next task and applied before its first model run; the model sees them as paths it must not change)
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
AUGMENT_OPENCODE_AGENT
AUGMENT_OPENCODE_TIMEOUT_MS    (default 600000; slow model runs are killed after this budget)
AUGMENT_TUI_NO_MODEL=1
```

The TUI requires an interactive terminal (`process.stdin.isTTY`). It edits planned state and, on request, applies drafted patches to the working tree through `src/tui/apply.ts`: a shared `git apply --check` preflight followed by one atomic `git apply` for all selected patches. It never stages or commits.

## Architecture

`controller.ts` is UI-independent: it drives `AugmentServer`, computes selectable rows, and exposes a snapshot. `opencode-runtime.ts` is the standalone host adapter. `apply.ts` owns the host-side apply transaction (preflighted, atomic, uncommitted `git apply`). `augment.tsx` renders the controller snapshot with Ink/React. This keeps interaction testable separately from rendering.

## Validation

```sh
npx vitest run test/augment-tui.test.ts
npm run check
```
