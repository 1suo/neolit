---
name: neolit-planned-diff-workflow
description: Use when changing Neolit's planned-diff kernel, JSON-RPC/MCP protocol, standalone TUI, agent integrations, or Neovim host. Enforces the repository's current contract and lifecycle.
---

# Neolit planned-diff workflow

Use this skill for implementation, maintenance, and review of the planned-diff
kernel and its host surfaces.

## Read the owning contract first

Read the root `README.md`, then the smallest relevant documents:

- `src/augment/README.md` and `src/augment/SPEC.md` for reducer invariants,
  node/candidate/diff lifecycle, scope, and basis semantics.
- `src/augmentd/README.md` for JSON-RPC, MCP, persistence, notifications,
  host callbacks, and error behavior.
- `src/tui/README.md` for the standalone controller, repository watcher,
  path index, overlays, agent sessions, and keymap.
- `TODO-augment.md` and `SOTA-GAPS.md` for remaining implementation work
  and explicitly non-contract comparison gaps.
- The Neovim plugin repository's root README and its Lua/host bridge when
  changing the Neovim surface.

README means shipped behavior; SPEC means normative behavior; TODO records
implementation gaps. Never make those documents agree by hiding a real gap.

## Preserve controller authority

- Models propose domains, refinements, and patches. Deterministic reducers
  validate scope, restrictions, lifecycle, revisions, and legal transitions.
- Every mutation carries the latest `expectedRevision`. On a stale-revision
  error, refetch task/node state before retrying; never replay a stale mutation.
- Candidate selection is a commitment. Preserve rejected/eliminated records
  and their reasons.
- A planned diff is bound to its task basis and owning node. Never apply a diff
  from an old basis or a stale node.
- Path restrictions are controller-enforced, not prompt suggestions.
- External worktree changes and HEAD movement flow through `node/stale`.
  Neolit-owned apply transactions must rebaseline the watcher; commits must
  not, because the new HEAD invalidates remaining drafts.

## Standard change workflow

1. Start one task from a concrete objective.
2. Curate the restriction plain before generating: mark protected paths and
   use allow mode only when the intended writable set is explicit.
3. Inspect the candidate domain and challenge omissions before selecting.
4. Refine only the selected branch to the required path/hunk level.
5. Read target files and existing related files before drafting.
6. Draft one file-scoped patch at a time. Inspect exact raw patch text and
   assumptions; repair only against a concrete diagnostic.
7. Apply selected diffs through `patch/apply` / `apply_patches`, which uses
   the host transaction and rolls back if application or durable state
   recording fails.
8. Run host verification through `patch/verify` / `verify_patches`.
   The built-in Git verifier checks whitespace and reversibility; it is not a
   substitute for project-specific tests or CI.
9. In the TUI/Neovim flow, commit is allowed only after applied paths are
   verified. Commit only the task's applied paths; never include unrelated
   staged or dirty files.

## Host boundaries

- Keep the kernel host-neutral. Filesystem reads, Git operations, model
  runtimes, and UI belong in host adapters.
- JSON-RPC and MCP must use the same server operations and reducers.
- Standalone daemon state uses the atomic task snapshot store. Use
  `task/list` / `plan_list` after reconnecting before resuming a task.
- TUI agent sessions bind to task ids. Reuse the persisted session binding;
  do not silently start a fresh agent thread for each step.
- OpenCode, Claude, Codex, and Neovim are host surfaces, not separate sources
  of plan truth. Agent tools mutate the same server task shown by the panel.

## Repository context

- Use the path-aware index as navigation context, not as permission to widen
  task scope.
- Load global/repository practice overlays and scoped `AGENTS.md` rules as
  typed constraints. Keep their source and scope intact.
- Do not paste entire repository documents into prompts when a concise,
  path-scoped constraint or related-file hint is sufficient.

## Change and handoff discipline

- Implement the full behavior, not just a TODO checkbox or a design note.
- Update the owning README when shipped behavior or a public seam changes;
  update SPEC only when the desired contract changes; update TODO when a gap
  is actually closed or newly discovered.
- Keep changes small and directly tied to the task. Do not add a provider SDK
  or host-specific abstraction when the shared runtime/MCP seam already
  satisfies the contract.
- Follow `AGENTS.md` for validation and commit rules. Report exactly what was
  inspected or run; never claim tests, builds, or live-host checks that were
  not performed.
