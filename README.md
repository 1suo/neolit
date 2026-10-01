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
repair-patch
```

The kernel builds a bounded context packet, parses output with Zod, validates
scope and lifecycle, and merges only legal deltas. Invalid model output leaves
task state unchanged.

## `augmentd`

`src/augmentd/` implements newline-delimited JSON-RPC 2.0 over standard I/O:

```sh
npx augmentd <<'JSON'
{"jsonrpc":"2.0","id":1,"method":"initialize"}
{"jsonrpc":"2.0","id":2,"method":"task/start
task/restore","params":{"objective":"make retries bounded","basisRevision":"commit:1"}}
JSON
```

The executable uses an unavailable model runtime by default so pure task/tree
operations work without provider credentials. A host that needs
`crystallize`/`refine` embeds `new AugmentServer({ runtime })` and injects
its own OpenCode, Codex, or direct-provider adapter.

Operations include:

```text
initialize
task/start
task/get
tree/get
node/get
node/constrain
node/select
node/reject
node/reopen
node/stale
path/restrict
crystallize
refine
patch/draft
patch/repair
patch/set
diff/get
shutdown
```

Mutating requests carry `expectedRevision`; stale requests are rejected before
state changes.

## TUI

The standalone `augment` executable embeds `AugmentServer`, renders the full
repository tree with integrated plan state, and (when `opencode` is available)
routes bounded model operations through the OpenCode CLI:

```sh
npm run build
./dist/bin/augment.js --model opencode/space-bunny-free "make retries bounded"

# browse without model calls
AUGMENT_TUI_NO_MODEL=1 ./dist/bin/augment.js
```

After a change task is entered, the TUI automatically generates approaches for the root node; a single viable approach is adopted automatically, multiple approaches ask for `1-7`. Lower nodes receive candidates only when explicitly opened. Then:

```text
Enter  prompt for the selected path — text becomes a message that regenerates its subtree; empty submit rethinks it
1-7    choose numbered approach
D      develop selected path (expand into files; on a refined folder, draft its next undrafted file)
A      apply drafted patch to working tree
C      commit the session-applied paths only (never unrelated changes)
L      mark/unmark path in the restriction plain (lock polarity: marked = must not change)
W      mark/unmark path in the restriction plain (allow polarity: marked = the only thing that may change); pressing the other key inverts the plain
E      explain selected path (whole repository when no task is active)
N      new change task
Tab    switch pane
Q      quit
```

Directories aggregate descendant change state (`added`, `removed`, `changed`) and show a contents summary of their planned children with per-path change reasons (unchanged entries are omitted), aggregated change counts, and descendant patch previews. Files show their complete exact patch directly in the right pane; `j`/`k` scroll it while the detail pane is focused. While a model operation runs, its target animates in the tree and the preview leads with live status; failures mark the path with `×` until a retry succeeds.

The TUI can apply drafted patches to the working tree on request (`A`): every selected patch is preflighted with `git apply --check` and applied as one unit, so a conflict anywhere leaves the tree untouched. Nothing is staged or committed, and the repository tree refreshes after applying.
Its layout and interaction conventions are documented in
[`src/tui/README.md`](./src/tui/README.md).

## Documentation

- [`src/augment/README.md`](./src/augment/README.md) — current planned-diff
  core architecture and invariants.
- [`src/augment/SPEC.md`](./src/augment/SPEC.md) — desired planned-diff behavior.
- [`src/augmentd/README.md`](./src/augmentd/README.md) — current protocol and
  server responsibilities.
- [`src/tui/README.md`](./src/tui/README.md) — standalone TUI layout,
  operations, and OpenCode CLI runtime.
- `TODO-augment.md` — known gaps, including persistence, repository watching,
  apply/verify transactions, and host adapters.

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
npx vitest run test/augment-tui.test.ts
```
