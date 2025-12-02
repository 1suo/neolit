# Component Integration

How components communicate across containers.

**[PROJECT_SPECIFIC: Document integration patterns]**

## Web App → API Server

**Protocol:** HTTP/REST
**Auth:** Bearer token
**Data format:** JSON

Example:
```javascript
fetch('/api/users/123', {
  headers: { 'Authorization': 'Bearer TOKEN' }
})
```

---

## API Server → Database

**Protocol:** [Database driver]
**Pattern:** Repository pattern
**Transactions:** [When used]

---

## API Server → External APIs

**Services:**
- [Service name]: [Purpose, auth method]

**Error handling:** [Strategy]
