# Augment planned-diff roadmap

Known gaps between shipped behavior and `src/augment/SPEC.md`.

- [ ] Persist tasks and protocol sessions across daemon restarts.
- [ ] Add a repository watcher that turns path/basis changes into `node/stale` operations.
- [ ] Add an isolated apply/verify transaction boundary for planned patches.
- [x] Add an OpenCode CLI `ModelRuntime` for the standalone TUI.
- [ ] Add native OpenCode-plugin and Codex `ModelRuntime` adapters.
- [ ] Persist and reload TUI tasks across process restarts.
- [ ] Add a stable transport address (Unix socket) alongside stdio.
- [ ] Add protocol change notifications for multi-client tree views.
- [ ] Add path-aware filesystem indexing and stronger scope validation.
- [ ] Add user/practice overlays and documentation-derived constraints.
- [ ] Add bounded re-crystallization with rejected-candidate memory.
