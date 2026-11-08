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
- [x] Validate task remapping behavior and ambiguity handling
  - SPEC: `REWRITE-SPEC.md#R-20`, `REWRITE-SPEC.md#R-21`
  - Description: Manually reviewed `remapTaskIdentity`: unique structural keys are matched first, then unique task text and unique SPEC-reference signatures within the same TODO document; duplicate/competing groups remain explicitly ambiguous and are never resolved by line order. Source review only; no tests were added or run.
- [x] Add repository instruction and reusable workflow skill for the new contract
  - SPEC: `REWRITE-SPEC.md#R-02`, `REWRITE-SPEC.md#R-08`, `REWRITE-SPEC.md#R-09`, `REWRITE-SPEC.md#R-10`, `REWRITE-SPEC.md#R-11`, `REWRITE-SPEC.md#R-47`
  - File: `AGENTS.md`
  - Description: Replaced planned-diff-specific agent workflow with a concise README → SPEC → TODO → inspect → implement → verify → reconcile process. Added an optional reusable Skill with detailed context, task-template, testing, and commit procedures; AGENTS.md remains sufficient for agents that do not load Skills.

## Phase 2 — deterministic documentation core

- [x] Implement linked README/SPEC/TODO document discovery
  - SPEC: `REWRITE-SPEC.md#R-08`, `REWRITE-SPEC.md#R-09`, `REWRITE-SPEC.md#R-12`
  - File: `src/planning/workspace.ts`, `test/planning-workspace.test.ts`
  - Description: Implemented root-README graph traversal and linked SPEC/TODO discovery, including linked variants, full/collapsed/shortcut reference-style links, and local Markdown autolinks. Implementation is complete; repository-specific behavior remains an explicit validation item.
- [x] Validate discovery against repository link patterns
  - SPEC: `REWRITE-SPEC.md#R-08`, `REWRITE-SPEC.md#R-09`, `REWRITE-SPEC.md#R-12`
  - Description: Manually reviewed README graph traversal against the current repository's linked README/SPEC/TODO layout and the supported inline, angle-bracket, escaped-path, reference-style (full/collapsed/shortcut), and local-autolink forms. The loader resolves paths within the selected worktree and rejects symlink escapes. Source review only; no tests were added or run.
- [x] Implement SPEC/TODO parsing and source references
  - SPEC: `REWRITE-SPEC.md#R-13`, `REWRITE-SPEC.md#R-14`, `REWRITE-SPEC.md#R-15`, `REWRITE-SPEC.md#R-16`, `REWRITE-SPEC.md#R-17`
  - Description: Added `R-NN` requirements, `AC-NN` criteria with explicit requirement links, TODO task metadata, optional direct AC references, and source ranges. 
- [x] Validate parsing against repository-specific Markdown variants
  - SPEC: `REWRITE-SPEC.md#R-13`, `REWRITE-SPEC.md#R-14`, `REWRITE-SPEC.md#R-15`, `REWRITE-SPEC.md#R-16`, `REWRITE-SPEC.md#R-17`
  - Description: Manually reviewed task checkboxes, nested SPEC/File/Description metadata, multi-ID references, optional file hints, standalone/list-form requirement IDs, acceptance-criterion IDs, and unresolved-reference behavior against the current repository conventions. This is a source review only; no tests were added or run.
- [x] Implement TODO-to-SPEC traceability and diagnostics
  - SPEC: `REWRITE-SPEC.md#R-18`, `REWRITE-SPEC.md#R-19`, `REWRITE-SPEC.md#R-29`
  - Description: Resolve every task's SPEC references, report missing/ambiguous targets, and never interpret checkbox state as implementation or verification evidence.
