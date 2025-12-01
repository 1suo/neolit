# Neolit Quick Reference

## Setup

```bash
cp templates/AGENTS.md /project/
cp templates/SYSTEM.org /project/
cp -r templates/docs /project/
```

**BEFORE coding:**
1. Document data schema (docs/architecture.md)
2. Create ADRs for core decisions
3. Map workflows
4. Fill MUST constraints in AGENTS.md

*Tip: AI can help - ask it to draft these based on your description*

## Usage

**Point agent:** `Read @AGENTS.md`

**Assign task:** `Complete FEAT-001 from src/auth/TODO.org`

---

## File Structure

```
project/
├── AGENTS.md              ← AI entry point
├── SYSTEM.org             ← Strategic plan
├── docs/
│   ├── architecture.md    ← System docs
│   ├── api.md
│   ├── contributing.md
│   └── adr/
│       └── NNNN-*.md      ← Decisions
└── src/
    └── module/
        ├── README.md      ← Module docs
        ├── TODO.org       ← Tasks
        └── [code]
```

---

## Modal Verbs

- **MUST** - Invariants, critical constraints (never violate)
- **SHOULD** - Preferences, guidelines (follow unless good reason)
- **MAY** - Optional, nice-to-have (use judgment)

---

## ADR Template

```markdown
# ADR-NNNN: Title

Status: Proposed|Accepted|Deprecated
Date: YYYY-MM-DD

## Context
What problem?

## Decision
What we chose.

## Consequences
Positive / Negative / Neutral

## Alternatives
What else we considered and why not.
```

---

## TODO.org Structure

```org
* Bugfixes
** TODO [BUG-NNN] Description
** IN-PROGRESS [BUG-NNN] Description
** WAITING [BUG-NNN] Description
** DONE [BUG-NNN] Description

* Features
** TODO [FEAT-NNN] Description
   *** Requirements
   *** Acceptance Criteria
   *** Implementation Notes

* Technical Debt
* Documentation
* Testing
```

---

## Documentation Locations

| Change Type | Update File |
|-------------|-------------|
| Schema | `docs/architecture.md` |
| API endpoint | `docs/api.md` |
| Architecture | `docs/architecture.md` + ADR |
| Module pattern | `src/module/README.md` |
| Task completion | `TODO.org` |
| Major decision | `docs/adr/NNNN-*.md` |

---

## Customization Markers

All `[PROJECT_SPECIFIC]` sections need replacement:
- Architecture patterns
- Key constraints (MUST)
- Preferences (SHOULD)
- Debugging approach
- Testing strategy

---

## Common Patterns

**Service Layer:**
```
Repository → Service → API Endpoint
(data)    → (logic)  → (interface)
```

**Task Notes:**
```
[YYYY-MM-DD] Agent: What was done
[YYYY-MM-DD] Agent: Question for reviewer
```

**Commit Message:**
```
Brief description (50 chars)

- Change 1
- Change 2
- Updated docs/architecture.md
```

---

## Troubleshooting

**Agent ignores patterns?**
→ Add examples to module README.md

**Agent skips docs?**
→ Emphasize in AGENTS.md, make explicit in task criteria

**Tasks too large?**
→ Break into smaller subtasks in TODO.org

**Wrong files changed?**
→ Add explicit constraints to module README.md

---

## Philosophy

**Documentation-first** - Doc before code  
**Patterns over prescription** - Show, don't tell  
**Minimal changes** - Only what's needed  
**Complete before moving** - No half-done features  
**Brief but sufficient** - No more, no less  

---

## Links

- **Setup:** See `INTEGRATION.md`
- **Overview:** See `README.md`
- **Summary:** See `SUMMARY.md`
- **Reference plan:** See `neolit.org`
