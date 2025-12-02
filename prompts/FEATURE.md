# Feature Implementation

Location: Inferred from TODO file path (src/module/TODO.org → src/module/README.md)

1. Read module README.md for responsibilities, patterns, constraints
2. Check "Related Context" sections for dependencies
3. Follow "Data Flow" section for this module
4. Implement following patterns documented in module README
5. Update module README.md "Related" sections if adding dependencies

Check docs/architecture.md only for schemas listed in module README "Related Schemas".
Check ADRs listed in module README "Related ADRs".
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
