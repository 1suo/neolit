# CONTAINER Level Template

**Location:** Deployable unit directory (`api/NEOLIT.md`, `worker/NEOLIT.md`, `frontend/NEOLIT.md`)

**Size:** 60-80 lines

**Use:** ONLY for separately deployable units (optional)

---

## Template

````markdown
# API Server Container

**Level:** CONTAINER

## Purpose
REST API for client applications (web, mobile)

## Deployment
- **Runtime:** Node.js 18
- **Port:** 3000 (HTTP)
- **Dependencies:** PostgreSQL 15, Redis 7
- **Process:** PM2 / Docker container
- **Scaling:** Horizontal (multiple instances)

## Components
- **[Auth](auth/NEOLIT.md)** - Authentication and authorization
- **[Users](users/NEOLIT.md)** - User management
- **[Payments](payments/NEOLIT.md)** - Payment processing
- **[Database](database/NEOLIT.md)** - Database access layer

## Technology Stack
- Framework: Express.js 4.x
- Database: PostgreSQL 15
- Cache: Redis 7
- Auth: JWT tokens
- Validation: Joi

## API Structure
```
POST   /api/auth/login
POST   /api/auth/register
GET    /api/users/:id
PUT    /api/users/:id
POST   /api/payments/charge
GET    /api/payments/:id
```

## Constraints

**MUST:**
- Authenticate all requests (except /auth/*)
- Rate-limit endpoints (100 req/min per IP)
- Return JSON errors with proper status codes
- Log all requests with correlation ID

**MUST NOT:**
- Expose internal error details
- Allow SQL injection
- Skip input validation
- Return stack traces in production

## Related
- **[System Overview](../NEOLIT.md)** - System architecture
- **[Worker Container](../worker/NEOLIT.md)** - Background jobs
````

---

## Required Sections

1. **Purpose** - What this deployable does (1-2 sentences)
2. **Deployment** - Runtime, port, dependencies, process management
3. **Components** - List of functional components with links
4. **Technology Stack** - Frameworks, libraries, tools
5. **API Structure** (if applicable) - Endpoint overview
6. **Constraints** - Container-specific MUST/MUST NOT

---

## When to Use

**Create CONTAINER level ONLY when:**
- Directory contains separately deployable unit
- Runs independently with own runtime/process
- Examples: API server, worker service, frontend app

**Skip when:**
- Single deployable application
- Just source code directory (src/)
