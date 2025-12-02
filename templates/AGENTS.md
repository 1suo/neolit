# AGENTS.md

Entry point for AI coding agents.

---

## Core Principles

1. **Documentation-First**: Update docs in same commit as code
2. **Minimal Changes**: Change only what's needed
3. **Follow Patterns**: Check existing code first
4. **Complete Fully**: No placeholders or half-done work

---

## Working with Tasks

### Finding Context

Task location → Context:
- Task in `src/module/TODO.org` → Read `src/module/CONTEXT.md`
- Module CONTEXT → Points to `.neolit/` docs
- Follow references from there

Task tags → Prompts:
- `:bug:` → Read `prompts/BUG.md`
- `:feature:` → Read `prompts/FEATURE.md`
- etc.

**Start here:** `.neolit/system.md` (system structure entry point; "neolit" is AI-driven documentation standard, not actual project name)

### Managing Task Status

**Org-mode syntax:**
```org
* STATUS [#PRIORITY] Description :tags:
  <YYYY-MM-DD>
```

**Status meanings:**
- `TODO` - Ready to work on (active backlog)
- `INBOX` - Frozen/not ready yet
- `BACKLOG` - Maybe later/low priority
- `IN-PROGRESS` - Currently working
- `WAITING` - Done, needs human review
- `DONE` - Approved and closed

**Status transitions:**
- `TODO` → `IN-PROGRESS`: Starting complex task
- `TODO` → `WAITING`: Simple task done, needs review
- `IN-PROGRESS` → `WAITING`: Complex task done, needs review
- `WAITING` → `DONE`: Only after human approval

**Default:** Use `WAITING` for review. Don't assume `DONE`.

**Adding progress notes:**
```org
* IN-PROGRESS [#A] Task description :tags:
  <2025-12-02>
  
*** Agent Notes
    [2025-12-02] Implemented X
    Changed: src/file.js
    Updated: .neolit/system.md
    Question: Should we also handle Y?
```

**For tracking complex work:**
```org
*** Agent Subtasks
    - [X] Completed step
    - [ ] In progress step
    - [ ] Not started
```

**Can't:**
- Create new top-level tasks (only subtasks/checkboxes for tracking)
- Delete tasks
- Mark `DONE` without certainty (use `WAITING` instead)

**On task completion:**
- Add `CLOSED: <YYYY-MM-DD>` timestamp
- Move to `WAITING` for review
- Document what changed

---

## Key Constraints (MUST)

**[Fill during setup with project invariants]**

Example constraints (replace with actual):
- MUST follow schemas in `.neolit/3-database/schemas.md`
- MUST validate inputs per ADR-002
- MUST use patterns documented in module CONTEXT
- MUST update docs when changing APIs

---

## Preferences (SHOULD)

**[Fill during setup with project style]**

Example preferences (replace with actual):
- SHOULD keep functions under 50 lines
- SHOULD prefer async/await
- SHOULD write self-documenting code

---

## Documentation Structure

Entry point: `.neolit/system.md`

From system.md, navigate to:
- Containers (e.g., `.neolit/1-web-app/`, `.neolit/2-api-server/`)
- Components (e.g., `.neolit/2-api-server/components/controllers.md`)
- Code (module `CONTEXT.md` files)
- ADRs (`.neolit/adr/`)

**When in doubt:** Ask, don't guess.
