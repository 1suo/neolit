# Feature Implementation

**MANDATORY: Read these files BEFORE starting:**

1. **`neolit/standard/rules.md`** - All mandatory rules (READ FULLY)
2. **`neolit/standard/workflow.md`** - Phase 0-3 workflow (READ FULLY)
3. **`neolit/standard/validation.md`** - Validation checklist

---

## Workflow Summary

**Phase 0: Verify Docs Exist**
- Check NEOLIT.md exists at all needed levels
- Verify **Level:** markers correct
- Verify required sections present
- **If missing:** Use DOCUMENT_COMPONENT.md to create

**Phase 1: Read Docs**
- Read SYSTEM level (root NEOLIT.md)
- Read CONTAINER level (if exists)
- Read COMPONENT level
- Extract all structures, constraints

**Phase 2: Implement**
- Follow exact structures from NEOLIT.md
- Honor all constraints (MUST/MUST NOT)
- Complete fully (no placeholders)
- Handle all errors

**Phase 3: Document Changes**
- Update NEOLIT.md (correct level)
- Add agent notes to TODO.org
- Move task to WAITING

**See `neolit/standard/workflow.md` for complete details.**

---

## Validation

Before marking WAITING, verify using `neolit/standard/validation.md`:

- [ ] Docs existed before starting
- [ ] Read all levels
- [ ] Structures match NEOLIT.md exactly
- [ ] All constraints honored
- [ ] Feature complete
- [ ] Docs updated
- [ ] Agent notes added

---

## Templates

If creating new component, see:
- `neolit/standard/templates/component.md`
- `neolit/standard/templates/code.md`

---

**Any violation of rules → REJECTED**

**See `neolit/standard/rules.md` for complete mandatory rules.**
