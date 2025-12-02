# Architecture

**Entry point for understanding system structure.**

---

## Start Here

[system.md](system.md) - **Complete C4 model: System Context, Containers, Component organization, Interfaces**

---

## By Container (C4 Level 2)

- [1-web-app/](1-web-app/) - Web Application container and its components
- [2-api-server/](2-api-server/) - API Server container and its components
- [3-database/](3-database/) - Database container schema

---

## Cross-Cutting

- [workflows.md](workflows.md) - End-to-end user journeys across containers
- [adr/](adr/) - Architecture decisions

---

**Agent workflow:**
1. Read `system.md` for overall structure and interfaces
2. Find which container task belongs to
3. Read that container's README and component docs
4. Check `system.md` interfaces if crossing container boundaries
