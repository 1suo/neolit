# BASE.md

Entry point for AI coding agents.

---

## Start Here

**Read these files IN ORDER:**

1. **`neolit/standard/glossary.md`** - Understand terms (NEOLIT.md, TODO.org, C4 levels)
2. **`neolit/standard/levels.md`** - Understand when to use each level
3. **`neolit/standard/rules.md`** - **MANDATORY** rules 0-6 (READ FULLY)
4. **`neolit/standard/workflow.md`** - Phase 0-3 workflow (READ FULLY)

---

## Then Read Project Docs

1. **Root `NEOLIT.md`** (SYSTEM level) - System overview, workflows
2. **Container `NEOLIT.md`** (CONTAINER level, if exists) - Deployable unit context
3. **Component `NEOLIT.md`** (COMPONENT level) - Exact structures, constraints

**If any NEOLIT.md missing:** Use `ANALYZE_PROJECT.md` or `DOCUMENT_COMPONENT.md` to create.

---

## Task Management

**Status flow:** `TODO` → `PROGRESS` → `WAITING` → `DONE` (human only)

**Task tags → Prompts:**
- `:bug:` → `BUG.md`
- `:feature:` → `FEATURE.md`

**Agent notes format (add to TODO.org):**
```org
*** Agent Notes
    [2025-12-08] Task description
    Files changed: file1.js, file2.js
    Docs updated: NEOLIT.md (COMPONENT level)
    Notes: key decisions
```

---

## Quick Reference

**Templates:** `neolit/standard/templates/` (system, container, component, code)
**Validation:** `neolit/standard/validation.md`

**When uncertain:** Ask, don't guess.
