# AGENTS.md

**Purpose:** Master prompt for AI coding agents.

This file defines **HOW** agents work with this codebase. For **WHAT** the system does, see linked documentation.

---

## Quick Reference

- **Architecture:** → `/docs/architecture.md`
- **API Docs:** → `/docs/api.md`
- **Strategic Plan:** → `/SYSTEM.org`
- **Contributing:** → `/docs/contributing.md`

---

## Core Principles

### 1. Documentation-First Development

**Every code change MUST update relevant documentation in the SAME commit.**

**Documentation locations:**
- Schema changes → Update `/docs/architecture.md`
- API changes → Update `/docs/api.md`
- New patterns → Update relevant ADR in `/docs/adr/`
- Task completion → Mark status in relevant `TODO.org`

**Example commit:**
```
Add user authentication endpoint

- Created POST /api/auth/login endpoint
- Updated docs/api.md with endpoint spec
- Marked task DONE in src/auth/TODO.org
```

### 2. Minimal Changes Philosophy

- Change **only** what's needed for the task
- Don't refactor unrelated code
- Don't fix unrelated bugs unless explicitly asked
- Keep commits focused and atomic

### 3. Follow Existing Patterns

**Before adding new code:**
1. Check if similar implementation exists
2. Identify the pattern in existing code
3. Reuse existing utilities/components
4. Consult relevant ADRs in `/docs/adr/`

### 4. Complete Before Moving On

- Finish one task fully before starting next
- No half-done features
- No placeholder implementations
- No TODO comments without tracking in TODO.org

---

## Finding Context for Your Task

**Workflow:**
1. Read task in `TODO.org` - Check `:CONTEXT:` property for required reading
2. Read module `README.md` - Local patterns, data structures, constraints
3. Follow "Related" sections - Dependencies, schemas, APIs, other modules
4. Read only referenced sections in `docs/architecture.md` - Don't read entire doc
5. Read only referenced ADRs - Listed in task or module README

**Don't:**
- Read entire architecture.md (too much context)
- Guess which schemas are relevant
- Search for patterns - they're in module README

**Example:**
```
Task says: :CONTEXT: User schema, Auth module
→ Read src/auth/README.md (local context)
→ Check "Related Schemas" section for User
→ Check "Related Modules" section
→ Read only those sections
```

---

## Working with This Codebase

### Order of Operations

1. **Foundations** - Understand data schema and invariants (docs/architecture.md)
2. **Workflows** - Know user journeys and data flows
3. **Patterns** - Follow established architectural patterns
4. **Code** - Implement features serving workflows, respecting foundations

### Workflows First

**Code serves workflows.** Before writing code, understand:
1. User workflows (what users do)
2. Data flows (how data transforms)
3. Component interactions (who calls who)

See `docs/architecture.md` Workflows section.

**Code implements these workflows based on the architectural foundations (schema, decisions) documented below.**

### Architecture Patterns

**[PROJECT_SPECIFIC: Replace with your patterns]**

Example:
```
Service Layer: repository → service → API endpoint
Store Pattern: Readonly reactive stores
Component Pattern: Composition API with composables
```

### Code Organization

**Check first:** Is there existing code that does something similar?

**Structure:**
```
src/
  module/
    README.md       # Module documentation
    TODO.org        # Module tasks
    index.js        # Entry point
    [files]         # Implementation
```

### Key Constraints (MUST)

**[PROJECT_SPECIFIC: Replace with your constraints]**

**Architectural (from foundations):**
- MUST follow data schema in docs/architecture.md
- MUST respect entity invariants (see Domain Model section)
- MUST use [database] per ADR-XXX
- MUST use [auth method] per ADR-XXX

**Code-level:**
- MUST NOT mutate state directly from components
- MUST NOT skip the service layer
- MUST validate all user inputs
- MUST use string IDs, not ObjectIds (see ADR-001)

### Preferences (SHOULD)

**[PROJECT_SPECIFIC: Replace with your preferences]**

Example:
- SHOULD use TypeScript for new files
- SHOULD prefer composition over inheritance
- SHOULD use existing UI component library
- SHOULD follow naming conventions in docs/contributing.md

---

## Common Tasks

### Adding a New Feature

1. Read module's `README.md` and `TODO.org`
2. Select task from `TODO.org`
3. Explore corresponding architecture patterns in `/docs/architecture.md`
3. Check relevant ADRs in `/docs/adr/`
4. Identify similar existing implementations
5. Implement following existing patterns if possible,
6. If not, make new ADR. If in doubt, ask user for clarification
7. Update documentation
8. Update TODO.org status to WAITING or DONE
9. Commit with clear description

### Fixing Bugs

1. Reproduce the error
2. Identify root cause
3. Make minimal fix following existing patterns
4. Update documentation if behavior changed
5. Update TODO.org status
6. Commit with description of fix

### Code Review

Before completing work:
- Does it follow existing patterns?
- Are all TODOs tracked in TODO.org?
- Is documentation updated?
- Are tests passing?
- Is the commit message clear?

---

## Task Status Management

**In TODO.org files:**

- `TODO → IN-PROGRESS`: Starting work on complex task
- `TODO → WAITING`: Simple task done, needs human review
- `TODO → DONE`: Simple task obviously complete
- `IN-PROGRESS → WAITING`: Complex task done, needs review (most common)
- `IN-PROGRESS → DONE`: Complex task obviously complete

**Add notes under tasks:**
- Approach taken
- Links to relevant code/ADRs
- Questions for reviewers

---

## Anti-Patterns

**Don't:**
- Guess at requirements - ask for clarification
- Add features not in TODO.org
- Change code style of existing files
- Add dependencies without documenting why
- Skip error handling
- Commit secrets or sensitive data

---

## Debugging

**[PROJECT_SPECIFIC: Replace with your debugging approach]**

Example:
- Check server logs in terminal
- Check browser console for frontend errors
- Use curl to test API endpoints
- Check middleware logs for auth issues
- Look at similar working code for patterns

---

## When in Doubt

1. Read documentation first (`/docs/`)
2. Check existing similar code
3. Review relevant ADRs (`/docs/adr/`)
4. Ask user for clarification
5. Don't guess - wrong changes waste time

---

**Remember:** This file guides YOU (the AI). Actual architecture, schemas, and implementation details live in other documented files.
