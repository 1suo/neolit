# Git-native simplification rewrite

Implementation gaps against [REWRITE-SPEC.md](./REWRITE-SPEC.md). Tasks are ordered to prove the new product in vertical slices. Each task links to the normative requirement IDs it implements. Existing `TODO-augment.md` remains the historical/current planned-diff gap ledger until the old product is retired; do not silently reinterpret its items as work for this rewrite.

## Phase 1 — contract and document conventions

- [ ] Define and test requirement-ID and TODO-reference parsing
  - SPEC: `REWRITE-SPEC.md#R-13`, `REWRITE-SPEC.md#R-14`, `REWRITE-SPEC.md#R-15`, `REWRITE-SPEC.md#R-18`
  - File: `src/planning/markdown.ts`, `test/planning-markdown.test.ts`
  - Description: Implemented the pure SPEC/TODO parser, source ranges, reference resolution diagnostics, Git diff hunk parsing, and conservative file-path associations. Keep this task open until the test suite has been executed and the parser contract is validated.
- [ ] Define conservative task identity and remapping behavior
  - SPEC: `REWRITE-SPEC.md#R-20`, `REWRITE-SPEC.md#R-21`
  - Description: Added disposable task keys and conservative remapping for edits, heading moves, and unique requirement references. Duplicate/competing matches remain explicitly ambiguous. Tests cover heading moves, text edits, unique requirement signatures, additions/removals across TODO files, duplicate identities, and competing requirement signatures. Keep open until the focused test suite is executed.
- [x] Add repository instruction and reusable workflow skill for the new contract
  - SPEC: `REWRITE-SPEC.md#R-02`, `REWRITE-SPEC.md#R-08`, `REWRITE-SPEC.md#R-09`, `REWRITE-SPEC.md#R-10`, `REWRITE-SPEC.md#R-11`, `REWRITE-SPEC.md#R-47`
  - File: `AGENTS.md`
  - Description: Replaced planned-diff-specific agent workflow with a concise README → SPEC → TODO → inspect → implement → verify → reconcile process. Added an optional reusable Skill with detailed context, task-template, testing, and commit procedures; AGENTS.md remains sufficient for agents that do not load Skills.

## Phase 2 — deterministic documentation core

- [ ] Discover linked README/SPEC/TODO documents without imposing a new repository layout
  - SPEC: `REWRITE-SPEC.md#R-08`, `REWRITE-SPEC.md#R-09`, `REWRITE-SPEC.md#R-12`
  - File: `src/planning/workspace.ts`, `test/planning-workspace.test.ts`
  - Description: Implemented root-README graph traversal and linked SPEC/TODO discovery, including linked variants. Tests are written but not yet executed; validate against real repository link patterns before closing.
- [ ] Parse SPEC requirements, acceptance criteria, TODO tasks, nested descriptions, and file references
  - SPEC: `REWRITE-SPEC.md#R-13`, `REWRITE-SPEC.md#R-14`, `REWRITE-SPEC.md#R-15`, `REWRITE-SPEC.md#R-16`, `REWRITE-SPEC.md#R-17`
  - Description: Added `R-NN` requirements, `AC-NN` criteria with explicit requirement links, TODO task metadata, optional direct AC references, and source ranges. Keep open until tests cover repository-specific Markdown variants and are executed.
- [ ] Build TODO-to-SPEC traceability and diagnostics
  - SPEC: `REWRITE-SPEC.md#R-18`, `REWRITE-SPEC.md#R-19`, `REWRITE-SPEC.md#R-29`
  - Description: Resolve every task's SPEC references, report missing/ambiguous targets, and never interpret checkbox state as implementation or verification evidence.
- [ ] Build documentation graph navigation and minimal context assembly
  - SPEC: `REWRITE-SPEC.md#R-09`, `REWRITE-SPEC.md#R-10`, `REWRITE-SPEC.md#R-11`, `REWRITE-SPEC.md#R-41`
  - Description: Retrieve only relevant linked documentation for a selected task/requirement; keep current-state README facts separate from desired-state SPEC.

## Phase 3 — Git evidence and derived states

- [ ] Index Git status and actual diff metadata for the selected comparison base
  - SPEC: `REWRITE-SPEC.md#R-33`, `REWRITE-SPEC.md#R-34`, `REWRITE-SPEC.md#R-37`, `REWRITE-SPEC.md#R-38`
  - File: `src/planning/workspace.ts`, `test/planning-workspace.test.ts`
  - Description: Initial read-only HEAD-to-working-tree/index diff and porcelain status loader implemented, including untracked path enumeration. Workspace diff identity now includes HEAD, tracked diff, porcelain status, and hashes of untracked file contents. Untracked files now receive real `git diff --no-index` hunks and raw diff text, not just a path placeholder. Added a fixture covering staged-only, staged+unstaged, deleted, renamed, and untracked Unicode/space-containing paths. Keep open until the focused workspace tests execute; expose comparison-base selection later.
