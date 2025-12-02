# Update Task Status

Change status keyword:

```org
** IN-PROGRESS [TASK-ID] Description :tags:
** WAITING [TASK-ID] Description :tags:
** DONE [TASK-ID] Description :tags:
```

Status flow per neolit.org:
- TODO → IN-PROGRESS: Starting complex task
- TODO → WAITING: Simple task done, needs review
- IN-PROGRESS → WAITING: Complex task done (most common)
- Any → DONE: Obviously complete

Add notes:

```org
** WAITING [TASK-ID] Description :tags:
   [YYYY-MM-DD]
   
*** Agent Notes
    [YYYY-MM-DD] Completed. Changes: file.ext
    See: ADR-NNN, docs/architecture.md#section
```
