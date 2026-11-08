# Git-native simplification rewrite

Checkboxes distinguish shipped implementation slices from outstanding validation. A checked implementation item does not claim tests or host-level verification passed; the paired validation item stays open until that work is actually performed. Incomplete implementation remains unchecked. No test work is implied by this ledger update.

Implementation gaps against [REWRITE-SPEC.md](./REWRITE-SPEC.md). Tasks are ordered to prove the new product in vertical slices. Each task links to the normative requirement IDs it implements. `TODO-augment.md` and `SOTA-GAPS.md` are retained as historical records of the retired planned-diff product; do not reinterpret their items as work for this rewrite.

## Phase 1 — contract and document conventions

- [x] Implement requirement-ID and TODO-reference parsing
  - SPEC: `REWRITE-SPEC.md#R-13`, `REWRITE-SPEC.md#R-14`, `REWRITE-SPEC.md#R-15`, `REWRITE-SPEC.md#R-18`
  - File: `src/planning/markdown.ts`, `test/planning-markdown.test.ts`
  - Description: Implemented the pure SPEC/TODO parser, source ranges, reference resolution diagnostics, Git diff hunk parsing, and conservative file-path associations. 
- [x] Validate parser behavior against repository Markdown conventions
  - SPEC: `REWRITE-SPEC.md#R-13`, `REWRITE-SPEC.md#R-14`, `REWRITE-SPEC.md#R-15`, `REWRITE-SPEC.md#R-18`
  - Description: Manually reviewed the parser against the repository's actual REWRITE-SPEC and TODO forms. Corrected requirement/criterion parsing to accept the standalone bold IDs used by REWRITE-SPEC as well as list-form IDs. This is a source review only; no tests were added or run.
- [x] Implement conservative task identity and remapping
  - SPEC: `REWRITE-SPEC.md#R-20`, `REWRITE-SPEC.md#R-21`
  - Description: Added disposable task keys and conservative remapping for edits, heading moves, and unique requirement references. Duplicate/competing matches remain explicitly ambiguous. Tests cover heading moves, text edits, unique requirement signatures, additions/removals across TODO files, duplicate identities, and competing requirement signatures. 
- [ ] Validate task remapping behavior and ambiguity handling
  - SPEC: `REWRITE-SPEC.md#R-20`, `REWRITE-SPEC.md#R-21`
  - Description: Implementation is present; this remains open until task-identity remapping and ambiguity handling are independently reviewed. No tests are added or represented as passing by this ledger.
- [x] Add repository instruction and reusable workflow skill for the new contract
  - SPEC: `REWRITE-SPEC.md#R-02`, `REWRITE-SPEC.md#R-08`, `REWRITE-SPEC.md#R-09`, `REWRITE-SPEC.md#R-10`, `REWRITE-SPEC.md#R-11`, `REWRITE-SPEC.md#R-47`
  - File: `AGENTS.md`
  - Description: Replaced planned-diff-specific agent workflow with a concise README → SPEC → TODO → inspect → implement → verify → reconcile process. Added an optional reusable Skill with detailed context, task-template, testing, and commit procedures; AGENTS.md remains sufficient for agents that do not load Skills.

## Phase 2 — deterministic documentation core

- [x] Implement linked README/SPEC/TODO document discovery
  - SPEC: `REWRITE-SPEC.md#R-08`, `REWRITE-SPEC.md#R-09`, `REWRITE-SPEC.md#R-12`
  - File: `src/planning/workspace.ts`, `test/planning-workspace.test.ts`
  - Description: Implemented root-README graph traversal and linked SPEC/TODO discovery, including linked variants, full/collapsed/shortcut reference-style links, and local Markdown autolinks. Implementation is complete; repository-specific behavior remains an explicit validation item.
- [ ] Validate discovery against repository link patterns
  - SPEC: `REWRITE-SPEC.md#R-08`, `REWRITE-SPEC.md#R-09`, `REWRITE-SPEC.md#R-12`
  - Description: Implementation is present; this remains open until behavior is independently reviewed. No tests are added or represented as passing by this ledger.