- [x] Validate missing and ambiguous reference reporting
  - SPEC: `REWRITE-SPEC.md#R-18`, `REWRITE-SPEC.md#R-19`, `REWRITE-SPEC.md#R-29`
  - Description: Manually reviewed `resolvePlanningDocuments`: missing SPEC files, missing/duplicate requirement IDs, missing/duplicate acceptance-criterion IDs, and tasks without requirement references remain explicit diagnostics/unresolved references; no fallback guessing is used. Source review only; no tests were added or run.
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
- [x] Validate staged, unstaged, renamed, deleted, and untracked diff behavior
  - SPEC: `REWRITE-SPEC.md#R-33`, `REWRITE-SPEC.md#R-34`, `REWRITE-SPEC.md#R-37`, `REWRITE-SPEC.md#R-38`
  - Description: Manually reviewed porcelain `-z` status parsing, rename/copy path pairing, comparison-base resolution, tracked base-to-worktree diff parsing, and per-file `--no-index` diffs for untracked files. Binary/unparseable hunks remain visible as changed-file records. Source review only; no Git fixture or tests were run.
- [x] Parse unified diff paths and retain hunk source evidence
  - SPEC: `REWRITE-SPEC.md#R-03`, `REWRITE-SPEC.md#R-04`, `REWRITE-SPEC.md#R-31`, `REWRITE-SPEC.md#R-32`
  - File: `src/planning/markdown.ts`
  - Description: Parse changed paths, quoted Git paths, renames, hunk coordinates, and added/removed source lines. File-level associations remain conservative: shared hints are unresolved, documentation changes are classified separately, and unmatched paths remain unplanned.
- [x] Preserve source order of added and removed lines in parsed hunks
  - SPEC: `REWRITE-SPEC.md#R-34`, `REWRITE-SPEC.md#R-35`, `REWRITE-SPEC.md#R-36`
  - File: `src/planning/markdown.ts`, `1suo/neolit.nvim/lua/neolit/planning.lua`
  - Description: Each parsed hunk now retains its ordered added/removed line sequence alongside side-specific coordinates. The Neovim diff tree and hunk details render that sequence in the same order as Git's patch instead of grouping additions before removals.
  
- [x] Map individual diff hunks to TODO tasks and SPEC requirements where evidence permits
  - SPEC: `REWRITE-SPEC.md#R-03`, `REWRITE-SPEC.md#R-04`, `REWRITE-SPEC.md#R-31`, `REWRITE-SPEC.md#R-32`
  - File: `src/planning/markdown.ts`
  - Description: Added a per-hunk review index with hunk coordinates, candidate task/requirement IDs, and explicit reasons. File hints only produce unresolved candidates, never fulfilment attribution. Derived task and requirement projections now expose the candidate hunk records as `hunkReviews`, including exact old/new coordinates and explicit unresolved/unplanned/documentation reasons. The Neovim planning view now renders each hunk's unresolved/unplanned/documentation marker and exact candidate task/requirement references; VS Code shows candidate counts and exact details in hunk tooltips. Hunk questions and line questions opened from a selected hunk use only that hunk's candidate tasks and include exact candidate requirement references even when no task is linked; ordinary file questions retain file-level candidates. Requirement context is joined by fully qualified SPEC path plus ID. Added exact added- and removed-line coordinates to each parsed hunk, so line-level navigation and context anchors identify the correct base/working-tree side, and context lines cannot falsely attribute a documentation edit. TODO hunks are linked only when an added source line overlaps the exact parsed task block; SPEC hunks require overlap with an exact requirement/criterion line. Criteria without an explicit R-ID are joined to a task's sole requirement only when that task explicitly references the criterion; multi-requirement cases remain unresolved. Both editor views distinguish these documentary attributions. Source-code hunks remain unresolved from path hints alone because no deterministic, non-semantic source-code attribution contract is justified by the current TODO/SPEC format.
- [x] Implement evidence-derived task and requirement states
  - SPEC: `REWRITE-SPEC.md#R-26`, `REWRITE-SPEC.md#R-27`, `REWRITE-SPEC.md#R-28`, `REWRITE-SPEC.md#R-29`, `REWRITE-SPEC.md#R-30`
  - Description: Added AC-ID parsing and read-only task/requirement projections for planned, in-progress, verified, blocked, unmapped, and unplanned states. `implemented` remains reserved in the state model but is not emitted until precise source-code hunk attribution is justified. File-path hints remain `in-progress`; verified requires passing evidence linked to all applicable criteria (or directly to a task with no criteria) and the exact base/diff identity. Existing fixtures cover checkbox independence, partial path evidence, blockers, unmapped references, all-criteria verification, and stale/failed checks. 
