# Neolit Documentation Standard

**Purpose:** Define strict, simple, robust documentation rules for AI-driven development.

**Goal:** Enable coding agents to achieve COMPLETE understanding of system data structures, workflows, and code relationships through super-simple, super-straight context assembly.

---

## Glossary

### Documentation Types

**CODE.md**
- Location: Source code directories (alongside implementation)
- Purpose: Exact implementation details
- Content: Data structures (exact types, fields, constraints), function signatures, implementation patterns, MUST/SHOULD/MAY rules
- Max size: 100 lines
- Audience: Coding agents needing precise implementation details

**Architecture Docs** (`.neolit/docs/`)
- Location: `.neolit/docs/` directory tree
- Purpose: System design and architecture
- Content: Component design, patterns rationale, workflows, high-level data flow
- Types: system.md, container.md, component docs, workflows.md
- Max size: 300 lines per file
- Audience: Humans and agents understanding system design

**ADR** (Architecture Decision Record)
- Location: `.neolit/docs/adr/`
- Purpose: Document architectural decisions and rationale
- Content: Context, decision, consequences, alternatives considered
- Immutable: Once written, never modified (create new ADR to supersede)

**TODO.org**
- Location: Root and module directories
- Purpose: Task tracking in org-mode format
- Content: Tasks with status, priority, tags, dates
- Types: TODO.org (active), TODO.org_archive (completed/cancelled)

---

## Documentation Principles

### 1. Two-Level Documentation (MANDATORY)

**Architecture level** (`.neolit/docs/`)
- **WHAT:** System design, component relationships, workflows
- **WHY:** Design rationale, architectural decisions
- **HOW:** Design patterns, interaction patterns
- **SCOPE:** Cross-module concerns, system-wide patterns

**Implementation level** (`CODE.md` in source)
- **WHAT EXACTLY:** Precise data structures, function signatures
- **CONSTRAINTS:** Exact rules (MUST/MUST NOT/SHOULD)
- **PATTERNS:** Module-specific implementation patterns
- **SCOPE:** Single module or component

**MUST NOT mix levels:** Architecture stays in `.neolit/docs/`, exact details stay in `CODE.md`

### 2. Tree-Like Navigation (MANDATORY)

Every document MUST be reachable from `.neolit/docs/system.md`:

```
system.md (root)
├→ container.md (architecture)
│  ├→ component.md (design)
│  │  └→ CODE.md (exact implementation)
│  └→ component.md (design)
│     └→ CODE.md (exact implementation)
├→ workflows.md (cross-module flows)
└→ adr/ (decisions)
```

**Rules:**
- MUST start from system.md
- MUST provide links down (parent → child)
- MUST provide links up (child → parent)
- MUST provide links across (sibling → sibling when related)
- MUST NOT create orphaned documents

### 3. Minimal, Focused Files (MANDATORY)

**Size limits (STRICT):**
- `system.md`: MAX 100 lines
- `container.md`: MAX 100 lines
- `component.md`: MAX 300 lines
- `CODE.md`: MAX 100 lines
- `workflows.md`: MAX 300 lines

**If exceeds limit:** MUST split into focused sub-documents

**Focus rule:** Each document covers ONE concern at ONE level

### 4. Exact Implementation Details (MANDATORY)

`CODE.md` files MUST contain:

**Data structures:**
```typescript
// MUST include exact types
interface DataStructure {
  field1: string;        // MUST include description
  field2: number;        // MUST document constraints
  field3?: boolean;      // MUST mark optional fields
}
```

**Function signatures:**
```typescript
// MUST include exact signature
function process(
  param1: Type1,    // MUST describe parameter
  param2: Type2     // MUST document constraints
): ReturnType;      // MUST describe return value
```

**Constraints:**
- **MUST:** Mandatory requirements (violations break system)
- **MUST NOT:** Forbidden actions (violations break system)
- **SHOULD:** Strong recommendations (follow unless good reason)
- **MAY:** Optional approaches

### 5. Links Over Duplication (MANDATORY)

