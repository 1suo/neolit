# Analyze Project for Neolit Integration

**Goal:** Document existing project to enable AI-driven development.

**CRITICAL RULES:**
1. **Ignore node_modules, .git, dist, build** - never analyze generated/dependency code
2. **Document ONLY what exists** - no guessing, no assumptions. Trace through real files, functions, schemas
3. **DO NOT create TODO tasks** - only create CONTEXT.md and documentation files
4. **DO NOT modify source code** - read only

---

## Step 1: Understand System Structure

**Create:** `neolit/docs/system.md` (MUST exist)

1. **Identify deployable units** (containers in C4):
   ```bash
   # Check structure - EXCLUDE dependencies
   ls -la
   tree -L 2 -I 'node_modules|.git|dist|build|vendor|target'
   ```

2. **Understand what exists:**
   - Separate frontend/backend? Monolith?
   - What databases/services?
   - External integrations?

3. **Document in `neolit/docs/system.md`:**
   - If clear separation exists: Present as C4 containers (ONLY if it truly fits), e.g.:
     - Container 1: Web App (what it actually does, actual tech, actual interfaces)
     - Container 2: API Server (what it actually does, actual tech, actual interfaces)
     - Container 3: Database (what it actually stores)
   - If monolith: Document actual directory structure as-is
   - Key: Show *actual interfaces* between parts from real code

**Example structure after analysis:**
```
neolit/
├── docs/
│   ├── system.md              # MUST - entry point
│   ├── workflows.md           # Key user/data flows
│   ├── 1-web-app/            # Optional - only if frontend exists
│   │   └── components/
│   │       ├── pages.md
│   │       └── state.md
│   ├── 2-api-server/         # Optional - only if backend exists
│   │   └── components/
│   │       ├── controllers.md
│   │       ├── services.md
│   │       └── auth.md
│   └── 3-database/           # Optional - only if complex data
│       └── schemas.md
```

**Note:** Create only what's needed. Simple projects might only need `system.md` + `workflows.md`.

---

## Step 2: Map Data Schemas

**If project has complex data:** Create `neolit/docs/3-database/schemas.md`

1. **Find actual schema definitions:**
   - Check `models/`, `entities/`, `schema/` directories
   - Read migrations files
   - Read ORM/ODM model files
   - **DO NOT** assume or infer - document what's in the code

2. **Extract from actual code:**
   - Entity names and attributes (from actual model classes)
   - Relationships (from actual foreign keys/references)
   - Validations (from actual validation decorators/functions)
   - Keys and indexes (from actual schema definitions)

3. **Document in schemas.md:**
   ```markdown
   ## User (from src/models/User.js)
   - id: UUID (primary) 
   - email: string (unique, required)
   - passwordHash: string (required)
   - createdAt: timestamp
   
   **Invariants:** (from actual code)
   - Email must be unique (unique index in schema)
   - Password must be hashed before storage (pre-save hook)
   
   **Relations:** (from actual foreign keys)
   - User has many Posts (userId foreign key in Post model)
   ```

**If simple data:** Document in `system.md` instead.

---

## Step 3: Document Key Workflows

**Create:** `neolit/docs/workflows.md`

1. **Identify critical paths by reading code, e.g.:**
   - User registration/login (trace actual route handlers)
   - Main feature (trace actual implementation)

2. **Trace through actual code files:**
   - Entry point (actual route file path)
   - Actual functions/services called (grep for function names)
   - Actual data accessed (check actual queries)
   - Actual response format

3. **Document as sequence from real code:**
   ```markdown
   ## User Login Workflow (from src/api/auth.js)
   
   1. POST /api/auth/login (defined in src/routes/auth.js:15)
      - Input: email, password (validated by authSchema)
      - Controller: src/api/auth.js → validateCredentials() line 42
      
   2. Service validates (src/services/auth.js:28):
      - Fetch user from DB (UserRepository.findByEmail)
      - Compare password hash (bcrypt.compare)
      
   3. Generate JWT token (src/utils/jwt.js:10):
      - Include userId, email in claims
      - Sign with JWT_SECRET from .env
      
   4. Return token to client (200 response with {token, user})
   ```

**Purpose:** Agents understand actual system behavior from real code paths.

