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

**Core principle:** Code serves workflows and architectural foundations, not the other way around.

Inspired by literate programming and ADR practices.

---

## Quick Start

### 1. Copy Templates

```bash
# From neolit directory
cp templates/AGENTS.md /path/to/your/project/
cp templates/SYSTEM.org /path/to/your/project/
cp -r templates/docs /path/to/your/project/
```

### 2. Document Foundations (BEFORE coding)

**Data Schema** (`docs/architecture.md`):
- List entities: User, Post, Comment, etc.
- For each: attributes, types, relationships
- State invariants: "User.email must be unique", "Post.authorId must exist"
- Define keys and indexes

**Architectural Decisions** (create ADRs):
- One ADR per major decision
- Include: Why this choice? What alternatives? What tradeoffs?
- Must have: Database, Authentication, API design, State management

**Critical Workflows** (`docs/architecture.md`):
- Pick 3-5 most important user journeys
- For each: Step-by-step flow with data transformations
- Show: Input → Validation → Processing → Storage → Output

**Fill MUST constraints** (`AGENTS.md`):
- From schema: "MUST respect User.email uniqueness"
- From ADRs: "MUST use JWT per ADR-002"

### 3. Integrate

See [INTEGRATION.md](./INTEGRATION.md) (one-time setup)

---

## File Structure

```
your-project/
├── README.md              # For humans
├── AGENTS.md              # For AI agents (main entry point)
├── SYSTEM.org             # Strategic planning
├── docs/
│   ├── architecture.md    # System architecture
│   ├── api.md             # API documentation
│   ├── contributing.md    # Contribution guide
│   └── adr/
│       ├── template.md    # ADR template
│       └── 0001-*.md      # Your ADRs
└── src/
    └── module/
        ├── README.md      # Module documentation
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
- `docs/architecture.md` - System-wide patterns
- `src/module/README.md` - Module-specific patterns
- `TODO.org` - Task-specific details

### Patterns Over Prescription
Show examples of good code. Reference existing implementations. Let patterns emerge.

### Minimal but Complete
Change only what's needed. But finish what you start.

---

## For AI Agents

When working on a project using Neolit:

1. **Read `AGENTS.md` first** - Entry point with all instructions
2. **Check module `README.md`** - Module-specific patterns
3. **Find tasks in `TODO.org`** - What needs to be done
4. **Update docs with code** - Documentation-first development
5. **Mark status in `TODO.org`** - Track your progress

---

## For Humans

### Setting Up

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

### Files You'll Modify

**Frequently:**
- `TODO.org` files - Add tasks, review agent work
- `docs/adr/` - Document decisions

**Occasionally:**
- `AGENTS.md` - Refine agent instructions
- `docs/architecture.md` - Update as system evolves
- Module `README.md` - Document new patterns

**Rarely:**
- `SYSTEM.org` - Strategic changes only

---

## Templates Included

| Template | Purpose |
|----------|---------|
| `AGENTS.md` | Master instructions for AI agents |
| `SYSTEM.org` | Strategic planning and milestones |
| `docs/architecture.md` | System architecture documentation |
| `docs/api.md` | API documentation |
| `docs/contributing.md` | Contribution guidelines |
| `docs/adr/template.md` | Architecture decision records |
| `src/module/README.md` | Module-level documentation |
| `src/module/TODO.org` | Task tracking for modules |

---

## Philosophy

### Why Org-Mode?

- Hierarchical task structure
- Properties for metadata
- Human and machine readable
- Plain text (version control friendly)

### Why Separate Planning from Docs?

- `.org` files - For planning, TODOs, milestones (humans + AI)
- `.md` files - For documentation (humans + AI + rendering)

### Why ADRs?

- Captures **why** decisions were made
- Prevents revisiting settled questions
- Provides context to AI agents
- Documents tradeoffs explicitly

---

## Examples

See original files for real-world usage:
- `AGENTS.md` - From Cutkit-Demo project
- `ARCHITECTURE.md` - Production architecture doc

---

## Adapting Neolit

This is a **scaffolding system**, not a rigid framework:

✅ Remove sections that don't apply  
✅ Add domain-specific sections  
✅ Change terminology to match your team  
✅ Evolve structure as you learn  

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
