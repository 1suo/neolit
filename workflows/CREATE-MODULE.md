# Create New Module

```bash
mkdir -p src/module-name
cp templates/src/module/README.md src/module-name/
cp templates/src/module/TODO.org src/module-name/
```

Customize `src/module-name/README.md`:
- Purpose and responsibilities
- Key data structures
- Related Schemas: entities from docs/architecture.md
- Related Modules: dependencies
- Related API Endpoints: uses and provides
- Related ADRs: relevant decisions
- Data Flow: for this module
- Constraints: module MUST rules

Create first tasks in `src/module-name/TODO.org`.
