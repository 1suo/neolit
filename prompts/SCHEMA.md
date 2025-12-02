# Create/Update Schema

For tasks working with data schemas:

1. Document in docs/architecture.md under "Data Schemas" section
2. For each entity:
   - Attributes and types
   - Relationships (has-many, belongs-to, etc)
   - Invariants (what MUST always be true)
   - Keys and indexes
3. Update module README.md "Related Schemas" to reference it
4. Update AGENTS.md MUST constraints if invariants affect code

Keep schema documentation minimal but complete.
