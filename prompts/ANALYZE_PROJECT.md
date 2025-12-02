# Analyze Project for Neolit Integration

**Goal:** Document existing project to enable AI-driven development.

---

## Step 1: Understand System Structure

**Create:** `.neolit/system.md` (MUST exist)

1. **Identify deployable units** (containers in C4):
   ```bash
   # Check structure
   ls -la
   tree -L 2 -I 'node_modules|.git|dist|build'
   ```

2. **Understand what exists:**
   - Separate frontend/backend? Monolith?
   - What databases/services?
   - External integrations?

3. **Document in `.neolit/system.md`:**
   - If clear separation exists: Present as C4 containers
     - Container 1: Web App (what it does, tech, interfaces)
     - Container 2: API Server (what it does, tech, interfaces)
     - Container 3: Database (what it stores)
   - If monolith: Document actual directory structure
   - Key: Show *interfaces* between parts (HTTP? GraphQL? SQL?)

**Example structure after analysis:**
```
.neolit/
├── system.md              # MUST - entry point
├── workflows.md           # Key user/data flows
├── 1-web-app/            # Optional - if frontend exists
│   └── components/
│       ├── pages.md
│       └── state.md
├── 2-api-server/         # Optional - if backend exists
│   └── components/
│       ├── controllers.md
│       ├── services.md
│       └── auth.md
└── 3-database/           # Optional - if complex data
    └── schemas.md
```

**Note:** Create only what's needed. Simple projects might only need `system.md` + `workflows.md`.

---

## Step 2: Map Data Schemas

**If project has complex data:** Create `.neolit/3-database/schemas.md`

1. **Find schema definitions:**
   - Check `models/`, `entities/`, `schema/` directories
   - Look at migrations
   - Check ORM/ODM files

2. **Extract:**
   - Entity names and attributes
   - Relationships (one-to-many, many-to-many)
   - Invariants (unique constraints, validations)
   - Keys and indexes

3. **Document in schemas.md:**
   ```markdown
   ## User
   - id: UUID (primary)
   - email: string (unique, required)
   - passwordHash: string (required)
   - createdAt: timestamp
   
   **Invariants:**
   - Email must be unique
   - Password must be hashed before storage
   
   **Relations:**
   - User has many Posts
   ```

**If simple data:** Document in `system.md` instead.

---

## Step 3: Document Key Workflows

**Create:** `.neolit/workflows.md`

1. **Identify 2-3 critical paths:**
   - User registration/login
   - Main feature (create post, checkout, etc)

2. **Trace through code:**
   - Entry point (route/page)
   - What functions/services called
   - Data accessed
   - Response

3. **Document as sequence:**
   ```markdown
   ## User Login Workflow
   
   1. POST /api/auth/login
      - Input: email, password
      - Controller: src/api/auth.js → validateCredentials()
      
   2. Service validates:
      - Fetch user from DB
      - Compare password hash
      
   3. Generate JWT token
      - Include userId, email in claims
      - Sign with secret from env
      
   4. Return token to client
   ```

**Purpose:** Agents understand system behavior, not just structure.

---

## Step 4: Create Module Contexts

**For each major feature area:**

1. **Identify logical modules:**
   - Auth (login, register)
   - Users (profile, settings)
   - Posts (CRUD operations)

2. **Find existing directories:**
   ```bash
   # Find where auth code lives
   find src -type f -name "*auth*"
   ```

3. **Add Neolit files to existing directory:**
   ```bash
   # In existing directory, e.g., src/auth/
   cp templates/src/module/CONTEXT.md ./
   cp templates/src/module/TODO.org ./
   ```

4. **Fill CONTEXT.md:**
   - **Purpose:** What this module does
   - **Key Files:** Important files in this directory
   - **Related Schemas:** Link to `.neolit/3-database/schemas.md` entities
   - **Related APIs:** Link to `.neolit/2-api-server/components/` if exists
   - **Patterns:** How code is organized here
   - **Data Flow:** For key operations
   - **Constraints:** Module-specific rules

---

## Step 5: Extract Architectural Decisions

**Create ADRs for past decisions:**

```bash
# In .neolit/adr/
cp template.md 0001-database-choice.md
cp template.md 0002-authentication.md
```

**Document:**
- Why this database?
- Why this auth approach?
- Why this API style (REST/GraphQL)?
- Why this state management?

**Reverse-engineer from code:**
- "We use JWT because..." (check implementation)
- "We chose PostgreSQL because..." (infer from schema)

---

## Step 6: Fill AGENTS.md Constraints

**In `AGENTS.md` → Key Constraints section:**

Replace examples with real invariants:
- MUST follow User schema (email unique)
- MUST validate inputs per validation.js patterns
- MUST use repository pattern (see src/repositories/)
- MUST handle errors with ErrorHandler (see src/errors/)

**Extract from:**
- Validation logic
- Schema constraints
- Existing patterns in codebase
- Critical bugs that happened

---

## Step 7: Create Initial Tasks

**In each module's TODO.org:**

Add discovered work:
```org
* TODO [#B] Document payment flow :docs:
  <2025-12-02>
  
*** Context for Agent
    Payment logic exists but undocumented
    Files: src/payments/stripe.js

* TODO [#C] Refactor user service for testability :refactor:
  <2025-12-02>
  
*** Context for Agent
    Tight coupling makes testing hard
    Consider dependency injection
```

---

## Step 8: Update Templates

**After documenting:**

1. **Remove unnecessary structure:**
   - If no separate frontend: Delete `.neolit/1-web-app/`
   - If simple data: Delete `.neolit/3-database/`, document in `system.md`

2. **Create missing structure:**
   - If API docs needed: Create `.neolit/2-api-server/components/endpoints.md`
   - If UI patterns exist: Create `.neolit/1-web-app/components/patterns.md`

**Adapt to project, don't force C4 where it doesn't fit.**

---

## Output Checklist

After analysis, verify:
- [ ] `.neolit/system.md` exists and describes structure
- [ ] `.neolit/workflows.md` has 2-3 key flows
- [ ] Schemas documented (in schemas.md or system.md)
- [ ] Each module has `CONTEXT.md` (in existing directories)
- [ ] Each module has `TODO.org` with real tasks
- [ ] `AGENTS.md` Key Constraints filled with real rules
- [ ] ADRs created for major decisions
- [ ] Unnecessary template folders removed

**Goal:** Documentation reflects reality, enables consistent AI work.
