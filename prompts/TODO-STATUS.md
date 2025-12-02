# Task Status Management

Agents MODIFY tasks, don't create or delete them.

## Change Status

Edit headline keyword:

```org
** IN-PROGRESS [#A] Task description :tags:
** WAITING [#A] Task description :tags:
** DONE [#A] Task description :tags:
```

Status flow:
- `TODO` → `IN-PROGRESS`: Starting complex task
- `TODO` → `WAITING`: Simple task done, needs review
- `IN-PROGRESS` → `WAITING`: Complex task done
- Any → `DONE`: Obviously complete for simple tasks
- 'WAITING' → 'DONE' : Done by reviewer

In most cases, use `WAITING` for review instead of `DONE`.
Tasks in 

## Add Notes

```org
** WAITING [#A] Task description :tags:
   [YYYY-MM-DD]
   
*** Agent Notes
    [YYYY-MM-DD] Implemented X. Changed: src/module/file.ext
    Updated: .neolit/architecture.md#section, ADR-003
    Question: Should we also handle Y?
```

## Add Subtasks (for tracking work)

```org
** IN-PROGRESS [#A] Complex refactoring :feature:
   [YYYY-MM-DD]
   
*** Agent Subtasks
    - [X] Extract interface
    - [X] Update implementations
    - [ ] Update tests
    - [ ] Update docs
```

Agents can add checkboxes or subtasks for internal tracking.
Agents do NOT create new top-level tasks or delete tasks.