- [x] Implement SPEC/TODO parsing and source references
  - SPEC: `REWRITE-SPEC.md#R-13`, `REWRITE-SPEC.md#R-14`, `REWRITE-SPEC.md#R-15`, `REWRITE-SPEC.md#R-16`, `REWRITE-SPEC.md#R-17`
  - Description: Added `R-NN` requirements, `AC-NN` criteria with explicit requirement links, TODO task metadata, optional direct AC references, and source ranges. 
- [x] Validate parsing against repository-specific Markdown variants
  - SPEC: `REWRITE-SPEC.md#R-13`, `REWRITE-SPEC.md#R-14`, `REWRITE-SPEC.md#R-15`, `REWRITE-SPEC.md#R-16`, `REWRITE-SPEC.md#R-17`
  - Description: Manually reviewed task checkboxes, nested SPEC/File/Description metadata, multi-ID references, optional file hints, standalone/list-form requirement IDs, acceptance-criterion IDs, and unresolved-reference behavior against the current repository conventions. This is a source review only; no tests were added or run.
- [x] Implement TODO-to-SPEC traceability and diagnostics
  - SPEC: `REWRITE-SPEC.md#R-18`, `REWRITE-SPEC.md#R-19`, `REWRITE-SPEC.md#R-29`
  - Description: Resolve every task's SPEC references, report missing/ambiguous targets, and never interpret checkbox state as implementation or verification evidence.
- [ ] Validate missing and ambiguous reference reporting
  - SPEC: `REWRITE-SPEC.md#R-18`, `REWRITE-SPEC.md#R-19`, `REWRITE-SPEC.md#R-29`
  - Description: Implementation is present; this remains open until behavior is independently reviewed. No tests are added or represented as passing by this ledger.
- [x] Select minimal related task context for a diff path
  - SPEC: `REWRITE-SPEC.md#R-09`, `REWRITE-SPEC.md#R-10`, `REWRITE-SPEC.md#R-41`
  - File: `src/planning/context.ts`
  - Description: Added `selectRelatedTaskContexts`: select tasks only through explicit file hints (including rename source paths), preserve all shared candidates, and include their resolved requirements and acceptance criteria in contextual packets.
- [x] Navigate the documentation graph for a selected task/requirement
  - SPEC: `REWRITE-SPEC.md#R-09`, `REWRITE-SPEC.md#R-10`, `REWRITE-SPEC.md#R-11`
  - File: `src/planning/context.ts`, `src/planning/workspace.ts`
  - Description: Added task-scoped documentation resolution from explicit file/SPEC locations. It selects the deepest matching component README (root README fallback only when no scoped README matches), preserves equally specific matches with diagnostics, bounds README text, and returns README facts separately from only the selected task's resolved SPEC requirements and acceptance criteria. Workspace exposes discovered README source text; the shared packet builder can include this context as separate current-README and desired-SPEC sections.

## Phase 3 — Git evidence and derived states

- [x] Implement Git status and comparison-base diff indexing
  - SPEC: `REWRITE-SPEC.md#R-33`, `REWRITE-SPEC.md#R-34`, `REWRITE-SPEC.md#R-37`, `REWRITE-SPEC.md#R-38`
  - File: `src/planning/workspace.ts`, `test/planning-workspace.test.ts`
  - Description: Read-only Git status and diff loader implemented, including staged, unstaged, deleted, renamed, and untracked paths. Untracked files receive real `git diff --no-index` hunks and raw diff text. `comparisonBase` now accepts a ref and resolves it to an immutable commit exposed as `git.base`; the resolved base participates in diff identity and verification evidence. Default remains `HEAD`. The Neovim adapter accepts `comparison_base`, displays the resolved SHA, and uses it for native diff buffers and stale-anchor checks. Workspace document and untracked-file reads now resolve symlinks and reject targets outside the selected worktree. 
- [ ] Validate staged, unstaged, renamed, deleted, and untracked diff behavior
  - SPEC: `REWRITE-SPEC.md#R-33`, `REWRITE-SPEC.md#R-34`, `REWRITE-SPEC.md#R-37`, `REWRITE-SPEC.md#R-38`
  - Description: Implementation is present; this remains open until behavior is independently reviewed. No tests are added or represented as passing by this ledger.