- [x] Validate state projections against the editor presentation
  - SPEC: `REWRITE-SPEC.md#R-26`, `REWRITE-SPEC.md#R-27`, `REWRITE-SPEC.md#R-28`, `REWRITE-SPEC.md#R-29`, `REWRITE-SPEC.md#R-30`
  - Description: Manually reviewed checkbox-independent state derivation and its Neovim/VS Code presentation: file hints remain `in-progress`, blockers/unmapped states are preserved, verification is bound to base/diff identity and applicable criteria, and requirement states aggregate linked tasks. Source review only; neither editor host was launched.
- [x] Implement derived-view invalidation and refresh
  - SPEC: `REWRITE-SPEC.md#R-38`, `REWRITE-SPEC.md#R-51`, `REWRITE-SPEC.md#R-52`
  - Description: The Neovim prototype refreshes on in-repository BufWritePost/FileChangedShellPost and FocusGained, cancels superseded refresh jobs, and invalidates callbacks on close. The VS Code adapter refreshes on save/focus/manual commands and re-reads Git immediately before hunk navigation/context handoff. Manual refresh remains available. Runtime refresh-race and external Git validation remains separate.

- [x] Validate refresh races and external Git changes
  - SPEC: `REWRITE-SPEC.md#R-38`, `REWRITE-SPEC.md#R-51`, `REWRITE-SPEC.md#R-52`
  - Description: Manually reviewed the Neovim refresh generation token, superseded-job cancellation, close-time callback invalidation, focus/save refresh, and fresh Git/base reads before contextual handoff. The VS Code adapter also re-reads workspace Git identity before hunk navigation and context copy. Source review only; external-process race behavior was not exercised in either host.

## Phase 4 — contextual agent questions
- [x] Implement stable file, hunk, and line-range anchors
  - SPEC: `REWRITE-SPEC.md#R-36`, `REWRITE-SPEC.md#R-39`, `REWRITE-SPEC.md#R-40`, `REWRITE-SPEC.md#R-45`
  - File: `src/planning/context.ts`, `src/planning/workspace.ts`, `1suo/neolit.nvim/lua/neolit/planning.lua`
  - Description: Added shared anchors with repository-relative paths, base/working-tree side, optional line/hunk ranges, base commit, SHA-256 diff identity, and optional blob identity. Added fail-closed stale checks and tests for base/diff/blob changes. The Neovim line-range handoff now consumes the shared builder; file/hunk handoff compares the refreshed Git diff against the captured raw diff. 
- [x] Validate stale-anchor rejection across base, diff, and blob changes
  - SPEC: `REWRITE-SPEC.md#R-36`, `REWRITE-SPEC.md#R-39`, `REWRITE-SPEC.md#R-40`, `REWRITE-SPEC.md#R-45`
  - Description: Manually reviewed anchor creation and currentness checks: anchors retain repository-relative path, side, line/hunk range, base commit, SHA-256 diff identity, and optional blob identity; changed base/diff/blob values fail closed. Source review only; no tests were run.
- [x] Retire generated prompt copying from the Neovim workflow
  - SPEC: `REWRITE-SPEC.md#R-39`, `REWRITE-SPEC.md#R-41`, `REWRITE-SPEC.md#R-42`
  - File: `1suo/neolit.nvim/lua/neolit/planning.lua`
  - Description: Removed the question dialogs, generated context packets, and packet-building path from the Neovim adapter. Tree actions now copy selected task/requirement/criterion/description text, exact file diffs or selected hunk patch text, and repository-relative source paths with line numbers. No agent session or generated prompt is involved.
- [x] Review literal Neovim copy targets
  - SPEC: `REWRITE-SPEC.md#R-39`, `REWRITE-SPEC.md#R-40`, `REWRITE-SPEC.md#R-41`
  - Description: Source review confirms distinct copy targets for task/requirement/criterion text, file diffs, hunk patch text, and source paths/line numbers. No tests were run.
