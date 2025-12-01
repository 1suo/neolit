# Contributing Guide

Thank you for contributing! This guide helps you work effectively with this codebase.

---

## Getting Started

### Prerequisites

- [List required software and versions]
- [e.g., Node.js 18+, Python 3.9+, etc.]

### Setup

```bash
# Clone repository
git clone <repository-url>
cd <project-name>

# Install dependencies
[installation command]

# Run development server
[dev server command]

# Run tests
[test command]
```

---

## Development Workflow

### 1. Pick a Task

- Check `SYSTEM.org` for available tasks
- Check module-specific `TODO.org` files
- Discuss new features before implementing

### 2. Create a Branch

```bash
git checkout -b feature/description
# or
git checkout -b fix/description
```

### 3. Make Changes

- Follow existing code patterns
- Update documentation in same commit
- Write/update tests for new code
- Keep commits small and focused

### 4. Test Your Changes

```bash
# Run linter
[linting command]

# Run tests
[test command]

# Manual testing
[manual test steps]
```

### 5. Commit

```bash
git add .
git commit -m "Brief description

- Detailed change 1
- Detailed change 2
- Updated documentation"
```

### 6. Submit for Review

```bash
git push origin feature/description
```

Create a pull request with:
- Clear description of changes
- Link to related issue/task
- Screenshots if UI changes
- Test results

---

## Code Style

### General Principles

- **Clarity over cleverness** - Write obvious code
- **Consistency** - Follow existing patterns
- **Simplicity** - Avoid unnecessary complexity

### Naming Conventions

**[PROJECT_SPECIFIC]**

Example:
- Variables: `camelCase`
- Functions: `camelCase`
- Classes: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`
- Files: `kebab-case.js`

### Code Formatting

**[PROJECT_SPECIFIC]**

Example:
- Use 2 spaces for indentation
- Max line length: 100 characters
- Always use semicolons
- Prefer `const` over `let`
- Use template literals for string interpolation

### Comments

- Document **why**, not **what**
- Update comments when code changes
- Remove commented-out code
- Use JSDoc/docstrings for public APIs

```javascript
// Good: Explains reasoning
// Using setTimeout to debounce rapid clicks
setTimeout(() => handleClick(), 300);

// Bad: States the obvious
// Set timeout to 300ms
setTimeout(() => handleClick(), 300);
```

---

## Testing

### Test Structure

**[PROJECT_SPECIFIC]**

Example:
```javascript
describe('Feature', () => {
  it('should do expected behavior', () => {
    // Arrange
    const input = setupInput();
    
    // Act
    const result = performAction(input);
    
    // Assert
    expect(result).toBe(expected);
  });
});
```

### What to Test

- ✅ Core business logic
- ✅ Edge cases and error conditions
- ✅ API contracts
- ✅ Critical user flows
- ❌ Implementation details
- ❌ Third-party library code

### Test Coverage

- Aim for [X]% coverage on critical paths
- 100% coverage not required
- Focus on high-value tests

---

## Documentation

### When to Update Docs

**MUST update:**
- API changes → `docs/api.md`
- Architecture changes → `docs/architecture.md` and ADR
- Schema changes → `docs/architecture.md`
- Configuration changes → `README.md`

**SHOULD update:**
- New patterns → Module `README.md`
- Complex algorithms → Inline comments
- Setup changes → `README.md`

### Writing Documentation

- Be concise and clear
- Include code examples
- Link related documentation
- Keep it up-to-date

---

## Architecture Decision Records (ADRs)

### When to Create an ADR

Create an ADR for:
- Significant architectural changes
- Technology choices
- Design pattern decisions
- Breaking changes

Don't create ADRs for:
- Minor bug fixes
- Code style preferences
- Obvious choices

### ADR Template

See `docs/adr/template.md` for the template.

### ADR Workflow

1. Create ADR with status "Proposed"
2. Discuss with team
3. Update status to "Accepted" or "Rejected"
4. Implement the decision
5. Reference ADR number in related code

---

## Git Workflow

### Commit Messages

Format:
```
Brief description (50 chars or less)

- Detailed point 1
- Detailed point 2
- Updated relevant documentation

Closes #123
```

### Branch Names

- `feature/short-description` - New features
- `fix/short-description` - Bug fixes
- `docs/short-description` - Documentation only
- `refactor/short-description` - Code refactoring

### Pull Requests

**Before submitting:**
- [ ] Code follows style guide
- [ ] Tests pass
- [ ] Documentation updated
- [ ] No merge conflicts
- [ ] Commit messages are clear

**PR Description should include:**
- What changed and why
- How to test
- Screenshots (if UI changes)
- Link to issue/task

---

## Common Issues

### Issue: [Common Problem]

**Solution:** [How to fix it]

### Issue: Tests Failing Locally

**Solution:**
```bash
# Clear cache and reinstall
[clear cache commands]
```

---

## Getting Help

- Check existing documentation first
- Search closed issues and PRs
- Ask in team chat/forum
- Create a detailed issue

When asking for help, include:
- What you tried
- Error messages
- Relevant code snippets
- Environment details

---

## Code Review Guidelines

### For Authors

- Keep PRs small and focused
- Respond to feedback promptly
- Don't take feedback personally
- Update PR based on feedback

### For Reviewers

- Be constructive and kind
- Focus on the code, not the person
- Explain your reasoning
- Approve when it's good enough, not perfect

### Review Checklist

- [ ] Code follows existing patterns
- [ ] Tests are adequate
- [ ] Documentation is updated
- [ ] No obvious bugs or security issues
- [ ] Performance is acceptable

---

## Resources

- [Project Documentation](../README.md)
- [Architecture Guide](./architecture.md)
- [API Documentation](./api.md)
- [ADR Index](./adr/)
