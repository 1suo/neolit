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
6. If the challenge budget is exhausted after concrete omissions, the controller records `challengeExhausted`. This is not acceptance and not proof of coverage; it explicitly permits human collapse from the bounded domain while preserving the exhaustion record.
6. Collapse selects one possible candidate, records the witness, and eliminates sibling candidates as superseded, not as forgotten prose.
6. Refinement is legal only for a collapsed node.
7. Child nodes must stay inside the parent path scope and collectively describe the parent's planned work.
8. Candidate domains are local to one node. Refinement may create descendant work nodes, but it must not generate descendant candidate domains implicitly; a descendant receives candidates only when that node is explicitly crystallized.
9. The filesystem tree projection must not display the touched paths of unchosen sibling candidates as though they were one plan. Before collapse, alternative paths remain alternative details; after collapse, only the selected candidate's paths project into the tree.
10. A host may project the plan onto the complete repository file tree. Repository-only paths are visibly unchanged; planned, drafted, new, deleted, stale, and locked paths carry distinct state marks.
11. A user may lock a repository file or directory for a task. Locked paths are controller authority: no candidate, refinement, or patch may modify a locked path or any descendant. Locks are task-local, inspectable, and reversible. Patch text is subject to the same authority as declared paths: a patch may touch only the file of its node (or, for a virtual node, paths the restriction plain allows).
12. A planned patch belongs to one file/hunk node and one immutable basis revision.
13. Real repository change marks the smallest overlapping planned subtree stale.
14. A stale tree cannot be applied or represented as ready. Staleness ends only through an explicit refresh that returns each stale node to its last live lifecycle point; a refresh may re-anchor the task to a new basis revision while every existing diff keeps the basis revision it was drafted against.
15. User prompts become typed constraints attached to a node or subtree; they are not conversation history.
16. Every omission of a rejected candidate or path must remain inspectable.

## Model operation contract

The runtime is a replaceable port. For each operation it receives a bounded context packet, temperature, and LOD, and returns one typed proposal:

- `generate-domain`: one bounded initial set of at most five candidates, each with a 0–100 confidence estimate. Two live-domain slots remain reserved for challenge counterexamples, keeping the total bound at seven.
- `challenge-domain`: acceptance, one missing candidate, or one missing touched path. At most two counterexample rounds run; exhausting that budget records bounded, unproven coverage rather than failing the task.
- `refine-node`: bounded children and obligations for a selected node.
- `draft-patch`: one patch for one file/hunk node.
- `draft-patches`: one batched proposal covering every undrafted file target under a node — all-or-nothing, so an incomplete or invalid batch leaves task state unchanged.
- `repair-patch`: one replacement patch grounded in an exact failed check.
- `explain-project`: one bounded set of repository path explanations for the requested topic.

Proposals arrive through two channels, and the controller treats them identically:

- **One typed reply per call.** The model answers the operation in one payload. A `draft-patch`/`repair-patch` reply may be the raw unified-diff text itself — a diff is self-delimiting (`--- a/x`, `+++ b/x`, `@@`), so a JSON string envelope only invites escape errors and mid-string truncation — with assumptions as trailing `Assumption:` lines the controller parses separately. The JSON envelope remains valid.
- **Typed tool proposals.** The operations are exposed as small agent tools (over MCP, with `augmentd` as the tool provider) so a model writes into the plan one call at a time: propose a domain, challenge it, select an approach, refine, draft one file's diff, repair one diff. Each call is validated and answered by the controller immediately — scope, locks, lifecycle, and host `git apply` diagnostics are returned to the agent so it retries that operation with the exact reason. Controller authority is unchanged: every call flows through the same reducers as every other mutation, and deterministic per-operation call caps bound agent loops. Tool drafting replaces the single-blob reply as the preferred draft path; one-shot raw-diff replies remain the fallback for runtimes without tool support.

A user message attached to a path is a scoped constraint. Regenerating that path reopens the owning node and its descendants, preserves the message on the owning node, and crystallizes only that node. Sibling subtrees remain intact. A message on a repository path without a node binds to the root with that path scope.

Every planned diff derives a deterministic presentation kind: `new`, `modify`, or `delete` when the unified diff identifies it; otherwise `unknown`. The kind never replaces the exact patch text. A dedicated exact-diff projection must remain available for every drafted path.

Invalid shape, illegal paths, duplicate identities, out-of-scope mutations, locked-path mutations, and previously rejected candidates are controller failures. A failed model call changes no task state.

## Host and protocol contract

`augmentd` exposes the pure core over host-neutral JSON-RPC. It stores tasks in memory in the current implementation and must eventually persist them atomically. Hosts implement model runtimes (OpenCode, Codex, direct providers, or deterministic tests) and repository apply/verify transactions. `augmentd` also serves the planned-diff operations as MCP agent tools; hosts inject repository diagnostics (a `git apply` preflight) so tool-driven drafts are answered with exact applicability failures.

## Acceptance

A release requires reducer tests for domain, challenge, collapse, refinement, rejection, staleness, and tree projection; kernel tests with deterministic model runtimes; protocol tests for every operation and stale-revision rejection; and documentation that does not claim persistence or apply support before they exist.
