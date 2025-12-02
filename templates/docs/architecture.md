# Architecture

Documentation organized by C4 model levels.

---

## Level 1: System Context

See: [context.md](context.md)

System boundaries, external actors, integrations.

---

## Level 2: Containers

See: [containers.md](containers.md)

Applications, databases, services that make up the system.

---

## Level 3: Components

Organized by container/domain:

- [api/](api/) - API components and endpoints
- [ui/](ui/) - UI components and patterns
- [data/](data/) - Data schemas and relationships
- [auth/](auth/) - Authentication components

Each domain has:
- Overview (responsibility, dependencies)
- Component diagrams
- Data flows
- Patterns and conventions

---

## Decisions

See: [adr/](adr/)

Architecture Decision Records.

---

## Cross-Cutting

- [workflows.md](workflows.md) - End-to-end user journeys
- [integration.md](integration.md) - How components communicate
