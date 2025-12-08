# Neolit

AI-driven development system. Document once with NEOLIT.md, develop consistently.

## Installation

```bash
npm install -g neolit
```

## Quick Start

```bash
cd your-project
neolit init

# Have AI analyze and document your codebase
# Follow: neolit/prompts/ANALYZE_PROJECT.md
```

## Structure

**Single deployable application:**
```
project/
├── neolit/prompts/          # Agent instructions
├── NEOLIT.md                 # System architecture (SYSTEM level)
└── src/
    ├── auth/
    │   ├── NEOLIT.md         # Component docs (COMPONENT level)
    │   ├── TODO.org
    │   └── *.js
    └── user/
        └── NEOLIT.md         # Component docs (COMPONENT level)
```

**Multi-deployable (microservices):**
```
project/
├── neolit/prompts/          # Agent instructions
├── NEOLIT.md                 # System architecture (SYSTEM level)
├── api/
│   ├── NEOLIT.md             # Container (CONTAINER level - deployable unit)
│   └── auth/
│       ├── NEOLIT.md         # Component (COMPONENT level)
│       └── TODO.org
├── worker/
│   ├── NEOLIT.md             # Container (CONTAINER level - deployable unit)
│   └── email/
│       └── NEOLIT.md         # Component (COMPONENT level)
└── TODO.org
```

## Documentation Levels

**NEOLIT.md files use C4 model:**

- **SYSTEM** (root) - System overview, workflows (always)
- **CONTAINER** (api/, worker/) - Separately deployable unit (optional, only for microservices)
- **COMPONENT** (src/auth/) - Architecture + implementation (always)
- **CODE** (src/auth/utils/) - Specific functions (optional if complex)

**Each NEOLIT.md starts with:** `**Level:** SYSTEM | CONTAINER | COMPONENT | CODE`

**CONTAINER level:**
- Use ONLY for separately deployable units (API server, worker service, frontend app)
- Skip for single deployable applications
- Skip for source directories (src/)

## Philosophy

**One filename everywhere, content by level:**

1. **NEOLIT.md at every level** - Simple, scales naturally
2. **C4 levels determine content** - Clear structure for each level
3. **CONTAINER optional** - Only for separately deployable units
4. **Progressive detail** - System → Container (if applicable) → Component → Code
5. **Documentation-first** - Agents verify docs before coding
6. **Mandatory rules** - Enforced patterns and constraints

## Workflow

```
Task: Implement feature X

Agent workflow:
1. Verify NEOLIT.md exists (root + component levels)
2. Read NEOLIT.md (SYSTEM) → system overview
3. Read NEOLIT.md (COMPONENT) → exact structures, constraints
4. Implement following exact structures
5. Update NEOLIT.md (COMPONENT level) with changes
6. Move task to WAITING for human review
```

## Commands

- `neolit init` - Initialize `neolit/prompts/`
- `neolit analyze` - Show prompt for AI to analyze project
- `neolit update` - Update prompts (preserves NEOLIT.md files)
- `neolit clean --force` - Remove all neolit files

## Publishing (Maintainers)

```bash
npm version patch  # or minor/major
npm publish
git push --follow-tags
```

## Integration

See [INTEGRATION.md](INTEGRATION.md)

**Adapt freely. Scaffolding, not framework.**
