# Container: API Server (C4 Level 2)

**Technology:** [Node.js/Express, Python/FastAPI, etc]
**Responsibility:** Business logic, data validation, orchestration

---

## Components (C4 Level 3)

Components within this container:

- [components/controllers.md](components/controllers.md) - HTTP request handlers
- [components/services.md](components/services.md) - Business logic
- [components/repositories.md](components/repositories.md) - Data access layer
- [components/middleware.md](components/middleware.md) - Auth, validation, logging

---

## Component Interfaces

### Controllers → Services

Controllers delegate to services:
```javascript
const user = await userService.createUser(userData);
```

### Services → Repositories

Services use repositories for data:
```javascript
const user = await userRepository.findByEmail(email);
```

### Repositories → Database Container

DB queries to Database container (see [../system.md](../system.md#container-interfaces))

---

## Request Flow

```
HTTP Request
  ↓
Middleware (auth, validation)
  ↓
Controller (parse, validate)
  ↓
Service (business logic)
  ↓
Repository (data access)
  ↓
Database Container
```
