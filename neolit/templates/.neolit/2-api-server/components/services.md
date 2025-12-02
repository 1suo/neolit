# Component: Services

**Responsibility:** Business logic, validation, orchestration

---

## AuthService

**Interface:**
```javascript
class AuthService {
  login(email: string, password: string): Promise<{ token: string, user: User }>
  verifyToken(token: string): Promise<User | null>
}
```

**Implementation:**
```javascript
class AuthService {
  async login(email, password) {
    const user = await userRepository.findByEmail(email);
    if (!user) throw new Error('Invalid credentials');
    
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new Error('Invalid credentials');
    
    const token = jwt.sign({ userId: user.id }, SECRET);
    return { token, user };
  }
}
```

**Location:** `services/AuthService.js`

---

## UserService

**Interface:**
```javascript
class UserService {
  getUserById(id: string): Promise<User | null>
  createUser(data: CreateUserData): Promise<User>
  updateUser(id: string, changes: Partial<User>): Promise<User>
}
```

**Implementation:**
```javascript
class UserService {
  async createUser(data) {
    // Validate email uniqueness (invariant)
    const exists = await userRepository.findByEmail(data.email);
    if (exists) throw new Error('Email already exists');
    
    // Hash password
    data.passwordHash = await bcrypt.hash(data.password);
    delete data.password;
    
    return await userRepository.create(data);
  }
}
```

**Location:** `services/UserService.js`
