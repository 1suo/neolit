# Component: Repositories

**Responsibility:** Data access, CRUD operations

**Interface to:** Database Container

---

## UserRepository

**Interface:**
```javascript
class UserRepository {
  findById(id: string): Promise<User | null>
  findByEmail(email: string): Promise<User | null>
  create(userData: CreateUserData): Promise<User>
  update(id: string, changes: Partial<User>): Promise<User>
  delete(id: string): Promise<void>
}
```

**Implementation:**
```javascript
class UserRepository {
  async findById(id) {
    return await db.users.findOne({ id });
  }
  
  async create(userData) {
    return await db.users.insert(userData);
  }
  
  async update(id, changes) {
    // Never allow id change (invariant)
    delete changes.id;
    return await db.users.update({ id }, changes);
  }
}
```

**Location:** `repositories/UserRepository.js`

**Schema:** See [../../3-database/schemas.md](../../3-database/schemas.md#user)
