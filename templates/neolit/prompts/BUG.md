# Bug Fix

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
- [ ] Contains data structures related to bug?
- [ ] Documents constraints that might be violated?
- [ ] Has function signatures for affected functions?

**If ANY checkbox unchecked:**
- **STOP. Update CODE.md following DOCUMENT_MODULE.md guide**
- Document missing structures, signatures, constraints
- **Then return to this workflow**

**Violation:** Starting bug fix without complete documentation → REJECTED

---

## Phase 1: Context Assembly (MANDATORY)

**Documentation now exists and is complete. Read it:**

**MUST execute in this order:**

1. **MUST** read module `CODE.md`
   - Understand affected data structures
   - Note constraints and invariants
   - Identify patterns that must be preserved

2. **MUST** read `.neolit/system.md`
   - Understand system context
   - Identify impact scope (single module vs. cross-module)

3. **MUST** check related architecture docs
   - Check ADRs for relevant decisions
   - Check workflows if bug affects flow

## Phase 2: Root Cause Analysis (MANDATORY)

**MUST identify root cause:**

1. **Reproduce the bug:**
   - **MUST** verify bug exists as described
   - **MUST** identify exact conditions triggering it

2. **Trace through code:**
   - **MUST** find exact location of failure
   - **MUST** understand why it fails
   - **MUST** verify against data structures in CODE.md

3. **Assess impact:**
   - Single function? Module? Multiple modules?
   - Data integrity affected?
   - API contract affected?

## Phase 3: Fix Implementation (MANDATORY)

**MUST follow these rules:**

1. **Minimal fix:**
   - **MUST** change ONLY what's needed to fix bug
   - **MUST NOT** refactor unrelated code
   - **MUST NOT** fix unrelated bugs

2. **Data integrity:**
   - **MUST** preserve all data structure constraints
   - **MUST** maintain all documented invariants
   - **MUST NOT** change data structures unless bug requires it

3. **Pattern preservation:**
   - **MUST** match existing patterns
   - **MUST** maintain API compatibility unless bug is in API
   - **MUST** preserve existing behavior except buggy behavior

## Phase 4: Documentation Update (MANDATORY)

**MUST update in SAME commit:**

1. **Update CODE.md IF:**
   - Fix changed documented behavior
   - Fix exposed incorrect documentation
   - Data structures or constraints changed

2. **Create ADR IF:**
   - Fix requires architectural change
   - Fix changes API contract
   - Fix affects multiple modules
   - **MUST** get human approval before implementing architectural changes

3. **Update `.neolit/` docs IF:**
   - Fix changes design patterns
   - Fix changes workflows
   - Fix changes component architecture

## Phase 5: Document Changes (MANDATORY)

**After fix, document what changed:**

### In Task File (TODO.org)

```org
*** Agent Notes
    [YYYY-MM-DD] Fixed bug: user login timeout
    
    **Root cause:**
    Session timeout not being refreshed on activity
    
    **Files changed:**
    - src/session/manager.js (fixed refresh logic, line 45)
    
    **Documentation updated:**
    - src/session/CODE.md (clarified MUST refresh constraint)
    
    **Fix notes:**
    - Minimal change to refresh logic only
    - No other session code touched
    - Verified: timeout now refreshes correctly
```

### Update Documentation

**MUST update in SAME commit:**

1. **If bug exposed unclear documentation:**
   - Clarify constraints in `CODE.md`
   
2. **If fix changed documented behavior:**
   - Update `CODE.md` with correct behavior
   
3. **If fix required architectural change:**
   - Create ADR in `.neolit/docs/adr/`
   - Update architecture docs

**Violation:** Bug fix without documentation updates → REJECTED

---

## Validation Checklist (MANDATORY)

Before marking task WAITING:

### Documentation Verification
- [ ] All task-related documentation existed before starting
- [ ] Documentation gaps filled before fixing
- [ ] CODE.md updated if bug exposed unclear docs
- [ ] Agent notes added to TODO.org with root cause

### Fix Implementation
- [ ] Bug is actually fixed (verified)
- [ ] Root cause identified and addressed
- [ ] Fix is minimal (no extra changes)
- [ ] All data structures still match CODE.md
- [ ] All constraints still honored
- [ ] No API breakage (unless bug was in API)
- [ ] ADR created if architectural change needed
- [ ] Architecture docs updated if needed
- [ ] No unrelated code modified
