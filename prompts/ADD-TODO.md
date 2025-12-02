# Add Task to TODO.org

Org-mode task syntax:

```org
** TODO [TASK-ID] Brief description :tag1:tag2:tag3:
   [YYYY-MM-DD]
   
*** Context for Agent
    Brief context for this task.
    Data: Entity { field: type }
   
*** Requirements
    - Requirement 1
```

Status: TODO, IN-PROGRESS, WAITING, DONE
Priority (optional): [#A], [#B], [#C] after status
Tags: :tag1:tag2: at end of headline
TASK-ID: BUG-NNN, FEAT-NNN, DEBT-NNN, DOC-NNN, TEST-NNN
Date: [YYYY-MM-DD] timestamp on next line

Status changes by agents:
- TODO → IN-PROGRESS: Starting complex task
- TODO/IN-PROGRESS → WAITING: Done, needs review (most common)
- Any → DONE: Obviously complete

Add notes under "*** Agent Notes".
