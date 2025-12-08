# Analyze Project for Neolit Integration

**Goal:** Document existing project with NEOLIT.md files.

---

## Prerequisites

**Read FIRST:**

1. **`neolit/standard/levels.md`** - Understand C4 levels and when to use
2. **`neolit/standard/templates/`** - See all templates (system, container, component, code)

---

## Critical Rules

1. Ignore: node_modules, .git, dist, build, vendor
2. Document ONLY what exists (no guessing)
3. Extract from actual code (trace through real files)
4. Match codebase structure (NEOLIT.md placement follows code)
5. Use C4 levels correctly (see `neolit/standard/levels.md`)

---

## Workflow: 5 Phases

### Phase 1: Analyze Structure (Read-Only)

```bash
ls -la
find . -type d -name "src" -o -name "api" -o -name "server" | head -20
find . -name "package.json" -o -name "*.config.*" | head -10
grep -r "export.*function\|export.*class" --include="*.js" --include="*.ts" | head -20
```

**Identify:**
- Separately deployable units (containers)?
- Functional components?
- Technology stack
- Entry points

**Key question:** Single deployable or multiple?

**Don't create files yet.**

---

### Phase 2: Plan Structure (Output for Verification)

**For single deployable:**
```
PLAN:
Root: NEOLIT.md (SYSTEM)
Components: src/auth/NEOLIT.md (COMPONENT)
            src/user/NEOLIT.md (COMPONENT)
Skip CONTAINER level (single deployable)
```

**For multi-deployable:**
```
PLAN:
Root: NEOLIT.md (SYSTEM)
Containers: api/NEOLIT.md (CONTAINER - deployable)
            worker/NEOLIT.md (CONTAINER - deployable)
Components: api/auth/NEOLIT.md (COMPONENT)
            api/user/NEOLIT.md (COMPONENT)
```

**See:** `neolit/standard/levels.md` for level usage criteria

---

### Phase 3: Create Structure (Empty Files)

Create NEOLIT.md with section headers from templates.

**Use:** `neolit/standard/templates/` for section structure

---

### Phase 4: Fill Content (Level by Level)

**Order:**
1. SYSTEM level (root NEOLIT.md)
2. CONTAINER level (if multi-deployable)
3. COMPONENT level (most detailed)
4. CODE level (if needed)

**For each level:**
- Use template from `neolit/standard/templates/`
- Extract from actual code
- Respect size limits
- Include all required sections

**Checkpoint after each level:**
- [ ] **Level:** marker correct
- [ ] Required sections present
- [ ] Size within limits
- [ ] Cross-links added

---

### Phase 5: Verify Navigation

**Test paths:**
- Can reach every NEOLIT.md from root?
- All cross-links valid?
- All **Level:** markers correct?
- CONTAINER used only for deployable units?

**Use:** `neolit/standard/validation.md` for complete checklist

---

## Common Mistakes

❌ src/ as CONTAINER → ✅ Skip CONTAINER for single deployable
❌ Missing **Level:** marker → ✅ Always include
❌ Wrong sections → ✅ Use neolit/standard/templates/
❌ Oversized files → ✅ Respect limits
❌ Hallucinated features → ✅ Document only what exists

---

## Output Checklist

- [ ] Root NEOLIT.md (SYSTEM, 60-100 lines)
- [ ] Container NEOLIT.md if multi-deployable (60-80 lines)
- [ ] Component NEOLIT.md for each component (100-200 lines)
- [ ] CODE level only where needed (30-80 lines)
- [ ] All have **Level:** marker
- [ ] All cross-linked
- [ ] Navigation works
- [ ] NO hallucinated features

---

**Templates:** `neolit/standard/templates/`
**Level guide:** `neolit/standard/levels.md`
**Validation:** `neolit/standard/validation.md`
**Document individual component:** `DOCUMENT_COMPONENT.md`
