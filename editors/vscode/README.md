# Neolit VS Code adapter

This is a thin VS Code companion over the shared `neolit/planning` package. It reads linked README/SPEC/TODO documents and Git state through the core; it does not parse Markdown, derive task states, apply patches, or own an agent session.

## Development

Build the shared core first, then compile the extension:

```sh
# repository root
npm run build

# editors/vscode
npm install
npm run compile
```

Open the repository in VS Code and launch the extension from an Extension Development Host (F5). The **Neolit Plan** view appears in Explorer.

## Behavior

- Task rows show the shared derived state, expose the task description as a tooltip, and open the source TODO task.
- Explicit task file hints appear beneath the task and receive a `P` Explorer annotation when unchanged. Opening one shows the real file; after it changes, the same row opens the native base-to-working diff. Changed files use a distinct `N` review annotation.
- Requirement rows open the exact SPEC source location and expand to show every TODO task linked to that fully qualified SPEC path and requirement ID.
- Expanding a task shows its linked SPEC requirements and its candidate hunk reviews.
- A separate **Git changes** group shows every parsed hunk, including unplanned and documentation changes that have no task candidate.
- Hunk rows distinguish unresolved candidates (`~`), documentation changes (`DOC`), and unplanned changes (`?`). These are review annotations, not proof of implementation.
- **Open Native Hunk Diff** opens VS Code's native diff editor, comparing the selected file's content at the resolved Git base with the current working-tree file. Added/untracked files have an empty base side; renames compare against the previous path.
- **Copy Hunk Context** uses the shared stale-checked context packet builder and copies the result for pasting into the user's existing agent session.
- Refresh runs on demand, after in-workspace saves, and when the window regains focus.

Git status remains owned by VS Code's native Git integration. Neolit does not register competing Git decorations or disguise planned paths as actual Git changes.
