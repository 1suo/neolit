# API Layer

**Agent context: API patterns, what endpoints exist.**

---

## Files

- [endpoints.md](endpoints.md) - What APIs exist, request/response
- [patterns.md](patterns.md) - Auth, errors, validation patterns

---

## Structure

```
api/
  auth/
    login.js        → POST /api/auth/login
    logout.js       → POST /api/auth/logout
  users/
    [id].js         → GET /api/users/:id
    index.js        → GET /api/users
```

**Pattern:** File path = endpoint path

---

**Related:**
- See [../data/schemas.md](../data/schemas.md) for data structures
- See [patterns.md](patterns.md) for auth/error handling
