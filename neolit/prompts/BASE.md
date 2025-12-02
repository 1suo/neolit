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

**Start here:** `neolit/system.md` (system structure entry point; "neolit" is AI-driven documentation standard, not actual project name)

### Finding Context

Task location → Context:
- Task in `src/module/TODO.org` → Read `src/module/CONTEXT.md`
- Module CONTEXT → Points to `neolit/` docs
- Follow references from there

Task tags → Prompts:
- `:bug:` → Read `prompts/BUG.md`
- `:feature:` → Read `prompts/FEATURE.md`
- etc.

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
- `PROGRESS` - Currently working
- `WAITING` - Done, needs human review
- `DONE` - Approved and closed

**Status transitions:**
- `TODO` → `PROGRESS`: Starting complex task
- `TODO` → `WAITING`: Simple task done, needs review
- `PROGRESS` → `WAITING`: Complex task done, needs review
- `WAITING` → `DONE`: Only after human approval

**Default:** Use `WAITING` for review. Don't assume `DONE`.

**Adding progress notes:**
```org
* PROGRESS [#A] Task description :tags:
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
- Modify `VISION.org`

**On task completion:**
- Add `CLOSED: <YYYY-MM-DD>` timestamp
- Move to `WAITING` for review
- Document what changed

---

## Core Rules (MUST)

- MUST read `neolit/system.md` first (system architecture)
- MUST follow existing data structures exactly
- MUST match existing naming conventions  
- MUST use established patterns
- MUST preserve existing APIs unless explicitly changing
- MUST update documentation when changing code
- MUST complete one task fully before next
- MUST strictly follow existing code logic when documenting, not guessing based on names or conventions

## General Guidelines (SHOULD)

- SHOULD reuse existing utilities/abstractions
- SHOULD write clear commit messages
- SHOULD add progress notes to complex tasks
- SHOULD ask when uncertain rather than guess
- SHOULD update related docs (CONTEXT.md, ADRs) as needed

---

## Documentation Structure

Entry point: `neolit/system.md`

From system.md, navigate to:
- Containers (e.g., `neolit/1-web-app/`, `.neolit/2-api-server/`)
- Components (e.g., `neolit/2-api-server/components/controllers.md`)
- Code (module `CONTEXT.md` files)
- ADRs (`neolit/adr/`)

**When in doubt:** Ask, don't guess.
