# Document Component Guide

**Purpose:** Create NEOLIT.md at any level.

---

## Step 1: Determine Level

**Read:** `neolit/standard/levels.md` to understand when to use each level.

**Quick check:**
- Root directory → SYSTEM
- Separately deployable (api/, worker/) → CONTAINER (optional)
- Functional component (src/auth/) → COMPONENT (most common)
- Sub-component (src/auth/utils/) → CODE (optional, if 3+ files)

---

## Step 2: Identify Scope

```bash
ls -la {directory}
grep -l "export\|module.exports" {directory}/*.{js,ts}
grep -r "import.*from" {directory} | head -20
```

Determine:
- Core files
- Key functions/classes
- Dependencies
- Data structures

---

## Step 3: Choose Template

**Use template from:** `neolit/standard/templates/`

- `system.md` - For SYSTEM level (root)
- `container.md` - For CONTAINER level (deployable units only)
- `component.md` - For COMPONENT level (most detailed)
- `code.md` - For CODE level (sub-components only)

**Each template contains:**
- Required sections
- Size limits
- Complete example
- When to use

---

## Step 4: Create NEOLIT.md

Copy structure from chosen template, fill with actual content from code.

**Extract from code:**
- Function signatures (exact types)
- Data structures (exact fields with constraints)
- Patterns and conventions
- Design rationale

**DO NOT:**
- Hallucinate features
- Guess implementations
- Skip constraints

---

## Step 5: Add Cross-Links

Update related NEOLIT.md files:
- Parent level → add to components list
- Related components → add to Related section
- System workflows → add references if used

---

## Step 6: Validate

**Use:** `neolit/standard/validation.md`

Check:
- [ ] **Level:** marker correct
- [ ] Required sections present
- [ ] Size within limits
- [ ] All structures have exact types
- [ ] All functions have signatures
- [ ] Cross-links work
- [ ] Navigation from root works

---

**Complete templates:** `neolit/standard/templates/`
**Level guide:** `neolit/standard/levels.md`
**Validation:** `neolit/standard/validation.md`