- [x] Remove the Neovim line-range question and packet action
  - SPEC: `REWRITE-SPEC.md#R-41`, `REWRITE-SPEC.md#R-42`, `REWRITE-SPEC.md#R-43`
  - File: `1suo/neolit.nvim/lua/neolit/planning.lua`
  - Description: Removed the obsolete line-range question callback and its generated packet builder invocation. Diff inspection remains native; literal text/path/diff/hunk copying is handled by the tree.

- [x] Render resolved TODO-to-SPEC relationships in the Neovim planning tree
  - SPEC: `REWRITE-SPEC.md#R-09`, `REWRITE-SPEC.md#R-10`, `REWRITE-SPEC.md#R-39`, `REWRITE-SPEC.md#R-44`
  - File: `1suo/neolit.nvim/lua/neolit/planning.lua`
  - Description: Expanding a TODO task shows its parsed description, resolved requirements, acceptance criteria and source references. Expanding a SPEC requirement shows linked TODO tasks, criterion coverage and associated hunk reviews. Cross-highlighting follows resolved task/requirement relationships.

- [x] Keep agent conversations outside the Neovim planning workflow
  - SPEC: `REWRITE-SPEC.md#R-42`, `REWRITE-SPEC.md#R-43`
  - File: `1suo/neolit.nvim/lua/neolit/planning.lua`
  - Description: The Neovim adapter has no question composer, generated prompt, message store, or agent-session integration. Copy and navigation actions operate directly on repository text and Git diffs.


## Phase 5 — editor-native vertical slice and adapters

- [x] Implement the Neovim parsed planning workspace
  - SPEC: `REWRITE-SPEC.md#R-01`, `REWRITE-SPEC.md#R-03`, `REWRITE-SPEC.md#R-06`, `REWRITE-SPEC.md#R-35`, `REWRITE-SPEC.md#R-54`, `REWRITE-SPEC.md#R-55`, `REWRITE-SPEC.md#R-56`, `REWRITE-SPEC.md#R-57`, `REWRITE-SPEC.md#R-58`, `REWRITE-SPEC.md#R-61`, `REWRITE-SPEC.md#R-62`, `REWRITE-SPEC.md#R-63`, `REWRITE-SPEC.md#R-64`, `REWRITE-SPEC.md#R-65`
  - File: `1suo/neolit.nvim`, branch `main`
  - Description: The default `:Neolit` workspace presents one compact repository tree. TODO and SPEC documents start collapsed; expanding them reveals parsed tasks, descriptions, resolved requirements, reverse task links, acceptance criteria, derived states, and hunk evidence. Changed files expand to task associations and per-hunk candidate reasons. Affected-only mode retains the relevant TODO/SPEC source documents. Native source/diff preview windows are reused; the former planned-diff controller and generated prompt workflow are removed.
- [x] Add compact expandable task and requirement details
  - SPEC: `REWRITE-SPEC.md#R-57`, `REWRITE-SPEC.md#R-61`, `REWRITE-SPEC.md#R-63`
  - File: `1suo/neolit.nvim/lua/neolit/planning.lua`
  - Description: Replaced the floating `K` details window with on-demand tree expansion. Task details expose descriptions, linked requirements, acceptance criteria, file hints, derived state explanations, changed paths and hunk-review reasons. Requirement details expose reverse-linked tasks, acceptance-criterion coverage and related hunks. Related rows cross-highlight; no details popup or K mapping remains.
  
- [x] Navigate and copy exact hunk evidence from task and requirement rows
  - SPEC: `REWRITE-SPEC.md#R-31`, `REWRITE-SPEC.md#R-32`, `REWRITE-SPEC.md#R-39`, `REWRITE-SPEC.md#R-40`, `REWRITE-SPEC.md#R-41`
  - File: `1suo/neolit.nvim/lua/neolit/planning.lua`
  - Description: Task- and requirement-linked hunk rows now resolve their zero-based hunk index to the exact parsed Git hunk for preview, Enter navigation, and literal copy. Candidate task and fully qualified SPEC references are shown alongside each hunk's attribution state and reason. Enter on a task opens its TODO source; `za` remains the explicit expansion action.

