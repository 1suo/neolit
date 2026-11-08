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

1. **Durability.** Core daemon tasks and protocol sessions live in memory and do not
   survive daemon restarts. The standalone TUI separately persists its
   active task and per-task agent-session bindings across process restarts;
   that does not make the daemon's in-memory store durable
   ([TODO-augment.md](./TODO-augment.md)). Resumable planning across
   independent daemon instances and machines is still table stakes.
2. **Verification-gated apply.** Apply/verify lifecycle is absent from core
   state and there is no `patch/apply` over JSON-RPC with rollback; the TUI
   applies host-side via a preflighted atomic `git apply` (`src/tui/apply.ts`),
   and check or test outcomes never gate plan completion.
3. **Repository awareness.** The standalone TUI now polls tracked and non-ignored
   untracked paths plus HEAD, and turns external edits, creates, deletes, and
   basis movement into `node/stale` operations. Changes queue behind active
   controller work; Neolit-owned apply/commit operations re-baseline the watcher.
   Path-aware filesystem indexing to prioritize context remains open.
4. **Granular multi-client sync.** Change notifications carry only the task
   id and revision, so multi-client tree views must refetch; finer-grained
   notifications remain open, and coordination stops at per-task
   serialization — no plan diff or merge across concurrent tasks.
5. **Host adapter breadth and efficiency.** Model access ships as
   CLI backends (opencode, claude, codex) in the standalone TUI;
   native OpenCode-plugin and Codex runtimes and the Claude and Codex
   tool-session adapters remain open. OpenCode model calls and tool-session
   steps already use the kept-alive `PersistentAgentServer` warm transport,
   with CLI fallback; equivalent warm transports for the other backends
   remain open.
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
