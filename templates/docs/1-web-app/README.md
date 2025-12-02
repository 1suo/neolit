# Container: Web Application (C4 Level 2)

**Technology:** [Vue/React/etc]
**Responsibility:** User interface and client-side logic

---

## Components (C4 Level 3)

Components within this container:

- [components/ui-components.md](components/ui-components.md) - Reusable UI components
- [components/pages.md](components/pages.md) - Page-level components (routes)
- [components/state.md](components/state.md) - State management (composables/stores)
- [components/api-client.md](components/api-client.md) - API communication layer

---

## Component Interfaces

### Pages → State

Pages use composables for shared state:
```javascript
const { user, login } = useAuth();
```

### State → API Client

State composables call API client:
```javascript
const data = await apiClient.get('/users/123');
```

### API Client → API Server Container

HTTP calls to API Server (see [../system.md](../system.md#container-interfaces))
