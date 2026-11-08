# `augmentd` server

`src/augmentd/` exposes the planned-diff core through newline-delimited JSON-RPC 2.0 over standard I/O, and serves the same operations as MCP agent tools. It is deliberately host-neutral: OpenCode, Codex, Neovim, tests, and future IDE clients embed or launch the same protocol.

## Responsibility

- own task sessions with an atomic, durable snapshot for standalone daemon and MCP processes;
- dispatch pure core operations;
- invoke the injected model runtime for crystallization/refinement;
- reject stale revisions and unknown nodes;
- keep model execution outside process-global state.

It does not watch the repository, apply patches, run checks, authenticate providers, or render a UI. Those are host responsibilities.

## Durable task sessions

Standalone `augmentd` and standalone `augmentd --mcp` persist every accepted
task mutation before acknowledging it. The snapshot is written with mode
`0600` to a temporary file, fsynced, then atomically renamed. Startup validates
each saved task against the protocol schema and referential-integrity rules;
invalid entries are skipped without discarding other valid tasks. The default
path is `$XDG_STATE_HOME/neolit/augmentd-<repository-hash>.json` when
`--directory DIR` is supplied, otherwise
`$XDG_STATE_HOME/neolit/augmentd-default.json` (falling back to
`~/.local/state`). Use `--state-file FILE` to choose an explicit store.
`task/list` and MCP `plan_list` enumerate recovered task ids after reconnect;
then `task/get` / `plan_status` resumes the selected task. The TUI has its own
repository-scoped task and agent-session binding store.

## Protocol

Requests are one JSON-RPC object per line. Batch requests are not supported.

```text
initialize
task/start
task/restore
task/list
task/get
tree/get
explain
message/route
node/get
node/constrain
node/select
node/reject
node/reopen
node/stale
node/refresh
path/restrict
crystallize
refine
domain/propose
domain/challenge
node/refine
patch/attach
patch/draft
patch/draft-batch
patch/set
diff/get
shutdown
```

`task/restore` rehydrates a task supplied by an embedding host; the payload must be a version-1 task that passes the boundary schema (`PlanTaskSchema`) and referential-integrity check, and the task id must not already exist. `task/list` returns the id, objective, mode, revision, and basis revision for every recovered task. Hosts embedding the server can subscribe with `onChange` for push delivery; over stdio, every task mutation is forwarded as a notification line — `{"jsonrpc":"2.0","method":"augment/taskChanged","params":{"taskId":"…","revision":N}}` — so editor hosts invalidate views instead of polling. Every mutating request carries `taskId` and `expectedRevision`; the server rejects a mismatch before touching state. A task may use `mode: "change"` or `mode: "explanation"`; `explain` invokes the bounded explanation operation and attaches path explanations without creating candidates or patches — it accepts an optional `nodeId` to focus the explanation on one path. `message/route` classifies one node-linked user message with a single bounded `route-message` model call (`develop`, `explain`, or `offer-options` with at least two interpretations) and returns the verdict without mutating the task — the host decides which flow continues. `path/restrict` keeps one plain: `lockedPaths` is the marked set and `restrictionMode` its polarity — in lock mode candidates, refinement children, and patches (including the paths named inside patch text) must not intersect the set; in allow mode a candidate pattern is legal only when the marked set fully covers it (a pattern that merely overlaps an allowed path — a folder spanning allowed and locked siblings — still names paths outside the set and is rejected; coverage by a single marked entry is required). Switching polarity inverts the plain without touching the set. `node/refresh` ends staleness for a subtree: stale nodes return to their last live lifecycle point, readiness propagates again, and an optional `basisRevision` re-anchors the task while existing diffs keep the basis they were drafted against. `patch/apply` accepts one or more diff ids, runs the injected transactional applier, and records `applied` only after filesystem application and durable state recording succeed; if persistence fails, the host rolls back the filesystem snapshot. `patch/verify` runs the host verifier and records `verified` or `failed` with its diagnostic. The TUI and `augmentd --directory DIR` use a Git-backed verifier that checks whitespace and reverse-applies the full patch series in a disposable worktree. `patch/set` lets a host overwrite a drafted patch with its own edited text (for example, saved from an editor buffer); it reclassifies the diff, bumps the revision, records an optional `failedCheck` grounding, and is rejected for stale revisions, unknown diffs, or locked paths.

### Deterministic proposal seams

