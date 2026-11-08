# Gap to state-of-the-art

This document answers one question: what do Neolit's planned-diff kernel and
protocol lack to become state-of-the-art? It is an external comparison and
analysis snapshot, not a contract. Shipped behavior stays canonical in
[README.md](./README.md) and [`src/augment/README.md`](./src/augment/README.md),
desired behavior in [`src/augment/SPEC.md`](./src/augment/SPEC.md), and known
gaps in [`TODO-augment.md`](./TODO-augment.md); this file links to those
records instead of duplicating them.

## What is being judged

The judged subject is the kernel and protocol described canonically in
[README.md](./README.md): one objective becomes an inspectable,
filesystem-shaped planned-diff tree exposed over host-neutral JSON-RPC and
MCP agent tools.

## Baselines

State-of-the-art here means matching, at least:

- **Agent harness ecosystems** (OpenCode, Claude Code, Codex, and similar):
  broad runtime support, session reuse, and planning that outlives a single
  prompt exchange.
- **Spec-driven development kits** (for example GitHub Spec Kit): constitution
  and standards ingestion feeding an executable specification workflow.
- **Tool ecosystems** (MCP): one bounded operation per call with immediate
  typed diagnostics the caller can act on.
- **Verification loops**: apply gated by checks, tests, and CI, with rollback.

## Already at the frontier

Current code and tests ship, among others:

- First-class plan tree: stable ids, basis-bound patches, obligations, stale ranges (README.md).
- Controller authority; one reducer path for model and tool proposals (`src/augment/README.md`).
- Selection as a commitment with recorded witnesses; bounded domains, challenges, and call caps (`src/augment/README.md`).
- Restriction plains on candidates, children, and patch text; out-of-scope candidates become constraints (`src/augment/README.md`).
- Raw unified-diff drafts with trailing `Assumption:` lines (`src/augment/raw-diff.ts`).
- Exact per-call diagnostics, `task/restore` integrity, optimistic concurrency, serialized dispatch, socket transport (`src/augmentd/README.md`).
- Host-side preflighted atomic apply and pathspec commit (`src/tui/README.md`).

## What it lacks

Ordered by user-visible impact; the owning record tracks each gap.

1. **Durability.** Standalone JSON-RPC and MCP servers now atomically persist
   task snapshots and expose `task/list` / `plan_list`; the TUI separately
   persists task state, agent-session bindings, and bounded session output.
   Cross-machine synchronization and multi-process coordination over one
   shared store remain open ([TODO-augment.md](./TODO-augment.md)).
2. **Verification-gated apply.** The core now records `drafted` → `applied` →
   `verified`/`failed`; JSON-RPC and MCP expose host-injected transactional
   `patch/apply` and `patch/verify`, including filesystem rollback when apply
   or durable state recording fails. The built-in verifier checks whitespace
   and reverse-applies the full patch series in a disposable worktree.
   The built-in verifier checks whitespace and reversibility; arbitrary test
   suites and CI checks are not run automatically by the host.
3. **Repository awareness.** The standalone TUI now polls tracked and non-ignored
   untracked paths plus HEAD, and turns external edits, creates, deletes, and
   basis movement into `node/stale` operations. Changes queue behind active
   controller work; Neolit-owned apply operations re-baseline the watcher, while commits trigger basis staleness.
   A bounded path index now resolves common source imports and supplies
   scope-specific related-file hints to model calls.
4. **Granular multi-client sync.** Change notifications carry only the task
   id and revision, so multi-client tree views must refetch; finer-grained
   notifications remain open, and coordination stops at per-task
   serialization — no plan diff or merge across concurrent tasks.
5. **Host adapter breadth and efficiency.** CLI model runtimes ship for
   OpenCode, Claude, and Codex; Claude and Codex tool-session adapters now
   use their respective MCP configuration and session-resume paths. Live-host
   verification of those paths and the OpenCode warm tool-step transport
   remains open. Native OpenCode-plugin and non-CLI Codex runtime adapters
   are still absent; equivalent warm transports for Claude and Codex remain open.
6. **Telemetry and evaluation.** Nothing measures plan quality, retry rates,
   or apply success over time, so improvement claims cannot be evidenced —
   the repository's telemetry-before-optimization rule is unmet.
7. **Practice overlays.** No user or practice overlays and no
   documentation-derived constraints: spec-kit-style standards cannot
   constrain candidate domains yet.

## Maintenance

This file is an analysis snapshot. Closing an item above means updating the
owning SPEC or TODO record and the matching row here in the same change;
items already tracked stay tracked where they are.
