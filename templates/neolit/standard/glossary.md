# Glossary

**NEOLIT.md**
- Single documentation file at any directory level
- Content structure determined by C4 level
- Always includes **Level:** marker

**TODO.org**
- Task tracking in org-mode format
- Location: Root and component directories
- Active tasks in TODO.org, completed in TODO.org_archive

**C4 Levels (internal guide):**
- **SYSTEM** → Project root (always)
- **CONTAINER** → Separately deployable unit: API server, worker service, frontend app (optional, only if multi-deployable)
- **COMPONENT** → Functional unit: auth, user, payment (always)
- **CODE** → Sub-component: utils, models, handlers (optional if complex)
