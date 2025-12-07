# Document Module Guide

**Purpose:** Atomic guide for documenting a single module/component.

**Documentation principle:** 
- **Architecture & Design** → `.neolit/docs/` (WHY and HOW at system level)
- **Code & Implementation** → `CODE.md` in source (WHAT exactly in code)

**When to use:**
- During initial project analysis (called by ANALYZE_PROJECT.md)
- When adding new modules to existing project
- When splitting oversized documentation files
- When documenting previously missed modules

---

## Input Requirements

Before starting, you must know:
- **Module name:** What is this module called?
- **Module location:** Where is the source code? (e.g., `client/src/store`, `server/api`)
- **Module purpose:** What does it do? (1-2 sentences)
- **Container:** Which container does it belong to? (e.g., `client`, `server`)

---

## Step 1: Identify Module Scope

**Find key files:**
```bash
# List files in module directory
ls -la {module_path}

# Find entry points
grep -l "export\|module.exports" {module_path}/*.{js,ts}

# Find dependencies
grep -r "import.*from\|require(" {module_path} | head -20
```

**Determine scope:**
- What files are CORE to this module?
- What patterns/classes/functions are central?
- What other modules does it depend on?
- What data/schemas does it use?

**Output:**
```
Module: {name}
Core files: file1.js, file2.js, file3.js
Key exports: ClassName, functionName, constant
Dependencies: moduleA, moduleB
Schemas: EntityX, EntityY
```

---

## Step 2: Choose Documentation Location

**Decision tree:**

Is this module complex enough for neolit/docs?
- Multiple files (3+)
- Multiple concerns
- Complex architecture
- Reused by other modules

→ **YES:** Create `neolit/docs/{container}/components/{module}.md` (architecture/design)
           AND `{module_path}/CODE.md` (exact code details)
→ **NO:** Document in source `{module_path}/CODE.md` only

**Most modules need BOTH: architecture doc for design, CODE.md for exact implementation.**

---

## Step 3: Create Component Documentation

**Location:** `neolit/docs/{container}/components/{module}.md`

**Purpose:** Architecture and design explanation (WHY and HOW at system level)

**Template (MAX 300 LINES):**

```markdown
# {Module Name}

**Location:** `{actual_source_path}`

## Purpose

1-2 sentences: What this module does and why it exists.

## Key Files

- **file1.js** - Brief description (1 line)
- **file2.js** - Brief description (1 line)
- **file3.js** - Brief description (1 line)

## Architecture

### Main Components

**ComponentA** (from file1.js:42)
- Responsibility: ...
- Design pattern: ...
- Used by: X, Y

**ComponentB** (from file2.js:15)
- Responsibility: ...
- Design pattern: ...

**For exact signatures, types, constraints → See CODE.md**

### Data Flow

```
Input → ComponentA → process() → ComponentB → Output
```

Or describe key operations:
```
User action
  ↓
Handler (file1.js:30)
  ↓
Service call (file2.js:50)
  ↓
Database (via dbService)
  ↓
Response
```

## Key Concepts

Explain 2-3 important design patterns/concepts:

### Concept 1: {Name}

Design rationale and pattern explanation.

**For exact implementation → See CODE.md**

### Concept 2: {Name}

...

## Interface Overview

High-level interface description:
- What functionality this module provides
- How other modules interact with it
- Key interaction patterns

**For exact function signatures, parameters, types → See CODE.md**

## Constraints

Design constraints and architectural rules:

**MUST:**
- Architectural constraint (why it exists)
- Design invariant (rationale)

**SHOULD:**
- Preferred design pattern
- Recommended approach

**For exact implementation constraints → See CODE.md**

## Related

- [Related Component](./related.md) - How it relates
- [Container Overview](../container.md)
- [ADR-00X](../../adr/000X-decision.md) - If relevant
- [Workflow](../../workflows.md#specific-flow) - If module used in workflow
- **[CODE.md](../../../{source_path}/CODE.md)** - Exact implementation details
```

**Rules:**
- Focus on architecture and design (WHY and HOW)
- Explain patterns and rationale
- Link to CODE.md for exact details
- Include code references (file:line) for context
- MAX 300 lines total

---

## Step 4: Create Source CODE.md

**Location:** `{module_source_path}/CODE.md`

**Purpose:** Exact code details (WHAT exactly - data structures, signatures, constraints)

**Template (MAX 100 LINES):**

