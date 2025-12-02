# Neolit

AI-driven development scaffolding. Document once, develop consistently.

---

## Quick Start

```bash
./integrate.sh /path/to/project
```

For new projects: AI documents foundations using `prompts/ANALYZE-EXISTING.md`

For existing: AI analyzes codebase and generates docs

See [INTEGRATION.md](INTEGRATION.md)

---

## Structure

```
project/
├── AGENTS.md             # For agents (agents read, humans write)
├── HUMAN.org             # For humans (humans maintain, agents can read)
├── .neolit/              # System documentation
│   ├── system.md         # MUST exist - system structure entry point
│   ├── workflows.md      # Key user/data flows
│   ├── adr/              # Architecture decisions
│   └── [containers]/     # Can vary by project (1-web-app/, 2-api-server/, etc)
├── prompts/              # Task-type workflows
│   ├── BUG.md
│   ├── FEATURE.md
│   ├── TODO-STATUS.md
│   └── ANALYZE-EXISTING.md
├── src/module/
│   ├── CONTEXT.md        # Module context for agents
│   └── TODO.org          # Module tasks
└── templates/            # For creating new modules
    └── src/module/
```

---

## Philosophy

**Code serves workflows and architectural foundations.**

1. **Document foundations first**: Schemas, architectural decisions, workflows
2. **Layered context**: Global → System → Module → Task
3. **Close to code**: Module CONTEXT.md with relevant code
4. **Dynamic composition**: AI reads only what's needed for task

Task tags point to prompts → prompts point to docs → docs point to code.

---

## Key Files

| File | Purpose | Updated By |
|------|---------|------------|
| `AGENTS.md` | Instructions for AI agents | Human setup, AI follows |
| `HUMAN.org` | Strategic planning | Human maintains |
| `.neolit/system.md` | System structure (MUST) | AI during analysis, human reviews |
| `.neolit/workflows.md` | User/data flows | AI + human |
| `src/module/CONTEXT.md` | Module-level context | AI with code changes |
| `src/module/TODO.org` | Tasks | Human creates, AI updates status |
| `prompts/*.md` | Task-type workflows | Part of system |

---

## AI Workflow

```
Human assigns task → AI reads AGENTS.md → 
Task location reveals module → AI reads module CONTEXT.md →
Task tags reveal type → AI reads prompts/TYPE.md →
Module CONTEXT points to specific .neolit/ docs →
AI implements following foundations →
AI updates docs + TODO status in same commit
```

---

## Integration

See [INTEGRATION.md](INTEGRATION.md)

**TL;DR:**
1. Run `./integrate.sh`
2. AI reads `prompts/ANALYZE-EXISTING.md` to document project
3. Review and refine
4. Start assigning tasks

---

**Adapt freely. Scaffolding, not framework.**