- [ ] Parse diff hunks and map changed paths/hunks to TODO tasks and SPEC requirements
  - SPEC: `REWRITE-SPEC.md#R-03`, `REWRITE-SPEC.md#R-04`, `REWRITE-SPEC.md#R-31`, `REWRITE-SPEC.md#R-32`
  - Description: Start with explicit task file references and conservative path/hunk evidence. Surface ambiguity and unplanned changes instead of guessing.
- [ ] Derive task and requirement presentation states from Markdown, Git, and verification evidence
  - SPEC: `REWRITE-SPEC.md#R-26`, `REWRITE-SPEC.md#R-27`, `REWRITE-SPEC.md#R-28`, `REWRITE-SPEC.md#R-29`, `REWRITE-SPEC.md#R-30`
  - Description: Added AC-ID parsing and read-only task/requirement projections for planned/in-progress/implemented/verified/blocked/unmapped/unplanned. Verification requires a non-empty command/result, passing result, explicit criterion/task linkage, and exact base/diff identity. Workspace and unit fixtures cover checkbox independence, partial/full path evidence, blockers, unmapped references, all-criteria verification, and stale/failed checks. Keep open until focused tests execute and editor display is verified.
- [ ] Invalidate and refresh derived views on filesystem and Git changes
  - SPEC: `REWRITE-SPEC.md#R-38`, `REWRITE-SPEC.md#R-51`, `REWRITE-SPEC.md#R-52`
  - Description: Watch relevant files for responsiveness, but re-read Git before presenting consequential state.

## Phase 4 — contextual agent questions

- [ ] Define stable file, hunk, and line-range context anchors
  - SPEC: `REWRITE-SPEC.md#R-36`, `REWRITE-SPEC.md#R-39`, `REWRITE-SPEC.md#R-40`, `REWRITE-SPEC.md#R-45`
  - File: `src/planning/context.ts`, `src/planning/workspace.ts`, `1suo/neolit.nvim/lua/neolit/planning.lua`
  - Description: Added shared anchors with repository-relative paths, base/working-tree side, optional line/hunk ranges, base commit, SHA-256 diff identity, and optional blob identity. Added fail-closed stale checks and tests for base/diff/blob changes. The Neovim prototype independently rejects stale HEAD/diff context. Keep open until host handoff consumes the shared API and focused tests execute.
- [ ] Build compact contextual question packets
  - SPEC: `REWRITE-SPEC.md#R-41`, `REWRITE-SPEC.md#R-44`
  - File: `src/planning/context.ts`, `1suo/neolit.nvim/lua/neolit/planning.lua`
  - Description: Added a shared packet builder that validates the current base/diff identity, includes only selected diff text, and appends related TODO/SPEC context. The Neovim prototype now supports `<leader>nx` on a diff-buffer line or visual line range, includes exact selected lines plus file diff/base/diff identity, rejects unsaved working buffers, and refreshes on stale HEAD/diff. The Neovim prototype now calls the shared `buildDiffQuestionPacket` API; a headless Neovim smoke test covers the line-range packet and stale-diff rejection. Run the plugin's Lua suite before closing.
- [ ] Add existing-agent handoff with copyable fallback
  - SPEC: `REWRITE-SPEC.md#R-05`, `REWRITE-SPEC.md#R-42`, `REWRITE-SPEC.md#R-43`, `REWRITE-SPEC.md#R-46`, `REWRITE-SPEC.md#R-49`, `REWRITE-SPEC.md#R-50`
  - Description: Use a supported host API/session integration only when available. Otherwise expose a copyable context prompt and native navigation; do not add a Neolit chat/session layer.

## Phase 5 — editor-native vertical slice and adapters

- [ ] Prototype the full task → requirement → diff → contextual question flow in Neovim
  - SPEC: `REWRITE-SPEC.md#R-01`, `REWRITE-SPEC.md#R-03`, `REWRITE-SPEC.md#R-05`, `REWRITE-SPEC.md#R-06`, `REWRITE-SPEC.md#R-35`, `REWRITE-SPEC.md#R-54`, `REWRITE-SPEC.md#R-55`, `REWRITE-SPEC.md#R-56`, `REWRITE-SPEC.md#R-57`, `REWRITE-SPEC.md#R-58`, `REWRITE-SPEC.md#R-61`, `REWRITE-SPEC.md#R-62`, `REWRITE-SPEC.md#R-63`, `REWRITE-SPEC.md#R-64`, `REWRITE-SPEC.md#R-65`
  - File: `1suo/neolit.nvim` (separate repository, branch `rewrite/planning-workspace`)
  - Description: Initial `:NeolitPlan` companion view is implemented: linked tasks/requirements, changed file/hunk navigation, diff-syntax buffers, and clipboard context packets. It is intentionally separate from the legacy `:Neolit` controller. Still needs local Neovim smoke tests and refinement into native explorer decorations/details UI.
- [ ] Implement the shared VS Code adapter
  - SPEC: `REWRITE-SPEC.md#R-06`, `REWRITE-SPEC.md#R-54`, `REWRITE-SPEC.md#R-55`, `REWRITE-SPEC.md#R-56`, `REWRITE-SPEC.md#R-57`, `REWRITE-SPEC.md#R-58`
  - Description: Use TreeView, FileDecorationProvider, native diff/editor commands, and the shared core; do not duplicate parsing or state derivation.