---

## Step 4: Create Module Contexts

**For each major feature area found in codebase:**

1. **Identify logical modules from actual directories:**
   - Auth (if src/auth/ or similar exists)
   - Users (if src/users/ or similar exists)
   - Posts (if src/posts/ or similar exists)
   - Routes, Controllers, Services, etc.
   - Store/State (for frontend)

2. **Find where code actually lives:**
   ```bash
   # Find actual auth implementation
   find src -type f -name "*auth*" -not -path "*/node_modules/*"
   grep -r "class.*Auth" src/ --exclude-dir=node_modules
   ```

3. **Add CONTEXT.md to existing directories:**
   ```bash
   # In actual existing directory found above
   cp neolit/module-templates/CONTEXT.md src/auth/
   ```

4. **Fill CONTEXT.md by reading actual files:**
   - **Purpose:** What this module actually does (from reading the code)
   - **Key Files:** List actual important files with brief purpose
   - **Related Schemas:** Link to actual entities used (check imports)
   - **Related APIs:** List actual endpoints (check route definitions)
   - **Patterns:** How code is actually organized (check file structure)
   - **Data Flow:** For key operations (trace through actual functions)
   - **Constraints:** Extract from actual validation code

**DO NOT create TODO.org files** - documentation only.

---

## Step 5: Extract Architectural Decisions

**Create ADRs for decisions found in code:**

```bash
# In neolit/docs/adr/
cp neolit/docs/adr/template.md neolit/docs/adr/0001-database-choice.md
```

**Reverse-engineer from actual code:**
- Database choice (check package.json, config files)
- Auth approach (check actual auth implementation)
- API style (check actual endpoint patterns)
- State management (check actual frontend store/state code)

**Document what you find, not what you assume:**
- "Uses JWT tokens (jwt.sign in src/utils/jwt.js)"
- "PostgreSQL with Sequelize ORM (sequelize config in src/db/)"
- "REST API (express routes in src/routes/)"

---

## Step 6: Fill Project Constraints

**In `neolit/prompts/BASE.md` → Key Constraints section:**

Replace examples with actual extracted invariants from code:
```markdown
### Data Constraints (from actual schemas)
- User.email MUST be unique (unique index in User model)
- Password MUST be hashed with bcrypt (pre-save hook)

### Code Patterns (from actual codebase)
- MUST use UserRepository for DB access (pattern in src/repositories/)
- MUST validate with Joi schemas (validation pattern in src/validators/)
- MUST handle errors with AppError class (src/utils/errors.js)

### API Conventions (from actual endpoints)
- MUST return 401 for unauthenticated requests
- MUST return {error: string} format for errors
- MUST use Bearer token authentication
```

**Extract from:**
- Actual validation code
- Actual schema constraints
- Actual patterns seen in multiple files
- Actual error handling code

---

## Step 7: Clean Up Structure

**After documenting from code:**

1. **Remove unused template folders:**
   - If no separate frontend: Delete `neolit/docs/1-web-app/`
   - If simple data: Delete `neolit/docs/3-database/`, document in `system.md`
   - If no complex API: Delete `neolit/docs/2-api-server/`

2. **Create only what's needed:**
   - If API docs needed and complex: Create `neolit/docs/2-api-server/components/endpoints.md`
   - If UI patterns exist and complex: Create `neolit/docs/1-web-app/components/patterns.md`

**Adapt structure to match actual project, don't force templates, can delete unused docs templates (except TODO.org and CONTEXT.md).**

---

## Output Checklist

After analysis from actual code, verify:
- [ ] `neolit/docs/system.md` exists and describes actual structure
- [ ] `neolit/docs/workflows.md` has actual key flows traced through code
- [ ] Schemas documented from actual model files
- [ ] Each major module has `CONTEXT.md` (in existing directories)
- [ ] `neolit/prompts/BASE.md` Key Constraints filled from actual code patterns
- [ ] ADRs created for decisions found in code
- [ ] Unused template folders removed
- [ ] NO TODO.org files created (agent doesn't create tasks)
- [ ] NO features documented that don't exist in code
- [ ] EVERYTHING extracted from actual source files, not assumptions

**Goal:** Documentation accurately reflects real codebase, enables consistent AI work.
