# Neolit Extension System

## How It Works

1. **Core prompts** ship in package → copied to `neolit/prompts/` on init
2. **User customizes** by editing files in `neolit/`
3. **Updates** merge new core prompts without overwriting customizations

## Customization Flow

### 1. Override Core Prompts

Edit any file in `neolit/prompts/`:
```
neolit/prompts/BASE.md          # Override base instructions
neolit/prompts/BUG.md           # Override bug-fixing workflow
neolit/prompts/FEATURE.md       # Override feature workflow
```

### 2. Add Custom Prompts

Create new prompt files:
```
neolit/prompts/DEPLOY.md        # Custom deployment workflow
neolit/prompts/REVIEW.md        # Custom code review workflow
```

Reference in tasks:
```org
* TODO Deploy to staging :deploy:
```

### 3. Extend Documentation

Add domain-specific docs:
```
neolit/docs/api.md              # API architecture
neolit/docs/database.md         # Data architecture
neolit/docs/custom-domain.md    # Project-specific domain
```

Reference from system.md:
```markdown
## Architecture

- **API Layer**: See [api.md](api.md)
- **Database**: See [database.md](database.md)
```

### 4. Add Project Conventions

Edit `neolit/prompts/BASE.md`:
```markdown
## Project-Specific Conventions

- Use Zod for validation
- Prefer composition over inheritance
- Test files: `*.test.ts` next to source
```

## Update Strategy

When running `npx neolit update`:

1. **Core files** (BASE.md, BUG.md, etc.):
   - If unmodified → replace with new version
   - If modified → show diff, ask user
   
2. **User files** (custom prompts/docs):
   - Never touched by updates

3. **Template updates**:
   - New templates added
   - User can adopt or ignore

## Config: .neolit.json

```json
{
  "format": "org",
  "customPrompts": ["DEPLOY", "REVIEW"],
  "coreOverrides": {
    "BASE": "modified",
    "BUG": "original"
  }
}
```

Tracks customizations for smart updates.
