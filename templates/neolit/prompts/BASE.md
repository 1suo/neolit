# BASE.md

MANDATORY GUIDELINES FOR AI AGENTS WORKING ON CODEBASE

---

## ⚠️ DOCUMENTATION-FIRST WORKFLOW (MANDATORY)

**BEFORE doing ANY task:**

1. **Verify documentation exists** → If missing, create it FIRST
2. **Read documentation** → Understand context fully
3. **Implement task** → Follow exact structures from docs
4. **Document changes** → Update docs in same commit

**Rule 0 in MANDATORY RULES section below enforces this.**

---

## Core Principles

1. **Documentation-First**: Update docs in same commit as code
2. **Minimal Changes**: Change only what's needed
3. **Follow Patterns**: Check existing code first
4. **Complete Fully**: No placeholders or half-done work

**Read documentation standard:** `neolit/docs/STANDARD.md` for complete glossary, principles, and rules.

---

## Working with Tasks

### Finding Context

Task location → Context:
- Task in `src/module/TODO.org` → Read `src/module/CODE.md`
- Module CODE.md → Points to `neolit/` docs for architecture/design
- Follow references from there

Task tags → Prompts:
- `:bug:` → Read `prompts/BUG.md`
- `:feature:` → Read `prompts/FEATURE.md`
- etc.

**Start here:** `neolit/system.md` (system structure entry point; "neolit" is AI-driven documentation standard, not actual project name)

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

**Files tracked:**
- `TODO.org` - Active tasks
- `TODO.org_archive` - Completed/cancelled tasks (moved from TODO.org)

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
    Updated: neolit/system.md
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
- Move to `WAITING` for review, add notes
- If DONE, add `CLOSED: <YYYY-MM-DD>` timestamp
- Document what changed

---

## MANDATORY RULES

**VIOLATION OF THESE RULES RESULTS IN IMMEDIATE REJECTION OF ALL CHANGES.**

### 1. Context Assembly (MANDATORY)
- **MUST** read `neolit/system.md` FIRST before any code changes
- **MUST** read task-specific `CODE.md` in module directory
- **MUST** identify ALL data structures involved in task from CODE.md
- **MUST** trace full data flow through system before implementation
- **MUST** verify understanding of task's place in system tree

### 2. Data Structure Integrity (MANDATORY)
- **MUST** follow existing data structures EXACTLY as documented
- **MUST** match field names, types, constraints PRECISELY
- **MUST NOT** modify data structures without explicit task requirement
- **MUST NOT** add/remove fields from existing structures
- **MUST** preserve all invariants documented in CODE.md

### 3. Pattern Adherence (MANDATORY)
- **MUST** match existing naming conventions CHARACTER-FOR-CHARACTER
- **MUST** use established patterns documented in architecture
- **MUST** preserve existing APIs unless task explicitly requires changes
- **MUST** follow workflows documented in `neolit/workflows.md`

### 4. Documentation Synchronization (MANDATORY)
- **MUST** update CODE.md when changing implementation details
- **MUST** update `neolit/` docs when changing architecture/design
- **MUST** include documentation updates in SAME commit as code
- **MUST** maintain accuracy between code and documentation

### 5. Task Completion (MANDATORY)
- **MUST** complete one task FULLY before starting next
- **MUST NOT** leave placeholders, TODOs, or incomplete implementations
- **MUST NOT** skip error handling or edge cases
- **MUST** move task to WAITING status (not DONE) after completion

### 6. Change Minimization (MANDATORY)
- **MUST** change ONLY what task requires
- **MUST NOT** refactor unrelated code
- **MUST NOT** fix unrelated issues or bugs
- **MUST** preserve all working functionality not mentioned in task

---

## Documentation Structure

**Two-level documentation:**

1. **Architecture & Design** (`neolit/` directory)
   - `system.md` - System overview, containers, high-level data flow
   - `workflows.md` - Cross-module workflows and processes
   - Container docs - Component architecture and design patterns
   - ADRs - Architectural decisions and rationale

2. **Code & Implementation** (`CODE.md` files in source)
   - Exact data structures with types and constraints
   - Function signatures and parameters
   - Implementation-specific details
   - Module-specific patterns and rules
   - Links to architecture docs for context

**Navigation:**
- Start: `neolit/system.md` (architecture overview)
- Then: Module `CODE.md` (implementation details)
- Reference: `neolit/workflows.md`, ADRs as needed

**When in doubt:** Ask, don't guess.
