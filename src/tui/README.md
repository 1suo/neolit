# Neolit TUI

`src/tui/` is the standalone planned-diff terminal interface. It embeds the same in-memory `AugmentServer` used by the protocol and renders the resulting filesystem-shaped plan with [Ink](https://github.com/vademedes/ink) and React.

## Layout

The interface adapts the proven OpenCode connector TUI conventions rather than inventing a new visual language:

- a compact status header;
- a 42% planned-tree pane and 58% detail pane;
- bordered focus states;
- keyboard-first navigation;
- a footer of available operations;
- inline prompt input instead of chat.

```text
┌ PLANNED TREE ─────────┐ ┌ DETAILS ─────────────────────┐
│ src/auth              │ │ selected path/status         │
│   session.ts          │ │ candidates and constraints   │
│     fixed retries ◇   │ │ patch text                   │
└───────────────────────┘ └───────────────────────────────┘
```

## Flow

After a task is entered and a model is configured, the TUI automatically generates approaches. The intended flow is:

```text
1. describe the change
2. review generated approaches
3. Enter to use one
4. F expands it into planned files
5. D drafts the selected file change
6. review the planned patch
```

## Operations

```text
N  start a new plan
G  generate approaches again
Enter  use selected approach / inspect detail
F  expand approach into files
D  draft selected file change
A  add rule
O  rework selected choice
S  mark real file changed
Tab   switch pane
Q     quit
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
