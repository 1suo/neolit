# Component: Controllers

**Responsibility:** Handle HTTP requests, call services, return responses

---

## AuthController

**Interface:**
```javascript
POST /api/auth/login
Request: { email: string, password: string }
Response: { token: string, user: User }
Errors: 400 (validation), 401 (invalid credentials)
```

**Implementation:**
```javascript
async function login(req, res) {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  
  try {
    const result = await authService.login(email, password);
    res.json(result);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
}
```

**Location:** `api/auth/login.js` or `controllers/AuthController.js`

---

## UserController

**Interface:**
```javascript
GET /api/users/:id
Auth: Required
Response: User
Errors: 401 (no auth), 404 (not found)
```

**Implementation:**
```javascript
async function getUser(req, res) {
  const { id } = req.params;
  
  const user = await userService.getUserById(id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  res.json(user);
}
```

**Location:** `api/users/[id].js` or `controllers/UserController.js`
