# Feature Implementation

**MANDATORY WORKFLOW - MUST FOLLOW EXACTLY**

## Phase 0: Documentation Verification (MANDATORY - FIRST STEP)

**BEFORE reading any documentation, verify it exists:**

Location: Inferred from TODO file path (src/module/TODO.org → src/module/CODE.md)

### Step 1: Check System Documentation

```bash
# Does system.md exist?
ls .neolit/docs/system.md
```

- **If missing:** **STOP. Follow `.neolit/prompts/ANALYZE_PROJECT.md` to create system.md**
- **If exists:** Proceed to Step 2

### Step 2: Check Module CODE.md

```bash
# Does module CODE.md exist?
ls src/module/CODE.md
```

- **If missing:** **STOP. Follow `.neolit/prompts/DOCUMENT_MODULE.md` to create CODE.md**
- **If exists:** Proceed to Step 3

### Step 3: Verify CODE.md Completeness

**Open CODE.md and check:**
- [ ] Contains data structures for this feature?
- [ ] Has function signatures?
- [ ] Documents constraints (MUST/MUST NOT/SHOULD)?
- [ ] Has implementation patterns?

**If ANY checkbox unchecked:**
- **STOP. Update CODE.md following DOCUMENT_MODULE.md guide**
- Document missing structures, signatures, constraints
- **Then return to this workflow**

### Step 4: Check Architecture Documentation (if complex module)

**Is this a complex module? (3+ files, multiple concerns, reused by others)**
- **If YES and architecture doc missing:** **STOP. Follow DOCUMENT_MODULE.md to create architecture doc**
- **If YES and exists:** Proceed to Phase 1
- **If NO (simple module):** Proceed to Phase 1

**Violation:** Starting implementation without complete documentation → REJECTED

---

## Phase 1: Context Assembly (MANDATORY)

**Documentation now exists and is complete. Read it:**

**MUST execute in this order:**

1. **MUST** read `.neolit/system.md` FIRST
   - Understand system architecture
   - Identify container this module belongs to
   - Map high-level data flow

2. **MUST** read module `CODE.md` 
   - Extract ALL data structures involved (types, fields, constraints)
   - Note ALL function signatures and parameters
   - Identify patterns and rules (MUST/SHOULD/MAY)
   - Map implementation-specific workflow

3. **MUST** read related architecture docs
   - Check container docs in `.neolit/` for design patterns
   - Check ADRs listed in CODE.md for decisions
   - Check `.neolit/workflows.md` for cross-module flows

4. **MUST** verify complete understanding
   - Can you draw the data flow?
   - Do you know all data structures involved?
   - Do you understand this task's place in system?
   - **IF NO to any: STOP and ask for clarification**

## Phase 2: Implementation (MANDATORY)

**MUST follow these rules:**

1. **Data structures:**
   - **MUST** use EXACT field names from CODE.md
   - **MUST** respect EXACT types documented
   - **MUST** honor ALL constraints documented
   - **MUST NOT** add/modify fields without task requirement

2. **Patterns:**
   - **MUST** match existing naming conventions
   - **MUST** follow patterns documented in architecture
   - **MUST** use established utilities/abstractions

3. **Implementation:**
   - **MUST** handle ALL edge cases
   - **MUST** include error handling
   - **MUST NOT** leave TODOs or placeholders
   - **MUST** complete feature fully

## Phase 3: Documentation Update (MANDATORY)

**MUST update documentation in SAME commit:**

1. **Update CODE.md IF:**
   - Added new functions/classes → document signatures
   - Changed data structures → update structure definitions
   - Added new patterns → document pattern usage
   - Added dependencies → update related modules section

2. **Update `.neolit/` docs IF:**
   - Changed component architecture
   - Changed design patterns
   - Added new workflows
   - Made architectural decisions (create ADR)

## Creating New Module

**ONLY if task explicitly requires new module:**

For NEW projects:
```bash
mkdir -p src/module-name
cp templates/src/module/CODE.md src/module-name/
cp templates/src/module/TODO.org src/module-name/
```

For EXISTING projects:
- Find logical module boundaries in existing code
- Create CODE.md in that directory
- Create TODO.org in that directory
- **MUST NOT** restructure existing code

Fill CODE.md:
- Data structures (exact types, fields, constraints)
- Function signatures
- Implementation patterns
- Links to architecture docs

## Phase 4: Document Changes (MANDATORY)

**After implementation, document what changed:**

### In Task File (TODO.org)

```org
*** Agent Notes
    [YYYY-MM-DD] Completed feature X
    
    **Files changed:**
    - src/module/file.js (added function Y)
    - src/module/other.js (updated function Z)
    
    **Documentation updated:**
    - src/module/CODE.md (added structure UserData)
    - .neolit/docs/container/component.md (updated workflow section)
    
    **Implementation notes:**
    - Used existing pattern from component X
    - Added validation as per constraints in CODE.md
    - All edge cases handled
```

### Update Documentation

**MUST update in SAME commit:**

1. **If added/changed data structures or functions:**
   - Update `CODE.md` with exact signatures and types
   
2. **If changed design patterns or architecture:**
   - Update architecture docs in `.neolit/docs/`
   
3. **If added new workflows:**
   - Update `.neolit/docs/workflows.md`

**Violation:** Code changes without documentation updates → REJECTED

---

## Validation Checklist (MANDATORY)

Before marking task WAITING:

### Documentation Verification
- [ ] All task-related documentation existed before starting
- [ ] Documentation gaps filled before implementation
- [ ] CODE.md updated with any new structures/functions
- [ ] Architecture docs updated if design changed
- [ ] Agent notes added to TODO.org

### Implementation
- [ ] All data structures match CODE.md exactly
- [ ] All field names/types are correct
- [ ] All constraints are honored
- [ ] Feature is complete (no placeholders)
- [ ] Error handling implemented
- [ ] Changes are minimal (only what task requires)
- [ ] No unrelated code modified
