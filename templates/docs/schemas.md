# Data Schemas

**[PROJECT_SPECIFIC: Document entities, relationships, invariants]**

## Entity: User

**Attributes:**
- id: string (primary key)
- email: string (unique)
- name: string
- createdAt: datetime

**Relationships:**
- has-many: Posts
- has-one: Profile

**Invariants (MUST always be true):**
- User.email must be unique
- User.email must be valid format
- User.id never changes once set

**Indexes:**
- Primary: id
- Unique: email
- Index: createdAt (for sorting)

---

## Entity: Post

[Same structure]
