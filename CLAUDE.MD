# Rocket Backend — Project Context

## What This Is

Metadata-driven backend engine. Entities, relations, and business logic are defined as JSON metadata and interpreted at runtime — no per-entity code generation. Define an entity via the admin API, and five REST endpoints are instantly available.

## Current Status

**Phase 0–7 are complete** in two languages. Both share the same Postgres instance.

| Implementation | Directory | Framework | Driver | Status |
|----------------|-----------|-----------|--------|--------|
| Go | `golang/` | Fiber v2 | pgx v5 | Phase 7 done |
| TypeScript | `expressjs/` | Express 4 | pg (node-postgres) | Phase 7 done |

**What Phase 0 delivers:**
- Admin API (`/api/_admin/*`) for entity + relation CRUD
- Dynamic REST API (`/api/:entity`) with 5 endpoints per entity
- Auto-migration (CREATE TABLE / ALTER TABLE ADD COLUMN on entity create/update)
- Filters, sorting, pagination, includes
- Nested writes with diff/replace/append modes
- Soft delete with cascade policies
- Validation (required fields, enums)
- Standard error format with codes and field-level details

**What Phase 4 delivers:**
- JWT authentication (HS256, 15min access tokens, 7-day refresh tokens with rotation)
- Auth middleware on all routes (except `/api/auth/*` and `/health`)
- Metadata-driven permission policies (`_permissions` table, whitelist model)
- Row-level security (read conditions injected as WHERE clauses)
- Write permission conditions (current record checked before update/delete)
- Admin role bypasses all permission checks
- Seed admin user on first boot (`admin@localhost` / `changeme`)
- User + permission admin CRUD
- bcrypt password hashing (never returned in responses)

**What Phase 5 delivers:**
- Metadata-driven webhooks (`_webhooks` table) — HTTP callouts triggered by entity writes
- Four hook types: `after_write`, `before_write`, `after_delete`, `before_delete`
- Async webhooks (default): fire after commit in background, log to `_webhook_logs`, retry on failure
- Sync webhooks: fire inside transaction before commit, non-2xx causes rollback
- Condition expressions (same engine as rules), header templates (`{{env.VAR_NAME}}`)
- Webhook delivery logs (`_webhook_logs`) with status tracking (pending/delivered/retrying/failed)
- Background retry scheduler (30s interval, exponential backoff: 30s x 2^attempt)
- Admin API for webhook + log CRUD, manual retry endpoint
- State machine + workflow webhook stubs replaced with real HTTP dispatch

**What Phase 6 delivers:**
- Multi-app support (database-per-app isolation)
- Management database (`rocket`) holds `_apps`, `_platform_users`, `_platform_refresh_tokens`
- Platform auth (separate from per-app auth): `platform@localhost / changeme`
- App lifecycle: create app → provisions new database → bootstraps all system tables → seeds admin user
- Platform admin token accepted in any app (dual-auth middleware: tries app JWT first, falls back to platform JWT)
- URL prefix routing: `/api/_platform/*` for management, `/api/:app/*` for app-scoped operations
- Per-app JWT secrets (auto-generated on app creation)
- AppContext holds pre-built handlers per app (zero changes to existing engine/handler code)
- Multi-app schedulers (single scheduler iterates all apps for workflow timeouts + webhook retries)

**Admin UI** is in `admin/` — SolidJS + Vite + Tailwind. Covers app management (create/list/delete/select), entity CRUD, relation editing, rules management, state machine management, workflow builder, workflow monitor, data browsing, user management, permission management, webhook management, webhook log viewer, platform login/logout, and auth-protected routes.

**What Phase 7 delivers:**
- `file` field type — maps to JSONB in PostgreSQL, stores `{id, filename, size, mime_type}`
- Dedicated file upload endpoint (`POST /api/:app/_files/upload`) with multipart/form-data
- File serve endpoint (`GET /api/:app/_files/:id`) streams files with correct Content-Type
- File delete + list endpoints (admin only)
- Storage interface with local-disk implementation (S3-ready)
- Per-app file isolation (`uploads/{app_name}/`)
- Write pipeline resolves UUID → full JSONB metadata on file fields
- `_files` system table tracks all uploads
- Admin UI: FileUploadField component integrated into DataRecordEditor
- Config: `storage` section in app.yaml (driver, local_path, max_file_size)

**Schema Export/Import** — full schema portability between apps/systems:
- `GET /_admin/export` returns all metadata (entities, relations, rules, state machines, workflows, permissions, webhooks) as a single JSON document
- `POST /_admin/import` accepts the export JSON and recreates everything (tables, relations, business logic) with idempotent dedup
- Admin UI: Export/Import buttons on the Entities page (download JSON file / upload JSON file with results summary)

