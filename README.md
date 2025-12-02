# Neolit

AI-driven development scaffolding. Document once, develop consistently.

## Quick Start

```bash
# Clone and integrate
cd your-project
git clone https://github.com/you/neolit.git .neolit-src
./.neolit-src/integrate.sh .

# Have AI analyze and document
# Use: neolit/prompts/ANALYZE_PROJECT.md
```

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

## Integration

See [INTEGRATION.md](INTEGRATION.md)

**Adapt freely. Scaffolding, not framework.**