- [x] Parse unified diff paths and retain hunk source evidence
  - SPEC: `REWRITE-SPEC.md#R-03`, `REWRITE-SPEC.md#R-04`, `REWRITE-SPEC.md#R-31`, `REWRITE-SPEC.md#R-32`
  - File: `src/planning/markdown.ts`
  - Description: Parse changed paths, quoted Git paths, renames, hunk coordinates, and added/removed source lines. File-level associations remain conservative: shared hints are unresolved, documentation changes are classified separately, and unmatched paths remain unplanned.
- [x] Map individual diff hunks to TODO tasks and SPEC requirements where evidence permits
  - SPEC: `REWRITE-SPEC.md#R-03`, `REWRITE-SPEC.md#R-04`, `REWRITE-SPEC.md#R-31`, `REWRITE-SPEC.md#R-32`
  - File: `src/planning/markdown.ts`
  - Description: Added a per-hunk review index with hunk coordinates, candidate task/requirement IDs, and explicit reasons. File hints only produce unresolved candidates, never fulfilment attribution. Derived task and requirement projections now expose the candidate hunk records as `hunkReviews`, including exact old/new coordinates and explicit unresolved/unplanned/documentation reasons. The Neovim planning view now renders each hunk's unresolved/unplanned/documentation marker and candidate task/requirement counts. Hunk questions and line questions opened from a selected hunk use only that hunk's candidate tasks; ordinary file questions retain file-level candidates. Requirement context is joined by fully qualified SPEC path plus ID. Added exact added-line coordinates to each parsed hunk, so context lines cannot falsely attribute a documentation edit. TODO hunks are linked only when an added source line overlaps the exact parsed task block; SPEC hunks require overlap with an exact requirement/criterion line. Both editor views distinguish these documentary attributions. Source-code hunks remain unresolved from path hints alone because no deterministic, non-semantic source-code attribution contract is justified by the current TODO/SPEC format.
- [x] Implement evidence-derived task and requirement states
  - SPEC: `REWRITE-SPEC.md#R-26`, `REWRITE-SPEC.md#R-27`, `REWRITE-SPEC.md#R-28`, `REWRITE-SPEC.md#R-29`, `REWRITE-SPEC.md#R-30`
  - Description: Added AC-ID parsing and read-only task/requirement projections for planned/in-progress/implemented/verified/blocked/unmapped/unplanned. File-path hints now remain `in-progress` rather than overstating implementation; verified requires passing evidence linked to all applicable criteria (or directly to a task with no criteria) and the exact base/diff identity. Workspace and unit fixtures cover checkbox independence, partial path evidence, blockers, unmapped references, all-criteria verification, and stale/failed checks. Precise hunk-level implementation attribution remains necessary before `implemented` can be derived. 
- [ ] Validate state projections against the editor presentation
  - SPEC: `REWRITE-SPEC.md#R-26`, `REWRITE-SPEC.md#R-27`, `REWRITE-SPEC.md#R-28`, `REWRITE-SPEC.md#R-29`, `REWRITE-SPEC.md#R-30`
  - Description: Implementation is present; this remains open until behavior is independently reviewed. No tests are added or represented as passing by this ledger.
- [x] Implement derived-view invalidation and refresh
  - SPEC: `REWRITE-SPEC.md#R-38`, `REWRITE-SPEC.md#R-51`, `REWRITE-SPEC.md#R-52`
  - Description: The Neovim prototype now refreshes on in-repository BufWritePost/FileChangedShellPost and FocusGained, cancels superseded refresh jobs, and invalidates callbacks on close. Manual refresh remains available. Every contextual handoff still re-reads Git; refresh race and external Git validation remains separate.

- [ ] Validate refresh races and external Git changes
  - SPEC: `REWRITE-SPEC.md#R-38`, `REWRITE-SPEC.md#R-51`, `REWRITE-SPEC.md#R-52`
  - Description: Implementation is present; this remains open until behavior is independently reviewed. No tests are added or represented as passing by this ledger.

## Phase 4 — contextual agent questions
- [x] Implement stable file, hunk, and line-range anchors
  - SPEC: `REWRITE-SPEC.md#R-36`, `REWRITE-SPEC.md#R-39`, `REWRITE-SPEC.md#R-40`, `REWRITE-SPEC.md#R-45`
  - File: `src/planning/context.ts`, `src/planning/workspace.ts`, `1suo/neolit.nvim/lua/neolit/planning.lua`
  - Description: Added shared anchors with repository-relative paths, base/working-tree side, optional line/hunk ranges, base commit, SHA-256 diff identity, and optional blob identity. Added fail-closed stale checks and tests for base/diff/blob changes. The Neovim line-range handoff now consumes the shared builder; file/hunk handoff compares the refreshed Git diff against the captured raw diff. 
