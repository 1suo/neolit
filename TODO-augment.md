# Augment planned-diff roadmap

Known gaps between shipped behavior and `src/augment/SPEC.md`.

- [ ] Persist tasks and protocol sessions across daemon restarts.
- [ ] Add a repository watcher that turns path/basis changes into `node/stale` operations.
- [ ] Track apply/verify lifecycle in planned-diff core state and expose `patch/apply` over JSON-RPC with rollback; the standalone TUI already applies drafted patches host-side through a preflighted, atomic `git apply` transaction (`src/tui/apply.ts`).- [x] Add an OpenCode CLI `ModelRuntime` for the standalone TUI.
- [x] Project the planned tree onto the complete repository tree.
- [x] Add task-local locked paths with mutation rejection.
- [x] Keep candidate domains node-local and scope candidate paths to their owning node.
- [ ] Add native OpenCode-plugin and Codex `ModelRuntime` adapters.
- [ ] Persist and reload TUI tasks across process restarts.
- [x] Add a stable transport address (Unix socket) alongside stdio: the TUI (and any embedding host) serves its embedded server on `$XDG_RUNTIME_DIR/neolit/augment.sock`, mutation notifications broadcast to attached clients, and per-task serialization of mutating dispatch keeps concurrent writers from losing updates (a racing writer fails the optimistic-concurrency check instead of being overwritten by a stale-snapshot result).
- [ ] Add protocol change notifications for multi-client tree views.
- [ ] Add path-aware filesystem indexing.
- [x] Validate patch content scope and locks: patch headers are parsed, one patch stays inside one file node, virtual patches project at their real path, and `task/restore` payloads pass the boundary schema plus referential integrity.
- [ ] Add user/practice overlays and documentation-derived constraints.
- [x] Add bounded re-crystallization with rejected-candidate memory: stale subtrees end staleness through `node/refresh` (optionally re-anchoring the basis), regeneration stays challenge-bounded, and labels eliminated by rejection or collapse cannot return.
- [x] Let models write into the plan through tools instead of one JSON reply: expose the planned-diff operations as agent tools over MCP, with `augmentd` as the tool provider (`augmentd --mcp`). Each call is small (one file's diff), validated and answered by the controller immediately (scope, locks, and — with `--directory` — joint `git apply` diagnostics returned to the agent so it retries that file with the exact reason). Controller authority is unchanged — every call flows through the reducers via the deterministic `domain/propose`, `domain/challenge`, `node/refine`, and `patch/attach` seams — and deterministic per-operation call caps keep agent loops bounded.
- [x] Wire an agent host (OpenCode MCP config, Codex, or Claude) to drive a task through the augmentd MCP tools end to end, and render tool-driven mutations live in the TUI as they land: agents attach with `augmentd --mcp --connect <socket>` (the TUI's winbar and the neolit.nvim sidebar show the served address), tool calls mutate the TUI's own task store, and external changes are adopted and repainted while the panel is idle. A write racing a running TUI operation queues behind it and then gets the typed stale-revision rejection with the fresh revision to retry.
- [x] Accept raw unified-diff text (no JSON envelope) for `draft-patch`/`repair-patch` replies: a unified diff is self-delimiting (`--- a/x`, `+++ b/x`, `@@`), so wrapping it in a JSON string only invites escape errors and mid-string truncation; assumptions move to trailing lines the runtime parses separately.
- [ ] Route model calls through one kept-alive agent server instead of per-call CLI spawns: backends declare `serveArgs` (opencode: `opencode serve --port 0`), `PersistentAgentServer` in `src/tui/opencode-runtime.ts` keeps that process alive and reuses its printed address, and `extractServerUrl` parses it (`test/augment-agent-backends.test.ts` covers both); wiring the runtime's per-call invocations through the kept-alive server remains.