```markdown
# {Module Name}

**Purpose:** 1-2 sentence summary

## Data Structures

### StructureName
```typescript
// Exact structure (file.js:42)
interface StructureName {
  field1: string;          // Description, constraints
  field2: number;          // Must be > 0
  field3?: boolean;        // Optional, default: false
  nested: {
    subfield: Type;        // Description
  };
}
```

### AnotherStructure
```typescript
// From file2.js:15
type AnotherStructure = {
  // Exact fields and types
}
```

## Functions / API

### functionName
```typescript
// From file.js:100
function functionName(
  param1: Type1,    // Description, constraints
  param2: Type2     // Description, constraints
): ReturnType;      // What it returns
```

**MUST:**
- Constraint 1 (e.g., param1 must not be empty)
- Constraint 2 (e.g., must validate before calling)

### anotherFunction
```typescript
// Signature with exact types
```

## Classes

### ClassName
```typescript
// From file.js:200
class ClassName {
  constructor(param: Type);
  
  method1(param: Type): ReturnType;
  method2(param: Type): ReturnType;
}
```

**Invariants:**
- Class invariant 1
- Class invariant 2

## Constants

```typescript
// From constants.js:10
const CONSTANT_NAME = value;  // What it represents, constraints
```

## Patterns

**Pattern 1:** How to use X
```typescript
// Example from actual code (file.js:300)
const example = pattern();
```

**Pattern 2:** How to handle Y
```typescript
// Example usage
```

## Constraints (MANDATORY)

**MUST:**
- Implementation constraint 1 (exact requirement)
- Implementation constraint 2 (exact requirement)
- Field/type constraint (exact format)

**MUST NOT:**
- What is forbidden (exact rule)

**SHOULD:**
- Recommended practice (rationale)

## Related

**Architecture:** [Component Architecture](../../neolit/docs/{container}/components/{module}.md)
**Related Modules:** [Module](../related/CODE.md)
**ADRs:** [ADR-00X](../../neolit/docs/adr/000X.md)
```

**Rules:**
- Exact data structures with types
- Exact function signatures
- Exact constraints (MUST/MUST NOT/SHOULD)
- Implementation-specific rules
- Links to architecture docs
- MAX 100 lines (if exceeds, split into sub-modules)

---

## Step 5: Add Cross-Links

Update related documents to link back to this module:

**1. Container doc:** Add to components list
```markdown
## Components

1. [Existing Component](./components/existing.md)
2. [New Component](./components/{module}.md) ← ADD THIS
```

**2. Related component docs:** Add to Related section
```markdown
## Related

- [{Module}](./{module}.md) - Brief relation
- **[{Module} CODE](../../../{source_path}/CODE.md)** - Implementation details
```

**3. Workflows:** If module used in workflow, add reference
```markdown
## {Workflow Name}

Step 3: Process data
- Handler: `server/api/handler.js:42`
- Uses: [{Module}](../server/components/{module}.md) ← ADD IF RELEVANT
- Details: [CODE.md](../../{source_path}/CODE.md)
```

---

## Step 6: Validate

**Checklist:**
- [ ] Component doc exists in `neolit/docs/{container}/components/{module}.md`
- [ ] Component doc is < 300 lines (architecture and design)
- [ ] CODE.md exists in `{source_path}/CODE.md`
- [ ] CODE.md is < 100 lines (exact implementation details)
- [ ] Component doc links to CODE.md
- [ ] CODE.md links to architecture docs
- [ ] Container doc lists this component
- [ ] Cross-links added to related components
- [ ] All file:line references are accurate
- [ ] No broken links
- [ ] Navigation works: container → component → CODE.md

**Test navigation:**
```
Can you reach this doc from system.md?
  system.md → container.md → {module}.md → CODE.md ✓

Can you reach related docs from here?
  {module}.md → related.md ✓
  CODE.md → architecture.md ✓
```

---

## Examples

### Example 1: Simple Module (CODE.md Only)

**Module:** Utility functions (`server/utils/`)
- Only 2 files
- Helper functions
- No complex architecture

**Action:** Create `server/utils/CODE.md` (exact signatures and types)
**Skip:** neolit/docs component (too simple, no architecture to explain)

### Example 2: Complex Module (Full Documentation)

**Module:** State management (`client/src/store/`)
- Multiple files (5+)
- XState machines
- Central to application

