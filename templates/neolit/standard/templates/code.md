# CODE Level Template

**Location:** Sub-component directory (`src/auth/utils/NEOLIT.md`)

**Size:** 30-80 lines

**Use:** ONLY for complex sub-components (3+ files, optional)

---

## Template

````markdown
# Auth Utilities

**Level:** CODE

## Purpose
Helper functions for authentication component

## Functions

### hashPassword(password)
```typescript
function hashPassword(
  password: string  // MUST be non-empty
): Promise<string>  // Returns bcrypt hash
```

**Implementation:** Uses bcrypt with cost factor 10

**MUST:**
- Validate password non-empty before hashing
- Use bcrypt (not other algorithms)
- Use cost factor 10 or higher

**Returns:** Bcrypt hash string

### comparePassword(plain, hash)
```typescript
function comparePassword(
  plain: string,    // Plaintext password
  hash: string      // Bcrypt hash
): Promise<boolean> // true if match, false otherwise
```

**Implementation:** Uses bcrypt.compare() for constant-time comparison

**MUST:**
- Use constant-time comparison (bcrypt.compare)
- Handle errors gracefully (return false on error)
- Never throw exceptions

**Returns:** Boolean indicating match

### validateEmail(email)
```typescript
function validateEmail(
  email: string
): boolean
```

**Implementation:** Uses regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`

**Returns:** true if valid email format, false otherwise

### generateSalt()
```typescript
function generateSalt(
  rounds?: number  // Optional, defaults to 10
): Promise<string>
```

**Implementation:** Uses bcrypt.genSalt()

**MUST:**
- Use rounds >= 10
- Default to 10 if not specified

**Returns:** Salt string for bcrypt

## Constants

```typescript
const BCRYPT_ROUNDS = 10;        // Bcrypt cost factor
const MIN_PASSWORD_LENGTH = 8;   // Minimum password length
const MAX_PASSWORD_LENGTH = 128; // Maximum password length
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // Email validation pattern
```

## Related
- **[Auth Component](../NEOLIT.md)** - Parent component
- **[Password Module](../password/NEOLIT.md)** - Password handling (if exists)
````

---

## Required Sections

1. **Purpose** - What these functions do (1 sentence)
2. **Functions** - Each function with:
   - Signature with types
   - Implementation description
   - MUST/MUST NOT rules
   - Returns description
3. **Constants** - All constants with descriptions
4. **Related** - Link to parent component

---

## When to Use

**Create CODE level ONLY when:**
- Sub-component has 3+ files
- Complex logic needs documentation
- Utilities used across multiple components

**Skip when:**
- Simple utility functions
- Self-explanatory code
- Single file
