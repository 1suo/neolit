# Component: State Management

**Responsibility:** Shared application state, business logic on client

---

## useAuth Composable

**Interface:**
```javascript
export function useAuth() {
  return {
    user: Ref<User | null>,
    token: Ref<string | null>,
    login: (email: string, password: string) => Promise<void>,
    logout: () => void,
    isAuthenticated: ComputedRef<boolean>
  }
}
```

**Implementation:**
```javascript
const user = ref(null);
const token = ref(null);

async function login(email, password) {
  const res = await apiClient.post('/auth/login', { email, password });
  user.value = res.user;
  token.value = res.token;
}
```

**Usage:**
```vue
<script setup>
const { user, login, isAuthenticated } = useAuth();
</script>
```

**Location:** `composables/useAuth.js`
