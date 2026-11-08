# Neolit — Git-native simplification rewrite

Status: normative product specification for Git-native Neolit. The former planned-diff product has been retired. Current shipped behavior is described by the root and component READMEs; remaining implementation and validation gaps are tracked in `TODO-rewrite.md`.

## 1. Product definition

Neolit is a thin, editor-native layer for planning, understanding, and reviewing changes made by coding agents. It connects three things that otherwise remain scattered:

- project documentation describing the existing system (`README.md` graph);
- the desired outcome and actionable work (`SPEC.md` and `TODO.md`);
- the actual implementation (`git diff`).

Neolit makes the relationship between intention and implementation inspectable. It is not an agent harness, code editor, patch generator, workflow engine, or alternative source-control system.

**Core rule:** Git is the source of truth for code changes; ordinary Markdown files are the source of truth for intent and task notes; Neolit derives the view connecting them. Neolit must not maintain a second authoritative implementation plan or patch state.

## 2. Goals and non-goals

### 2.1 Goals

1. Make a non-trivial agent change understandable before implementation, reviewable during implementation, and auditable afterward. **R-01**
2. Reuse the repository's existing README/SPEC/TODO documentation conventions and Markdown files. **R-02**
3. Render planned work beside the real repository tree and actual Git changes. **R-03**
4. Trace TODO tasks to precise SPEC requirements and actual changed files/hunks. **R-04**
5. Let a user ask an existing coding agent about a selected file, diff, hunk, or line without introducing a Neolit-owned chat/session protocol. **R-05**
6. Keep editor integrations thin and native to each host. **R-06**
7. Keep a fast path for small changes that do not need a formal plan. **R-07**

### 2.2 Non-goals

- Generating, storing, applying, repairing, or committing planned patches.
- Maintaining a parallel virtual filesystem or candidate/approach tree.
- Replacing Git, the editor's diff UI, the coding agent's conversation, permissions, or execution runtime.
- Requiring MCP, ACP, LangGraph, a Neolit daemon, or a provider-specific adapter for the initial workflow.
- Defining a new task DSL, JSON plan format, database schema, or Neolit-only Markdown syntax.
- Treating model-reported completion, a checked TODO box, or a changed file as proof that a requirement is satisfied.
- Requiring a plan for every prompt.

## 3. Canonical information sources

These sources have distinct ownership. Do not duplicate one source's authority in another.

| Source | Meaning | Who updates it |
|---|---|---|
| README graph | What the current system actually does; architecture and component contracts | Agent after implementation, based on verified behavior |
| SPEC | What the desired system must do; requirements, constraints, acceptance criteria | Agent before implementation; user approves/changes intent |
| TODO | Concrete work needed to move current behavior toward a SPEC | Agent; user may edit |
| Git status/diff | What source files actually changed | Git |
| Test/check output | What was actually verified | Test runner/CI; Neolit may display captured results |

**R-08** Neolit reads planning documents in place and does not rewrite them as a side effect of browsing or refresh. The Neovim tree may explicitly delete the selected TODO task, SPEC requirement, or acceptance criterion source range. It must reject stale or modified source buffers and leave unrelated content untouched; Git history is the recovery mechanism.

**R-09** The root README remains the system-level description. Component READMEs own local architecture and behavior. Follow their links only as far as needed for the selected task.

**R-10** A README describes shipped behavior, not aspirations. A SPEC describes desired behavior, not implementation progress. A TODO records the delta, not a second copy of the SPEC.

**R-11** After implementation, update the smallest relevant README(s) to match verified behavior. Do not mark a README claim true merely because an agent edited a file.

**R-12** Preserve repository-specific filenames and conventions. Neolit may discover conventional names such as `README.md`, `SPEC.md`, and `TODO.md`, plus explicitly linked variants such as the current `src/augment/SPEC.md` and `TODO-augment.md`. It must not assume every repository uses one global fixed path.

## 4. Markdown conventions and traceability

### 4.1 SPEC structure

A SPEC is ordinary Markdown. Recommended sections are:

- Objective
- Requirements
- Constraints
- Acceptance criteria
- References (optional)

Requirements must be individually addressable. Use stable, human-readable requirement labels such as `R-01`, `R-02`, etc. Put the label on the requirement line; do not rely on line numbers as permanent identifiers.

