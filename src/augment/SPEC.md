# Augment planned-diff core — desired-state specification

Status: normative desired behavior for the planned-diff product. The current implementation may lag this specification; known gaps belong in `TODO-augment.md`.

## Purpose

Neolit turns one objective into an inspectable, filesystem-shaped planned diff tree. Models propose domain and refinement deltas; deterministic controller code validates, challenges, collapses, propagates, and tracks staleness. Hosts own models, repository access, UI, and patch application.

## Planned-tree invariants

1. A task has exactly one root and every node has one parent.
2. A node represents a real repository path, a hunk within one path, or an explicitly named virtual scope.
3. Candidate domains are materially distinct approaches for one node, bounded by the controller.
4. A domain must be challenged before controller collapse.
5. Collapse selects one possible candidate, records the witness, and eliminates sibling candidates as superseded, not as forgotten prose.
6. Refinement is legal only for a collapsed node.
7. Child nodes must stay inside the parent path scope and collectively describe the parent's planned work.
8. A planned patch belongs to one file/hunk node and one immutable basis revision.
9. Real repository change marks the smallest overlapping planned subtree stale.
10. A stale tree cannot be applied or represented as ready.
11. User prompts become typed constraints attached to a node or subtree; they are not conversation history.
12. Every omission of a rejected candidate or path must remain inspectable.

## Model operation contract

The runtime is a replaceable port. For each operation it receives a bounded context packet, temperature, and LOD, and returns one typed proposal:

- `generate-domain`: one bounded set of candidates.
- `challenge-domain`: acceptance, one missing candidate, or one missing touched path.
- `refine-node`: bounded children and obligations for a selected node.
- `draft-patch`: one patch for one file/hunk node.
- `repair-patch`: one replacement patch grounded in an exact failed check.

Invalid shape, illegal paths, duplicate identities, out-of-scope mutations, and previously rejected candidates are controller failures. A failed model call changes no task state.

## Host and protocol contract

`augmentd` exposes the pure core over host-neutral JSON-RPC. It stores tasks in memory in the current implementation and must eventually persist them atomically. Hosts implement model runtimes (OpenCode, Codex, direct providers, or deterministic tests) and repository apply/verify transactions.

## Acceptance

A release requires reducer tests for domain, challenge, collapse, refinement, rejection, staleness, and tree projection; kernel tests with deterministic model runtimes; protocol tests for every operation and stale-revision rejection; and documentation that does not claim persistence or apply support before they exist.
