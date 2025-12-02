# Create New Module

Syntax for creating module structure:

```bash
mkdir -p src/module-name
cp templates/src/module/README.md src/module-name/
cp templates/src/module/TODO.org src/module-name/
```

Then customize src/module-name/README.md:
- Purpose and responsibilities
- Key data structures
- Related Schemas: List entities from docs/architecture.md this module uses
- Related Modules: List dependencies with purpose
- Related API Endpoints: Uses (calls) and Provides (exposes)
- Related ADRs: Link relevant decisions
- Data Flow: Diagram for this module
- Constraints: Module-specific MUST rules

Create first tasks in src/module-name/TODO.org with proper tags.
