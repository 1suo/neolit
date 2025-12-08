# Bug Fix

**MANDATORY: Read these files BEFORE starting:**

1. **`neolit/standard/rules.md`** - All mandatory rules (READ FULLY)
2. **`neolit/standard/workflow.md`** - Phase 0-3 workflow (READ FULLY)

---

## Workflow Summary

**Phase 0: Verify Docs Exist**
- Check NEOLIT.md exists
- Verify completeness
- **If missing:** Use DOCUMENT_COMPONENT.md

**Phase 1: Read Docs**
- Read COMPONENT level (affected component)
- Read CONTAINER/SYSTEM levels for context
- Identify constraints that might be violated

**Phase 2: Root Cause Analysis**
1. Reproduce bug
2. Trace through code
3. Verify against NEOLIT.md - which constraint violated?
4. Assess impact

**Phase 3: Fix Implementation**
- **Minimal changes ONLY** (Rule 6)
- Preserve all structures (Rule 2)
- Fix only the bug (no refactoring)

**Phase 4: Document Changes**
- Update NEOLIT.md if bug exposed unclear docs
- Add agent notes with root cause
- Move to WAITING

**See `neolit/standard/workflow.md` for complete workflow.**

---

## Validation

Before marking WAITING, verify using `neolit/standard/validation.md`:

- [ ] Bug actually fixed (verified)
- [ ] Minimal fix (no extra changes)
- [ ] Structures still match NEOLIT.md
- [ ] No API breakage
- [ ] Docs updated if needed
- [ ] Agent notes added

---

**Any violation of rules → REJECTED**

**See `neolit/standard/rules.md` for mandatory rules.**
