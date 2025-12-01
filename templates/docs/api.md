# API Documentation

**Base URL:** `http://localhost:PORT` (development)  
**Production URL:** `https://api.example.com`  
**Version:** 1.0.0  
**Last Updated:** YYYY-MM-DD

---

## Authentication

All authenticated endpoints require a token in the Authorization header:

```
Authorization: Bearer <token>
```

### Getting a Token

**POST** `/api/auth/login`

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1...",
  "user": {
    "id": "123",
    "email": "user@example.com"
  }
}
```

---

## Endpoints

### Resource Name

#### List Resources

**GET** `/api/resources`

**Query Parameters:**
- `page` (optional) - Page number (default: 1)
- `limit` (optional) - Items per page (default: 20, max: 100)
- `filter` (optional) - Filter criteria

**Response:**
```json
{
  "data": [
    {
      "id": "123",
      "field1": "value1",
      "field2": "value2",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "pages": 5
  }
}
```

#### Get Single Resource

**GET** `/api/resources/:id`

**Response:**
```json
{
  "id": "123",
  "field1": "value1",
  "field2": "value2",
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-02T00:00:00Z"
}
```

#### Create Resource

**POST** `/api/resources`

**Request:**
```json
{
  "field1": "value1",
  "field2": "value2"
}
```

**Response:**
```json
{
  "id": "124",
  "field1": "value1",
  "field2": "value2",
  "createdAt": "2024-01-03T00:00:00Z"
}
```

#### Update Resource

**PUT** `/api/resources/:id`

**Request:**
```json
{
  "field1": "new_value1",
  "field2": "new_value2"
}
```

**Response:**
```json
{
  "id": "123",
  "field1": "new_value1",
  "field2": "new_value2",
  "updatedAt": "2024-01-03T00:00:00Z"
}
```

#### Delete Resource

**DELETE** `/api/resources/:id`

**Response:**
```json
{
  "success": true,
  "message": "Resource deleted"
}
```

---

## Error Responses

All error responses follow this format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {}
  }
}
```

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid input data |
| `UNAUTHORIZED` | 401 | Missing or invalid authentication |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Resource conflict (e.g., duplicate) |
| `INTERNAL_ERROR` | 500 | Server error |

---

## Rate Limiting

- **Limit:** 100 requests per minute per IP
- **Headers:**
  - `X-RateLimit-Limit`: Maximum requests
  - `X-RateLimit-Remaining`: Remaining requests
  - `X-RateLimit-Reset`: Time when limit resets (Unix timestamp)

**Response when rate limited:**
```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please try again later.",
    "retryAfter": 60
  }
}
```

---

## Webhook Events

If your API supports webhooks:

### Webhook Payload Format

```json
{
  "event": "resource.created",
  "timestamp": "2024-01-01T00:00:00Z",
  "data": {
    "id": "123",
    "field1": "value1"
  }
}
```

### Event Types

- `resource.created` - New resource created
- `resource.updated` - Resource updated
- `resource.deleted` - Resource deleted

---

## Examples

### Using cURL

```bash
# Get list of resources
curl -X GET https://api.example.com/api/resources \
  -H "Authorization: Bearer <token>"

# Create resource
curl -X POST https://api.example.com/api/resources \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"field1": "value1", "field2": "value2"}'
```

### Using JavaScript (fetch)

```javascript
// Get list of resources
const response = await fetch('https://api.example.com/api/resources', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
const data = await response.json();

// Create resource
const response = await fetch('https://api.example.com/api/resources', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    field1: 'value1',
    field2: 'value2'
  })
});
const data = await response.json();
```

---

## Versioning

API version is included in the URL path: `/api/v1/resources`

Breaking changes will increment the major version. Previous versions will be supported for 6 months after a new version is released.

---

## Support

For API issues or questions:
- Email: api-support@example.com
- Docs: https://docs.example.com
- Status: https://status.example.com
