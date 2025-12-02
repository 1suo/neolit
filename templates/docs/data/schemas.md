# Data Schemas

## Entity: User

**Attributes:**
- id: string (PK)
- email: string (unique)
- name: string
- createdAt: datetime

**Relationships:**
- has-many: Post
- has-one: Profile

**Invariants (MUST always be true):**
- User.email must be unique
- User.email must be valid format
- User.id never changes once set

**Indexes:**
- Primary: id
- Unique: email
- Index: createdAt (for queries)

---

## Entity: Post

**Attributes:**
- id: string (PK)
- userId: string (FK → User.id)
- title: string
- content: text
- createdAt: datetime

**Relationships:**
- belongs-to: User

**Invariants:**
- Post.userId must reference existing User
- Post.title cannot be empty

**Indexes:**
- Primary: id
- Foreign: userId
- Index: createdAt
