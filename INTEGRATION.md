# Neolit Integration Guide

## Quick Start

```bash
# Copy templates
cp templates/AGENTS.md /project/
cp templates/SYSTEM.org /project/
cp -r templates/docs /project/

# Set up modules
mkdir -p src/module-name
cp templates/src/module/README.md src/module-name/
cp templates/src/module/TODO.org src/module-name/
```

## **BEFORE Coding: Document Foundations**

### MUST Document First (Core Architecture)

1. **Data Schema** (in `.neolit/architecture.md`)
   - Core entities and their relationships
   - Invariants (what MUST always be true)
   - Primary keys and indexes
   - Critical constraints

2. **Key Architectural Decisions** (create ADRs)
   - Database choice and why
   - Authentication approach
   - State management pattern
   - API design (REST/GraphQL/etc)
   - Deployment model

3. **Critical Workflows** (see below)
   - Main user journeys
   - Data flow paths
   - Integration points

**Why:** AI agents need these foundations to make consistent decisions. Without them, each feature drifts in different directions.

**What to document:**

1. **Data Schema** - For each entity:
   - Attributes and types
   - Relationships (has-many, belongs-to)
   - Invariants (what MUST always be true)
   - Keys and indexes

2. **Key Decisions** - One ADR per major choice:
   - Context: What problem?
   - Decision: What we chose
   - Why: Rationale and alternatives considered
   - Required: Database, Auth, API design, State management

3. **Critical Workflows** - 3-5 most important paths:
   - Step-by-step with data at each step
   - Input → Validation → Processing → Storage → Output
   - Components involved at each step

## Workflows First

Before documenting components, document workflows:

### User Workflows
In `.neolit/architecture.md`:
1. Map user journeys (from entry to goal)
2. Show sequence diagrams
3. Identify critical paths

### Data Flows
1. Document data transformations
2. Show component interactions
3. Trace requests end-to-end

**Code serves workflows and architectural foundations, not the other way around.**

---

## Customize Templates

Open files and replace `[PROJECT_SPECIFIC]` markers with your:
- Architecture patterns (service layer, etc)
- Constraints (MUST rules from foundations)
- Preferences (SHOULD guidelines)
- Debugging approach

---

## Working with AI Agents

**Point agent:** `Read @AGENTS.md for instructions`

**Assign task:** `Complete FEAT-005 from src/api/TODO.org`

**Fix bug:** `Fix BUG-003 in src/data/TODO.org. Reproduces when [steps]`

---

## Best Practices

### Documentation-First

- Document decisions before coding (ADRs)
- Update docs in same commit as code
- Keep docs close to code (module READMEs)

### Task Tracking

- Use TODO.org for tracking all work
- Agents update status as they work
- Human reviews items in WAITING status
- Keep tasks small and focused
- Keep exact tasks close to code

### Patterns Over Prescription

- Show examples of good code
- Reference existing implementations
- Link to relevant ADRs
- Let patterns emerge organically

### Layered Context

- AGENTS.md: Global rules
- .neolit/*.md: System-wide context
- ADRs: Decision context
- Module README.md: Module-specific patterns
- TODO.org: Task-specific details

---

## Migration from Existing Project

### Phase 1: Document Foundations (CRITICAL)

1. **Data Schema** - Document all entities, relationships, constraints
2. **Architectural Decisions** - Create ADRs for past decisions (database, auth, patterns)
3. **Workflows** - Map critical user and data flows
4. **Copy templates** and fill in above

### Phase 2: Module Organization

1. Identify major modules
2. Create module READMEs
3. Extract current pain points
4. Document patterns in use

### Phase 3: Task Tracking

1. Create TODO.org per module
2. Migrate issues to TODO.org
3. Add acceptance criteria
4. Prioritize tasks

### Phase 4: AI Integration

1. Start with small tasks
2. Review agent output carefully
3. Refine AGENTS.md based on results
4. Gradually increase task complexity

---

## Adapting to Your Stack

### Backend Framework Examples

**Node.js/Express:**
```
Pattern: Route → Controller → Service → Repository
MUST: Use express-validator for input validation
SHOULD: Use async/await, not callbacks
```

**Python/Django:**
```
Pattern: View → Serializer → Service → Model
MUST: Use Django ORM, not raw SQL
SHOULD: Use class-based views
```

**Go:**
```
Pattern: Handler → Service → Repository
MUST: Handle errors explicitly, no panics
SHOULD: Use context.Context for cancellation
```

### Frontend Framework Examples

**React:**
```
MUST: Use functional components with hooks
SHOULD: Use React Query for data fetching
SHOULD: Prefer composition over prop drilling
```

**Vue:**
```
MUST: Use Composition API, not Options API
SHOULD: Use Pinia for state management
SHOULD: Keep components under 300 lines
```

**Svelte:**
```
MUST: Use stores for shared state
SHOULD: Keep components single-purpose
SHOULD: Use slots for composition
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Agent ignores patterns | Add examples to module README |
| Agent skips docs | Make explicit in task criteria |
| Tasks too large | Break into subtasks in TODO.org |
| Wrong files changed | Add constraints to module README |

---

**Adapt freely. This is scaffolding, not a framework.**
