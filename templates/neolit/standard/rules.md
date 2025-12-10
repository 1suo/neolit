# Mandatory Rules

## Rule 0: Documentation-First

**Before touching code:**

1. **MUST** verify `NEOLIT.md` exists at correct level
   - Root level (SYSTEM) → If missing: create using ANALYZE_PROJECT.md
   - Component level (COMPONENT) → If missing: create using DOCUMENT_COMPONENT.md

2. **MUST** verify `NEOLIT.md` has correct **Level:** marker and sections
   - Check: `**Level:** SYSTEM | CONTAINER | COMPONENT | CODE`
   - If wrong or incomplete → Fill using appropriate guide

3. **MUST** verify `NEOLIT.md` complete for task
   - Has required sections for its level?
   - Has data structures, constraints?
   - If incomplete → Fill gaps using DOCUMENT_COMPONENT.md

**ONLY AFTER all docs exist and complete → proceed to implementation**

**Violation:** Starting without complete documentation → REJECTED

---

## Rule 1: Context Assembly

1. **MUST** read root `NEOLIT.md` FIRST (SYSTEM level)
2. **MUST** read component `NEOLIT.md` (COMPONENT level - exact structures, signatures, constraints)
3. **MUST** identify ALL data structures involved
4. **MUST** trace complete data flow
5. **MUST** verify understanding (can draw flow? know structures? understand place in system?)

**Violation:** Implementation without complete context → REJECTED

---

## Rule 2: Data Structure Integrity

1. **MUST** follow existing structures EXACTLY (types, fields, constraints from NEOLIT.md)
2. **MUST** match field names CHARACTER-FOR-CHARACTER
3. **MUST NOT** modify structures without explicit task requirement

**Violation:** Any deviation from documented structures → REJECTED

---

## Rule 3: Pattern Adherence

1. **MUST** match existing naming conventions EXACTLY
2. **MUST** use established patterns from architecture (in NEOLIT.md)
3. **MUST** preserve existing APIs unless task requires change

**Violation:** Pattern violations or API breakage → REJECTED

---

## Rule 4: Documentation Synchronization

1. **MUST** update `NEOLIT.md` when changing implementation
2. **MUST** update correct level (COMPONENT for code, SYSTEM for workflows, CONTAINER for deployable unit)
3. **SHOULD** commit documentation separately from code (see neolit/standard/git-workflow.md)
4. **MUST** add agent notes to TODO.org

**Agent notes format:**
```org
*** Agent Notes
    [2025-12-08] Task description
    Files changed: file1.js, file2.js
    Docs updated: NEOLIT.md (COMPONENT level)
    Notes: key decisions, patterns used
```

**Violation:** Code without documentation updates → REJECTED

---

## Rule 5: Completeness

1. **MUST** complete task FULLY (no placeholders, TODOs, or "later" comments)
2. **MUST** implement error handling and edge cases
3. **MUST** move to WAITING status (not DONE)

**Violation:** Incomplete implementation → REJECTED

---

## Rule 6: Minimal Changes

1. **MUST** change ONLY what task requires
2. **MUST NOT** refactor unrelated code or fix unrelated bugs

**Violation:** Unnecessary changes → REJECTED
