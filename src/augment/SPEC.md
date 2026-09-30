# Augment planned-diff core — desired-state specification

Status: normative desired behavior for the planned-diff product. The current implementation may lag this specification; known gaps belong in `TODO-augment.md`.

## Purpose

Neolit turns one objective into an inspectable, filesystem-shaped planned diff tree. Models propose domain and refinement deltas; deterministic controller code validates, challenges, collapses, propagates, and tracks staleness. Hosts own models, repository access, UI, and patch application.

A task has two modes: `change` and `explanation`. A change task uses candidate domains, refinement, and planned diffs. An explanation task attaches typed path explanations to repository files and directories without creating change candidates or patches. Explanations use the same repository-tree projection; selecting an explained path exposes what it is, what it does, and why it relates to the requested topic.

## Planned-tree invariants

1. A task has exactly one root and every node has one parent.
2. A node represents a real repository path, a hunk within one path, or an explicitly named virtual scope.
3. Candidate domains are materially distinct approaches for one node, bounded by the controller.
4. A domain must be challenged before controller collapse.
5. Every proposed candidate carries a 0–100 model confidence estimate. The estimate is presentation metadata only; it never eliminates or selects a candidate.
6. Collapse selects one possible candidate, records the witness, and eliminates sibling candidates as superseded, not as forgotten prose.
6. Refinement is legal only for a collapsed node.
7. Child nodes must stay inside the parent path scope and collectively describe the parent's planned work.
8. Candidate domains are local to one node. Refinement may create descendant work nodes, but it must not generate descendant candidate domains implicitly; a descendant receives candidates only when that node is explicitly crystallized.
9. The filesystem tree projection must not display the touched paths of unchosen sibling candidates as though they were one plan. Before collapse, alternative paths remain alternative details; after collapse, only the selected candidate's paths project into the tree.
10. A host may project the plan onto the complete repository file tree. Repository-only paths are visibly unchanged; planned, drafted, new, deleted, stale, and locked paths carry distinct state marks.
11. A user may lock a repository file or directory for a task. Locked paths are controller authority: no candidate, refinement, or patch may modify a locked path or any descendant. Locks are task-local, inspectable, and reversible.
8. A planned patch belongs to one file/hunk node and one immutable basis revision.
9. Real repository change marks the smallest overlapping planned subtree stale.
10. A stale tree cannot be applied or represented as ready.
11. User prompts become typed constraints attached to a node or subtree; they are not conversation history.
12. Every omission of a rejected candidate or path must remain inspectable.

## Model operation contract

The runtime is a replaceable port. For each operation it receives a bounded context packet, temperature, and LOD, and returns one typed proposal:

- `generate-domain`: one bounded initial set of at most five candidates, each with a 0–100 confidence estimate. Two live-domain slots remain reserved for challenge counterexamples, keeping the total bound at seven.
- `challenge-domain`: acceptance, one missing candidate, or one missing touched path. At most two counterexample rounds run.
- `refine-node`: bounded children and obligations for a selected node.
- `draft-patch`: one patch for one file/hunk node.
- `repair-patch`: one replacement patch grounded in an exact failed check.
- `explain-project`: one bounded set of repository path explanations for the requested topic.

A user message attached to a path is a scoped constraint. Regenerating that path reopens the owning node and its descendants, preserves the message on the owning node, and crystallizes only that node. Sibling subtrees remain intact. A message on a repository path without a node binds to the root with that path scope.

Every planned diff derives a deterministic presentation kind: `new`, `modify`, or `delete` when the unified diff identifies it; otherwise `unknown`. The kind never replaces the exact patch text. A dedicated exact-diff projection must remain available for every drafted path.

Invalid shape, illegal paths, duplicate identities, out-of-scope mutations, locked-path mutations, and previously rejected candidates are controller failures. A failed model call changes no task state.

## Host and protocol contract

`augmentd` exposes the pure core over host-neutral JSON-RPC. It stores tasks in memory in the current implementation and must eventually persist them atomically. Hosts implement model runtimes (OpenCode, Codex, direct providers, or deterministic tests) and repository apply/verify transactions.

## Acceptance

A release requires reducer tests for domain, challenge, collapse, refinement, rejection, staleness, and tree projection; kernel tests with deterministic model runtimes; protocol tests for every operation and stale-revision rejection; and documentation that does not claim persistence or apply support before they exist.
