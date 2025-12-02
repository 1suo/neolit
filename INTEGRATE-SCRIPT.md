# Neolit Integration Script

**Purpose:** Automates Neolit scaffolding setup for new and existing projects.

---

## Usage

### For New Projects

```bash
cd /path/to/neolit
./integrate.sh new /path/to/new-project
```

### For Existing Projects

```bash
cd /path/to/neolit
./integrate.sh existing /path/to/existing-project
```

---

## What It Does

### 1. Copies Templates
- AGENTS.md → Project root
- SYSTEM.org → Project root
- docs/ → Project docs/
- docs/adr/ → Project docs/adr/

### 2. Creates Module Structure
- **New projects:** Creates `src/` directory
- **Existing projects:** Skips (use existing structure)

### 3. Generates AI Prompts File
Creates `.neolit-prompts.md` with ready-to-use prompts:

**Initial Setup Prompts:**
- Document data schema
- Create ADRs
- Map workflows

**Development Prompts:**
- Start a task
- Understand a module
- Implement a feature
- Fix a bug

**Documentation Prompts:**
- Update architecture
- Create module docs
- Review completeness

**Workflow Prompts:**
- Complete milestone
- Review module context

### 4. Creates Integration Checklist
- **New projects:** `.neolit-checklist-new.md`
  - Phase 1: Foundations (schema, ADRs, workflows)
  - Phase 2: Customization
  - Phase 3: Module setup
  - Phase 4: Validation

- **Existing projects:** `.neolit-checklist-existing.md`
  - Phase 1: Document existing foundations
  - Phase 2: Module organization
  - Phase 3: Task migration
  - Phase 4: Customization
  - Phase 5: Validation
  - Phase 6: AI integration

### 5. Creates Helper Script
`neolit-init-module.sh` - Quick module creation:

```bash
./neolit-init-module.sh auth
# Creates src/auth/ with README.md and TODO.org
```

---

## After Integration

### Files Created
```
project/
├── AGENTS.md              # From templates
├── SYSTEM.org             # From templates
├── docs/                  # From templates
│   ├── architecture.md
│   ├── api.md
│   ├── contributing.md
│   └── adr/
│       └── template.md
├── .neolit-prompts.md     # AI prompts (generated)
├── .neolit-checklist-*.md # Integration checklist (generated)
└── neolit-init-module.sh  # Helper script (generated)
```

### Next Steps (Shown by Script)

1. **Read the checklist**
   ```bash
   cat .neolit-checklist-new.md
   # or
   cat .neolit-checklist-existing.md
   ```

2. **Review AI prompts**
   ```bash
   cat .neolit-prompts.md
   ```

3. **Start with foundations**
   - Document data schema
   - Create ADRs
   - Map workflows

4. **Customize templates**
   - Edit AGENTS.md
   - Edit SYSTEM.org

5. **Create first module**
   ```bash
   ./neolit-init-module.sh module-name
   ```

---

## Prompt Examples

The `.neolit-prompts.md` file includes prompts like:

### Document Schema
```
I'm setting up architectural foundations for this project.

Project description: [YOUR DESCRIPTION]

Help me document the data schema in docs/architecture.md...
```

### Start Task
```
Read @AGENTS.md for project instructions.

I'm working on: [TASK from TODO.org]

Check :CONTEXT: property and implement following patterns.
```

### Create ADR
```
Create an ADR for [DECISION].

Use format from docs/adr/template.md...
```

---

## Tips

- **Always use the checklist** - It ensures nothing is missed
- **Use the prompts file** - Copy/paste and fill in details
- **One phase at a time** - Don't skip foundations
- **Point AI to AGENTS.md** - It has project-specific rules

---

## Example Run

```bash
$ ./integrate.sh new my-app

╔════════════════════════════════════════════╗
║     Neolit Integration Script v1.0        ║
╚════════════════════════════════════════════╝

✓ Project directory: /home/user/my-app
✓ Integration type: new

[1/5] Copying templates...
✓ Templates copied

[2/5] Creating module structure...
  → Created src/ directory

[3/5] Creating AI prompts...
✓ Created .neolit-prompts.md

[4/5] Creating checklist...
✓ Created .neolit-checklist-new.md

[5/5] Creating helper scripts...
✓ Created neolit-init-module.sh

╔════════════════════════════════════════════╗
║     Integration Complete!                  ║
╚════════════════════════════════════════════╝

Next steps:
1. Read the checklist:
   cat .neolit-checklist-new.md
2. Review AI prompts:
   cat .neolit-prompts.md
...
```

---

## Troubleshooting

**Script fails with permission error:**
```bash
chmod +x integrate.sh
```

**Want to re-run integration:**
```bash
# Remove generated files first
rm .neolit-* neolit-init-module.sh
# Then re-run
./integrate.sh [new|existing] /path/to/project
```

**Module script not working:**
```bash
chmod +x neolit-init-module.sh
```

---

## What Gets Generated vs Copied

**Copied (from templates/):**
- AGENTS.md
- SYSTEM.org
- docs/architecture.md
- docs/api.md
- docs/contributing.md
- docs/adr/template.md

**Generated (by script):**
- .neolit-prompts.md
- .neolit-checklist-[new|existing].md
- neolit-init-module.sh

---

## See Also

- [INTEGRATION.md](./INTEGRATION.md) - Manual integration guide
- [QUICKREF.md](./QUICKREF.md) - Quick reference
- [README.md](./README.md) - Project overview
