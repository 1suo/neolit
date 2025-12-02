#!/bin/bash
# Neolit Integration Script
# Usage: ./integrate.sh [new|existing] /path/to/project

set -e

NEOLIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_TYPE="${1:-new}"
PROJECT_DIR="${2:-.}"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     Neolit Integration Script v1.0        ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""

# Validate project type
if [[ "$PROJECT_TYPE" != "new" && "$PROJECT_TYPE" != "existing" ]]; then
    echo -e "${RED}Error: First argument must be 'new' or 'existing'${NC}"
    echo "Usage: $0 [new|existing] /path/to/project"
    exit 1
fi

# Create project directory if it doesn't exist
mkdir -p "$PROJECT_DIR"
cd "$PROJECT_DIR"
PROJECT_DIR="$(pwd)"

echo -e "${GREEN}✓${NC} Project directory: $PROJECT_DIR"
echo -e "${GREEN}✓${NC} Integration type: $PROJECT_TYPE"
echo ""

# Step 1: Copy templates
echo -e "${BLUE}[1/5]${NC} Copying templates..."

cp "$NEOLIT_DIR/templates/AGENTS.md" "$PROJECT_DIR/"
cp "$NEOLIT_DIR/templates/SYSTEM.org" "$PROJECT_DIR/"
mkdir -p "$PROJECT_DIR/docs/adr"
cp -r "$NEOLIT_DIR/templates/docs/"* "$PROJECT_DIR/docs/"

echo -e "${GREEN}✓${NC} Templates copied"
echo ""

# Step 2: Create initial module structure
echo -e "${BLUE}[2/5]${NC} Creating module structure..."

if [ "$PROJECT_TYPE" == "new" ]; then
    mkdir -p "$PROJECT_DIR/src"
    echo -e "  ${YELLOW}→${NC} Created src/ directory"
    echo -e "  ${YELLOW}→${NC} Add modules with: mkdir -p src/module-name && cp templates/src/module/* src/module-name/"
else
    echo -e "  ${YELLOW}→${NC} Existing project - skipping src/ creation"
fi

echo ""

# Step 3: Create prompt files
echo -e "${BLUE}[3/5]${NC} Creating AI prompts..."

cat > "$PROJECT_DIR/.neolit-prompts.md" << 'EOFPROMPTS'
# Neolit AI Prompts

Quick prompts for working with AI agents on this project.

---

## Initial Setup Prompts

### Document Data Schema

```
I'm setting up architectural foundations for this project.

Project description: [DESCRIBE YOUR SYSTEM]

Help me document the data schema in docs/architecture.md following this structure:

For each entity:
1. List attributes and types
2. Define relationships (has-many, belongs-to)
3. State invariants (what MUST always be true)
4. Suggest keys and indexes

Entities to document: [LIST YOUR ENTITIES]
```

### Create Initial ADRs

```
Create an ADR (Architecture Decision Record) for [DECISION TOPIC].

Use this format from docs/adr/template.md:
- Context: [DESCRIBE PROBLEM/SITUATION]
- Decision: [WHAT WE CHOSE]
- Alternatives considered: [OTHER OPTIONS]
- Consequences: Positive/Negative/Neutral

Decision to document: [e.g., "Choosing PostgreSQL over MongoDB"]
```

### Map Critical Workflows

```
Help me document the critical workflow for [FEATURE NAME].

Show:
1. User's goal
2. Step-by-step flow
3. Data at each step (Input → Validation → Processing → Storage → Output)
4. Components involved

Feature to document: [DESCRIBE FEATURE]
```

---

## Development Prompts

### Starting a Task

```
Read @AGENTS.md for project instructions.

I'm working on: [TASK DESCRIPTION from TODO.org]

Check the :CONTEXT: property and "Context for Agent" section in the task.
Read the referenced module README.md and related sections.
Then implement following existing patterns.
```

### Understanding a Module

```
Read @src/[MODULE]/README.md

Explain:
1. What this module does
2. Key data structures
3. Related modules and APIs
4. Patterns I should follow
```

