# C4 Levels Guide

## When to Use Each Level

### SYSTEM Level (always)
- **Location:** Project root
- **Use:** Every project has one SYSTEM level NEOLIT.md
- **Purpose:** Project overview, containers/components list, workflows
- **Size:** 60-100 lines

### CONTAINER Level (optional)
- **Location:** Separately deployable unit directories (api/, worker/, frontend/)
- **Use ONLY when:**
  - Multiple separately deployable units (microservices)
  - Each unit runs independently
  - Example: API server, worker service, frontend app
- **Skip when:**
  - Single deployable application
  - Just source code directories (src/)
- **Size:** 60-80 lines

### COMPONENT Level (always)
- **Location:** Functional unit directories (src/auth/, api/users/)
- **Use:** For every functional component
- **Purpose:** Detailed architecture + implementation
- **Size:** 100-200 lines

### CODE Level (optional)
- **Location:** Sub-component directories (src/auth/utils/)
- **Use ONLY when:**
  - Sub-component has 3+ files
  - Complex logic needs documentation
- **Skip when:**
  - Simple utilities
  - Self-explanatory code
- **Size:** 30-80 lines

---

## Level Detection

### By Project Structure

**Single deployable application:**
```
project/
├── NEOLIT.md              # SYSTEM
└── src/
    ├── auth/
    │   └── NEOLIT.md      # COMPONENT (skip CONTAINER)
    └── user/
        └── NEOLIT.md      # COMPONENT
```

**Multi-deployable (microservices):**
```
project/
├── NEOLIT.md              # SYSTEM
├── api/
│   ├── NEOLIT.md          # CONTAINER (deployable: API server)
│   └── auth/
│       └── NEOLIT.md      # COMPONENT
├── worker/
│   ├── NEOLIT.md          # CONTAINER (deployable: background worker)
│   └── email/
│       └── NEOLIT.md      # COMPONENT
└── frontend/
    ├── NEOLIT.md          # CONTAINER (deployable: web app)
    └── components/
        └── NEOLIT.md      # COMPONENT
```

### By Marker in File

```markdown
**Level:** SYSTEM | CONTAINER | COMPONENT | CODE
```

Agent determines level from path, then validates marker matches.
