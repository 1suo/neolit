# API Endpoints

**[PROJECT_SPECIFIC]**

### POST /api/auth/login

Request: `{ "email": "string", "password": "string" }`
Response (200): `{ "token": "string", "user": {...} }`
Errors: 401, 400
