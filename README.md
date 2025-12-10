# Neolit

Neolit stands for New Literate Programming, a simple framework for AI-driven software development.

It's core ideas are close to spec-driven development, but differs in key ways.

Instead of mainaining spec as "want" document, neolit separates existing codebase documentation (created, maintaied and used for context by AI) from tasks to be done (implemented via TODO files with history of what's been done, reviews, notes etc).

Both live in codebase alongside code to ensure context is always available to AI agents in sufficient detail.


## Philosophy

### Documentation

1. **NEOLIT.md at every level** - Document existing code structure and constraints, linked with each other according to usage
2. **C4 levels determine content** - Clear structure for inner use
3. **Progressive detail** - System → Container (if applicable) → Component → Code. On each level there is one-link path to broader or narrower context
4. **Documentation-first** - Agents verify docs before coding and update after
5. **Mandatory rules** - Enforced patterns and constraints

### Tasks

1. **TODO.org at every level** - Tasks scoped to system/component level
2. **Traceable history** - Each task has full history of changes, reviews, notes
3. **Agent + Human collaboration** - Agents implement tasks, humans review and guide
4. **Clear states** - TODO tasks have clear states (TODO, IN-PROGRESS, WAITING, DONE)
5. **Contextual tasks** - Tasks scoped to relevant level (system/component) with links to related docs

## Structure

```
project/
├── neolit/prompts/          # Agent instructions
├── NEOLIT.md                 # System architecture (SYSTEM level)
├── TODO.org                  # System-level tasks
└── src/
    ├── auth/
    │   ├── NEOLIT.md         # Component docs (COMPONENT level)
    │   ├── TODO.org
    │   └── *.js
    └── user/
        └── NEOLIT.md         # Component docs (COMPONENT level)
```

## Workflow

```
Task: Implement feature X

Agent workflow:
1. Verify NEOLIT.md exists (root + component levels)
2. Read NEOLIT.md (SYSTEM) → system overview
3. Read NEOLIT.md (COMPONENT) → exact structures, constraints
4. Implement following exact structures
5. Update NEOLIT.md (COMPONENT level) with changes
6. Move task to WAITING for human review
```

## Installation

```bash
npm install -g neolit
```

## Quick Start

```bash
cd your-project
neolit init

# Have AI analyze and document your codebase
# Use prompt for coding agent: neolit/prompts/ANALYZE_PROJECT.md
```

## Integration

See [INTEGRATION.md](INTEGRATION.md)

## Commands

- `neolit init` - Initialize `neolit/prompts/`
- `neolit analyze` - Show prompt for AI to analyze project
- `neolit update` - Update prompts (preserves NEOLIT.md files)
- `neolit clean --force` - Remove all neolit files

## Git Workflow

See `neolit/standard/git-workflow.md` - You can keep TODO and NEOLIT files in a local branch while keeping main clean.

## Publishing (Maintainers)

```bash
npm version patch  # or minor/major
npm publish
git push --follow-tags
```