### Implementing a Feature

```
Read @AGENTS.md for instructions.
Read @src/[MODULE]/TODO.org and find task [TASK-ID].
Read the "Context for Agent" section for data structures and required reading.
Read the linked module READMEs and schemas.

Implement the feature following:
- Existing patterns from module README
- MUST constraints from AGENTS.md
- Workflow from docs/architecture.md

Update documentation in the same commit.
```

### Fixing a Bug

```
Read @AGENTS.md for instructions.
Read @src/[MODULE]/TODO.org task [BUG-ID].

The bug: [DESCRIPTION]
Steps to reproduce: [STEPS]

Find root cause, implement minimal fix following existing patterns.
Update documentation if behavior changed.
```

---

## Documentation Prompts

### Update Architecture Docs

```
Read @docs/architecture.md

I've added/changed [FEATURE/ENTITY].

Update the relevant sections:
- Domain Model (if entity changed)
- Workflows (if flow changed)
- Data Schemas (if schema changed)
```

### Create Module Documentation

```
I'm creating a new module: src/[MODULE-NAME]

Based on templates/src/module/README.md, create documentation including:
- Purpose and responsibilities
- Key data structures
- Related schemas from docs/architecture.md
- Related modules and APIs
- Patterns to follow

Module description: [DESCRIBE MODULE]
```

### Review Documentation Completeness

```
Review all [PROJECT_SPECIFIC] markers in:
- AGENTS.md
- docs/architecture.md
- docs/contributing.md

Check if they're filled with project-specific information.
List any remaining placeholders.
```

---

## Workflow Prompts

### Complete Milestone Checklist

```
Read @SYSTEM.org

Review Milestone [N]: [MILESTONE NAME]

Check each checklist item and report status:
- What's completed
- What's remaining
- Any blockers
```

### Review Module Context

```
Read @src/[MODULE]/README.md

Check if "Related Context" sections are complete:
- Related Schemas: Do they list all entities this module uses?
- Related Modules: Are all dependencies listed?
- Related APIs: Are all endpoints documented?
- Related ADRs: Are relevant decisions referenced?

Update any missing links.
```

---

## Tips

1. **Always start with @AGENTS.md** - It has project-specific rules
2. **Use :CONTEXT: properties** - Tasks tell you what to read
3. **Follow "Related" sections** - Don't guess at dependencies
4. **Read only what's referenced** - Don't read entire architecture.md
5. **Update docs with code** - Same commit, always

EOFPROMPTS

echo -e "${GREEN}✓${NC} Created .neolit-prompts.md"
echo ""

# Step 4: Create integration checklist
echo -e "${BLUE}[4/5]${NC} Creating checklist..."

if [ "$PROJECT_TYPE" == "new" ]; then
    CHECKLIST_FILE="$PROJECT_DIR/.neolit-checklist-new.md"
    cat > "$CHECKLIST_FILE" << 'EOFCHECKLIST'
# Neolit Integration Checklist - New Project

## Phase 1: Foundations (BEFORE coding)

- [ ] **Data Schema** (docs/architecture.md)
  - [ ] List all entities
  - [ ] For each: attributes, types, relationships
  - [ ] State invariants for each entity
  - [ ] Define keys and indexes

- [ ] **Architectural Decisions** (docs/adr/)
  - [ ] ADR-0001: Database choice
  - [ ] ADR-0002: Authentication method
  - [ ] ADR-0003: API design (REST/GraphQL/etc)
  - [ ] ADR-0004: State management pattern
  - [ ] ADR-0005: Deployment model

- [ ] **Critical Workflows** (docs/architecture.md)
  - [ ] Workflow 1: [Main user journey]
  - [ ] Workflow 2: [Key feature flow]
  - [ ] Workflow 3: [Critical path]
  - [ ] For each: Input→Validation→Processing→Storage→Output

- [ ] **MUST Constraints** (AGENTS.md)
  - [ ] Add architectural constraints from schema
  - [ ] Add constraints from ADRs
  - [ ] Add code-level constraints

