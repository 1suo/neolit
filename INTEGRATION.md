# Integration Guide

## Setup

```bash
./integrate.sh /path/to/project
cd /path/to/project
```

This creates:
- `neolit/prompts/` - Agent instructions
- `.neolitrc` - Config

## Analyze Project

Give AI:

```
Use neolit/prompts/ANALYZE_PROJECT.md to document this codebase.
```

AI will:
1. Analyze structure, patterns
2. Determine if single or multi-deployable
3. Create NEOLIT.md files at appropriate levels:
   - Root: SYSTEM level (architecture, workflows)
   - Containers: CONTAINER level (only for multi-deployable: api/, worker/, frontend/)
   - Components: COMPONENT level (detailed architecture + implementation)
4. Preserve existing project structure

## Review

1. Check root `NEOLIT.md` (SYSTEM level)
2. Check container `NEOLIT.md` files (CONTAINER level - if multi-deployable)
3. Check component `NEOLIT.md` files (COMPONENT level)
4. Verify **Level:** markers correct
5. Verify required sections present
6. Refine as needed

## Workflow

### Task Structure

```org
* TODO Fix user login timeout      :bug:api:
```

**Single deployable:**
AI reads (in order):
1. `neolit/prompts/BASE.md` (always)
2. `neolit/prompts/BUG.md` (from :bug:)
3. `NEOLIT.md` (root, SYSTEM level)
4. `src/auth/NEOLIT.md` (COMPONENT level - exact structures)

**Multi-deployable:**
AI reads (in order):
1. `neolit/prompts/BASE.md` (always)
2. `neolit/prompts/BUG.md` (from :bug:)
3. `NEOLIT.md` (root, SYSTEM level)
4. `api/NEOLIT.md` (CONTAINER level)
5. `api/auth/NEOLIT.md` (COMPONENT level - exact structures)

### Status Management

- `TODO` - Work on now
- `PROGRESS` - Currently working
- `WAITING` - Done, needs human review
- `DONE` - Approved and closed

**Agents:** Work on TODO, update to WAITING (not DONE)

### Example (Single Deployable)

```
You: "Work on src/auth/TODO.org first task"

AI:
1. Reads neolit/prompts/BASE.md
2. Sees :feature: tag → reads FEATURE.md
3. Phase 0: Verifies NEOLIT.md exists
   - Checks root NEOLIT.md (SYSTEM)
   - Checks src/auth/NEOLIT.md (COMPONENT)
4. Phase 1: Reads NEOLIT.md files
   - Extracts exact data structures
   - Notes constraints (MUST/MUST NOT)
5. Implements following exact structures
6. Updates src/auth/NEOLIT.md (COMPONENT level)
7. Updates TODO → WAITING
8. Adds agent notes
```

### Example (Multi-Deployable)

```
You: "Work on api/auth/TODO.org first task"

AI:
1. Reads neolit/prompts/BASE.md
2. Sees :feature: tag → reads FEATURE.md
3. Phase 0: Verifies NEOLIT.md exists
   - Checks root NEOLIT.md (SYSTEM)
   - Checks api/NEOLIT.md (CONTAINER)
   - Checks api/auth/NEOLIT.md (COMPONENT)
4. Phase 1: Reads NEOLIT.md files
   - System overview
   - Container deployment info
   - Component exact structures
5. Implements following exact structures
6. Updates api/auth/NEOLIT.md (COMPONENT level)
7. Updates TODO → WAITING
8. Adds agent notes
```

---

**System adapts to your structure. NEOLIT.md scales naturally.**
