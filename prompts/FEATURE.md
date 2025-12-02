# Feature Implementation

Location: Inferred from TODO file path (src/module/TODO.org → src/module/README.md)

1. Read module README.md for responsibilities, patterns, constraints
2. Check "Related Context" sections for dependencies
3. Follow "Data Flow" section for this module
4. Implement following patterns documented in module README
5. Update module README.md "Related" sections if adding dependencies

Check .neolit/system.md only for schemas listed in module README "Related Schemas".
Check ADRs listed in module README "Related ADRs".

## Creating New Module

```bash
mkdir -p src/module-name
cp templates/src/module/README.md src/module-name/
cp templates/src/module/TODO.org src/module-name/
```

Fill module README.md:
- Purpose, key data structures
- Related Schemas/Modules/APIs/ADRs
- Data Flow, Constraints
