# Prompts

Task-type workflows. Domain-specific info lives in .neolit/.

## Files

- **TODO-STATUS.md** - How to modify task status (used always)
- **BUG.md** - Bug fix workflow
- **FEATURE.md** - Feature implementation workflow

## Usage

Task has tags: `:bug:api:`
→ Agent reads prompts/BUG.md
→ Module README.md points to .neolit/api.md for API conventions
→ Agent follows .neolit/api.md for domain specifics

Prompts = task type workflows
Docs = domain knowledge (API, UI, schemas, etc)
