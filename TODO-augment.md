# Augment planned-diff roadmap

Known gaps between shipped behavior and `src/augment/SPEC.md`.

- [ ] Persist tasks and protocol sessions across daemon restarts.
- [ ] Add a repository watcher that turns path/basis changes into `node/stale` operations.
- [ ] Track apply/verify lifecycle in planned-diff core state and expose `patch/apply` over JSON-RPC with rollback; the standalone TUI already applies drafted patches host-side through a preflighted, atomic `git apply` transaction (`src/tui/apply.ts`).
- [x] Add an OpenCode CLI `ModelRuntime` for the standalone TUI.
- [x] Project the planned tree onto the complete repository tree.
- [x] Add task-local locked paths with mutation rejection.
- [x] Keep candidate domains node-local and scope candidate paths to their owning node.
- [ ] Add native OpenCode-plugin and Codex `ModelRuntime` adapters.
- [ ] Persist and reload TUI tasks across process restarts.
- [ ] Add a stable transport address (Unix socket) alongside stdio.
- [ ] Add protocol change notifications for multi-client tree views.
- [ ] Add path-aware filesystem indexing.
- [x] Validate patch content scope and locks: patch headers are parsed, one patch stays inside one file node, virtual patches project at their real path, and `task/restore` payloads pass the boundary schema plus referential integrity.
- [ ] Add user/practice overlays and documentation-derived constraints.
- [ ] Add bounded re-crystallization with rejected-candidate memory: stale subtrees end staleness through `node/refresh` (optionally re-anchoring the basis), regeneration stays challenge-bounded, and labels eliminated by rejection or collapse cannot return.
- [ ] Let models write into the plan through tools instead of one JSON reply: expose the planned-diff operations (draft one file, select approach, refine) as agent tools over MCP, with `augmentd` as the tool provider. Each call is small (one file's diff — no JSON-escaped multi-hundred-line payload to truncate), validated and answered by the controller immediately (scope, locks, `git apply` diagnostics returned to the agent so it retries that file with the exact reason), and rendered in the TUI as it lands. Controller authority is unchanged — every call still flows through the reducers — and deterministic per-operation call caps keep agent loops bounded. This replaces the single-blob reply as the draft path and requires the model-operation contract in `src/augment/SPEC.md` to move from "one typed proposal per call" to typed tool proposals.
- [ ] Accept raw unified-diff text (no JSON envelope) for `draft-patch`/`repair-patch` replies: a unified diff is self-delimiting (`--- a/x`, `+++ b/x`, `@@`), so wrapping it in a JSON string only invites escape errors and mid-string truncation; assumptions move to trailing lines the runtime parses separately.
