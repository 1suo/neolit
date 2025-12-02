# Database: Schemas (C4 Level 3)

**Container:** Database
**Responsibility:** Data structure definition

---

## User Table/Collection

**Schema:**
```javascript
{
  id: "uuid" (PK),
  email: "string" (unique, not null),
  passwordHash: "string" (not null),
  name: "string",
  role: "user|admin" (not null, default: "user"),
  createdAt: "timestamp" (not null)
}
```

**Invariants:**
- `email` MUST be unique across all users
- `email` MUST match email format regex
- `id` is immutable after creation
- `role` MUST be exactly "user" or "admin"
- `passwordHash` never exposed in API responses

**Indexes:**
- Primary: `id`
- Unique: `email`

**Relations:**
- User has many Posts (1:N)

**Referenced by:** UserRepository (see [../2-api-server/components/repositories.md](../2-api-server/components/repositories.md))

---

## Post Table/Collection

**Schema:**
```javascript
{
  id: "uuid" (PK),
  userId: "uuid" (FK → User.id, not null),
  title: "string" (not null),
  content: "text",
  status: "draft|published" (not null, default: "draft"),
  createdAt: "timestamp" (not null),
  updatedAt: "timestamp" (not null)
}
```

**Invariants:**
- `userId` MUST reference existing User.id (foreign key constraint)
- `title` MUST NOT be empty string
- `status` MUST be exactly "draft" or "published"

**Indexes:**
- Primary: `id`
- Foreign: `userId` (for lookups by user)
- Index: `createdAt` (for sorting)

**Relations:**
- Post belongs to User (N:1)

**Referenced by:** PostRepository