**Action:**
1. Create `neolit/docs/client/components/state.md` (250 lines - architecture, design patterns, WHY)
2. Create `client/src/store/CODE.md` (80 lines - exact data structures, signatures, constraints)
3. Update `neolit/docs/client/container.md` (add to component list)
4. Add cross-links from ui-application.md, 3d-engine.md

---

## File Size Guidelines

**neolit/docs component doc (architecture/design):**
- Target: 200-250 lines
- Maximum: 300 lines
- If exceeds 300: Split into sub-components

**Source CODE.md (implementation details):**
- Target: 60-80 lines
- Maximum: 100 lines
- If exceeds 100: Split into sub-modules or focus on essentials

**Container doc:**
- Target: 60-80 lines
- Maximum: 100 lines

**system.md:**
- Target: 40-50 lines
- Maximum: 100 lines

---

## Common Patterns

### Pattern 1: Module with Sub-modules

If module has clear sub-modules, create separate docs:

```
neolit/docs/client/components/
├── state.md (overview, architecture, links to sub-modules)
├── state-machines.md (XState machines design)
└── state-auth.md (Authentication state design)

client/src/store/
├── CODE.md (main structures and patterns)
├── machines/CODE.md (machine implementations)
└── auth/CODE.md (auth state details)
```

Each < limits, well cross-linked.

### Pattern 2: Module Using External Libraries

Document HOW you use the library in architecture doc, WHAT exactly in CODE.md:

**In neolit/docs (architecture):**
```markdown
## Three.js Integration

This module uses Three.js for 3D rendering.

**Design approach:**
- BufferGeometry pattern for performance
- Factory pattern for renderer initialization
- See [Three.js docs](https://threejs.org) for library details
```

**In CODE.md:**
```markdown
## Three.js Structures

### SceneConfig
\`\`\`typescript
interface SceneConfig {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  // Exact structure
}
\`\`\`
```

### Pattern 3: Module with State Machine

**In neolit/docs (design):**
```markdown
## State Machine Design

**Architecture:** Event-driven state transitions
**Pattern:** XState state machine

States and transitions:
\`\`\`
idle → SETUP → loading → FETCH_SUCCESS → playing
playing → PAUSE → paused → PLAY → playing
\`\`\`

Design rationale: Ensures valid state transitions, prevents race conditions
```

**In CODE.md (exact implementation):**
```markdown
## State Machine

### States
\`\`\`typescript
type PlayerState = 'idle' | 'loading' | 'playing' | 'paused';
\`\`\`

### Events
\`\`\`typescript
type PlayerEvent = 
  | { type: 'SETUP' }
  | { type: 'FETCH_SUCCESS', data: VideoData }
  | { type: 'PLAY' }
  | { type: 'PAUSE' };
\`\`\`

**MUST:** Validate event type before processing
**MUST NOT:** Skip state validation
```

---

## Anti-Patterns to Avoid

❌ **Documenting library details**
✅ Document how YOU use the library (design in neolit/docs, exact usage in CODE.md)

❌ **Mixing architecture and implementation**
✅ Architecture/design in neolit/docs, exact code in CODE.md

❌ **Copying code into docs**
✅ Reference file:line, explain logic, document exact structures in CODE.md

❌ **Huge component docs (500+ lines)**
✅ Split into focused sub-components

❌ **Huge CODE.md (200+ lines)**
✅ Split into sub-modules or focus on essentials

❌ **Vague CODE.md without exact types**
✅ Exact data structures, signatures, constraints

❌ **Orphaned docs (no links to/from)**
✅ Always add cross-links both ways

---

## Quick Reference

**When to create neolit/docs + CODE.md:**
- Complex modules (3+ files, multiple concerns)
- Has architecture/design to explain
- Reusable components
- Architectural significance

**When to use CODE.md only:**
- Simple utilities (1-2 files)
- No architecture to explain
- Self-contained functionality
- Just need exact signatures/types

**When to split into sub-components:**
- Architecture doc exceeds 300 lines
- CODE.md exceeds 100 lines
- Clear sub-concerns exist
- Different aspects worth separate docs

**Cross-link checklist:**
- Container lists component ✓
- Component links to CODE.md ✓
- CODE.md links to architecture ✓
- Related docs link to each other ✓
- Workflows reference if used ✓
- ADRs referenced if relevant ✓

---

## See Also

- [ANALYZE_PROJECT.md](./ANALYZE_PROJECT.md) - Top-level project analysis workflow
- [BASE.md](./BASE.md) - General agent guidelines
