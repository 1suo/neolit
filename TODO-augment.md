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
- [x] Add bounded re-crystallization with rejected-candidate memory: stale subtrees end staleness through `node/refresh` (optionally re-anchoring the basis), regeneration stays challenge-bounded, and labels eliminated by rejection or collapse cannot return.
