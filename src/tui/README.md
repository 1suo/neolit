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

## Operations

```text
N  start a task
C  crystallize selected node
R  refine selected node
P  draft a patch
A  add a constraint
O  reopen selected node
S  mark a path stale
Enter  collapse selected candidate / inspect detail
Tab   switch pane
Q     quit
```

## Model runtime

By default the executable uses `OpenCodeCliRuntime`, which invokes:

```text
opencode run --format json --auto
```

It uses OpenCode authentication and model routing, but returns only a JSON object matching the requested Neolit operation. Configure it with:

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
