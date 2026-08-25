# neolit architecture: the graph/harness seam

`neolit` is the **pure graph**: a bounded CSP + CEGAR + AND/OR LOD solver that
orchestrates LLM activations through LangGraph. It contains no OpenCode code.
Hosts (opencode-langgraph today; pi, deepseek-based runners, or any Node agent
harness tomorrow) embed it and supply one async function plus their own UI.

## What a harness must provide

Exactly one runtime method:

```ts
import { solutionLodGraph } from "neolit";

const configured = solutionLodGraph({
  agents: { inspect: "...", synthesize: "...", refine: "...", implement: "...", verify: "...", present: "..." },
  checkpointer,                       // any BaseCheckpointSaver; DurableFileSaver ships here
});

const result = await configured.graph.invoke(
  configured.initial({ task, conversationContext, directory, worktree, runId }),
  { recursionLimit: 512,
    configurable: { thread_id: runId, langgraphOpenCodeRuntime: myRuntime } },
);
configured.result?.(result);   // final answer text
configured.progress?.(state);  // GraphProgressSnapshot for your UI
```

### `AgentRuntime.call(input: AgentCall): Promise<AgentCallResult>`

| AgentCall field | Meaning | Harness responsibility |
|---|---|---|
| `agent` | role-mapped agent name you supplied in `agents` | route to your agent/persona |
| `prompt` | fully compiled, role-native instruction | deliver verbatim as the task |
| `schema` | JSON Schema for the structured result | obtain a structured reply; on parse/validation failure, retry **in the same session** with the failed precondition and admissible correction |
| `validateStructured` | kernel-side semantic validator | call before accepting; treat a throw as invalid output |
| `limits` | maxTurns/maxTokens/maxCost budget stops | enforce; report via `budgetStop` |
| `session` | `fresh` / `continue sessionId` / `fork sessionId` | challenge runs demand fresh sessions; recovery demands continue/fork |
| `directory`, `worktree` | execution sandbox | run tools there; honor worktree isolation |

`AgentCallResult` returns `text`, optional `structured`, `usage`, `tools`
trace, `retryTrace`, `budgetStop`. Failures should throw
`OpenCodeRuntimeError(kind, message, details)` — despite the historical name it
is the **harness error protocol**: `kind` classifies startup/transport/
inactivity/schema/semantic failures and carries session/tool/progress evidence
so the kernel can retry, recover, or fork boundedly.

### Environment hooks (all optional)

Passed via `configurable`: `langgraphAcquireWorktree` (mutation lease),
`langgraphPrepareVerifierWorkspace` / `langgraphReleaseVerifierWorkspace`
(isolated verifier checkout), `langgraphSnapshotWorkspace`.

## Division of authority

Deterministic (this package): state machine legality, evidence authority,
constraint propagation to fixpoint, CEGAR gating, refinement contracts,
convergence limits, telemetry, checkpoint/resume semantics.

Model-side (your harness's agents): proposing facts/candidates/constraints,
decompositions, implementations, verdicts. Every proposal passes strict schema +
semantic validation before the kernel merges it.

## Post-run verification

`verify.ts` exports harness-agnostic invariant checks (`checkEvidenceDedup`,
`checkConvergence`, `checkSolverWorkflows`) over a final `SolutionNetwork`.
Drivers should assert them after real runs; they encode the regression classes
this graph was hardened against.

## Deliberate soft edges

`SOLUTION_ROLE_CONTRACTS` and the presenter prompts contain default agent/tool
bindings phrased for OpenCode. They are data, not dependencies: hosts override
models, tool policies, and prompts freely; the kernel never sees them.
