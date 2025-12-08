# COMPONENT Level Template

**Location:** Functional component directory (`src/auth/NEOLIT.md`, `api/users/NEOLIT.md`)

**Size:** 100-200 lines

**Use:** Every functional component (always)

---

## Template

````markdown
# Auth Component

**Level:** COMPONENT

## Purpose
Authentication and authorization for the application

## Architecture

### Design Pattern
JWT-based stateless authentication

**Rationale:** Scalable, no server-side session storage, works across multiple instances

**Alternatives considered:**
- Session-based auth (rejected: requires sticky sessions, state management overhead)
- OAuth only (rejected: need custom auth for API keys)

### Components (files)
- `authenticate.js` - Credential validation logic
- `jwt.js` - Token generation and verification
- `middleware.js` - Express authentication middleware
- `password.js` - Password hashing utilities

### Data Flow
```
Login Request
  → validate credentials (authenticate.js)
  → compare hash (password.js)
  → generate JWT (jwt.js)
  → return token

Authenticated Request
  → extract token (middleware.js)
  → verify token (jwt.js)
  → attach user to request
  → proceed to handler
```

## API

### authenticate(email, password)
```typescript
function authenticate(
  email: string,     // MUST be valid email format
  password: string   // MUST be non-empty, min 8 chars
): Promise<User | null>
```

**Returns:** User object if valid credentials, null if invalid

**MUST:**
- Validate email format before processing
- Hash password before comparison using bcrypt
- Log authentication attempts (success and failure)
- Rate-limit failed attempts (5/min per IP)

**MUST NOT:**
- Log passwords or password hashes
- Return detailed error messages (security risk)
- Skip input validation

### generateToken(user)
```typescript
function generateToken(
  user: User        // MUST have id and role properties
): string           // JWT token string
```

**Returns:** JWT token string, expires in 24 hours

**MUST:**
- Set expiration claim (24 hours)
- Include only necessary claims (id, role)
- Sign with secret from environment

**MUST NOT:**
- Include sensitive data (password, email)
- Create tokens without expiration

### verifyToken(token)
```typescript
function verifyToken(
  token: string     // JWT token string
): TokenPayload | null
```

**Returns:** Decoded token payload if valid, null if invalid/expired

**MUST:**
- Verify signature
- Check expiration
- Handle errors gracefully

## Data Structures

### User
```typescript
interface User {
  id: string;           // UUID v4, MUST be unique
  email: string;        // MUST be validated email format
  passwordHash: string; // bcrypt hash, MUST use cost factor 10+
  role: UserRole;       // 'admin' | 'user'
  createdAt: Date;      // ISO 8601 timestamp
  lastLogin?: Date;     // ISO 8601 timestamp, optional
}
```

**Constraints:**
- id: MUST be UUID v4 format
- email: MUST match regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`
- passwordHash: MUST be bcrypt hash with cost 10+
- role: MUST be one of defined UserRole values

### TokenPayload
```typescript
interface TokenPayload {
  userId: string;   // User ID from database
  role: UserRole;   // User role
  exp: number;      // Unix timestamp, expiration time
  iat: number;      // Unix timestamp, issued at time
}
```

### UserRole
```typescript
type UserRole = 'admin' | 'user';
```

## Constraints

**Design:**
- MUST be stateless (no server-side session storage)
- SHOULD support multiple authentication providers in future (OAuth, SAML)
- MUST work across multiple server instances

**Implementation:**
- MUST use bcrypt with cost factor 10 or higher
- MUST expire tokens after 24 hours maximum
- MUST validate all inputs before processing
- MUST rate-limit login attempts (5 per minute per IP)
- MUST use constant-time comparison for passwords

**Security:**
- MUST NOT log sensitive data (passwords, tokens, hashes)
- MUST NOT return detailed error messages (avoid information leakage)
- MUST NOT hash passwords client-side (always server-side)
- MUST hash password before any comparison operation

## Related
- **[User Component](../user/NEOLIT.md)** - User data management
- **[API Middleware](../api/NEOLIT.md)** - Request authentication
- **[Container](../NEOLIT.md)** - Parent container (if exists)
- **[System](../../NEOLIT.md)** - System overview
- **[Workflow: User Login](../../NEOLIT.md#user-login)** - Login workflow
````

---

## Required Sections

1. **Purpose** - What component does (1-2 sentences)
2. **Architecture**
   - Design Pattern (with rationale and alternatives)
   - Components (files)
   - Data Flow (visual)
3. **API** - All functions with exact signatures, MUST/MUST NOT
4. **Data Structures** - All types with exact fields and constraints
5. **Constraints** - Design, Implementation, Security
6. **Related** - Links to related components and workflows
