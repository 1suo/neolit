# Add Task to TODO.org

Syntax:

```org
** TODO [TASK-ID] Brief description
   SCHEDULED: <YYYY-MM-DD>
   :PROPERTIES:
   :CREATED: [YYYY-MM-DD]
   :PRIORITY: A
   :END:
   #tag1 #tag2

*** Context for Agent
    Brief context specific to this task.
    Data structures involved: Entity { fields }
    Files to check: path/to/file.ext
   
*** Requirements
    - Requirement 1
    - Requirement 2
```

Priority: A (high), B (medium), C (low)
Tags: #bug, #feature, #api, #ui, #schema, etc
TASK-ID format: BUG-NNN, FEAT-NNN, DEBT-NNN, DOC-NNN, TEST-NNN
