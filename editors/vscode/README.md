# Neolit VS Code adapter

This is a thin VS Code companion over the shared `neolit/planning` package. It reads linked README/SPEC/TODO documents and Git state through the core; it does not parse Markdown, derive task states, apply patches, or own an agent session.

## Development

From this directory:

```sh
npm install
npm run compile
```

Open the repository in VS Code and launch the extension from an Extension Development Host (F5). The **Neolit Plan** view appears in Explorer.

## Behavior

- Task rows show the shared derived state and open the source TODO task.
- Expanding a task shows its linked SPEC requirements and its candidate hunk reviews.
- Hunk rows distinguish unresolved candidates (`~`), documentation changes (`DOC`), and unplanned changes (`?`). These are review annotations, not proof of implementation.
- Opening a hunk navigates to the real changed file in the native editor.
- **Copy Hunk Context** uses the shared stale-checked context packet builder and copies the result for pasting into the user's existing agent session.
- Refresh runs on demand, after in-workspace saves, and when the window regains focus.

Git status remains owned by VS Code's native Git integration. Neolit does not register competing Git decorations or disguise planned paths as actual Git changes.