- [ ] Validate stale-anchor rejection across base, diff, and blob changes
  - SPEC: `REWRITE-SPEC.md#R-36`, `REWRITE-SPEC.md#R-39`, `REWRITE-SPEC.md#R-40`, `REWRITE-SPEC.md#R-45`
  - Description: Implementation is present; this remains open until behavior is independently reviewed. No tests are added or represented as passing by this ledger.
- [x] Implement compact contextual question packets
  - SPEC: `REWRITE-SPEC.md#R-41`, `REWRITE-SPEC.md#R-44`
  - File: `src/planning/context.ts`, `1suo/neolit.nvim/lua/neolit/planning.lua`
  - Description: Added a shared packet builder that validates the current base/diff identity, includes only selected diff text, and appends related TODO/SPEC context. The Neovim prototype now supports `<leader>nx` on a diff-buffer line or visual line range, includes exact selected lines plus file diff/base/diff identity, rejects unsaved working buffers, and refreshes on stale HEAD/diff. The Neovim prototype now calls the shared `buildDiffQuestionPacket` API; packets include exact line text, current diff, linked TODO/SPEC context, and explicit size limits. Core tests cover truncation and stale anchors; a headless Neovim smoke test covers line-range packets and stale-diff rejection. File, hunk, and line-range diff questions now all use the shared builder; file/hunk packets include selected diff text, exact coordinates, base and diff identity, linked TODO/SPEC context, and common size limits. Plugin fixtures now cover all three diff-selection levels plus stale-diff rejection. Core and plugin validation remains separate.
- [ ] Validate packet contents, size limits, and stale-context rejection
  - SPEC: `REWRITE-SPEC.md#R-41`, `REWRITE-SPEC.md#R-44`
  - Description: Implementation is present; this remains open until behavior is independently reviewed. No tests are added or represented as passing by this ledger.
- [x] Implement copyable contextual handoff to the existing agent
  - SPEC: `REWRITE-SPEC.md#R-05`, `REWRITE-SPEC.md#R-42`, `REWRITE-SPEC.md#R-43`, `REWRITE-SPEC.md#R-46`, `REWRITE-SPEC.md#R-50`
  - File: `1suo/neolit.nvim/lua/neolit/planning.lua`
  - Description: The Neovim flow builds a bounded contextual packet, copies it through the editor clipboard, and preserves native file/diff navigation. No Neolit-owned chat or session protocol is introduced.
- [ ] Add a supported existing-agent session handoff when a host API is available
  - SPEC: `REWRITE-SPEC.md#R-05`, `REWRITE-SPEC.md#R-42`, `REWRITE-SPEC.md#R-43`, `REWRITE-SPEC.md#R-48`, `REWRITE-SPEC.md#R-49`
  - Description: Integrate only a documented host API that can address the active agent session. Keep clipboard handoff as the fallback; do not invent a provider protocol or Neolit chat layer.

## Phase 5 — editor-native vertical slice and adapters

- [x] Implement the Neovim task-to-contextual-question vertical slice
  - SPEC: `REWRITE-SPEC.md#R-01`, `REWRITE-SPEC.md#R-03`, `REWRITE-SPEC.md#R-05`, `REWRITE-SPEC.md#R-06`, `REWRITE-SPEC.md#R-35`, `REWRITE-SPEC.md#R-54`, `REWRITE-SPEC.md#R-55`, `REWRITE-SPEC.md#R-56`, `REWRITE-SPEC.md#R-57`, `REWRITE-SPEC.md#R-58`, `REWRITE-SPEC.md#R-61`, `REWRITE-SPEC.md#R-62`, `REWRITE-SPEC.md#R-63`, `REWRITE-SPEC.md#R-64`, `REWRITE-SPEC.md#R-65`
  - File: `1suo/neolit.nvim` (separate repository, branch `rewrite/planning-workspace`)
  - Description: Initial `:NeolitPlan` companion view is implemented: linked tasks/requirements with derived states, explicit planned-file rows that open the file or its actual diff, planned-file question context, changed file/hunk navigation, diff-syntax buffers, exact line-range context, and clipboard handoff through the shared core. A headless smoke test covers the vertical slice but has not been run. It is intentionally separate from the legacy `:Neolit` controller; native explorer decorations/details UI remain future refinement.
