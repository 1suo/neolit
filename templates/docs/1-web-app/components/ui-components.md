# Component: UI Components

**Responsibility:** Reusable presentational components

---

## Button

**Interface:**
```javascript
Props: {
  variant: 'primary' | 'secondary' | 'danger',
  disabled: boolean,
  onClick: () => void
}
```

**Usage:**
```vue
<Button variant="primary" @click="handleClick">Save</Button>
```

**Location:** `components/Button.vue`

---

## Form

**Interface:**
```javascript
Props: {
  onSubmit: (data: FormData) => void,
  loading: boolean
}
Slots: default (form content)
```

**Usage:**
```vue
<Form @submit="handleSubmit" :loading="loading">
  <input v-model="email" />
  <Button type="submit">Submit</Button>
</Form>
```

**Location:** `components/Form.vue`
