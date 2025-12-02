# Bug Fix

Location: Inferred from TODO file path (src/module/TODO.org → src/module/README.md)

1. Read module README.md for context and constraints, if any
2. Check "Related docs" sections
3. Find root cause
4. Implement minimal fix following documented patterns
5. Update module README.md if behavior changes

If schemas changed, or architecture affected:
1. Analyze impact on architecture and schemas
2. If safe, update relevant docs/*.md and schema files
3. If not safe, create ADR in docs/adr/ by copying template.md and filling out
4. Get approval for ADR before implementation

Refer to .neolit/system.md only for schemas listed in module README "Related Schemas".
