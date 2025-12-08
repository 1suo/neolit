# LLM Usage Guidelines

Best practices for working with AI coding agents.

## When to Use AI Agents

- Implementing well-defined features from TODO.org
- Writing code following established patterns
- Debugging with clear reproduction steps
- Updating documentation alongside code
- Analyzing code for documentation

## When NOT to Use AI Agents

- Making architectural decisions (requires human judgment)
- Security-critical code (requires expert review)
- Large refactoring without clear plan
- Breaking changes without discussion

## AI Agent Workflow

1. **Phase 0: Documentation Verification (FIRST)**
   - Check NEOLIT.md exists (root + component, container if multi-deployable)
   - Verify **Level:** markers correct
   - Verify required sections present
   - Fill gaps if missing

2. **Phase 1: Read Documentation**
   - Read root NEOLIT.md (SYSTEM level)
   - Read container NEOLIT.md (CONTAINER level - if multi-deployable)
   - Read component NEOLIT.md (COMPONENT level)
   - Extract exact data structures
   - Note constraints (MUST/MUST NOT)

3. **Phase 2: Implement**
   - Follow exact structures from NEOLIT.md
   - Honor all constraints
   - Complete fully (no placeholders)

4. **Phase 3: Document Changes**
   - Update NEOLIT.md (correct level)
   - Add agent notes to TODO.org
   - Update task to WAITING

5. **Phase 4: Human Review**
   - Human reviews changes and documentation
   - Approves or requests modifications

## Task Management

### Top-down (Recommended for coordination)

**Root TODO.org** for project-wide tasks:
- Cross-component features
- Architectural work
- Prioritization

Use when:
- Task affects multiple components
- Need project-wide overview
- Architectural decisions

### Bottom-up (Recommended for component work)

**Component TODO.org** (`src/auth/TODO.org` or `api/auth/TODO.org`):
- Tasks close to implementation
- Clear component ownership
- Isolated features

Use when:
- Task confined to single component
- Implementation detail
- Already know the component

## Documentation Levels

NEOLIT.md files use C4 model:

**SYSTEM** (root)
- System overview, workflows
- Containers list (if multi-deployable) OR Components list (if single)
- Global constraints
- 60-100 lines

**CONTAINER** (api/, worker/, frontend/)
- **OPTIONAL: Only for separately deployable units**
- Deployment info (runtime, port)
- Components list, tech stack
- Container constraints
- 60-80 lines

**COMPONENT** (src/auth/, api/auth/)
- Architecture + implementation (most detailed)
- Exact data structures, API, constraints
- 100-200 lines

**CODE** (src/auth/utils/)
- Specific functions, utilities
- Only if complex (3+ files)
- 30-80 lines

**Each file starts with:** `**Level:** SYSTEM | CONTAINER | COMPONENT | CODE`

---

## Structure Examples

**Single deployable application (most common):**
```
NEOLIT.md (SYSTEM) → src/auth/NEOLIT.md (COMPONENT)
```

**Multi-deployable (microservices):**
```
NEOLIT.md (SYSTEM) → api/NEOLIT.md (CONTAINER) → api/auth/NEOLIT.md (COMPONENT)
```

**Key principle:** CONTAINER level only for separately deployable units, not source directories.
