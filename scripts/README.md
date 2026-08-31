# Maintenance scripts

Scripts in this directory maintain deterministic repository artifacts. Recurring
operations must be exposed through `package.json` so contributors and CI use the
same command.

## Solution role graph

`render-solution-role-graph.ts` renders the Mermaid role topology from
`SOLUTION_ROLE_GRAPH` in `src/solution-lod/roles.ts` into the marked block in
`src/solution-lod/README.md`.

```sh
npm run graph:write  # update the generated block
npm run graph:check  # fail when the committed block is stale
```

The script does not define routing. The typed role contracts and reducer remain
authoritative; the diagram is their deterministic documentation projection.
