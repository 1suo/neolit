# Analyze Existing Project

**For integrating Neolit into existing project.**

---

## Step 1: Understand System

**Goal:** Fill system.md with actual system structure

1. Identify containers (deployable units):
   - What applications/services exist?
   - What databases?
   - What external systems integrated?

2. Map container interfaces:
   - How does web app talk to API? (HTTP? GraphQL?)
   - How does API talk to database? (SQL? MongoDB?)
   - Auth mechanism? (JWT? Session?)

3. Document in `.neolit/system.md` following template:
   - If project follows C4: Use C4 structure (System Context → Containers → Components)
   - If not: Document actual directory structure and responsibilities

---

## Step 2: Map Project Structure

**Goal:** Understand how code is organized

1. Identify main directories:
   ```
   ls -la
   tree -L 2 -I 'node_modules|.git'
   ```

2. Find patterns:
   - Where are API endpoints? (`api/`, `routes/`, `controllers/`)
   - Where are components? (`components/`, `src/`)
   - Where is business logic? (`services/`, `lib/`)
   - Where are data models? (`models/`, `entities/`, `schemas/`)

3. If project doesn't follow C4:
   - Document actual structure in `docs/structure.md`
   - Map what directories contain what responsibility

---

## Step 3: Identify Existing Documentation

1. Check for existing docs:
   - README files in subdirectories
   - API documentation
   - Schema definitions
   - ADRs or design docs

2. Preserve existing docs:
   - Don't overwrite
   - Reference from Neolit docs
   - Extract key info into Neolit structure

---

## Step 4: Document Core Data

**Critical for agents:** What data exists and rules

1. Find data schemas:
   - Check `models/` or `entities/` directory
   - Look at database migration files
   - Check ORM/ODM definitions

2. Extract to `.neolit/3-database/schemas.md`:
   - Entity attributes and types
   - Relationships
   - Invariants (unique constraints, validation rules)

3. Example:
   ```javascript
   // Found in models/User.js
   const UserSchema = {
     email: { type: String, unique: true, required: true },
     ...
   }
   // Document in schemas.md with invariants
   ```

---

## Step 5: Document Key Workflows

1. Identify 2-3 critical user workflows:
   - User registration/login
   - Core feature (e.g., create post, make payment)

2. Trace through code:
   - Entry point (API endpoint or page)
   - What services/functions called
   - What data accessed
   - What response returned

3. Document in `.neolit/workflows.md`

---

## Step 6: Create Module Structure

**For existing projects:** Identify logical module boundaries in existing code.

1. Identify modules (groups of related features):
   - Auth (login, register, password reset)
   - Users (profile, settings)
   - Posts (create, edit, list)

2. For each module (use existing directory structure):
   ```bash
   # Find existing module directory, e.g., src/auth or lib/user-service
   cd existing-module-directory
   
   # Add Neolit files
   cp /path/to/templates/src/module/CONTEXT.md ./
   cp /path/to/templates/src/module/TODO.org ./
   ```

3. Fill CONTEXT.md:
   - Purpose: What this module does
   - Key Files: List important files in this module
   - Related Data: Link to .neolit/3-database/schemas.md entities
   - Related APIs: Link to .neolit/2-api-server/components/controllers.md
   - Patterns: How code is organized in this module
   - Data Flow: For features in this module
   - Constraints: Module-specific MUST rules

---

## Step 7: Create Initial Tasks

1. In each module's TODO.org, create tasks for:
   - Bugs found during analysis
   - Missing documentation
   - Technical debt identified

2. Use proper org-mode syntax:
   ```org
   ** TODO [#B] Document authentication flow :feature:docs:
      [2025-12-02]
      
   *** Context for Agent
       Auth logic in src/auth/login.js
       Need to document in module README
   ```

---

## Output

After analysis:
- `.neolit/system.md` filled with actual structure and interfaces (MUST)
- `.neolit/3-database/schemas.md` with real entities (adjust this and follow-ups if needed)
- `.neolit/workflows.md` with 2-3 key workflows
- `src/MODULE/README.md` for each module
- `src/MODULE/TODO.org` with initial tasks
- `AGENTS.md` Key Constraints section filled with real invariants ()
