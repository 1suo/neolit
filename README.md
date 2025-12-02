# Neolit

**AI-driven development scaffolding system**

Neolit provides templates and structures for AI-assisted web application development. Insert it into any project to enable effective collaboration between humans and AI coding agents.

---

## What is Neolit?

A scaffolding system for AI-assisted development:
- **Documentation templates** that guide AI agents
- **Architectural foundations** (schema, decisions, workflows)
- **Task tracking** (org-mode based)
- **Design patterns** for LLM collaboration

Inspired by literate programming idea and ADR practices.

---

## File Structure

```
your-project/
├── CONTEXT.md              # For humans
├── AGENTS.md              # For AI agents (main entry point)
├── SYSTEM.org             # Strategic planning
├── .neolit/
│   ├── architecture.md    # System architecture
│   ├── api.md             # API documentation
│   ├── contributing.md    # Contribution guide
│   └── adr/
│       ├── template.md    # ADR template
│       └── 0001-*.md      # Your ADRs
└── src/
    └── module/
        ├── CONTEXT.md      # Module documentation
        ├── TODO.org       # Module tasks
        └── [code]
```

---

## Core Principles

### Documentation-First
Document decisions before coding. Update docs in same commit as code.

### Foundations Before Code
Document data schema, workflows, and key decisions first. Code implements these foundations consistently.

### Layered Context
- `AGENTS.md` - Global rules for AI agents
- `.neolit/architecture.md` - System-wide patterns
- `src/module/CONTEXT.md` - Module-specific patterns
- `TODO.org` - Task-specific details

### Patterns Over Prescription
Show examples of good code. Reference existing implementations. Let patterns emerge.

### Minimal but Complete
Change only what's needed. But finish what you start.

---

## Setting Up

See [INTEGRATION.md](./INTEGRATION.md)

### Working with AI

Point agent to `AGENTS.md`:
```
Read @AGENTS.md for instructions on working with this codebase.
```

Assign tasks via `TODO.org`:
```
Complete the next TODO task in src/auth/TODO.org
```

Run open-ended session through all tasks:
```
Complete all tasks from all TODO.org files in src/ until none with "TODO" status remain.
```

### Files You'll Modify

**Frequently:**
- `TODO.org` files - Add tasks, review agent work

**Occasionally:**
- `SYSTEM.org` - Strategic planning updates
- `AGENTS.md` - Refine agent instructions
- Module `CONTEXT.md` - Document new patterns that aren't fit high-level docs
- `.neolit/*.md` - Update as system evolves
- `.neolit/adr/` - Document decisions

**Rarely:**
- `.neolit/system.md` - Major architecture changes

---

## Templates Included

| Template | Purpose |
|----------|---------|
| `AGENTS.md` | Master instructions for AI agents |
| `SYSTEM.org` | Strategic planning and milestones |
| `.neolit/architecture.md` | System architecture documentation |
| `.neolit/api.md` | API documentation |
| `.neolit/adr/template.md` | Architecture decision records |
| `src/module/CONTEXT.md` | Module-level documentation |
| `src/module/TODO.org` | Task tracking for modules |

---

## Philosophy

### Why Org-Mode?

In complex AI-assisted projects, clear task management is crucial. It becomes easy to lose track of what needs to be done, what has been done, and what the priorities are. Main point of using orgmode here is to leverage project-wide agenda views, which help humans keep in touch with overall progress. In comparison, markdown TODO lists are isolated to individual files, making it harder to get a holistic view. Anyway, orgmode is just a suggestion - plain text TODO lists work too.

### Why Separate Planning from Docs?

- `.org` files - For planning, TODOs, milestones (humans + AI)
- `.md` files - For documentation (humans + AI + rendering)

### Why ADRs?

- Prevents revisiting settled questions
- Provides context to AI agents

---

## Examples

See original files for real-world usage:
- `AGENTS.md` - From Cutkit-Demo project
- `ARCHITECTURE.md` - Production architecture doc

---

## Adapting Neolit

This is a **scaffolding system**, not a rigid framework:

- Remove sections that don't apply  
- Add domain-specific sections  
- Change terminology to match your team  
- Evolve structure as you learn  

Goal: Clarity for AI agents, not perfection.

---

## Requirements

- AI coding assistant that can read custom instructions (GitHub Copilot, Cursor, etc.)
- Project using version control (Git)
- Optional: Emacs/Org-mode for `.org` file editing (any text editor works)

---

## License

MIT - Use freely, adapt as needed.

---

## Contributing

This is a young project. Feedback welcome:
- What worked?
- What didn't?
- What's missing?

---

## Related Work

- [Architecture Decision Records (ADR)](https://adr.github.io/)
- [Literate Programming](https://en.wikipedia.org/wiki/Literate_programming)
- [C4 Model](https://c4model.com/) for architecture diagrams
- [Org-mode](https://orgmode.org/) for structured documents
