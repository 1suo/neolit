# Neolit Integration Guide

## Integration

```bash
./integrate.sh /path/to/existing-project
cd /path/to/existing-project
```

**Then:** Give AI this prompt:

```
Read @prompts/ANALYZE_PROJECT.md and follow it to integrate Neolit.
Analyze the codebase and create documentation.
```

AI will:
1. Analyze structure → Fill `.neolit/system.md`
2. Extract schemas → Fill `.neolit/3-database/schemas.md`
3. Map workflows → Fill `.neolit/workflows.md`
4. Create module contexts → Add `CONTEXT.md` to existing directories
5. Fill `AGENTS.md` Key Constraints with real invariants

---

## After Integration

1. **Review AI-generated docs** - Verify accuracy
2. **Fill HUMAN.org** - Add milestones, testing strategy
3. **Start with small task** - Test workflow
4. **Refine as needed** - Adjust based on results

---

## Working with AI

**Assign task:** `Complete "Add auth middleware" from src/api/TODO.org`

**Fix bug:** `Fix "Login validation" in src/auth/TODO.org`

**AI reads:** AGENTS.md → module CONTEXT.md → task-specific prompts

**Status workflow:**
- `TODO` - Active work (assign these to AI)
- `INBOX` - Frozen/not ready
- `PROGRESS` - AI working on it
- `WAITING` - Done, needs review
- `DONE` - Approved and closed

---

## Philosophy

**Core principle:** Code serves workflows and architectural foundations.

1. Document foundations FIRST (schemas, decisions, workflows)
2. AI uses foundations to make consistent decisions
3. Update docs with code in same commit
4. Keep context layered and close to code

---

**Adapt freely. This is scaffolding, not framework.**
