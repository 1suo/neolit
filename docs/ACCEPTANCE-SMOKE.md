# Acceptance smoke guide

This is the manual acceptance path for the shared core, standalone TUI, and
Neovim host. It is a test procedure, not a claim that these checks have been
run. The implementation work does not write or execute test suites.

## 1. Build the shared package

From the neolit checkout:

```sh
npm run build
```

Point neolit.nvim at this checkout with `NEOLIT_DIR` or its `neolit_dir`
option. The Neovim host deliberately loads the same built controller/runtime
as the standalone TUI; do not test against a stale `dist/`.

## 2. Durable daemon task recovery

Create a task in a standalone daemon:

```sh
basis=$(git rev-parse HEAD)
printf '%s\n' "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"task/start\",\"params\":{\"taskId\":\"acceptance:durability\",\"objective\":\"acceptance smoke task\",\"basisRevision\":\"$basis\"}}" | augmentd --directory .
```

Stop the process, then list tasks in a new process:

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"task/list","params":{}}' | augmentd --directory .
```

Confirm `acceptance:durability` is present. Repeat with
`augmentd --mcp --directory .` and call `plan_list` from the MCP client.
For an explicit location, pass `--state-file /path/to/tasks.json`.

## 3. Repository watcher and path index

1. Open a task in the TUI or `:Neolit`.
2. Develop a file so it has a planned node and drafted patch.
3. Edit that file from another editor/process, then wait one watcher interval.
4. Confirm the affected plan node becomes stale; unrelated planned paths stay
   live when their paths do not overlap.
5. Move Git HEAD in another terminal and confirm remaining planned paths
   become stale.
6. On a source file, ask for a change that naturally touches an imported
   neighbor. Confirm the model's context includes related importers/imports
   without embedding their file bodies.

## 4. Overlay constraints

Create temporary policy files before starting a fresh task:

- `.neolit/overlay.md`: a repository-wide user constraint.
- `.neolit/practice.md`: a repository-wide practice constraint.
- `src/AGENTS.md`: a scoped instruction for paths under `src/`.

Start a new change task and inspect its constraints through `plan_status`
or the selected node details. Confirm the explicit overlays apply globally,
the nested instruction retains its `src/` scope, and the constraint source
is recorded as `user` or `repository`. Remove the temporary files after
the check.

## 5. Apply, verify, and commit gate

1. Draft a patch and press `A` (TUI), `a` (Neovim), or call MCP
   `apply_patches`.
2. Confirm the diff lifecycle becomes `applied` and the working tree changes.
3. Attempt commit before verification; the TUI must refuse it.
4. Select the applied file/folder and press `G` (TUI) or `g` (Neovim), or
   call MCP `verify_patches`.
5. Confirm the host records `verified`; commit is now allowed.
6. For a multi-file patch series, confirm verification reverse-applies the
   patches in reverse order in a disposable worktree and leaves the real
   working tree unchanged.

## 6. Agent tool sessions

For each installed backend, select it in the agent picker and run one
multi-step task:

- OpenCode: confirm the kept-alive v2 serve path carries the Neolit MCP
  connection; a transport-only failure may fall back to standalone CLI.
- Claude: confirm the generated `--mcp-config` and allowed-tool filter expose
  Neolit tools and the next step resumes the same session id.
- Codex: confirm the `mcp_servers.neolit` config overrides expose Neolit
  tools, `thread.started` supplies a session id, and the next step uses
  `codex exec resume`.

In each case, confirm tool calls mutate the same task shown by the panel,
then restart the TUI and confirm the repository-scoped session binding is
reused. This section requires the corresponding vendor CLI and account;
the implementation does not claim live-host verification in advance.