Example:

```md
## Requirements

- **R-01** The client refreshes an expired session without losing the request.
- **R-02** Invalid credentials are rejected with a typed error.

## Acceptance criteria

- **AC-01** An expired session is refreshed and the original request is retried once.
- **AC-02** Invalid credentials produce the documented error response.
```

**R-13** A SPEC requirement ID is stable within that document. Renumbering or deleting requirements is an intentional document edit; Neolit must not silently rewrite references.

**R-14** Neolit must expose a requirement's document path, heading path, ID, and current text. It may additionally expose a current line range for navigation, but line numbers are not identity.

### 4.2 TODO structure

A TODO is ordinary Markdown task-list syntax. Each actionable task must reference one or more concrete SPEC requirement IDs. Tasks may also reference acceptance criteria.

Example:

```md
# Authentication implementation

## Tasks

- [ ] Implement session refresh
  - SPEC: `src/auth/SPEC.md#R-01`
  - File: `src/auth/session.ts`
  - Description: Refresh an expired session and retry the original request once.

- [ ] Reject invalid credentials
  - SPEC: `src/auth/SPEC.md#R-02`
  - File: `src/api/client.ts`
  - Description: Convert the provider response into the documented typed error.

- [ ] Add regression coverage
  - SPEC: `src/auth/SPEC.md#R-01, R-02`
  - File: `test/auth.test.ts`
  - Description: Cover refresh success, refresh failure, and invalid credentials.
