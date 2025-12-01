# Neolit Summary

**Status:** Initial boilerplate complete  
**Date:** 2025-12-01

---

## What Was Created

### Core Templates

1. **AGENTS.md** - Master prompt for AI coding agents
   - Core principles (documentation-first, minimal changes, follow patterns)
   - Architecture patterns (customizable)
   - Key constraints (MUST) and preferences (SHOULD)
   - Common tasks and workflows
   - Task status management

2. **SYSTEM.org** - Strategic planning document
   - Top-level TODOs and milestones
   - LLM usage guidelines
   - Testing strategy
   - Documentation index
   - Project conventions

### Documentation Templates

3. **docs/architecture.md**
   - Domain model
   - High-level architecture
   - Data schemas
   - Integration points
   - Security considerations
   - Performance considerations

4. **docs/api.md**
   - Authentication
   - Endpoints (CRUD examples)
   - Error responses
   - Rate limiting
   - Code examples

5. **docs/contributing.md**
   - Setup instructions
   - Development workflow
   - Code style guidelines
   - Testing guidelines
   - Git workflow
   - Code review process

6. **docs/adr/template.md**
   - ADR structure (Context, Criteria, Decision, Consequences)
   - Alternatives considered
   - Related decisions
   - Implementation notes

### Module Templates

7. **src/module/README.md**
   - Module responsibilities
   - Key concepts
   - Architecture and file structure
   - Data structures
   - Public API
   - Usage examples
   - Constraints and preferences
   - Pain points

8. **src/module/TODO.org**
   - Bugfixes section
   - Features section
   - Technical debt section
   - Documentation tasks
   - Testing tasks
   - Status guide for AI agents

### Integration

9. **INTEGRATION.md** - Complete setup guide
   - Quick start steps
   - Customization checklist
   - Working with AI agents
   - Best practices
   - Migration from existing projects
   - Stack-specific adaptations
   - Troubleshooting

10. **README.md** - Project overview
    - What Neolit is
    - Quick start
    - Core principles
    - File structure
    - Philosophy

---

## Key Concepts

### Layered Context

Information flows from general to specific:
```
AGENTS.md (global rules)
    ↓
docs/architecture.md (system patterns)
    ↓
src/module/README.md (module patterns)
    ↓
TODO.org (task details)
```

### Documentation-First Development

Code changes MUST include documentation updates in same commit.

### Task Status Flow

```
TODO → IN-PROGRESS → WAITING → DONE
```

AI agents move tasks to WAITING (human review) or DONE (obviously complete).

### Modal Verbs

- **MUST** - Invariants, critical constraints
- **SHOULD** - Preferences, style guidelines
- **MAY** - Optional optimizations

---

## How to Use

### For New Projects

1. Copy templates to project root
2. Customize AGENTS.md with project specifics
3. Fill in SYSTEM.org with milestones
4. Document architecture in docs/
5. Create module structures as needed

### For Existing Projects

1. Start with documentation phase (copy templates, document current state)
2. Create module READMEs for major components
3. Migrate issues to TODO.org files
4. Gradually introduce AI agent workflow

### For AI Agents

Entry point: `AGENTS.md`

Typical workflow:
1. Read AGENTS.md for global rules
2. Check module README.md for patterns
3. Find task in TODO.org
4. Implement following patterns
5. Update documentation
6. Update TODO.org status

---

## File Organization

```
neolit/
├── README.md              # Project overview (this system)
├── INTEGRATION.md         # Setup guide
├── SUMMARY.md             # This file
├── neolit.org             # Original plan/reference
├── SYSTEM.org             # Original planning
├── AGENTS.md              # Old example (to be replaced)
├── ARCHITECTURE.md        # Old example (to be replaced)
└── templates/             # Boilerplate for projects
    ├── AGENTS.md
    ├── SYSTEM.org
    ├── docs/
    │   ├── architecture.md
    │   ├── api.md
    │   ├── contributing.md
    │   └── adr/
    │       └── template.md
    └── src/
        └── module/
            ├── README.md
            └── TODO.org
```

---

## Design Decisions

### Why Org-Mode for TODOs?

- Hierarchical structure
- Properties for metadata
- Status tracking built-in
- Plain text, version control friendly
- Human and machine readable

### Why Separate .org and .md?

- `.org` - Planning, TODOs, ephemeral notes
- `.md` - Documentation, permanent reference, renders nicely

### Why ADRs?

- Captures decision context
- Prevents revisiting settled issues
- Provides architectural memory
- Guides future decisions

### Why Module-Level Documentation?

- Context closer to code
- Reduces cognitive load
- AI agents can focus on relevant section
- Easier to keep in sync

---

## Customization Points

All templates have `[PROJECT_SPECIFIC]` markers indicating sections to customize:

- Architecture patterns
- Code organization rules
- Key constraints (MUST)
- Preferences (SHOULD)
- Debugging approach
- Testing commands
- Stack-specific guidelines

---

## What's NOT Included

Deliberately excluded (add per-project):
- Specific tech stack setup
- Code generators/scaffolding scripts
- CI/CD configurations
- Deployment procedures
- Environment setup
- Package managers
- Testing frameworks

Reason: Too project-specific. Templates guide documentation, not implementation.

---

## Next Steps

1. **Test on real project** - Apply to an actual codebase
2. **Gather feedback** - What works? What doesn't?
3. **Refine templates** - Based on real-world usage
4. **Add examples** - Show before/after for common scenarios
5. **Create video guide** - Walkthrough of setup and usage

---

## Success Metrics

Good indicators Neolit is working:

- ✅ AI agents follow patterns consistently
- ✅ Documentation stays in sync with code
- ✅ Architectural decisions are documented
- ✅ New contributors get up to speed quickly
- ✅ Less time explaining context to AI
- ✅ Fewer "why was it done this way" questions

---

## Philosophy

**Neolit is scaffolding, not a framework.**

Adapt freely. Remove what doesn't fit. Add what's missing. The goal is clarity for AI agents and humans working together, not rigid adherence to templates.

**Be brief, but no briefer than necessary.**
