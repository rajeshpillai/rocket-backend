# Rocket Backend — Project Context

## What This Is

Metadata-driven backend engine. Entities, relations, and business logic are defined as JSON metadata and interpreted at runtime — no per-entity code generation. Define an entity via the admin API, and five REST endpoints are instantly available.

## Current Status

**Phase 0–3 are complete** in two languages. Both share the same Postgres database.

| Implementation | Directory | Framework | Driver | Status |
|----------------|-----------|-----------|--------|--------|
| Go | `golang/` | Fiber v2 | pgx v5 | Phase 3 done |
| TypeScript | `expressjs/` | Express 4 | pg (node-postgres) | Phase 3 done |

**What Phase 0 delivers:**
- Admin API (`/api/_admin/*`) for entity + relation CRUD
- Dynamic REST API (`/api/:entity`) with 5 endpoints per entity
- Auto-migration (CREATE TABLE / ALTER TABLE ADD COLUMN on entity create/update)
- Filters, sorting, pagination, includes
- Nested writes with diff/replace/append modes
- Soft delete with cascade policies
- Validation (required fields, enums)
- Standard error format with codes and field-level details

**Admin UI** is in `admin/` — SolidJS + Vite + Tailwind. Covers entity CRUD, relation editing, rules management, state machine management, workflow builder, workflow monitor, and data browsing.

**Not yet built (future phases):**
- Auth (JWT + permissions)
- Webhooks
- Audit log

## Project Structure

```
rocket-backend/
├── docker-compose.yml           # Shared Postgres 15 (port 5433:5432)
├── CLAUDE.MD                    # This file — project context for AI sessions
├── README.md                    # Project overview + quick start
├── .gitignore
├── admin/                       # SolidJS admin UI (Vite + Tailwind)
│   ├── package.json
│   ├── vite.config.ts / tsconfig.json / tailwind.config.js
│   └── src/
│       ├── App.tsx              # Router + layout
│       ├── api/                 # API client (entities, relations, data)
│       ├── components/          # Shared UI (DataTable, Modal, Toast, etc.)
│       ├── pages/               # EntitiesList, EntityDetail, RelationsList, DataBrowser, etc.
│       ├── stores/              # SolidJS stores (entities, notifications)
│       ├── styles/              # Tailwind + component CSS
│       └── types/               # TypeScript types (entity, relation, api)
├── docs/                        # Shared technical documentation
│   ├── dynamic-rest-api.md      # Router, read flow, write flow design
│   ├── metadata-schemas.md      # Entity, field, relation schemas
│   ├── nested-writes.md         # Diff/replace/append algorithms
│   ├── database.md              # System tables DDL, migration rules
│   ├── auth-and-permissions.md  # JWT + permission policy design
│   ├── rules-and-workflows.md   # 4-layer rules, state machines, workflows
│   └── admin-ui.md              # SolidJS page list + dev setup
├── golang/                      # Go implementation
│   ├── app.yaml                 # Config (port 8080, db on 5433)
│   ├── go.mod / go.sum
│   ├── todo.md                  # Go-specific phase tracking
│   ├── cmd/server/main.go
│   └── internal/
│       ├── config/config.go
│       ├── metadata/{field,entity,relation,registry,loader,rule,state_machine,workflow}.go
│       ├── store/{postgres,bootstrap,migrator}.go
│       ├── engine/{query,errors,soft_delete,writer,diff,nested_write,includes,handler,router,rules,state_machine,workflow,workflow_handler,workflow_scheduler}.go
│       └── admin/handler.go
└── expressjs/                   # Express.js implementation
    ├── app.yaml                 # Config (port 8080, db on 5433)
    ├── package.json / tsconfig.json
    ├── todo.md                  # Express-specific phase tracking
    └── src/
        ├── index.ts
        ├── config/index.ts
        ├── metadata/{types,registry,loader,rule,state-machine,workflow}.ts
        ├── store/{postgres,bootstrap,migrator,schema}.ts
        ├── engine/{query,errors,soft-delete,writer,diff,nested-write,includes,handler,router,rules,state-machine,workflow,workflow-handler,workflow-scheduler}.ts
        ├── admin/handler.ts
        └── middleware/error-handler.ts
```

## Database

Shared Postgres 15 via Docker Compose. Port **5433** on host (remapped from default 5432 to avoid conflict with local Postgres). Credentials: `rocket/rocket`, database: `rocket`.