**Not yet built (future phases):**
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
│       ├── api/                 # API client (client.ts, platform.ts)
│       ├── components/          # Shared UI (DataTable, Modal, Toast, Sidebar, etc.)
│       ├── pages/               # AppsList, EntitiesList, EntityDetail, RelationsList, DataBrowser, Login, etc.
│       ├── stores/              # SolidJS stores (entities, notifications, auth, app)
│       ├── styles/              # Tailwind + component CSS
│       └── types/               # TypeScript types (entity, relation, api, user, permission, webhook, app)
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
│       ├── metadata/{field,entity,relation,registry,loader,rule,state_machine,workflow,permission,user_context,webhook}.go
│       ├── store/{postgres,bootstrap,migrator}.go
│       ├── engine/{query,errors,soft_delete,writer,diff,nested_write,includes,handler,router,rules,state_machine,workflow,workflow_handler,workflow_scheduler,permissions,webhook,webhook_scheduler,file_handler}.go
│       ├── storage/{storage,local}.go
│       ├── auth/{auth,handler,middleware}.go
│       ├── admin/handler.go
│       └── multiapp/{context,manager,middleware,app_routes,platform_bootstrap,platform_handler,scheduler}.go
└── expressjs/                   # Express.js implementation
    ├── app.yaml                 # Config (port 8080, db on 5433)
    ├── package.json / tsconfig.json
    ├── todo.md                  # Express-specific phase tracking
    └── src/
        ├── index.ts
        ├── config/index.ts
        ├── metadata/{types,registry,loader,rule,state-machine,workflow,permission,webhook}.ts
        ├── store/{postgres,bootstrap,migrator,schema}.ts
        ├── engine/{query,errors,soft-delete,writer,diff,nested-write,includes,handler,router,rules,state-machine,workflow,workflow-handler,workflow-scheduler,webhook,webhook-scheduler,file-handler}.ts
        ├── storage/{storage,local}.ts
        ├── auth/{auth,handler,middleware,permissions}.ts
        ├── admin/handler.ts
        ├── multiapp/{context,manager,middleware,app-routes,platform-bootstrap,platform-handler,scheduler}.ts
        └── middleware/error-handler.ts
```

## Database

Shared Postgres 15 via Docker Compose. Port **5433** on host (remapped from default 5432 to avoid conflict with local Postgres). Credentials: `rocket/rocket`.

- **Management database** (`rocket`): holds `_apps`, `_platform_users`, `_platform_refresh_tokens`
- **Per-app databases** (`rocket_{appname}`): each contains all system tables below

### Platform Tables (management database)

```
_apps                    — name (PK), display_name, db_name (UNIQUE), jwt_secret, status, created_at, updated_at
_platform_users          — id (UUID PK), email (UNIQUE), password_hash, roles (TEXT[]), active, created_at, updated_at
_platform_refresh_tokens — id (UUID PK), user_id (FK→_platform_users), token (UUID UNIQUE), expires_at, created_at
```

### System Tables (per-app database)

```
_entities           — name (PK), table_name, definition (JSONB), created_at, updated_at
_relations          — name (PK), source (FK), target (FK), definition (JSONB), created_at, updated_at
_rules              — id (UUID PK), entity (FK), hook, type, definition (JSONB), priority, active, created_at, updated_at
_state_machines     — id (UUID PK), entity (FK), field, definition (JSONB), active, created_at, updated_at
_workflows          — id (UUID PK), name (UNIQUE), trigger (JSONB), context (JSONB), steps (JSONB), active, created_at, updated_at
_workflow_instances — id (UUID PK), workflow_id (FK), workflow_name, status, current_step, current_step_deadline, context (JSONB), history (JSONB), created_at, updated_at
_users              — id (UUID PK), email (UNIQUE), password_hash, roles (TEXT[]), active, created_at, updated_at
_refresh_tokens     — id (UUID PK), user_id (FK→_users), token (UUID UNIQUE), expires_at, created_at
_permissions        — id (UUID PK), entity, action, roles (TEXT[]), conditions (JSONB), created_at, updated_at
_webhooks           — id (UUID PK), entity, hook, url, method, headers (JSONB), condition, async, retry (JSONB), active, created_at, updated_at
_webhook_logs       — id (UUID PK), webhook_id (FK→_webhooks), entity, hook, url, method, request_headers (JSONB), request_body (JSONB), response_status, response_body, status, attempt, max_attempts, next_retry_at, error, idempotency_key, created_at, updated_at
_files              — id (UUID PK), filename, storage_path, mime_type, size (BIGINT), uploaded_by (UUID), created_at
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
- **JWT auth (Phase 4)** — HS256, 15min access, 7-day refresh with rotation, bcrypt passwords
- **Whitelist permissions** — no `_permissions` row = denied; admin role always bypasses
- **Auth routes before middleware** — `/api/auth/*` registered first, naturally unprotected
- **Webhooks (Phase 5)** — async by default (fire-and-forget after commit), sync optional (fire pre-commit, non-2xx rolls back). No new HTTP dependencies (Go: net/http, Express: fetch). Retry via background scheduler with exponential backoff.
- **Database-per-app (Phase 6)** — each app gets its own PostgreSQL database; management database is the control plane. AppContext holds pre-built handlers (zero changes to existing engine code). Dual-auth middleware tries app JWT first, falls back to platform JWT.