- [ ] Validate the vertical slice in the supported Neovim host
  - SPEC: `REWRITE-SPEC.md#R-01`, `REWRITE-SPEC.md#R-03`, `REWRITE-SPEC.md#R-05`, `REWRITE-SPEC.md#R-06`, `REWRITE-SPEC.md#R-35`, `REWRITE-SPEC.md#R-54`, `REWRITE-SPEC.md#R-55`, `REWRITE-SPEC.md#R-56`, `REWRITE-SPEC.md#R-57`, `REWRITE-SPEC.md#R-58`, `REWRITE-SPEC.md#R-61`, `REWRITE-SPEC.md#R-62`, `REWRITE-SPEC.md#R-63`, `REWRITE-SPEC.md#R-64`, `REWRITE-SPEC.md#R-65`
  - Description: Implementation is present; this remains open until behavior is independently reviewed. No tests are added or represented as passing by this ledger.
- [x] Implement the shared VS Code adapter
  - SPEC: `REWRITE-SPEC.md#R-06`, `REWRITE-SPEC.md#R-54`, `REWRITE-SPEC.md#R-55`, `REWRITE-SPEC.md#R-56`, `REWRITE-SPEC.md#R-57`, `REWRITE-SPEC.md#R-58`, `REWRITE-SPEC.md#R-61`, `REWRITE-SPEC.md#R-62`, `REWRITE-SPEC.md#R-63`
  - File: `editors/vscode/`
  - Description: Implemented the shared-core Explorer TreeView for TODO tasks, linked SPEC requirements (including reverse navigation to every linked task), planned file rows and task rationale, per-task hunk reviews, and a separate Git-changes group for all hunks. Planned files receive a distinct `P` annotation; changed files receive `N`; tooltips distinguish both from Git status. Planned-file navigation opens the real file until it changes, then opens VS Code's native diff editor. Hunk navigation opens a native base-to-working diff and uses VS Code’s compare-editor navigation to reveal the selected change; the virtual base document is pinned to the resolved base SHA, handles added/untracked files with an empty base, and uses the previous path for renames. Hunk context uses the shared stale-checked packet builder and clipboard fallback. Refreshes on save, focus, and command. README and command contributions are included.
- [ ] Validate the VS Code adapter in an Extension Development Host
  - SPEC: `REWRITE-SPEC.md#R-54`, `REWRITE-SPEC.md#R-55`, `REWRITE-SPEC.md#R-56`, `REWRITE-SPEC.md#R-57`, `REWRITE-SPEC.md#R-58`, `REWRITE-SPEC.md#R-61`, `REWRITE-SPEC.md#R-62`, `REWRITE-SPEC.md#R-63`, `REWRITE-SPEC.md#R-65`
  - Description: Exercise activation, TreeView expansion, Explorer decorations alongside Git status, task/requirement/file/hunk navigation, native diff rendering for tracked/added/renamed files, stale context rejection, refresh behavior, and host packaging.
- [x] Keep trivial changes on the direct prompt → Git diff path
  - SPEC: `REWRITE-SPEC.md#R-07`, `REWRITE-SPEC.md#R-24`, `REWRITE-SPEC.md#R-25`
  - File: `editors/vscode/README.md`, `1suo/neolit.nvim/README.md`
  - Description: The new VS Code companion activates as an optional Explorer view and never intercepts agent prompts or requires planning documents. The Neovim planning workspace is an explicit `:NeolitPlan` command separate from the legacy `:Neolit` workflow; its README directs small changes to the existing agent and ordinary Git diff. Formalization remains optional rather than an automatic transition.

## Phase 6 — retire old architecture and validate migration

