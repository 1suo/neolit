# Analyze Project for Neolit Integration

**Goal:** Document existing project to enable AI-driven development.

**Type:** Project-wide analysis workflow (top-level orchestration)

**Documentation principle:** 
- **Architecture & Design** → `.neolit/docs/` (system overview, design patterns, workflows)
- **Code & Implementation** → `CODE.md` files in source (exact structures, signatures, constraints)

---

## Critical Rules

1. **Ignore dependencies:** node_modules, .git, dist, build, vendor, target
2. **Document ONLY what exists** - no guessing, no assumptions
3. **Extract from actual code** - trace through real files
4. **Modular structure** - focused docs with cross-links, NOT monolithic files
5. **Match codebase names** - directory names in docs match actual code structure

---

## Workflow: 4 Phases

Execute phases sequentially. DO NOT skip ahead.

---

### Phase 1: Analyze Structure (Read-Only)

**Goal:** Understand what exists without creating any files yet.

**Actions:**
```bash
# Explore codebase (exclude dependencies)
ls -la
find . -type d -name "src" -o -name "server" -o -name "client" | head -20
find . -name "package.json" -o -name "*.config.*" | head -10

# Identify patterns
grep -r "export.*function\|export.*class" --include="*.js" --include="*.ts" | head -20
```

**Output:** Mental model of:
- Containers (deployable units): frontend? backend? database?
- Major modules per container
- Technology stack
- Entry points

**Do NOT create files yet. Just understand the structure.**

---

### Phase 2: Plan Structure (Output for Verification)

**Goal:** Design documentation structure matching codebase.

**Output plan in this format:**
```
DOCUMENTATION STRUCTURE PLAN:

neolit/docs/
├── system.md (~150 lines) - Overview with links
├── workflows.md (~300 lines) - Key flows
├── {container1_actual_name}/          # Match actual directory name
│   ├── container.md (~80 lines)
│   └── components/
│       ├── {component1}.md (~250 lines) - Architecture/design
│       ├── {component2}.md (~250 lines) - Architecture/design
│       └── {component3}.md (~250 lines) - Architecture/design
├── {container2_actual_name}/          # Match actual directory name
│   ├── container.md (~80 lines)
│   └── components/
│       ├── {component1}.md (~250 lines) - Architecture/design
│       └── {component2}.md (~250 lines) - Architecture/design
└── adr/
    ├── 0001-{decision}.md
    └── 0002-{decision}.md

Source Code (exact implementation details):
├── {container1}/src/CODE.md → exact structures, entry point
├── {container1}/src/{module}/CODE.md → exact module details
├── {container2}/{module}/CODE.md → exact module details

NO VISION.org needed - root TODO.org is sufficient

EXAMPLE (do not use numbers like 1-web-app):
If codebase has /client and /server:
  → neolit/docs/client/ (NOT 1-web-app)
  → neolit/docs/server/ (NOT 2-api-server)
  → client/src/CODE.md (exact implementation)
  → server/src/CODE.md (exact implementation)
```

---

### Phase 3: Create Structure (Directories + Empty Files)

**Goal:** Create directory tree and empty markdown files with headers only.

**Actions:**
```bash
# Create directories
mkdir -p neolit/docs/{container}/components

# Create empty files with headers
cat > neolit/docs/system.md << 'HEADER'
# System Architecture

## Containers

## Data Flow

## Related
HEADER

cat > neolit/docs/{container}/container.md << 'HEADER'
# {Container} Container

## Purpose

## Components

## Technology Stack

## Interfaces

## Related
HEADER
```

**Output:**
```
Created structure:
✓ neolit/docs/system.md
✓ neolit/docs/{container}/container.md
✓ neolit/docs/{container}/components/{name}.md (x4)
```

---

### Phase 4: Fill Content (Module by Module)

**Goal:** Document each module using atomic guide.

**For EACH module, follow prompt from this file:** [DOCUMENT_MODULE.md](./DOCUMENT_MODULE.md)

**Order:**
1. Fill `system.md` (overview, links to containers)
2. Fill `workflows.md` (2-3 key flows)
3. For each container:
   - Fill `container.md`
   - For each component in container:
     - Follow DOCUMENT_MODULE.md guide
     - Check: file < 300 lines
     - Check: cross-links added
     - Check: source CONTEXT.md created (brief)

**Checkpoint after each module:**
- [ ] Component doc < 300 lines
- [ ] Cross-links to related docs
- [ ] Source CONTEXT.md links to neolit/docs
- [ ] All references use correct paths

---

## Phase 5: Verify Navigation

**Goal:** Ensure all docs are discoverable and linked.

**Test paths:**
```
Start: system.md
  → {container}/container.md
    → components/{name}.md (architecture)
      → CODE.md (exact implementation)
      → related component docs
      → ADRs
      → workflows
      
Test: Can you reach EVERY doc from system.md?
Test: Are all cross-links valid?
Test: Do CODE.md files have exact details?
Test: Do architecture docs link to CODE.md?
```

**If any doc is unreachable or has broken links: FIX before completing.**

---

## Common Mistakes to Avoid

❌ **Creating monolithic files** (500+ lines)
✅ Create focused, linked files (< 300 lines)

❌ **Using abstract names** (1-web-app, api-server)
✅ Use actual codebase names (client, server)

❌ **Putting everything in CODE.md**
✅ Architecture in neolit/docs, exact details in CODE.md

❌ **Vague CODE.md without exact types**
✅ Exact data structures, signatures, constraints in CODE.md

❌ **Putting everything in source CODE.md**
✅ Architecture in neolit/docs, exact details in CODE.md

❌ **Vague CODE.md without exact types**
✅ Exact data structures, signatures, constraints in CODE.md

❌ **Writing docs before planning structure**
✅ Plan → Create structure → Fill content

❌ **Skipping cross-links**
✅ Add links to related docs as you write

---

## Output Checklist

After all phases complete:

- [ ] `neolit/docs/system.md` exists (< 100 lines, links to containers)
- [ ] Container directories match actual codebase names
- [ ] Each container has `container.md` (< 100 lines)
- [ ] Component docs exist (< 300 lines each, architecture/design)
- [ ] CODE.md files exist in source (< 100 lines, exact implementation)
- [ ] All docs have cross-links to related docs
- [ ] CODE.md files have exact data structures and signatures
- [ ] Architecture docs link to CODE.md
- [ ] CODE.md links to architecture docs
- [ ] Navigation works: system.md → containers → components → CODE.md
- [ ] ADRs created for key decisions
- [ ] 2-3 workflows documented
- [ ] NO VISION.org created (root TODO.org is sufficient)
- [ ] NO hallucinated features

---

## For Re-Running on Existing Project

If documentation already exists but needs updates:

1. **Check current structure:**
   ```bash
   ls neolit/docs/
   ```

2. **Identify gaps:**
   - Missing containers?
   - Missing components?
   - Monolithic files to split?

3. **Use DOCUMENT_MODULE.md to fill gaps:**
   - Document new modules
   - Split oversized files
   - Add missing cross-links

4. **Verify navigation still works**

---

## See Also

- **[DOCUMENT_MODULE.md](./DOCUMENT_MODULE.md)** - Atomic guide for documenting individual modules
- **[BASE.md](./BASE.md)** - General guidelines for AI agents working on this project
