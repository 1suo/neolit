# API Components (C4 Level 3)

**Container:** API Server

---

## Component Structure

- [endpoints.md](endpoints.md) - All API endpoints
- [patterns.md](patterns.md) - Request/response patterns, error handling
- [auth.md](auth.md) - Authentication/authorization for API

---

## Responsibility

Handle HTTP requests, validate input, execute business logic, return responses.

---

## Dependencies

- Database (data access)
- Auth service (verification)
- External APIs (integrations)

See: [../integration.md](../integration.md)