## API Quick Reference

### Platform (no auth for login/refresh/logout; platform auth for app management)
```
POST /api/_platform/auth/login       # Platform admin login → {access_token, refresh_token}
POST /api/_platform/auth/refresh     # Platform token refresh
POST /api/_platform/auth/logout      # Platform logout
GET  /api/_platform/apps             # List all apps
POST /api/_platform/apps             # Create app {name, display_name}
GET  /api/_platform/apps/:name       # Get app details
DELETE /api/_platform/apps/:name     # Delete app (drops database)
```

### App-Scoped Auth (no token required)
```
POST /api/:app/auth/login            # Per-app user login → {access_token, refresh_token}
POST /api/:app/auth/refresh          # Per-app token refresh
POST /api/:app/auth/logout           # Per-app logout
```

### App-Scoped Admin (requires auth + admin role)
```
GET/POST       /api/:app/_admin/entities
GET/PUT/DELETE /api/:app/_admin/entities/:name
GET/POST       /api/:app/_admin/relations
GET/PUT/DELETE /api/:app/_admin/relations/:name
GET/POST       /api/:app/_admin/rules
GET/PUT/DELETE /api/:app/_admin/rules/:id
GET/POST       /api/:app/_admin/state-machines
GET/PUT/DELETE /api/:app/_admin/state-machines/:id
GET/POST       /api/:app/_admin/workflows
GET/PUT/DELETE /api/:app/_admin/workflows/:id
GET/POST       /api/:app/_admin/users
GET/PUT/DELETE /api/:app/_admin/users/:id
GET/POST       /api/:app/_admin/permissions
GET/PUT/DELETE /api/:app/_admin/permissions/:id
GET/POST       /api/:app/_admin/webhooks
GET/PUT/DELETE /api/:app/_admin/webhooks/:id
GET            /api/:app/_admin/webhook-logs          # ?webhook_id, ?status, ?entity filters
GET            /api/:app/_admin/webhook-logs/:id
POST           /api/:app/_admin/webhook-logs/:id/retry
GET            /api/:app/_admin/export                # Export full schema as JSON
POST           /api/:app/_admin/import                # Import schema JSON (idempotent)
```

### App-Scoped File Upload
```
POST   /api/:app/_files/upload              # Upload file (multipart/form-data, field "file")
GET    /api/:app/_files/:id                 # Serve/download file (streams with Content-Type)
DELETE /api/:app/_files/:id                 # Delete file (admin only)
GET    /api/:app/_files                     # List all files (admin only)
```

### App-Scoped Workflow Runtime
```
GET  /api/:app/_workflows/pending       # List paused instances
GET  /api/:app/_workflows/:id           # Get instance details
POST /api/:app/_workflows/:id/approve   # Approve current step
POST /api/:app/_workflows/:id/reject    # Reject current step
```

### App-Scoped Dynamic (per entity)
```
GET    /api/:app/:entity                    # List (filters, sort, pagination, includes)
GET    /api/:app/:entity/:id                # Get by ID (with optional includes)
POST   /api/:app/:entity                    # Create (with optional nested writes)
PUT    /api/:app/:entity/:id                # Update (with optional nested writes)
DELETE /api/:app/:entity/:id                # Soft or hard delete
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

Codes: `UNKNOWN_ENTITY` (404), `NOT_FOUND` (404), `VALIDATION_FAILED` (422), `UNKNOWN_FIELD` (400), `INVALID_PAYLOAD` (400), `CONFLICT` (409), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `INTERNAL_ERROR` (500)

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
- Update man-days.md with efforts