`domain/propose`, `domain/challenge`, `node/refine`, and `patch/attach` apply one typed proposal directly — no model runtime involved. They exist for tool-driven hosts (the MCP layer below) and any host that computes proposals itself: candidates and children pass the same Zod boundary schemas as model output, domain proposals record out-of-scope candidates as constraints instead of losing them, challenges consume the bounded two-round budget, and `patch/attach` records `assumptions` as model-source constraints exactly like a model draft would. Controller authority is identical to the model-driven path because both run through the same kernel merges (`applyDomainProposal`, `applyChallenge`) and reducers.

## Socket transport

`socket.ts` serves the same newline-delimited protocol over a Unix socket, so several clients can reach one task store:

- `serveAugmentSocket(server, path?)` — listen (default `$XDG_RUNTIME_DIR/neolit/augment-<basename>-<hash>.sock` keyed to the repository directory so TUIs in different projects serve side by side, else a uid-keyed temp path; without a directory the plain `augment.sock`), refuse to steal a live server's address, unlink stale files, broadcast `augment/taskChanged` notifications to every attached client, and unlink on close.
- `SocketAugmentPeer` — client side: answers `handle()` from whichever process owns the socket.
- Mutating dispatch is serialized per task inside `AugmentServer`: a long operation (a model call inside `crystallize`, a draft) holds its task's turn, so a concurrent writer waits and then fails the optimistic-concurrency check instead of being silently overwritten by a result merged from a stale snapshot.

The standalone TUI serves its embedded server this way while it runs, which is what makes the MCP bridge below mutate the task the TUI is rendering.

## MCP tool provider

`mcp.ts` serves the planned-diff operations as MCP tools (`initialize`, `tools/list`, `tools/call`) over the same stdio framing, so an agent host (OpenCode, Claude, Codex) can let its model write into the plan one small call at a time instead of one JSON blob:

```text
plan_start            plan_list            plan_status\nread_diff              apply_patches        verify_patches
propose_approaches    challenge_approaches
select_approach       refine_plan
draft_file            repair_patch
```

`apply_patches` and `verify_patches` use the same host callbacks as JSON-RPC `patch/apply` and `patch/verify`. Each mutating call carries `expectedRevision`; results are compact confirmations (revision, ids, next step), and failures return the controller's typed reason as a tool error — scope violations name the paths, stale revisions tell the agent to refetch `plan_status`, and when the host injected a preflight, `draft_file`/`repair_patch` return git's exact `apply` diagnostic so the agent retries that one file with the reason. `plan_status` rows carry the diff ids of drafted paths and `read_diff` returns the exact patch text (one diff or all), so regeneration stays grounded in what was actually proposed. Deterministic per-operation call caps (`MCP_TOOL_CAPS`) bound agent loops.

```sh
npx augmentd --mcp                                  # standalone: owns its own task store
npx augmentd --mcp --directory .                    # + joint git apply diagnostics for drafts
npx augmentd --mcp --connect "$XDG_RUNTIME_DIR/neolit/augment-<project>-<hash>.sock"   # attach to a running TUI (ls that directory to find the address)
```

Attached with `--connect`, every tool call mutates the served store — the TUI's (or neolit.nvim's) panel renders each mutation as it lands; detached, the bridge owns its own tasks. The MCP client's agent is the model, so no `ModelRuntime` is injected in either mode. A host embedding the server passes its own `preflight` function and may route dispatch to any `NativePeer` (in-process `AugmentServer` or `SocketAugmentPeer`).

## Error codes

Controller failures carry typed JSON-RPC codes so hosts can act without parsing message prose:

```text
-32001 unknown task          -32010 stale revision (refetch and retry)
-32003 unknown node          -32011 locked path (offer to relax the plain)
-32004 unknown diff          -32012 scope escape (offer scope fix or retry)
-32005 unknown candidate     -32013 rejected candidate (regenerate differently)
-32000 other controller failures (invalid input, lifecycle guards, duplicates)
-32020 no model runtime      -32021 invalid model output\n-32022 no patch applier       -32023 no patch verifier
```

## Model runtime

`new AugmentServer({ runtime })` accepts any implementation of `ModelRuntime`. The executable `augmentd` uses `UnavailableModelRuntime`, so pure tree operations work while crystallize/refine report that the host did not inject a model backend. The standalone TUI supplies its local OpenCode CLI adapter; native OpenCode-plugin and Codex adapters belong in their host packages.

## Validation

```sh
npx vitest run test/augment-server.test.ts test/augment-mcp.test.ts test/augment-socket.test.ts
npm run check
```
