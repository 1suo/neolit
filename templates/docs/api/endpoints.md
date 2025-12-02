# API Endpoints

**Agent context: What APIs exist, how to call them.**

---

## POST /api/auth/login

**Purpose:** Authenticate user, get token

**Request:**
```json
{
  "email": "user@example.com",
  "password": "secret"
}
```

**Response 200:**
```json
{
  "token": "jwt-token-here",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "user"
  }
}
```

**Errors:**
- 400: Missing email or password
- 401: Invalid credentials

**Implementation:** `api/auth/login.js`

---

## GET /api/users/:id

**Purpose:** Get user by ID

**Auth:** Required (Bearer token)

**Response 200:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "name": "John Doe",
  "role": "user"
}
```

**Errors:**
- 401: Not authenticated
- 404: User not found

**Implementation:** `api/users/[id].js`

---

**When adding endpoint:** Document here with examples.
