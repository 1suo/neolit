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
task/restore
task/get
tree/get
explain
node/get
node/constrain
node/select
node/reject
node/reopen
node/stale
path/restrict
crystallize
refine
patch/draft
patch/set
diff/get
shutdown
```

`task/restore` rehydrates a previously persisted task into a fresh server so hosts can resume after a restart; the payload must be a version-1 task. Every mutating request carries `taskId` and `expectedRevision`; the server rejects a mismatch before touching state. A task may use `mode: "change"` or `mode: "explanation"`; `explain` invokes the bounded explanation operation and attaches path explanations without creating candidates or patches — it accepts an optional `nodeId` to focus the explanation on one path. `path/restrict` keeps one plain: `lockedPaths` is the marked set and `restrictionMode` its polarity — in lock mode candidates, refinement children, and patches must avoid the set; in allow mode only the set may change. Switching polarity inverts the plain without touching the set. `patch/set` lets a host overwrite a drafted patch with its own edited text (for example, saved from an editor buffer); it reclassifies the diff, bumps the revision, and is rejected for stale revisions, unknown diffs, or locked paths.

## Model runtime

`new AugmentServer({ runtime })` accepts any implementation of `ModelRuntime`. The executable `augmentd` uses `UnavailableModelRuntime`, so pure tree operations work while crystallize/refine report that the host did not inject a model backend. The standalone TUI supplies its local OpenCode CLI adapter; native OpenCode-plugin and Codex adapters belong in their host packages.

## Validation

```sh
npx vitest run test/augment-server.test.ts
npm run check
```
