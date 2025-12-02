# Containers (C4 Level 2)

**[PROJECT_SPECIFIC: Fill with container architecture]**

## Container 1: Web Application

**Technology:** [Framework/language]
**Responsibility:** User interface, client-side logic
**Exposes:** HTTP/HTTPS on port 3000
**Depends on:** API Server

---

## Container 2: API Server

**Technology:** [Framework/language]
**Responsibility:** Business logic, data access
**Exposes:** REST API on port 8080
**Depends on:** Database, External APIs

---

## Container 3: Database

**Technology:** [Database type]
**Responsibility:** Data persistence
**Access:** API Server only

---

Diagram:
```
[Browser] → [Web App] → [API Server] → [Database]
                            ↓
                      [External APIs]
```
