# Neolit TUI

`src/tui/` is the standalone planned-diff terminal interface. It embeds the same in-memory `AugmentServer` used by the protocol and renders the resulting filesystem-shaped plan with [Ink](https://github.com/vademedes/ink) and React.

## Layout

The left pane is a filesystem tree, not a graph or status board. Only paths that are candidates for change, planned nodes, or drafted patches appear.

```text
FILES
◆ repo/                 chosen: fixed retries
└─ src/                 planned
   └─ auth/             planned
      └─ session.ts     draft patch
      └─ retry.test.ts  planned
└─ README.md            planned
```

Indicators:

```text
◇ N choices  paths suggested by possible approaches
◆ chosen     selected approach
~ planned    concrete path in the current plan
▤ draft      patch text exists
! stale      repository basis changed
● ready      path and obligations are complete
```

The right pane explains the selected path: why it is included, available approaches, user messages, and patch text.

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
N  start a new plan
Enter  attach a message to the selected path
1-7  choose the numbered approach
F  expand the chosen approach into files
D  draft the selected file patch
G  rethink the selected path
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
AUGMENT_OPENCODE_TIMEOUT_MS
AUGMENT_TUI_NO_MODEL=1
```

The TUI requires an interactive terminal (`process.stdin.isTTY`). It can edit only planned state and never applies a patch to the repository.

## Architecture

`controller.ts` is UI-independent: it drives `AugmentServer`, computes selectable rows, and exposes a snapshot. `opencode-runtime.ts` is the standalone host adapter. `augment.tsx` renders the controller snapshot with Ink/React. This keeps interaction testable separately from rendering.

## Validation

```sh
npx vitest run test/augment-tui.test.ts
npm run check
```
