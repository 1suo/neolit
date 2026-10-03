# neolit

Neolit is a **planned-diff augmentation kernel**. It turns an objective into an
inspectable, filesystem-shaped tree of candidate approaches, refinements,
planned hunks, obligations, constraints, and stale basis ranges. A host-neutral
JSON-RPC server exposes that state to editors and agent applications.

Neolit is not an agent harness. It has no OpenCode, LangGraph, provider, or
filesystem-mutation implementation. Hosts inject a model runtime and own
repository access, permissions, patch application, checks, and UI.

## Core idea

A project-wide generated change should remain anchored to real repository
topology. Neolit therefore models the plan itself as a **planned diff tree**:

```text
task: make retries bounded

repo/
└─ src/auth/                    planned subtree
   ├─ session.ts               planned hunks
   └─ retry-policy.ts          new file candidate
```

At each node, the controller can:

```text
form a bounded candidate domain
challenge the domain for omissions
collapse to one candidate
propagate consequences
refine into directory/file/hunk children
attach basis-bound patches
mark the smallest overlapping subtree stale
```

Selection is a commitment, not a UI abbreviation. Sibling candidates become
eliminated records with reasons, so rejected approaches cannot silently return.

## Public seam

```ts
import {
  createPlanTask,
  crystallizeNode,
  planTree,
  refineWithModel,
  selectCandidate,
  type ModelRuntime,
} from "neolit";

const task = createPlanTask({
  id: "task:1",
  objective: "make retries bounded",
  basisRevision: "commit:1",
});

const runtime: ModelRuntime = {
  async call(request) {
    // Route one bounded operation to OpenCode, Codex, a direct provider,
    // or a deterministic test runtime. Return JSON matching request.operation.
    return { value: hostCall(request) };
  },
};

const domain = await crystallizeNode(runtime, task, {
  taskId: task.id,
  nodeId: task.rootNodeId,
  temperature: "normal",
  lod: "file",
});

const collapsed = selectCandidate(domain, {
  taskId: domain.id,
  expectedRevision: domain.revision,
  nodeId: domain.rootNodeId,
  candidateId: domain.nodes[domain.rootNodeId]!.candidateIds[0]!,
});

const refined = await refineWithModel(runtime, collapsed, {
  taskId: collapsed.id,
  nodeId: collapsed.rootNodeId,
  temperature: "normal",
  lod: "hunk",
});

const view = planTree(refined);
```

Model operations are finite and typed:

```text
generate-domain
challenge-domain
refine-node
draft-patch
draft-patches
repair-patch
explain-project
route-message
```

The kernel builds a bounded context packet, parses output with Zod, validates
scope and lifecycle, and merges only legal deltas. Invalid model output leaves
task state unchanged. Draft and repair replies may be the raw unified diff
itself (assumptions as trailing `Assumption:` lines) instead of a JSON
envelope, and the same operations are exposed as MCP agent tools with
`augmentd` as the tool provider — see below and
[`src/augment/SPEC.md`](./src/augment/SPEC.md).

## `augmentd`

`src/augmentd/` implements newline-delimited JSON-RPC 2.0 over standard I/O:

```sh
npx augmentd <<'JSON'
{"jsonrpc":"2.0","id":1,"method":"initialize"}
{"jsonrpc":"2.0","id":2,"method":"task/start","params":{"objective":"make retries bounded","basisRevision":"commit:1"}}
JSON
```

The executable uses an unavailable model runtime by default so pure task/tree
operations work without provider credentials. A host that needs
`crystallize`/`refine` embeds `new AugmentServer({ runtime })` and injects
its own OpenCode, Codex, or direct-provider adapter.

Operations cover task and tree lifecycle (including `task/restore` and
`explain`), node selection and constraints, message routing
(`message/route`), staleness and refresh, the deterministic domain seams, and
patch attach/draft/repair/set; the canonical method list lives in
[`src/augmentd/README.md`](./src/augmentd/README.md).

Mutating requests carry `expectedRevision`; stale requests are rejected before
state changes, and mutating dispatch is serialized per task so concurrent
clients cannot lose updates. The `domain/propose`, `domain/challenge`,
`node/refine`, and `patch/attach` seams apply one typed proposal
deterministically — they back the MCP tool layer, where
`augmentd --mcp [--directory DIR] [--connect SOCK]` serves the planned-diff
operations as MCP agent tools (`plan_start`, `plan_status`, `read_diff`,
`propose_approaches`, `challenge_approaches`, `select_approach`,
`refine_plan`, `draft_file`, `repair_patch`): one small validated call per
operation, exact controller and git-apply diagnostics returned to the agent,
and deterministic per-operation call caps. With `--connect` the bridge
attaches to a served socket — for example the running TUI's — so tool calls
mutate the task the TUI renders. See
[`src/augmentd/README.md`](./src/augmentd/README.md).

## TUI

The standalone `augment` executable embeds `AugmentServer`, renders the full
repository tree with integrated plan state, and (when `opencode` is available)
routes bounded model operations through the OpenCode CLI:

```sh
npm run build
./dist/bin/augment setup                                     # pick agent + default/draft/challenge models, interactively

# browse without model calls
AUGMENT_TUI_NO_MODEL=1 ./dist/bin/augment.js
```

After a change task is entered, the TUI automatically generates approaches for
the root node; a single viable approach is adopted automatically, multiple
approaches ask for `1-7`, and lower nodes receive candidates only when
explicitly opened. `Enter` is the single message entry point: one bounded
`message/route` classification sends the message into the selected node's
develop flow, an explanation, or an offered set of interpretations. `D`
develops a selected path and its whole subtree —
expand, crystallize, refine, draft every undrafted file — stopping only where
an approach choice needs a human. Drafted patches touch the working tree only
on request: `A` preflights each selected patch with `git apply --check`
(uncommitted edits included) and applies them as one unit, and `C` commits
exactly the session-applied paths. While it runs, the TUI serves its embedded
server on a Unix socket, so an external agent (`augmentd --mcp --connect`)
drives the same task store and every tool-driven mutation renders in the panes
as it lands. When the backend can carry MCP tools into non-interactive runs,
the TUI keeps one tool-using agent session per task and its own operations
become short pointing prompts against that socket; `AUGMENT_TUI_NO_TOOLS=1`
falls back to one-shot prompts. The full keymap, layout, and interaction
conventions are canonical in [`src/tui/README.md`](./src/tui/README.md).

## Documentation

- [`src/augment/README.md`](./src/augment/README.md) — current planned-diff
  core architecture and invariants.
- [`src/augment/SPEC.md`](./src/augment/SPEC.md) — desired planned-diff behavior.
- [`src/augmentd/README.md`](./src/augmentd/README.md) — current protocol and
  server responsibilities.
- [`src/tui/README.md`](./src/tui/README.md) — standalone TUI layout,
  operations, and OpenCode CLI runtime.
- `TODO-augment.md` — known gaps between shipped behavior and
  `src/augment/SPEC.md`.
- `SOTA-GAPS.md` — external gap analysis: what the tool and protocol lack
  to reach the state of the art.

The former LangGraph/OpenCode solution graph lives in the sibling
[`opencode-langgraph`](https://github.com/1suo/opencode-langgraph) repository.

## Development

```sh
npm run check   # TypeScript + Vitest
npm run build   # emit dist/
```

## Validation

```sh
npx vitest run test/augment-state.test.ts
npx vitest run test/augment-kernel.test.ts
npx vitest run test/augment-server.test.ts
npx vitest run test/augment-mcp.test.ts
npx vitest run test/augment-socket.test.ts
npx vitest run test/augment-tui.test.ts
```
