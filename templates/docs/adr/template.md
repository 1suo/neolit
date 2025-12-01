# ADR-XXXX: [Short Descriptive Title]

**Status:** Proposed | Accepted | Deprecated | Superseded by ADR-YYYY  
**Date:** YYYY-MM-DD  
**Deciders:** [List people involved in decision]

---

## Context

What is the issue we're addressing? What is the current situation?

- Background information
- Why this decision needs to be made now
- What problem are we trying to solve?
- What are the constraints?

Keep this section factual and objective. Avoid bias or leading language.

---

## Criteria

What requirements or factors influenced this decision?

- Performance requirements
- Security requirements
- Maintainability concerns
- Cost constraints
- Team expertise
- Timeline
- Other relevant factors

---

## Decision

What is the change we're making?

Be specific and clear:
- What approach are we taking?
- How will it be implemented?
- What are the key technical details?

Example:
```
We will use PostgreSQL for primary data storage instead of MongoDB.
All data access will go through the Repository pattern.
Migrations will be managed using [tool name].
```

---

## Consequences

### Positive

What benefits does this decision bring?

- Improved performance
- Better maintainability
- Reduced complexity
- Other advantages

### Negative

What drawbacks or tradeoffs does this decision have?

- Increased complexity in area X
- Performance impact on Y
- Learning curve for team
- Technical debt in Z

### Neutral

What changes are neither clearly positive nor negative?

- New dependency to manage
- Different deployment process
- Changed monitoring requirements

---

## Alternatives Considered

What other options did we evaluate and why were they not chosen?

### Alternative 1: [Name]

**Description:** Brief description

**Pros:**
- Advantage 1
- Advantage 2

**Cons:**
- Disadvantage 1
- Disadvantage 2

**Why not chosen:** Specific reason

### Alternative 2: [Name]

[Same structure as Alternative 1]

---

## Related Decisions

- **Related to:** ADR-XXXX - [Title]
- **Supersedes:** ADR-XXXX - [Title] (if applicable)
- **Superseded by:** ADR-XXXX - [Title] (if applicable)

---

## References

- [Link to relevant documentation]
- [Link to discussion or RFC]
- [Link to related issues]
- [External references]

---

## Implementation Notes

Optional section for implementation details:

- Migration plan
- Rollback strategy
- Timeline
- Dependencies
- Testing approach

---

## Examples

Optional section for code examples or diagrams illustrating the decision:

```javascript
// Example code showing the pattern
```

Or diagrams:
```
[ASCII diagram or link to diagram image]
```

---

## Follow-up

Optional section for things to revisit:

- [ ] Review this decision in 6 months
- [ ] Measure performance impact after implementation
- [ ] Gather team feedback after 3 months

---

## Notes

Any additional notes, discussions, or clarifications.