**MUST NOT duplicate information between files**

Instead of copying:
```markdown
❌ BAD:
Component doc: "UserData has fields: id, name, email..."
CODE.md: "UserData has fields: id, name, email..."
```

Link instead:
```markdown
✅ GOOD:
Component doc: "See [UserData structure](../../src/user/CODE.md#userdata)"
CODE.md: 
### UserData
\`\`\`typescript
interface UserData {
  id: string;
  name: string;
  email: string;
}
\`\`\`
```

---

## Data Structures

### Documentation-First Workflow

**Agent receives task → Must follow this order:**

```
PHASE 0: VERIFY DOCUMENTATION EXISTS (MANDATORY FIRST)
├→ Check: Does .neolit/docs/system.md exist?
│  └→ NO → STOP, create using ANALYZE_PROJECT.md
├→ Check: Does module CODE.md exist?
│  └→ NO → STOP, create using DOCUMENT_MODULE.md
├→ Check: Is CODE.md complete for this task?
│  └→ NO → STOP, complete CODE.md first
└→ Check: Architecture docs needed? (complex module)
   └→ MISSING → STOP, create using DOCUMENT_MODULE.md

PHASE 1: READ DOCUMENTATION (only after Phase 0 complete)
├→ READ .neolit/docs/system.md
│  ├→ Understand: System architecture
│  ├→ Identify: Which container involved
│  └→ Map: High-level data flow
├→ READ module CODE.md
│  ├→ Extract: ALL data structures (exact types)
│  ├→ Note: ALL function signatures
│  ├→ Identify: Constraints (MUST/MUST NOT/SHOULD)
│  └→ Map: Implementation-specific workflow
├→ READ related architecture docs
│  ├→ Container design patterns
│  ├→ Related ADRs
│  └→ Workflows involving this module
└→ VERIFY understanding
   ├→ Can draw data flow?
   ├→ Know all structures involved?
   ├→ Understand task's place in system tree?
   └→ IF NO → STOP and ask

PHASE 2: IMPLEMENT (only after Phase 1 complete)
└→ Follow exact structures from CODE.md

PHASE 3: DOCUMENT CHANGES (same commit as code)
├→ Update CODE.md if structures/functions changed
├→ Update architecture docs if design changed
└→ Add agent notes to TODO.org
```

### File Organization

```
project/
├── .neolit/
│   ├── docs/
│   │   ├── system.md              # Entry point (MANDATORY)
│   │   ├── workflows.md           # Cross-module workflows
│   │   ├── container/
│   │   │   ├── container.md       # Container overview
│   │   │   └── components/
│   │   │       └── component.md   # Component architecture
│   │   └── adr/
│   │       └── NNNN-title.md      # ADRs
│   └── prompts/
│       ├── BASE.md                # Entry for agents
│       ├── FEATURE.md             # Feature workflow
│       └── BUG.md                 # Bug fix workflow
├── src/
│   ├── CODE.md                    # Root implementation details
│   └── module/
│       ├── CODE.md                # Module implementation details
│       ├── TODO.org               # Module tasks
│       └── implementation.js
├── TODO.org                       # Root tasks
└── TODO.org_archive               # Completed tasks
```

### Task Structure (org-mode)

```org
* STATUS [#PRIORITY] Description :tag1:tag2:
  <YYYY-MM-DD>
  
  Task details and context.
  
*** Agent Notes
    [YYYY-MM-DD] Progress notes
    Changed: file1.js, file2.js
    Updated: CODE.md
    
*** Agent Subtasks
    - [X] Completed step
    - [ ] Remaining step
```

**Statuses:**
- `TODO`: Ready to work on
- `INBOX`: Not ready yet
- `BACKLOG`: Low priority
- `PROGRESS`: Currently working
- `WAITING`: Done, needs human review
- `DONE`: Approved and closed

---

## Mandatory Rules for Coding Agents

### Rule 0: Documentation-First (MANDATORY - BEFORE EVERYTHING)

**Before reading ANY documentation, verify it exists:**

