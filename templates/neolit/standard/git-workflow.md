# Git Workflow for TODO and NEOLIT Files

Keep TODO.org and NEOLIT.md in a local branch, main branch stays clean.

## Setup

```bash
# Create documentation branch
git checkout -b neolit-docs
neolit init

# Add to .gitignore on main:
NEOLIT.md
**/NEOLIT.md
TODO.org
**/TODO.org
neolit/
.neolitrc

# Commit docs
git add NEOLIT.md neolit/ .neolitrc src/*/NEOLIT.md src/*/TODO.org
git commit -m "docs: Add neolit structure"
```

## Daily Use

```bash
# Work on neolit-docs (has all context)
git checkout neolit-docs

# Code changes
git add src/
git commit -m "feat: Feature X"

# Doc changes
git add NEOLIT.md TODO.org
git commit -m "docs: Update docs"

# Merge code to main
git checkout main
git cherry-pick <feat-commit-hash>

# Keep in sync
git checkout neolit-docs
git rebase main
```

## Why?

- Main branch: Clean, production-ready code only
- neolit-docs: Full context for you and AI agents
- Cherry-pick: Move code commits to main, leave docs behind
