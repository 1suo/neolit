# Data Access Patterns

## Repository Pattern

Each entity has repository for data access.

**Example: UserRepository**

```javascript
class UserRepository {
  async findById(id) {
    return db.users.findOne({ id });
  }
  
  async findByEmail(email) {
    return db.users.findOne({ email });
  }
  
  async create(userData) {
    // Validate invariants before insert
    return db.users.insert(userData);
  }
  
  async update(id, changes) {
    // Validate invariants before update
    return db.users.update({ id }, changes);
  }
}
```

## Transactions

Use for operations affecting multiple entities:

```javascript
await db.transaction(async (tx) => {
  await tx.users.update(...);
  await tx.posts.insert(...);
});
```

## Query Patterns

- Always use indexes for lookups
- Paginate large result sets
- Validate invariants before write operations
