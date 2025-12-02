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
3. Create additional docs as needed (workflows.md, domain docs)
4. Preserve existing project structure

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
3. neolit/docs/api.md (from :api:, if exists)
4. Local module context (from task location)

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
5. Reads neolit/docs/api.md
6. Implements
7. Updates TODO → DONE
8. Updates context if needed
```

---

**System adapts to your structure.**
