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

- `neolit init` - Initialize `.neolit/` folder with templates
- `neolit analyze` - Show prompt for AI to analyze existing project
- `neolit update` - Update core prompts (preserves your docs)
- `neolit clean --force` - Remove all neolit files

## Structure

```
project/
├── .neolit/
│   ├── prompts/
│   │   ├── BASE.md              # Core agent instructions
│   │   ├── ANALYZE_PROJECT.md
│   │   ├── BUG.md
│   │   └── FEATURE.md
│   ├── docs/
│   │   ├── system.md            # MUST - system overview
│   │   ├── workflows.md         # Key flows
│   │   ├── adr/                 # Architecture decisions
│   │   ├── EXTENSION.md         # Customization guide
│   │   └── [containers]/        # Domain-specific docs
│   ├── templates/               # For creating entities
│   │   ├── src/module/         # Module templates
│   │   └── .neolit/            # Container/component templates
│   └── VISION.org               # Human planning
└── .neolitrc                    # Config
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
npm login
npm version patch  # or minor/major
npm publish
git push --follow-tags
```

Users update with:
```bash
npm install -g neolit@latest
cd project
neolit update  # Updates prompts, preserves docs
```

## Integration

See [INTEGRATION.md](INTEGRATION.md)

**Adapt freely. Scaffolding, not framework.**
