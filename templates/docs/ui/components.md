# UI Components

## Component: Button

**Purpose:** Standard button for actions

**Props:**
- variant: 'primary' | 'secondary' | 'danger'
- size: 'sm' | 'md' | 'lg'
- disabled: boolean

**Usage:**
```jsx
<Button variant="primary" size="md" onClick={handleClick}>
  Submit
</Button>
```

**Location:** `components/Button.vue` or `components/Button.jsx`

---

## Component: Form

**Purpose:** Form wrapper with validation

**Props:**
- onSubmit: (data) => void
- schema: validation schema

**Pattern:**
```jsx
<Form onSubmit={handleSubmit} schema={userSchema}>
  <Input name="email" />
  <Input name="password" type="password" />
  <Button type="submit">Login</Button>
</Form>
```

---

## Component: Modal

**Purpose:** Overlay dialog

**Props:**
- open: boolean
- onClose: () => void
- title: string

**Usage:**
```jsx
<Modal open={isOpen} onClose={handleClose} title="Confirm">
  <p>Are you sure?</p>
  <Button onClick={confirm}>Yes</Button>
</Modal>
```
