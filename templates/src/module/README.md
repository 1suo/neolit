# Module Name

**Purpose:** Brief description of what this module does and why it exists.

---

## Responsibilities

What this module is responsible for:

- Responsibility 1
- Responsibility 2
- Responsibility 3

What this module is **NOT** responsible for:

- Other module's job 1
- Other module's job 2

---

## Key Concepts

### Concept 1

Brief explanation of important concept or data structure in this module.

```javascript
// Example code or structure
```

### Concept 2

Another key concept relevant to understanding this module.

---

## Architecture

### File Structure

```
module/
  README.md       # This file
  TODO.org        # Task tracking
  index.js        # Public exports
  service.js      # Business logic
  repository.js   # Data access
  types.js        # Type definitions
  utils.js        # Helper functions
```

### Dependencies

**Internal:**
- `../other-module` - For [purpose]

**External:**
- `library-name` - For [purpose]

### Pattern

This module follows [pattern name] pattern:

```
[ASCII diagram or description]
```

---

## Data Structures

### Primary Data Type

```typescript
interface MainType {
  id: string;
  field1: Type;
  field2: Type;
}
```

**Invariants:**
- Constraint 1
- Constraint 2

**Related Schemas:** (from docs/architecture.md)
- EntityName - Brief description, link to section
- OtherEntity - Brief description, link to section

---

## Related Context

### Related Modules
- `../other-module` - For [purpose] - See [link to README]
- `../another-module` - For [purpose]

### Related API Endpoints
**Endpoints this module uses:**
- `GET /api/resource` - To fetch X
- `POST /api/other` - To create Y

**Endpoints this module provides:**
- `GET /api/this-resource` - Returns Z

### Related ADRs
- [ADR-XXX: Decision Name](../../docs/adr/XXX-name.md) - Why relevant

---

## Data Flow (This Module)

```
Input → Validation → Processing → Storage → Output
  ↓         ↓            ↓           ↓         ↓
 Type1   Rules check  Transform    DB call   Type2
```

**Components involved:**
1. Component A - Does X
2. Component B - Does Y

---

## API

### Public Functions

#### `functionName(param1, param2)`

**Purpose:** What this function does.

**Parameters:**
- `param1` (Type) - Description
- `param2` (Type) - Description

**Returns:** Type - Description

**Throws:**
- `ErrorType` - When [condition]

**Example:**
```javascript
const result = functionName(value1, value2);
```

#### `anotherFunction(param)`

[Same structure as above]

---

## Usage Examples

### Example 1: Common Use Case

```javascript
// Setup
const input = createInput();

// Usage
const result = moduleFunction(input);

// Result
console.log(result); // Expected output
```

### Example 2: Edge Case Handling

```javascript
// Example showing how to handle edge cases
try {
  const result = riskyOperation();
} catch (error) {
  // Handle error appropriately
}
```

---

## Constraints & Preferences

### MUST (Invariants)

- MUST NOT violate constraint X (see ADR-XXX)
- MUST always validate input before processing
- MUST maintain consistency with [other module]

### SHOULD (Preferences)

- SHOULD use existing utility functions from utils.js
- SHOULD follow naming convention: [pattern]
- SHOULD add tests for new public functions

### MAY (Optional)

- MAY optimize performance if profiling shows bottleneck
- MAY add caching for expensive operations

---

## Pain Points

Current known issues or awkward aspects:

1. **[Issue description]**
   - Why it's a problem
   - Workaround for now
   - Link to TODO.org task for proper fix

2. **[Another issue]**
   - Details

---

## Testing

### Running Tests

```bash
[command to run module tests]
```

### Test Coverage

- Unit tests: [location]
- Integration tests: [location]
- Coverage goal: [percentage]

### Key Test Cases

- ✅ Normal operation with valid input
- ✅ Error handling for invalid input
- ✅ Edge case: [specific case]

---

## Related Documentation

- [Architecture Decision](../../docs/adr/XXXX-relevant-decision.md)
- [API Documentation](../../docs/api.md#module-section)
- [Parent Module](../parent-module/README.md)

---

## Implementation Notes

### Migration Path

If this module replaced something:
- Old approach: [description]
- New approach: [description]
- Migration guide: [steps or link]

### Performance Considerations

- Operation X is O(n) complexity
- Bottleneck is [specific part]
- Caching strategy: [description]

### Security Notes

- Input validation: [approach]
- Sensitive data: [how it's handled]
- Authentication: [how it's checked]

---

## Future Improvements

Ideas for future enhancement (not committed):

- Potential improvement 1
- Potential improvement 2

See `TODO.org` for tracked tasks.
