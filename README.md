# neolit

A pure **solution graph**: a bounded CSP + CEGAR + AND/OR LOD solver that
drives LLM activations through LangGraph to solve repository tasks by
progressively forming, challenging, selecting, decomposing, implementing, and
verifying solution regions.

`neolit` contains no agent-harness code. It ships the kernel, prompts, schemas,
lifecycle, checkpointing, and post-run invariant checks — and asks its host for
exactly one thing: an async `AgentRuntime.call()`.

- Architecture of the seam and a harness onboarding checklist: [ARCHITECTURE.md](./ARCHITECTURE.md)
- Conceptual design (CSP/WFC/CEGAR/LOD): [SOLUTION-GRAPH-CORE-IDEAS.md](./SOLUTION-GRAPH-CORE-IDEAS.md)

## Install

```sh
npm install neolit
```

## Minimal embedding

```ts
import { MemorySaver } from "@langchain/langgraph";
import { solutionLodGraph } from "neolit";

const configured = solutionLodGraph({
  agents: { inspect: "inspector", synthesize: "synthesizer", refine: "refiner", implement: "builder", verify: "verifier", present: "presenter" },
  checkpointer: new MemorySaver(),
});

const result = await configured.graph.invoke(
  configured.initial({ task: "Add a shout() export with tests", directory: process.cwd(), worktree: process.cwd(), runId: "run-1" }),
  { recursionLimit: 512, configurable: { thread_id: "run-1", langgraphOpenCodeRuntime: myRuntime } },
);
console.log(configured.result?.(result));
```

`myRuntime` implements `call(input: AgentCall): Promise<AgentCallResult>` — see
[ARCHITECTURE.md](./ARCHITECTURE.md) for the full contract, session strategies,
budget stops, and the error protocol.

The reference host is [`opencode-langgraph`](https://github.com/1suo/opencode-langgraph),
an OpenCode plugin that wraps this package with child sessions, permissions,
a TUI, and run storage.

## Development

```sh
npm run check   # tsc --noEmit + vitest
npm run build   # emit dist/
```