### System Tables

```
_entities    — name (PK), table_name, definition (JSONB), created_at, updated_at
_relations   — name (PK), source (FK), target (FK), definition (JSONB), created_at, updated_at
_rules            — id (UUID PK), entity (FK), hook, type, definition (JSONB), priority, active, created_at, updated_at
_state_machines   — id (UUID PK), entity (FK), field, definition (JSONB), active, created_at, updated_at
_workflows        — id (UUID PK), name (UNIQUE), trigger (JSONB), context (JSONB), steps (JSONB), active, created_at, updated_at
_workflow_instances — id (UUID PK), workflow_id (FK), workflow_name, status, current_step, current_step_deadline, context (JSONB), history (JSONB), created_at, updated_at
```

Business tables are created dynamically by the migrator when entities are defined.

### Existing Test Data (from Phase 0 verification)

Three entities exist: `customer`, `invoice`, `invoice_item`. One relation: `items` (invoice → invoice_item, one_to_many). Several test records exist in these tables from verification testing.

## Key Architecture Decisions

- **All data is `map[string]any` / `Record<string, any>`** — no typed structs per entity
- **Parameterized SQL only** — `$1, $2, ...` placeholders, never string interpolation
- **Plan-then-execute** for nested writes — validate and build op list before BEGIN
- **Includes use separate queries, not JOINs** — avoids cartesian explosions
- **Admin routes registered before dynamic routes** — prevents `/api/_admin/entities` matching `/:entity`
- **Auto-migration never drops columns** — removing a field hides it from the API, data stays
- **No auth in Phase 0** — all endpoints are open

## API Quick Reference

### Admin
```
GET/POST       /api/_admin/entities
GET/PUT/DELETE /api/_admin/entities/:name
GET/POST       /api/_admin/relations
GET/PUT/DELETE /api/_admin/relations/:name
GET/POST       /api/_admin/rules
GET/PUT/DELETE /api/_admin/rules/:id
GET/POST       /api/_admin/state-machines
GET/PUT/DELETE /api/_admin/state-machines/:id
GET/POST       /api/_admin/workflows
GET/PUT/DELETE /api/_admin/workflows/:id
```

### Workflow Runtime
```
GET  /api/_workflows/pending       # List paused instances
GET  /api/_workflows/:id           # Get instance details
POST /api/_workflows/:id/approve   # Approve current step
POST /api/_workflows/:id/reject    # Reject current step
```

### Dynamic (per entity)
```
GET    /api/:entity                    # List (filters, sort, pagination, includes)
GET    /api/:entity/:id                # Get by ID (with optional includes)
POST   /api/:entity                    # Create (with optional nested writes)
PUT    /api/:entity/:id                # Update (with optional nested writes)
DELETE /api/:entity/:id                # Soft or hard delete
```

### Query params
- `filter[field]=value`, `filter[field.op]=value` (eq/neq/gt/gte/lt/lte/in/not_in/like)
- `sort=field1,-field2` (- prefix for DESC)
- `page=1&per_page=25` (max 100)
- `include=relation1,relation2`

### Error format
```json
{"error": {"code": "VALIDATION_FAILED", "message": "...", "details": [{"field": "x", "rule": "required", "message": "..."}]}}
```

Codes: `UNKNOWN_ENTITY` (404), `NOT_FOUND` (404), `VALIDATION_FAILED` (422), `UNKNOWN_FIELD` (400), `INVALID_PAYLOAD` (400), `CONFLICT` (409), `INTERNAL_ERROR` (500)

## Running

```bash
# Start DB
docker compose up -d

# Go (port 8080)
cd golang && go run ./cmd/server/

# Express (port 8080) — stop Go first, same port
cd expressjs && npx tsx src/index.ts

# Admin UI (port 5173, proxies API to localhost:8080)
cd admin && npm run dev
```

## Known Issues

None currently.

## Conventions

- Both implementations must produce identical API responses
- Go: `snake_case.go` files, `pgx` directly, `fmt.Errorf` wrapping, context threading
- TypeScript: strict mode, ESM modules, `pg` directly for dynamic queries, async/await
- Each implementation has its own `todo.md` tracking phase progress
- Docs in `docs/` are shared and language-agnostic
- Create/update docs in golang and express respective docs folder for technical implementation details
- After implementing each backend feature, the admin UI in `admin/` must be updated to expose that feature
