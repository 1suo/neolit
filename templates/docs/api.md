# API Documentation

**[PROJECT_SPECIFIC: Fill with API patterns and endpoints]**

## Design Principles

RESTful, JSON, stateless
Authentication: [method]
Error format: [standard]

See: [adr/XXX-api-design.md](adr/)

---

## Endpoints

### POST /api/auth/login

**Purpose:** Authenticate user

**Request:**
```json
{
  "email": "string",
  "password": "string"
}
```

**Response (200):**
```json
{
  "token": "string",
  "user": { "id": "string", "email": "string" }
}
```

**Errors:**
- 401: Invalid credentials
- 400: Validation failed

---

### GET /api/users/:id

[Same structure]
