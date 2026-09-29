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
node/get
node/constrain
node/select
node/reject
node/reopen
node/stale
crystallize
refine
patch/draft
diff/get
shutdown
```

Every mutating request carries `taskId` and `expectedRevision`; the server rejects a mismatch before touching state.

## Model runtime

`createAugmentServer({ runtime })` accepts any implementation of `ModelRuntime`. The executable `augmentd` uses `UnavailableModelRuntime`, so pure tree operations work while crystallize/refine report that the host did not inject a model backend. OpenCode and Codex adapters belong in their host packages, not in this package.

## Validation

```sh
npx vitest run test/augment-server.test.ts
npm run check
```
