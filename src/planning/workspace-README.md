# Planning workspace

Loads the linked README → SPEC/TODO documentation graph from a real repository and joins it to the current Git working tree. This is the first filesystem/Git adapter for the Git-native rewrite.

## API

`loadPlanningWorkspace(directory)` returns:

- linked README paths;
- parsed SPEC requirements and TODO tasks, with source ranges;
- reference diagnostics and resolved task-to-requirement links;
- current branch and HEAD;
- Git porcelain status entries, actual diff/hunks, untracked file paths, and conservative file-level task associations.

Discovery begins at the root `README.md`, follows relative Markdown links to other READMEs, and collects linked files named `SPEC.md`, `*-SPEC.md`, `TODO.md`, or `TODO-*.md`. It does not recursively crawl arbitrary directories or read unrelated documents.

The Git comparison is working tree plus index against `HEAD`. The raw diff is retained for native host diff display. Untracked files appear in changed-file navigation but have no synthetic diff hunks.

## Boundaries

This module is a Node host adapter, not part of the pure Markdown parser. It reads files and invokes read-only Git commands only. It does not stage, apply, commit, reset, or modify repository files. The editor host owns rendering and contextual-agent handoff.