- [x] Distinguish file-hint candidates from confirmed hunk evidence in Neovim
  - SPEC: `REWRITE-SPEC.md#R-31`, `REWRITE-SPEC.md#R-32`, `REWRITE-SPEC.md#R-33`
  - File: `1suo/neolit.nvim/lua/neolit/planning.lua`, `1suo/neolit.nvim/README.md`
  - Description: Unique `File:` hints are displayed as candidates, not confirmed mappings. The tree uses `?` for no task hint, `~` for candidate/ambiguous hints, and `D` for planning-document changes; it no longer shows a misleading mapped checkmark for path-only evidence.

- [ ] Validate the vertical slice in the supported Neovim host
  - SPEC: `REWRITE-SPEC.md#R-01`, `REWRITE-SPEC.md#R-03`, `REWRITE-SPEC.md#R-05`, `REWRITE-SPEC.md#R-06`, `REWRITE-SPEC.md#R-35`, `REWRITE-SPEC.md#R-54`, `REWRITE-SPEC.md#R-55`, `REWRITE-SPEC.md#R-56`, `REWRITE-SPEC.md#R-57`, `REWRITE-SPEC.md#R-58`, `REWRITE-SPEC.md#R-61`, `REWRITE-SPEC.md#R-62`, `REWRITE-SPEC.md#R-63`, `REWRITE-SPEC.md#R-64`, `REWRITE-SPEC.md#R-65`
  - Description: Implementation is present; this remains open until behavior is independently reviewed. No tests are added or represented as passing by this ledger.
- [x] Implement the shared VS Code adapter
  - SPEC: `REWRITE-SPEC.md#R-06`, `REWRITE-SPEC.md#R-54`, `REWRITE-SPEC.md#R-55`, `REWRITE-SPEC.md#R-56`, `REWRITE-SPEC.md#R-57`, `REWRITE-SPEC.md#R-58`, `REWRITE-SPEC.md#R-61`, `REWRITE-SPEC.md#R-62`, `REWRITE-SPEC.md#R-63`
  - File: `editors/vscode/`
  - Description: Implemented the shared-core Explorer TreeView for TODO tasks, linked SPEC requirements (including reverse navigation to every linked task), planned file rows and task rationale, a Documentation diagnostics group with source navigation, per-task hunk reviews, and a separate Git-changes group for every changed file and its hunks, including binary/mode-only changes with no parsed hunks. Planned files receive a distinct `P` annotation; changed files receive `N`; tooltips distinguish both from Git status. Hunk rows show their own task/requirement candidate counts and exact details (in row text for Neovim and tooltips for VS Code); hunk context is restricted to that hunk's candidate tasks while also including standalone candidate requirements. Changed-file rows open native diffs even when the file has no parsed text hunks. Planned-file navigation opens the real file until it changes, then opens VS Code's native diff editor. Hunk navigation opens a native base-to-working diff and uses VS Code’s compare-editor navigation to reveal the selected change; the virtual base document is pinned to the resolved base SHA, handles added/untracked files with an empty base, and uses the previous path for renames. Hunk context selects the exact hunk through the shared stale-checked packet builder; hunk navigation and context handoff re-read Git before acting to reject stale external changes. README and command contributions are included. The extension's prepublish lifecycle compiles the bundle, and the shared core is a development-time dependency embedded by esbuild rather than a runtime package dependency. Virtual base-document URI paths are normalized correctly; planned-file navigation refreshes stale Git state and uses an empty working side for deleted files. Unsafe planned paths are excluded from Explorer decorations.