1. **MUST** check `.neolit/docs/system.md` exists
   - If missing → **STOP, create using ANALYZE_PROJECT.md**
   
2. **MUST** check task module `CODE.md` exists
   - If missing → **STOP, create using DOCUMENT_MODULE.md**
   
3. **MUST** verify `CODE.md` contains task-related structures
   - If incomplete → **STOP, complete CODE.md using DOCUMENT_MODULE.md**
   
4. **MUST** check architecture docs exist (if complex module)
   - If missing → **STOP, create using DOCUMENT_MODULE.md**

**ONLY AFTER all documentation exists → proceed to read and implement**

**Violation:** Starting task without verifying/creating documentation → REJECTED

### Rule 1: Context Assembly (MANDATORY)

**After documentation exists, read it:**

1. **MUST** read `.neolit/docs/system.md` FIRST
2. **MUST** read task module `CODE.md`
3. **MUST** extract ALL data structures involved
4. **MUST** trace complete data flow
5. **MUST** verify understanding of task's place in system

**Violation:** Changes made without complete context → REJECTED

### Rule 2: Data Structure Integrity (MANDATORY)

1. **MUST** follow existing data structures EXACTLY
2. **MUST** match field names CHARACTER-FOR-CHARACTER
3. **MUST** respect types PRECISELY
4. **MUST** honor ALL constraints documented
5. **MUST NOT** modify structures without explicit task requirement

**Violation:** Any deviation from documented structures → REJECTED

### Rule 3: Pattern Adherence (MANDATORY)

1. **MUST** match existing naming conventions EXACTLY
2. **MUST** use established patterns from architecture docs
3. **MUST** preserve existing APIs unless task requires change
4. **MUST** follow workflows documented in workflows.md

**Violation:** Pattern violations or API breakage → REJECTED

### Rule 4: Documentation Synchronization (MANDATORY)

1. **MUST** update `CODE.md` when changing implementation
2. **MUST** update architecture docs when changing design
3. **MUST** include documentation in SAME commit as code
4. **MUST** add agent notes to TODO.org documenting changes
5. **MUST** maintain accuracy between code and docs

**Agent notes format:**
```org
*** Agent Notes
    [YYYY-MM-DD] Task description
    
    Files changed: file1.js, file2.js
    Documentation updated: CODE.md, architecture.md
    Implementation notes: key decisions made
```

**Violation:** Code changes without documentation updates → REJECTED

### Rule 5: Completeness (MANDATORY)

1. **MUST** complete task FULLY before moving to next
2. **MUST NOT** leave placeholders, TODOs, or comments for "later"
3. **MUST** implement error handling
4. **MUST** handle edge cases
5. **MUST** move to WAITING status (not DONE) after completion

**Violation:** Incomplete implementation → REJECTED

### Rule 6: Minimal Changes (MANDATORY)

1. **MUST** change ONLY what task requires
2. **MUST NOT** refactor unrelated code
3. **MUST NOT** fix unrelated bugs
4. **MUST** preserve all working functionality

**Violation:** Unnecessary changes to unrelated code → REJECTED

---

## Validation Checklist

**Every task completion MUST pass:**

### Phase 0: Documentation Verification (FIRST)
- [ ] Verified system.md exists (created if missing)
- [ ] Verified module CODE.md exists (created if missing)
- [ ] Verified CODE.md complete for task (completed if missing)
- [ ] Verified architecture docs exist if needed (created if missing)

### Phase 1: Context Assembly
- [ ] Read system.md before starting
- [ ] Read module CODE.md
- [ ] Identified all data structures involved
- [ ] Traced complete data flow
- [ ] Understand task's place in system tree

### Implementation
- [ ] All data structures match CODE.md exactly
- [ ] All field names and types are correct
- [ ] All constraints honored (MUST/MUST NOT/SHOULD)
- [ ] Existing patterns followed
- [ ] No unrelated code modified
- [ ] Feature complete (no placeholders)
- [ ] Error handling implemented
- [ ] Edge cases handled

