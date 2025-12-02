# Feature Implementation

Location: Inferred from TODO file path (src/module/TODO.org → src/module/CONTEXT.md)

1. Read module CONTEXT.md for responsibilities, patterns, constraints
2. Check "Related Context" sections for dependencies
3. Follow "Data Flow" section for this module
4. Implement following patterns documented in module CONTEXT
5. Update module CONTEXT.md "Related" sections if adding dependencies

Check .neolit/system.md only for schemas listed in module CONTEXT "Related Schemas".
Check ADRs listed in module CONTEXT "Related ADRs".

## Creating New Module

For NEW modules:
```bash
mkdir -p src/module-name
cp templates/src/module/CONTEXT.md src/module-name/
cp templates/src/module/TODO.org src/module-name/
```

For EXISTING modules without CONTEXT.md:
- Find logical module boundaries in existing code
- Create CONTEXT.md in that directory
- Create TODO.org in that directory
- Don't restructure existing code

Fill CONTEXT.md using template it contains:
- Purpose, key data structures
- Related Schemas/Modules/APIs/ADRs
- Data Flow, Constraints
