# Neolit

AI-driven development scaffolding. Document once, develop consistently.

## Installation

```bash
npm install -g neolit
```

## Quick Start

```bash
# Initialize in your project
cd your-project
neolit init

# Have AI analyze and document your codebase
# Follow: neolit/prompts/ANALYZE_PROJECT.md
```

## Commands

- `neolit init` - Set up neolit/ structure in current project
- `neolit clean` - Remove all neolit files from project
- `neolit extend <name>` - Copy template for customization

## Structure

```
project/
├── neolit/
│   ├── prompts/
│   │   ├── BASE.md           # Core agent instructions
│   │   ├── ANALYZE_PROJECT.md
│   │   ├── BUG.md
│   │   └── FEATURE.md
│   ├── docs/
│   │   ├── system.md         # MUST - system overview
│   │   ├── workflows.md      # Key flows
│   │   └── [modules]/        # Domain-specific docs
│   ├── templates/            # For creating entities
│   └── VISION.org            # Human planning
└── .neolitrc                 # Config
```

## Philosophy

**Code serves workflows built on architectural foundations.**

1. **Document foundations first**: Core schemas, decisions, workflows
2. **Layered context**: Task → Module → System → Global
3. **Dynamic composition**: AI reads only what's needed
4. **Close to code**: Context lives with code

Task → prompts → docs → code

## Publishing (Maintainers)

```bash
npm version patch  # or minor/major
npm publish
git push --follow-tags
```

## Integration

See [INTEGRATION.md](INTEGRATION.md)

**Adapt freely. Scaffolding, not framework.**