- [x] Replace planned-diff kernel and protocol with the documentation/Git core
  - SPEC: `REWRITE-SPEC.md#R-51`, `REWRITE-SPEC.md#R-52`, `REWRITE-SPEC.md#R-53`, `REWRITE-SPEC.md#R-59`, `REWRITE-SPEC.md#R-60`, `REWRITE-SPEC.md#R-70`
  - File: `src/augment/`, `src/augmentd/`, `src/tui/`, `src/bin/`, `src/index.ts`, `package.json`, `package-lock.json`
  - Description: Retired the candidate/refinement/patch kernel, JSON-RPC/MCP/socket server, standalone TUI and OpenCode runtime, CLI binaries, and their legacy package-root exports. The package root now re-exports only `neolit/planning`; runtime dependencies and CLI build steps were removed. Historical gap documents remain untouched and are explicitly labeled as history in the root README.
- [x] Publish the dedicated Git-native planning package entry point
  - SPEC: `REWRITE-SPEC.md#R-51`, `REWRITE-SPEC.md#R-54`
  - File: `package.json`, `src/planning/index.ts`, `src/planning/README.md`
  - Description: Added the `neolit/planning` export and a planning-only public barrel, included the planning package files in publication, and documented the host-neutral API. New adapters can consume the deterministic core without importing the legacy kernel/TUI surface.
- [x] Retire legacy package exports/CLI commands and complete the Neovim host-contract migration
  - SPEC: `REWRITE-SPEC.md#R-54`, `REWRITE-SPEC.md#R-55`, `REWRITE-SPEC.md#R-59`, `REWRITE-SPEC.md#R-73`
  - File: `src/index.ts`, `package.json`, `package-lock.json`, `1suo/neolit.nvim/lua/neolit/init.lua`, `1suo/neolit.nvim/lua/neolit/planning.lua`, `1suo/neolit.nvim/README.md`
  - Description: The package root now exposes only the planning API; legacy CLI binaries and runtime dependencies are removed. The Neovim plugin now opens the Git-native workspace from both `:Neolit` and `:NeolitPlan`, and its former JSON-RPC/TUI host, configuration, and tests are retired. The plugin keeps only the shared-core planning view, local config, and its planning fixture. Host execution/packaging validation remains open in the paired Phase 5 validation task.
- [x] Preserve repository documents and isolate legacy task handling
  - SPEC: `REWRITE-SPEC.md#R-71`, `REWRITE-SPEC.md#R-72`
  - File: `src/planning/workspace.ts`, `src/planning/README.md`, `1suo/neolit.nvim/lua/neolit/planning.lua`
  - Description: The Git-native workspace reads linked README/SPEC/TODO files and Git metadata only; it has no document-write, task-import, or legacy-session migration path. The Neovim planning view is a separate read-only command and does not load or mutate the legacy planned-diff task/session store. No legacy export is offered.
- [ ] Add end-to-end fixtures for the full acceptance workflow
  - SPEC: `REWRITE-SPEC.md#R-22`, `REWRITE-SPEC.md#R-23`, `REWRITE-SPEC.md#R-26`, `REWRITE-SPEC.md#R-27`, `REWRITE-SPEC.md#R-28`, `REWRITE-SPEC.md#R-32`, `REWRITE-SPEC.md#R-40`, `REWRITE-SPEC.md#R-45`, `REWRITE-SPEC.md#R-66`, `REWRITE-SPEC.md#R-67`, `REWRITE-SPEC.md#R-68`, `REWRITE-SPEC.md#R-69`
  - Description: Prove exact traceability, stale-anchor rejection, verification gating, worktree isolation, and preservation of unrelated staged/dirty files.
- [x] Reconcile root/component READMEs and retire superseded roadmap references
  - SPEC: `REWRITE-SPEC.md#R-08`, `REWRITE-SPEC.md#R-10`, `REWRITE-SPEC.md#R-11`, `REWRITE-SPEC.md#R-73`
  - File: `README.md`, `src/planning/README.md`, `editors/vscode/README.md`, `1suo/neolit.nvim/README.md`, `AGENTS.md`, `.agents/skills/neolit-doc-workflow/SKILL.md`
  - Description: Replaced the root and Neovim onboarding docs with the shipped Git-native workflow, retained current planning/VS Code component contracts, removed obsolete links to retired planned-diff roadmaps, and aligned repository/skill instructions with the new package and implementation-vs-validation ledger. Archived gap files remain unlinked and are not active contracts.

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
