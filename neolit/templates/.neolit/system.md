# System Architecture

**Entry point for understanding system structure.**

Agent reads this to understand system organization and component interfaces.

---

## Project Structure

**[Fill based on actual project - can follow C4 or document actual structure]**

### Option A: If following C4 model

Document as: System Context → Containers → Components (see template below)

### Option B: If existing structure differs

Document actual directories and responsibilities:

```
src/
├── controllers/ - HTTP request handlers
├── services/ - Business logic
├── models/ - Data access
├── utils/ - Shared utilities
```

**For each directory, document:**
- Responsibility: What it does
- Key files/patterns
- Interfaces: How it communicates with other directories

---

## Level 1: System Context (if using C4)

**System:** [Project Name]

**Purpose:** [What problem does it solve?]

**Actors:**
- User: [Primary user type - what they do]
- Admin: [Admin user type - what they do]

**External Systems:**
- [External API]: [Purpose, protocol (REST/GraphQL), auth method]
- [Payment Service]: [Purpose, when used]

**System Boundary:**
- Manages: [What's inside system]
- Integrates with: [What's outside]

**Interface:**
```
User → [Web Browser] → System
System → [HTTPS REST] → External API
```

---

## Level 2: Containers

**Container = Deployable unit (application, database, service)**

### Container: Web Application

**Technology:** [Framework, e.g., Vue.js, React]
**Runs:** Browser
**Responsibility:** User interface, client-side logic
**Provides:** UI to users
**Depends on:** API Server (via HTTP)

**Interface:**
- Outbound: `HTTP REST` to API Server at `/api/*`
- Data: JSON request/response

### Container: API Server

**Technology:** [Framework, e.g., Node.js/Express, Python/FastAPI]
**Runs:** Server (port 8080)
**Responsibility:** Business logic, data validation, orchestration
**Provides:** REST API to Web App
**Depends on:** Database, External APIs

**Interface:**
- Inbound: `HTTP REST` from Web App
- Outbound: `Database protocol` to Database
- Outbound: `HTTPS REST` to External APIs
- Auth: Bearer token in headers

### Container: Database

**Technology:** [Database type, e.g., PostgreSQL, MongoDB]
**Runs:** Server (port 5432)
**Responsibility:** Data persistence
**Provides:** Data storage
**Depends on:** Nothing

**Interface:**
- Inbound: `SQL/NoSQL` from API Server only
- Access control: API Server credentials only

---

## Level 3: Components (within containers)

See container-specific docs:
- Web App components: [1-web-app/](1-web-app/)
- API Server components: [2-api-server/](2-api-server/)
- Database schema: [3-database/](3-database/)

---

## Container Interfaces (Critical)

### Web App → API Server

**Protocol:** HTTP/REST
**Auth:** Bearer token in `Authorization` header
**Base URL:** `/api/v1`
**Data Format:** JSON
**Error Format:** `{ "error": "message", "code": "ERROR_CODE" }`

### API Server → Database

**Protocol:** [SQL/MongoDB/etc]
**Connection:** Connection pool, max N connections
**Access:** Repository pattern (see [2-api-server/components/repositories.md](2-api-server/components/repositories.md))
**Transactions:** Used for multi-table operations

### API Server → External APIs

**Protocol:** HTTPS/REST
**Auth:** [API key in header / OAuth]
**Retry:** 3 attempts with exponential backoff
**Timeout:** 30 seconds
**Circuit breaker:** Open after 5 failures

---

## Cross-Cutting Concerns

- **Workflows:** See [workflows.md](workflows.md) for end-to-end user journeys
- **Security:** See [adr/](adr/) for auth/authz decisions
- **Error Handling:** Consistent error format across all containers

---

**When agent works on task:**
1. Read this file to understand where component lives
2. Go to container-specific docs (1-web-app, 2-api-server, 3-database)
3. Check interface specs if crossing container boundary