- [ ] Validate the VS Code adapter in an Extension Development Host
  - SPEC: `REWRITE-SPEC.md#R-54`, `REWRITE-SPEC.md#R-55`, `REWRITE-SPEC.md#R-56`, `REWRITE-SPEC.md#R-57`, `REWRITE-SPEC.md#R-58`, `REWRITE-SPEC.md#R-61`, `REWRITE-SPEC.md#R-62`, `REWRITE-SPEC.md#R-63`, `REWRITE-SPEC.md#R-65`
  - Description: Exercise activation, TreeView expansion, Explorer decorations alongside Git status, task/requirement/file/hunk navigation, native diff rendering for tracked/added/renamed files, stale context rejection, refresh behavior, and host packaging.
- [x] Keep trivial changes on the direct prompt → Git diff path
  - SPEC: `REWRITE-SPEC.md#R-07`, `REWRITE-SPEC.md#R-24`, `REWRITE-SPEC.md#R-25`
  - File: `editors/vscode/README.md`, `1suo/neolit.nvim/README.md`
  - Description: The VS Code companion activates as an optional Explorer view and never intercepts agent prompts or requires planning documents. Neovim exposes the same read-only workspace through `:Neolit` and the `:NeolitPlan` alias; its README directs small changes to the existing agent and ordinary Git diff. Formalization remains optional rather than an automatic transition.

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

- [x] Every TODO task resolves to one or more existing SPEC requirement IDs.
  - SPEC: `REWRITE-SPEC.md#R-13`, `REWRITE-SPEC.md#R-15`, `REWRITE-SPEC.md#R-18`
  - Description: Static audit of all 49 TODO checkbox tasks found at least one `REWRITE-SPEC.md` reference per task and no referenced IDs missing from the current SPEC. This was a document audit, not a test run.
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


## Phase 7 — planning archives and implementation explanations

- [x] Discover adjacent TODO/SPEC archive files and resolve archived requirement IDs
  - SPEC: `REWRITE-SPEC.md#R-74`, `REWRITE-SPEC.md#R-75`, `REWRITE-SPEC.md#R-78`
  - File: `src/planning/workspace.ts`, `src/planning/markdown.ts`
  - Description: Discover `.archive.md` siblings of linked TODO/SPEC documents. Archived SPEC entries resolve through their original document path while retaining the archive source path for navigation. Active and archived entries are merged for duplicate-ID detection; no document is moved or rewritten by the core.
- [x] Parse task agent notes separately from intent descriptions
  - SPEC: `REWRITE-SPEC.md#R-77`
  - File: `src/planning/markdown.ts`
  - Description: Added the `Agent notes:` nested field and multiline continuation handling, exposed separately as `agentNotes`; notes remain explanatory text and do not create verification evidence.
- [x] Render agent notes and navigate archived SPEC sources in Neovim
  - SPEC: `REWRITE-SPEC.md#R-75`, `REWRITE-SPEC.md#R-76`, `REWRITE-SPEC.md#R-77`
  - File: `1suo/neolit.nvim/lua/neolit/planning.lua`
  - Description: Expanded TODO tasks render agent notes as distinct detail rows. Requirement and criterion navigation uses the actual archive source path when the resolved entry lives in an archive document. Archive documents are included as separate planning-document rows and inherit the existing collapsed-by-default document behavior.
- [x] Document the archive and agent-note conventions
  - SPEC: `REWRITE-SPEC.md#R-74`, `REWRITE-SPEC.md#R-75`, `REWRITE-SPEC.md#R-76`, `REWRITE-SPEC.md#R-77`, `REWRITE-SPEC.md#R-78`
  - File: `README.md`, `src/planning/README.md`, `1suo/neolit.nvim/README.md`
  - Description: Documented archive sibling naming, reference preservation, explicit agent/user-owned moves, collapsed archive browsing, and the distinction between intent descriptions and implementation notes.
- [ ] Review archive discovery and rendering in the supported hosts
  - SPEC: `REWRITE-SPEC.md#R-74`, `REWRITE-SPEC.md#R-75`, `REWRITE-SPEC.md#R-76`, `REWRITE-SPEC.md#R-77`
  - Description: Inspect active and archive documents together, verify navigation into archived SPEC entries and multiline agent-note rendering, and check the VS Code presentation. No tests are added or run as part of this task.