- [ ] Keep trivial changes on the direct prompt → Git diff path
  - SPEC: `REWRITE-SPEC.md#R-07`, `REWRITE-SPEC.md#R-24`, `REWRITE-SPEC.md#R-25`
  - Description: Verify that opening Neolit or using an existing agent never forces SPEC/TODO creation for small tasks.

## Phase 6 — retire old architecture and validate migration

- [ ] Replace planned-diff kernel and protocol with the documentation/Git core
  - SPEC: `REWRITE-SPEC.md#R-51`, `REWRITE-SPEC.md#R-52`, `REWRITE-SPEC.md#R-53`, `REWRITE-SPEC.md#R-59`, `REWRITE-SPEC.md#R-60`, `REWRITE-SPEC.md#R-70`
  - Description: Remove candidate domains, challenge/collapse/refinement, planned patch storage/application, model operation routing, and agent tool orchestration. Retain only measured, reusable behavior that fits the target.
- [ ] Update package exports, CLI commands, and Neovim host contract
  - SPEC: `REWRITE-SPEC.md#R-54`, `REWRITE-SPEC.md#R-55`, `REWRITE-SPEC.md#R-59`, `REWRITE-SPEC.md#R-73`
  - Description: Remove stale public APIs and ensure `neolit.nvim` consumes the new shared core rather than the old TUI/controller contract.
- [ ] Preserve repository documents and isolate legacy task handling
  - SPEC: `REWRITE-SPEC.md#R-71`, `REWRITE-SPEC.md#R-72`
  - Description: Never rewrite existing README/SPEC/TODO files as a migration side effect. Legacy plan export, if implemented, must be explicit and read-only.
- [ ] Add end-to-end fixtures for the full acceptance workflow
  - SPEC: `REWRITE-SPEC.md#R-22`, `REWRITE-SPEC.md#R-23`, `REWRITE-SPEC.md#R-26`, `REWRITE-SPEC.md#R-27`, `REWRITE-SPEC.md#R-28`, `REWRITE-SPEC.md#R-32`, `REWRITE-SPEC.md#R-40`, `REWRITE-SPEC.md#R-45`, `REWRITE-SPEC.md#R-66`, `REWRITE-SPEC.md#R-67`, `REWRITE-SPEC.md#R-68`, `REWRITE-SPEC.md#R-69`
  - Description: Prove exact traceability, stale-anchor rejection, verification gating, worktree isolation, and preservation of unrelated staged/dirty files.
- [ ] Reconcile root/component READMEs and retire superseded roadmap references
  - SPEC: `REWRITE-SPEC.md#R-08`, `REWRITE-SPEC.md#R-10`, `REWRITE-SPEC.md#R-11`, `REWRITE-SPEC.md#R-73`
  - Description: Update READMEs only as the new behavior ships; remove obsolete planned-diff claims and historical TODO links when their owning code is actually retired.

## Verification

- [ ] Every TODO task resolves to one or more existing SPEC requirement IDs.
  - SPEC: `REWRITE-SPEC.md#R-13`, `REWRITE-SPEC.md#R-15`, `REWRITE-SPEC.md#R-18`
- [ ] Derived states are tested independently from Markdown checkbox values.
  - SPEC: `REWRITE-SPEC.md#R-26`, `REWRITE-SPEC.md#R-27`, `REWRITE-SPEC.md#R-28`, `REWRITE-SPEC.md#R-29`, `REWRITE-SPEC.md#R-30`
- [ ] Diff mapping tests include ambiguous, partial, and unplanned changes.
  - SPEC: `REWRITE-SPEC.md#R-31`, `REWRITE-SPEC.md#R-32`, `REWRITE-SPEC.md#R-33`, `REWRITE-SPEC.md#R-34`
- [ ] Context-anchor tests cover file, hunk, line range, base/working-tree side, and stale diff changes.
  - SPEC: `REWRITE-SPEC.md#R-39`, `REWRITE-SPEC.md#R-40`, `REWRITE-SPEC.md#R-41`, `REWRITE-SPEC.md#R-45`
- [ ] End-to-end tests preserve unrelated staged and unstaged user changes.
  - SPEC: `REWRITE-SPEC.md#R-66`, `REWRITE-SPEC.md#R-67`, `REWRITE-SPEC.md#R-68`, `REWRITE-SPEC.md#R-69`
- [ ] `npm run check` and `npm run build` pass for the core package.
  - SPEC: `REWRITE-SPEC.md#R-51`, `REWRITE-SPEC.md#R-52`, `REWRITE-SPEC.md#R-73`
- [ ] Neovim and VS Code host tests pass for their supported integration paths.
  - SPEC: `REWRITE-SPEC.md#R-54`, `REWRITE-SPEC.md#R-55`, `REWRITE-SPEC.md#R-56`, `REWRITE-SPEC.md#R-64`, `REWRITE-SPEC.md#R-65`
