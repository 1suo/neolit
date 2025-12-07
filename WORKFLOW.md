## LLM Usage Guidelines

Best practices for working with AI coding agents on projects using AI-centered linked documentation
  
**When to Use AI Agents**
   - Implementing well-defined features from TODO.org files
   - Writing boilerplate code following established patterns
   - Debugging issues with clear reproduction steps
   - Updating documentation alongside code changes
   - Analyzing code for writing docs or tests

**When NOT to Use AI Agents**
   - Making architectural decisions (requires human judgment)
   - Handling security-critical code (requires expert review)
   - Refactoring large sections without clear plan
   - Making breaking changes without discussion

**AI Agent Workflow**
   1. **Phase 0: Documentation Verification (FIRST)**
      - Check system.md exists (create if missing using ANALYZE_PROJECT.md)
      - Check module CODE.md exists (create if missing using DOCUMENT_MODULE.md)
      - Verify CODE.md complete for task (complete if gaps found)
      - Check architecture docs if needed (create if missing using DOCUMENT_MODULE.md)
   
   2. **Phase 1: Read Documentation (only after Phase 0)**
      - Read BASE.md for instructions and STANDARD.md for rules
      - Read system.md for architecture context
      - Read module CODE.md for exact implementation details
      - Read architecture docs for design patterns
      - Choose appropriate prompt (BUG.md, FEATURE.md, etc)
   
   3. **Phase 2: Implement (only after Phase 1)**
      - Follow exact structures from CODE.md
      - Implement changes following documented patterns
   
   4. **Phase 3: Document Changes (same commit as code)**
      - Update CODE.md if structures/functions changed
      - Update architecture docs if design changed
      - Add detailed agent notes to TODO.org
      - Update task status to WAITING
   
   5. **Phase 4: Human Review**
      - Human reviews changes and documentation
      - Human approves or requests modifications

## Top-down vs Bottom-up task management

Linked docs system supports two approaches for handling TODO.org files in a modular project.

1. **Top-down** (Recommended for coordination):
   - Root `TODO.org` for project-wide tasks
   - Agent sees full scope, priorities
   - Tasks link to relevant docs/modules
   - Good for: cross-module features, architectural work

Use root TODO.org if:
    - Task affects multiple modules
    - Need project-wide overview
    - Cross-module features
    - Architectural decisions
    - Prioritization across modules

2. **Bottom-up** (Recommended for module work):
   - Module `TODO.org` files (`src/module/TODO.org`)
   - Tasks close to implementation
   - Clear module ownership
   - Good for: bugs, isolated features

Start with root TODO.org if:
   - Task confined to single module
   - Implementation detail
   - Already know the module
   - Isolated features
