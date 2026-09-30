# `augmentd` server

`src/augmentd/` exposes the planned-diff core through newline-delimited JSON-RPC 2.0 over standard I/O. It is deliberately host-neutral: OpenCode, Codex, Neovim, tests, and future IDE clients embed or launch the same protocol.

## Responsibility

- own in-memory task sessions;
- dispatch pure core operations;
- invoke the injected model runtime for crystallization/refinement;
- reject stale revisions and unknown nodes;
- keep model execution outside process-global state.

It does not watch the repository, apply patches, run checks, authenticate providers, or render a UI. Those are host responsibilities.

## Protocol

Requests are one JSON-RPC object per line. Batch requests are not supported.

```text
initialize
task/start
task/get
tree/get
explain
node/get
node/constrain
node/select
node/reject
node/reopen
node/stale
path/lock
crystallize
refine
patch/draft
patch/set
diff/get
shutdown
```

Every mutating request carries `taskId` and `expectedRevision`; the server rejects a mismatch before touching state. A task may use `mode: "change"` or `mode: "explanation"`; `explain` invokes the bounded explanation operation and attaches path explanations without creating candidates or patches. `path/lock` records task-local controller authority: candidates, refinement children, and patches cannot modify a locked path or its descendants. `patch/set` lets a host overwrite a drafted patch with its own edited text (for example, saved from an editor buffer); it reclassifies the diff, bumps the revision, and is rejected for stale revisions, unknown diffs, or locked paths.

## Model runtime

`new AugmentServer({ runtime })` accepts any implementation of `ModelRuntime`. The executable `augmentd` uses `UnavailableModelRuntime`, so pure tree operations work while crystallize/refine report that the host did not inject a model backend. The standalone TUI supplies its local OpenCode CLI adapter; native OpenCode-plugin and Codex adapters belong in their host packages.

## Validation

```sh
npx vitest run test/augment-server.test.ts
npm run check
```