## Phase 2: Customization

- [ ] **AGENTS.md**
  - [ ] Replace [PROJECT_SPECIFIC] architecture patterns
  - [ ] Fill MUST constraints (from Phase 1)
  - [ ] Fill SHOULD preferences
  - [ ] Add debugging approach

- [ ] **SYSTEM.org**
  - [ ] Set project name and date
  - [ ] Add real milestones with deadlines
  - [ ] Fill testing strategy
  - [ ] Add development URLs

- [ ] **docs/contributing.md**
  - [ ] Add prerequisites
  - [ ] Update setup commands
  - [ ] Define code style
  - [ ] Add test commands

- [ ] **docs/api.md**
  - [ ] Set base URLs
  - [ ] Remove template examples
  - [ ] Keep as reference for format

## Phase 3: Module Setup

For each module:

- [ ] Create directory: src/[module-name]
- [ ] Copy templates: cp templates/src/module/* src/[module-name]/
- [ ] Fill module README.md:
  - [ ] Purpose and responsibilities
  - [ ] Key data structures
  - [ ] Related schemas (from docs/architecture.md)
  - [ ] Related modules
  - [ ] Related APIs
  - [ ] Related ADRs
  - [ ] Data flow for this module
- [ ] Create initial tasks in TODO.org:
  - [ ] Add :CONTEXT:, :PATTERNS:, :RELATED: properties
  - [ ] Fill "Context for Agent" section

## Phase 4: Validation

- [ ] All [PROJECT_SPECIFIC] markers replaced
- [ ] Milestone 0 in SYSTEM.org completed
- [ ] At least 3 ADRs created
- [ ] At least 3 workflows documented
- [ ] All modules have README.md
- [ ] AGENTS.md has real MUST constraints

## Ready to Code!

- [ ] Point AI agent: "Read @AGENTS.md for instructions"
- [ ] Create first task in TODO.org
- [ ] Let AI implement following foundations

---

**Use prompts from .neolit-prompts.md to work with AI on each phase.**
EOFCHECKLIST
else
    CHECKLIST_FILE="$PROJECT_DIR/.neolit-checklist-existing.md"
    cat > "$CHECKLIST_FILE" << 'EOFCHECKLIST'
# Neolit Integration Checklist - Existing Project

## Phase 1: Document Foundations (CRITICAL)

- [ ] **Data Schema** (docs/architecture.md)
  - [ ] Document all existing entities
  - [ ] For each: attributes, types, relationships
  - [ ] State current invariants
  - [ ] Document existing keys and indexes

- [ ] **Architectural Decisions** (docs/adr/)
  - [ ] Create ADRs for PAST decisions:
    - [ ] Why current database?
    - [ ] Why current auth method?
    - [ ] Why current API design?
    - [ ] Why current state management?
    - [ ] Why current deployment?

- [ ] **Critical Workflows** (docs/architecture.md)
  - [ ] Map 3-5 most important existing flows
  - [ ] For each: document current implementation
  - [ ] Show: Input→Validation→Processing→Storage→Output

- [ ] **MUST Constraints** (AGENTS.md)
  - [ ] Document current architectural constraints
  - [ ] Add constraints from existing schema
  - [ ] Add code-level rules currently followed

## Phase 2: Module Organization

For each major component:

- [ ] Identify module boundaries
- [ ] Create src/[module]/README.md
  - [ ] Document current responsibilities
  - [ ] Extract data structures
  - [ ] List related schemas
  - [ ] List related modules
  - [ ] List APIs (uses/provides)
  - [ ] Reference relevant ADRs
  - [ ] Document current data flow
- [ ] Extract current pain points
- [ ] Document patterns in use

## Phase 3: Task Migration

- [ ] Create TODO.org per module
- [ ] Migrate existing issues/tasks:
  - [ ] Add :CONTEXT: property to each
  - [ ] Add :PATTERNS: property
  - [ ] Add :RELATED: property
  - [ ] Fill "Context for Agent" section
- [ ] Add acceptance criteria
- [ ] Prioritize tasks

## Phase 4: Customization

- [ ] **AGENTS.md**
  - [ ] Replace [PROJECT_SPECIFIC] with current patterns
  - [ ] Fill MUST constraints (from Phase 1)
  - [ ] Document current debugging approach

- [ ] **SYSTEM.org**
  - [ ] Set project name
  - [ ] Document current milestones
  - [ ] Add current testing commands
  - [ ] List current development URLs

- [ ] **docs/contributing.md**
  - [ ] Document current setup
  - [ ] Current code style rules
  - [ ] Current test commands

## Phase 5: Validation

- [ ] All current architecture documented
- [ ] ADRs created for major past decisions
- [ ] Critical workflows mapped
- [ ] All modules have README.md
- [ ] All modules have TODO.org
- [ ] AGENTS.md reflects current reality

## Phase 6: AI Integration

- [ ] Start with small tasks
- [ ] Point AI: "Read @AGENTS.md for instructions"
- [ ] Review agent output carefully
- [ ] Refine AGENTS.md based on results
- [ ] Gradually increase task complexity

---

**Use prompts from .neolit-prompts.md to work with AI on each phase.**

**TIP:** Focus on documenting what EXISTS, not what you wish existed.
EOFCHECKLIST
fi

echo -e "${GREEN}✓${NC} Created $CHECKLIST_FILE"
echo ""

# Step 5: Create quick start script
echo -e "${BLUE}[5/5]${NC} Creating helper scripts..."

cat > "$PROJECT_DIR/neolit-init-module.sh" << 'EOFMODULE'
#!/bin/bash
# Create a new module with Neolit structure
# Usage: ./neolit-init-module.sh module-name

MODULE_NAME="$1"

if [ -z "$MODULE_NAME" ]; then
    echo "Usage: $0 module-name"
    exit 1
fi

MODULE_DIR="src/$MODULE_NAME"

if [ -d "$MODULE_DIR" ]; then
    echo "Error: Module $MODULE_NAME already exists"
    exit 1
fi

echo "Creating module: $MODULE_NAME"

mkdir -p "$MODULE_DIR"
cp templates/src/module/README.md "$MODULE_DIR/"
cp templates/src/module/TODO.org "$MODULE_DIR/"

echo "✓ Module created at $MODULE_DIR"
echo ""
echo "Next steps:"
echo "1. Edit $MODULE_DIR/README.md"
echo "2. Fill in module-specific information"
echo "3. Create initial tasks in $MODULE_DIR/TODO.org"
EOFMODULE

chmod +x "$PROJECT_DIR/neolit-init-module.sh"

echo -e "${GREEN}✓${NC} Created neolit-init-module.sh"
echo ""

# Done
echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     Integration Complete!                  ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo ""
echo -e "1. ${YELLOW}Read the checklist:${NC}"
if [ "$PROJECT_TYPE" == "new" ]; then
    echo -e "   cat .neolit-checklist-new.md"
else
    echo -e "   cat .neolit-checklist-existing.md"
fi
echo ""
echo -e "2. ${YELLOW}Review AI prompts:${NC}"
echo -e "   cat .neolit-prompts.md"
echo ""
echo -e "3. ${YELLOW}Start with foundations:${NC}"
echo -e "   - Document data schema in docs/architecture.md"
echo -e "   - Create ADRs in docs/adr/"
echo -e "   - Map workflows in docs/architecture.md"
echo ""
echo -e "4. ${YELLOW}Customize templates:${NC}"
echo -e "   - Edit AGENTS.md (replace [PROJECT_SPECIFIC])"
echo -e "   - Edit SYSTEM.org (set project name, milestones)"
echo ""
echo -e "5. ${YELLOW}Create first module:${NC}"
echo -e "   ./neolit-init-module.sh module-name"
echo ""
echo -e "${GREEN}Happy coding with AI! 🚀${NC}"
