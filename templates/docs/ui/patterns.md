# UI Patterns

## File Structure

```
components/
  Button/
    Button.vue
    Button.spec.js
  Form/
    Form.vue
    Form.spec.js
```

## Naming Conventions

- Components: PascalCase (Button, UserProfile)
- Props: camelCase (onClick, userName)
- Events: kebab-case (user-updated)
- CSS classes: kebab-case (btn-primary)

## State Management

**Local state:** Component state for UI-only concerns
**Shared state:** Store/composable for cross-component data

```javascript
// composables/useAuth.js
export const useAuth = () => {
  const user = ref(null);
  const login = async (credentials) => { ... };
  return { user, login };
};
```

## Form Handling

1. Use Form component wrapper
2. Define validation schema
3. Handle submit in parent
4. Show errors inline

## Error Handling

Display errors near relevant input:
```jsx
<Input name="email" error={errors.email} />
```