```

**R-15** Every implementation task must reference at least one SPEC requirement ID. A task may reference multiple requirements; a requirement may be covered by multiple tasks.

**R-16** File references are optional when the task is investigative, architectural, cross-cutting, or the target is not yet known. Do not invent file paths to make a task look concrete.

**R-17** Task descriptions explain the action and its purpose. Nested Markdown is allowed; no custom task schema or required metadata block is introduced.

**R-18** Neolit must detect missing or unresolved SPEC references and show them as documentation errors. It must not silently attach a task to a guessed requirement.

**R-19** A TODO checkbox is an agent/user-maintained note only. It is not evidence that code exists, that a requirement is fulfilled, or that tests passed.

### 4.3 Stable task identity

**R-20** A task is identified by its owning TODO document plus its Markdown structure (heading path and task text). A parser may derive an internal key for caching, but must not require persistent IDs to be authored into Markdown.

**R-21** If a task is moved or edited, Neolit should attempt a conservative match using document location, requirement references, and task text. Ambiguous matches must be shown as unmatched; never silently transfer completion or discussion state to a different task.

## 5. Workflow

### 5.1 Non-trivial change

1. User describes the outcome.
2. Agent reads the root README and follows relevant README links; it inspects the relevant code.
3. Agent creates or updates the appropriate SPEC with requirements and acceptance criteria.
4. Agent derives or updates TODO tasks, each linked to SPEC requirement IDs.
5. Neolit parses the documents and presents the proposed work in the repository tree. User reviews the plan before source edits begin.
6. After approval, the agent implements using its normal tools and working-tree/Git workflow.
7. Neolit watches Git and refreshes the actual diff view. It maps changed files/hunks to TODO tasks and SPEC requirements where evidence permits.
8. Agent may add TODO tasks when implementation reveals new necessary work. Unplanned changed files remain visible and are not automatically treated as defects.
9. Agent runs relevant tests/checks and reports results.
10. Agent updates affected README files to describe verified current behavior, reconciles TODO, and reports incomplete requirements, deviations, and failed checks.

**R-22** Planning is a reviewable proposal, not a locked contract. The agent may discover necessary work and update SPEC/TODO after approval; material changes to desired behavior or constraints require user review.

**R-23** Neolit must not apply agent-generated patches. The coding agent and its host retain normal edit, permission, and execution behavior.

### 5.2 Trivial change

**R-24** A user may send a prompt directly to the existing coding agent and review the ordinary Git diff. Neolit must not force SPEC/TODO creation for a small, obvious change.

**R-25** Neolit may offer to formalize a task when scope grows, multiple files/components are involved, or requirements/acceptance criteria are unclear. This is a suggestion, not an automatic workflow transition.

## 6. Derived task and requirement states

Neolit has no independent writable task lifecycle. It derives presentation states from Markdown, Git, and verification evidence.

### 6.1 Task states

- **planned** — TODO task exists and no linked implementation evidence has been observed.
- **in-progress** — at least one relevant changed file/hunk is associated with the task, but coverage is incomplete or uncertain.
- **implemented** — the task's linked work appears in the current diff or committed change, but no successful verification evidence is associated with it.
- **verified** — the task is implemented and its linked acceptance criteria have explicit successful verification evidence.
- **blocked** — an explicit blocker is recorded in the task's Markdown description or a verification result explains why work cannot proceed.
- **unmapped** — task references are invalid, or Neolit cannot determine relevant implementation evidence.

**R-26** These are derived UI states, not new TODO checkbox values or fields. Existing `[ ]` and `[x]` remain ordinary Markdown completion marks and are displayed separately.

**R-27** Neolit must not infer `verified` from a checked checkbox, a model statement, a file modification timestamp, or the mere existence of a diff.

**R-28** Verification evidence must identify the command/check and its observed result. A successful test run may support multiple tasks only when the relationship is explicit or conservatively established; otherwise show it as workspace-level evidence.

**R-29** If a task has multiple SPEC references, Neolit must show coverage per requirement and must not report the whole task verified while any required linked acceptance criterion remains unverified.

### 6.2 Requirement states

- **unplanned** — requirement has no TODO task linked to it.
- **planned** — at least one linked TODO task exists, with no implementation evidence.
- **in-progress** — linked work has partial or uncertain diff evidence.
- **implemented** — linked implementation appears in Git, verification is absent or incomplete.
- **verified** — all linked acceptance criteria have explicit passing evidence.
- **blocked** — an explicit blocker prevents completion.
- **unmapped** — references or evidence cannot be resolved reliably.

**R-30** Requirement state is an aggregation of linked task states and verification evidence. It is a view, not persisted canonical data.

### 6.3 Diff-to-plan relationship

For every changed path, Neolit should present one of:

- **planned** — associated with one or more TODO tasks;
- **partially mapped** — only some hunks or changes can be associated;
- **unplanned change** — changed path has no known task association;
- **documentation change** — README/SPEC/TODO change, shown distinctly;
- **unresolved** — association is ambiguous.

**R-31** A path association does not imply every hunk in that file fulfills the task. Hunk-level association is preferred when it can be established; otherwise show file-level association and label the granularity.

**R-32** Unplanned changes must remain visible and reviewable. Neolit must not hide, discard, or automatically classify them as mistakes.

**R-33** Deletions, renames, untracked files, staged changes, unstaged changes, and committed changes in the selected comparison range must be represented using Git's actual status/diff data.

## 7. Git and diff behavior

**R-34** Git is authoritative for changed paths, rename detection, staged/unstaged state, diff hunks, and comparison base. Neolit must not synthesize a competing patch representation.

**R-35** The primary diff experience must use the host editor's native diff facilities wherever possible. Neolit supplies navigation, associations, and contextual metadata; it does not replace syntax highlighting, LSP, folding, or diff rendering.

**R-36** Neolit must support selecting a changed file and navigating to its exact diff. Where the host supports it, selecting a hunk or line must preserve that granularity.

**R-37** A comparison base must be explicit and visible (for example, working tree against HEAD, branch against merge-base, or a user-selected commit). Neolit must not silently change the base during a review.

**R-38** Repository state changes must invalidate derived Git views. A file watcher may improve responsiveness, but Git status/diff remains the authority and must be re-read before consequential actions.

## 8. Literal copying and source navigation

Neolit is a planning and review surface, not a prompt composer or agent chat interface. The user works with their existing agent independently.

**R-39** Neolit must provide direct copy actions for selected task text, requirement text, acceptance-criterion text, repository-relative source paths, and source path plus line.

**R-40** A selected changed file must support copying its actual diff. A selected hunk must support copying that exact hunk in Git patch order, including context lines when present.

**R-41** Copy actions must preserve the selected source text or Git diff literally. They must not generate questions, instructions, summaries, wrappers, or artificial context packets.

**R-42** Copying must not open a question dialog, send a message, or require an agent/session connection. Clipboard access is the only side effect; repository files, index, and history remain untouched.

**R-43** The implementation must not create a Neolit-owned chat UI, message store, session manager, model router, provider abstraction, or agent protocol.

**R-44** Native source and diff navigation remains available independently of copying. Selecting a task or requirement opens its Markdown source; selecting a changed file or hunk opens the corresponding native diff.

**R-45** A hunk copy must use the hunk selected in the current Git diff view. It must never silently substitute another hunk or copy a generated approximation when the exact patch text is available.

## 9. Agent integration

**R-46** The MVP is a companion model: the user works with their existing coding agent; the agent reads and edits ordinary repository files; Neolit observes Markdown and Git and renders the result.

**R-47** Repository instructions in `AGENTS.md` define the documentation-first workflow. A reusable Agent Skill may provide detailed templates and procedures, but Neolit must work with ordinary agents that only read `AGENTS.md`.

**R-48** Do not build one integration per coding agent. Integrate at the editor/host boundary and reuse native agent sessions or documented host APIs when available.

**R-49** Do not require MCP for the core workflow. Do not implement ACP or another session protocol unless Neolit later takes ownership of the conversation experience and a concrete host integration requires it.

**R-50** Agent integration is outside the required workflow. Browsing documentation, Git status, diffs, task mappings, and literal text/path/diff copying must work without an agent connection.

## 10. Architecture

### 10.1 Shared local core

The shared core is a small TypeScript library responsible for:

- discovering and parsing linked README/SPEC/TODO documents;
- extracting requirement IDs, tasks, file references, and Markdown source ranges;
- resolving TODO-to-SPEC links;
- reading Git status, diff metadata, hunks, and comparison bases;
- deriving task/requirement/diff associations and presentation states;
- producing host-neutral view models and source-aware literal copy values;
- watching relevant filesystem/Git changes and invalidating derived views.

**R-51** The core must be deterministic and must not call an LLM. Parsing, link resolution, Git interpretation, state derivation, and context assembly are controller responsibilities.

**R-52** The core must not persist a second source of truth for plans, patches, task lifecycle, or agent conversation. Caches are allowed only when disposable and reconstructible from repository files and Git.

**R-53** Prefer direct Git commands/library behavior already used by the project. Do not introduce a long-lived daemon or database unless a measured host requirement makes it necessary.

### 10.2 Editor adapters

**R-54** Editor adapters consume the shared core and render through native host facilities. They must not reimplement Markdown parsing, Git semantics, or task-state derivation.

**R-55** The initial host targets are Neovim and VS Code. Neovim should use extmarks/signs, quickfix or picker navigation, native buffers, and floating/detail windows. VS Code should use TreeView/FileDecorationProvider and native diff/editor commands.

**R-56** The repository explorer remains a repository explorer. Plan information decorates existing files/folders; it must not become a second virtual filesystem.

**R-57** Keep descriptions and rationale in a details surface. Do not permanently expand long task descriptions inline in the file tree.

**R-58** The UI must clearly distinguish plan annotations from Git status. Planned creation/modification/deletion must never be mistaken for actual untracked/modified/deleted files.

### 10.3 TUI and daemon

**R-59** The current standalone TUI and `augmentd` are not architectural requirements of the target. Their useful behavior may be retained only if it supports the thin companion model without duplicating editor functionality or owning agent orchestration.

**R-60** Remove the planned-diff candidate/refinement/patch lifecycle and its model-operation machinery from the target product. Do not preserve it behind renamed abstractions.

## 11. User interaction model

The primary layout is:

- **Explorer:** normal repository tree, with compact plan/task/Git annotations.
- **Editor/diff:** native editor view of the selected file or actual Git diff.
- **Details:** selected task, SPEC requirement, file explanation, or hunk rationale.
- **Existing agent:** its own chat/session, outside Neolit's ownership.

**R-61** Selecting a TODO task highlights its known file paths and linked SPEC requirements. Selecting a requirement reveals its linked TODO tasks and current derived state.

**R-62** Selecting a planned file before it changes shows the task description and rationale. Once it changes, the same navigation opens the actual Git diff; no fake or generated diff is shown.

**R-63** Selecting an actual changed file/hunk shows the tasks and requirements it may satisfy, plus any mapping uncertainty.

**R-64** The user can invoke “Ask agent about this” from a selected file, hunk, or line. The action must include the exact anchor/context defined in Section 8 and use the existing agent conversation where possible.

**R-65** Keyboard navigation and host conventions take priority. Neolit must not replace the editor's standard file explorer, diff navigation, window management, or keymaps wholesale.

## 12. Security, safety, and workspace boundaries

**R-66** Neolit reads repository content and Git metadata; it does not execute repository scripts or agent commands as a side effect of opening the UI.

**R-67** Any action that sends context to an agent must make the target agent/session clear. Do not send source text to a different session or project because of stale session metadata.

**R-68** Respect Git worktree boundaries. Derive all paths relative to the selected repository/worktree and do not associate changes from sibling worktrees.

**R-69** Preserve unrelated user changes. Neolit must not stage, reset, checkout, apply, commit, or rewrite files or history.

## 13. Migration and compatibility

**R-70** Treat the rewrite as a deliberate product/architecture replacement, not an incremental rename of the current planned-diff model.

**R-71** Existing README/SPEC/TODO documents are user data and must be preserved. The new parser must tolerate ordinary Markdown and the current repository's linked/variant document paths.

**R-72** Existing planned-diff tasks and persisted sessions are not required to migrate into the new model. If an export is provided, it must be explicit, read-only, and must not rewrite source documents.

**R-73** Update package exports, commands, documentation, tests, and the `neolit.nvim` host together when public behavior changes. Do not leave the plugin bound to removed kernel/TUI contracts.

## 14. Acceptance criteria

The rewrite is acceptable when all of the following are demonstrated in an isolated Git fixture and the supported editor hosts:

1. A non-trivial prompt produces an ordinary SPEC and TODO; every TODO task resolves to a concrete SPEC requirement ID.
2. Invalid/missing requirement references are surfaced without guessing.
3. README graph navigation finds the relevant current-state documentation without scanning unrelated documents into every view.
4. TODO tasks and SPEC requirements appear as annotations on the real repository tree.
5. Before source edits, a user can review the plan; after edits, the same task view maps to actual Git changes.
6. A task can be planned without known file paths and can acquire paths as implementation discovers them.
7. Unplanned changed files and partially mapped hunks remain visible.
8. Task/requirement states are derived from Git and explicit verification evidence; checked TODO boxes alone never yield verified.
9. The user can select an exact diff file/hunk/line and ask the existing agent about it with an accurate, stale-checked context anchor.
10. No Neolit-owned chat, patch application, candidate tree, or duplicate plan database is required.
11. The trivial-change path works without creating SPEC/TODO files.
12. Neovim and VS Code adapters use their native explorer/editor/diff primitives and share the same core semantics.
13. Existing unrelated dirty/staged files are never modified by Neolit.
14. Root and component READMEs describe only shipped behavior; the TODO records remaining gaps against this specification.

## 15. Implementation order

Implementation is staged to prove the smallest useful end-to-end workflow before broad host polish:

1. Freeze the target contract and task/requirement Markdown conventions.
2. Build the deterministic Markdown/document graph parser and traceability checks.
3. Build Git status/diff/hunk indexing and derived state projection.
4. Prototype one vertical slice in Neovim: TODO selection → requirement detail → actual diff mapping → literal task/path/hunk copying.
5. Keep agent conversations outside Neolit; do not add prompt composition or session handoff.
6. Build the VS Code adapter over the same core.
7. Replace or retire the old TUI/daemon/kernel surfaces and update package/plugin contracts.
8. Add end-to-end fixtures and verify documentation synchronization.

No stage may reintroduce a parallel patch model or a Neolit-owned conversation system to make the demo easier.


## 16. Archive documents and implementation notes

**R-77** TODO task metadata distinguishes `Description:` (intent and expected outcome) from `Agent notes:` (implementation summary, rationale, deviations, and remaining caveats). Agent notes may span indented Markdown lines and are rendered with the task's related changes. They are explanatory statements, never verification evidence.

**R-78** The Neovim tree provides a one-key delete action (`d`) for a selected TODO task, SPEC requirement, or acceptance criterion. It deletes the complete parsed source range from its Markdown file, validates that the source range still identifies the selected entry, rejects modified source buffers and unsafe paths, and refreshes the workspace. No archive/restore workflow or key mapping is added to ordinary preview buffers.