### Phase 3: Documentation
- [ ] CODE.md updated (if implementation changed)
- [ ] Architecture docs updated (if design changed)
- [ ] Documentation in same commit as code
- [ ] All links valid
- [ ] No information duplicated

### Phase 4: Task Management
- [ ] Task status updated to WAITING
- [ ] Agent notes added to TODO.org
- [ ] Agent notes include: files changed, docs updated, implementation notes
- [ ] Questions for human noted (if any)

---

## Examples

### Example: Feature Implementation

**Task:** Add user authentication

**Context assembly:**
1. Read `system.md` → Identify: auth flows through API container
2. Read `src/auth/CODE.md` → Extract: User structure, auth functions
3. Read `docs/api/components/auth.md` → Understand: Design patterns
4. Read `docs/workflows.md` → Map: Login/logout workflow

**Implementation:**
```typescript
// In src/auth/CODE.md - MUST document exactly:
interface User {
  id: string;           // UUID v4, MUST be unique
  email: string;        // MUST be valid email format
  passwordHash: string; // MUST use bcrypt, MUST NOT store plain text
  createdAt: Date;      // MUST be set on creation
}

function authenticate(
  email: string,    // MUST be non-empty, MUST be valid email
  password: string  // MUST be non-empty
): Promise<User | null>;  // Returns User if valid, null if invalid

// MUST validate email format before calling
// MUST hash password before comparing
// MUST NOT log password or hash
```

**Documentation update:**
- Update `src/auth/CODE.md`: Add User structure, authenticate signature
- Update `docs/api/components/auth.md`: Add authentication flow design
- Update `docs/workflows.md`: Document login workflow

### Example: Bug Fix

**Task:** Fix user login timeout

**Context assembly:**
1. Read `system.md` → Session management in API container
2. Read `src/session/CODE.md` → Session structure, timeout constraints
3. Identify bug: Timeout not being refreshed on activity

**Minimal fix:**
```typescript
// In src/session/CODE.md - existing structure:
interface Session {
  id: string;
  userId: string;
  expiresAt: Date;  // MUST refresh on each request
  lastActivity: Date;
}

// Fix only the timeout refresh logic
// DO NOT refactor other session code
// DO NOT change Session structure
```

**Documentation update:**
- Update `src/session/CODE.md`: Clarify "MUST refresh on each request"
- No architecture changes needed

---

## Anti-Patterns

### ❌ Violations That Lead to Rejection

1. **Missing context assembly**
   - Starting code without reading system.md
   - Not checking CODE.md for data structures
   - Guessing instead of reading documentation

2. **Data structure violations**
   - Adding/removing fields without task requirement
   - Changing types from documented
   - Ignoring constraints

3. **Incomplete implementation**
   - Leaving TODOs or placeholders
   - Missing error handling
   - Ignoring edge cases

4. **Documentation drift**
   - Code changes without doc updates
   - Documentation in separate commit
   - Duplicating information across files

5. **Scope creep**
   - Refactoring unrelated code
   - Fixing unrelated bugs
   - Changing working functionality not in task

6. **Pattern violations**
   - Using different naming conventions
   - Breaking existing APIs
   - Ignoring established patterns

---

## Quick Reference

**File sizes (STRICT):**
- system.md: 100 lines max
- container.md: 100 lines max
- component.md: 300 lines max
- CODE.md: 100 lines max

**Context assembly (MANDATORY order):**
1. system.md → 2. CODE.md → 3. architecture docs → 4. verify

**Documentation levels:**
- Architecture/design → `.neolit/docs/`
- Exact implementation → `CODE.md` in source

**Constraint keywords:**
- MUST: Mandatory (violation breaks system)
- MUST NOT: Forbidden (violation breaks system)
- SHOULD: Strong recommendation
- MAY: Optional

**Task statuses:**
- TODO → PROGRESS → WAITING → DONE
- Use WAITING for review (not DONE)

**Files tracked:**
- TODO.org: Active tasks
- TODO.org_archive: Completed/cancelled tasks
