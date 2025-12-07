# Integration Guide

## Setup

```bash
./integrate.sh /path/to/project
cd /path/to/project
```

This creates:
- `neolit/` - All scaffolding
- `.neolitrc` - Config

## Analyze Project

Give AI:

```
Use neolit/prompts/ANALYZE_PROJECT.md to document this codebase.
```

AI will:
1. Analyze structure, patterns, workflows
2. Create neolit/docs/system.md (required)
3. Create architecture docs in neolit/docs/
4. Create CODE.md files in source directories with exact implementation details
5. Preserve existing project structure

## Review

1. Check neolit/docs/system.md
2. Review other docs created
3. Refine as needed

## Workflow

### Task Structure

```org
* TODO Fix user login timeout      :bug:api:
```

AI reads (in order):
1. neolit/prompts/BASE.md (always)
2. neolit/prompts/BUG.md (from :bug:)
3. src/api/CODE.md (exact implementation details)
4. neolit/docs/api.md (architecture, from :api: tag, if exists)

### Status Management

- `TODO` - Work on now
- `HOLD` - Backlog/blocked
- `DONE` - Complete
- `CANCELLED` - Won't do

Agents: work on TODO, update to DONE

### Example

```
You: "Work on src/auth/TODO.org first task"

AI:
1. Reads neolit/prompts/BASE.md
2. Reads src/auth/TODO.org
3. Sees :feature:api: tags
4. Reads neolit/prompts/FEATURE.md
5. Reads src/auth/CODE.md (exact structures, constraints)
6. Reads neolit/docs/api.md (architecture)
7. Implements following exact data structures
8. Updates TODO → WAITING
9. Updates CODE.md if structures changed
```

---

**System adapts to your structure.**
