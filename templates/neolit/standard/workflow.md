# Documentation Workflow

## Phase 0: Verify Docs Exist

**Actions:**
1. Check: NEOLIT.md exists at level?
2. Check: **Level:** marker correct?
3. Check: Required sections present?
4. If missing/wrong → Create/fix using guides

**Commands:**
```bash
ls NEOLIT.md                    # Root: SYSTEM level
ls src/auth/NEOLIT.md           # Component: COMPONENT level (single deployable)
# OR
ls api/NEOLIT.md                # Container: CONTAINER level (multi-deployable)
ls api/auth/NEOLIT.md           # Component: COMPONENT level
```

**Violation:** Starting without complete docs → REJECTED

---

## Phase 1: Read Docs

**Actions:**
1. Read root NEOLIT.md (SYSTEM)
   - System architecture
   - Containers/components list
   - Relevant workflows

2. Read container NEOLIT.md (CONTAINER, if exists)
   - Container deployment info
   - Components list

3. Read component NEOLIT.md (COMPONENT)
   - Extract ALL data structures (types, fields, constraints)
   - Note ALL function signatures
   - Identify patterns and rules (MUST/MUST NOT)

4. Verify understanding
   - Can draw data flow?
   - Know all structures involved?
   - Understand task's place in system?

**Violation:** Implementation without context → REJECTED

---

## Phase 2: Implement

**Rules:**
- **MUST** use EXACT field names from NEOLIT.md
- **MUST** respect EXACT types and constraints
- **MUST** follow documented patterns
- **MUST** handle ALL edge cases and errors
- **MUST NOT** leave placeholders or TODOs
- **MUST** complete task fully

**Violation:** Deviation from structures → REJECTED

---

## Phase 3: Document Changes

**Update in SAME commit:**

1. **COMPONENT level NEOLIT.md** → if added/changed:
   - Data structures
   - Function signatures
   - Implementation patterns
   - Constraints

2. **CONTAINER level NEOLIT.md** → if changed (only if multi-deployable):
   - Deployment configuration
   - Components list

3. **SYSTEM level NEOLIT.md** → if changed:
   - Workflows
   - Global constraints
   - Containers/components list

4. **TODO.org** → add agent notes (required)

**Violation:** Code without doc updates → REJECTED
