# AGENTS.md

Entry point for AI coding agents.

---

## Core Principles

1. **Documentation-First**: Update docs (including README) in same commit as code 
2. **Minimal Changes**: Change only what's needed for the task if otherwise specified
3. **Follow Patterns**: Check existing code before adding new
4. **Complete Fully**: No half-done features or placeholders

---

## Working with Tasks

### Finding Context

Task location tells you context:
- Task in `src/module/TODO.org` → Read `src/module/CONTEXT.md`
- Module CONTEXT lists: Related Schemas, Modules, APIs, ADRs
- Follow only those references

Tags in task (`:bug:api:`) tell you which prompts to read:
- Read `prompts/BUG.md` for bug workflow
- Read `prompts/FEATURE.md` for feature workflow
- Check `.neolit/` links from module CONTEXT for domain specifics

### Task Status

Change status in TODO.org:
- `TODO` → `IN-PROGRESS`: Starting complex task
- `TODO`/`IN-PROGRESS` → `WAITING`: Done, needs review (most common)
- Any → `DONE`: Obviously complete

Add notes under task:
```org
*** Agent Notes
    [YYYY-MM-DD] Completed X. Changed: file.ext
```

Can add subtasks or checkboxes for tracking:
```org
*** Agent Subtasks
    - [ ] Step 1
    - [X] Step 2
```

Can't change status to DONE if unsure. Use WAITING for review.
Can't leave tasks IN-PROGRESS indefinitely. Use WAITING when done.
Can't add new tasks without approval. Can't remove existing tasks without approval.
If approved, add :ARCHIVE: tag when done, don't delete task.

---

## Key Constraints (MUST)

**[PROJECT_SPECIFIC: Filled by human during setup, not by AI]**

Example - Architectural constraints:
- MUST follow User/Post schema in .neolit/3-database/schemas.md
- MUST validate email uniqueness before User creation
- MUST use JWT auth per ADR-001
- MUST use repository pattern for data access

Example - Code-level constraints:
- MUST NOT mutate state directly
- MUST validate all API inputs
- MUST handle errors explicitly
- MUST use transactions for multi-entity changes

---

## Preferences (SHOULD)

**[PROJECT_SPECIFIC: Filled by human during setup]**

Example:
- SHOULD use async/await over callbacks
- SHOULD keep functions under 50 lines
- SHOULD prefer composition over inheritance

---

## Documentation Links

- System Architecture: `/.neolit/system.md` (start here)
- ADRs: `/.neolit/adr/`
- Strategic Plan: `/SYSTEM.org`

---

**When in doubt**: Ask for clarification, don't guess.
