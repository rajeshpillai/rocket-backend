# Rocket Backend — Project Context

## What This Is

Metadata-driven backend engine. Entities, relations, and business logic are defined as JSON metadata and interpreted at runtime — no per-entity code generation. Define an entity via the admin API, and five REST endpoints are instantly available.

## Implementations

All implementations share the same API contracts and must produce identical responses.

| Language | Directory | Framework | DB Driver | DB Adapters |
|----------|-----------|-----------|-----------|-------------|
| Go | `backend/golang/` | Fiber v2 | pgx v5 | Postgres, SQLite |
| TypeScript | `backend/expressjs/` | Express 4 | pg (node-postgres) | Postgres, SQLite |
| Elixir | `backend/elixir-phoenix/` | Phoenix | Postgrex / Exqlite | Postgres, SQLite |

**Admin UI:** `admin/` — SolidJS + Vite + Tailwind

**Completed:** Phases 0–8 + Schema Export/Import + User Invites (see [todo.md](todo.md) for full roadmap)

## Project Structure

```
rocket-backend/
├── todo.md                      # Canonical feature roadmap (language-agnostic)
├── docs/                        # Shared design documents
│   ├── email-providers.md       # Phase 10 design
│   ├── api-connectors.md        # Phase 11 design + all workflow/action/rule types
│   ├── auth-and-permissions.md  # JWT + permissions + invites
│   ├── database.md              # System tables DDL, migration rules
│   ├── dynamic-rest-api.md      # Router, read flow, write flow
│   ├── metadata-schemas.md      # Entity, field, relation schemas
│   ├── nested-writes.md         # Diff/replace/append algorithms
│   ├── rules-and-workflows.md   # Rules, state machines, workflows
│   └── admin-ui.md              # Admin UI pages + dev setup
├── admin/src/                   # SolidJS admin UI
│   ├── api/                     # API client layer
│   ├── components/              # Shared UI components
│   ├── pages/                   # Feature pages
│   ├── stores/                  # SolidJS reactive stores
│   └── types/                   # TypeScript interfaces
├── backend/                     # All backend implementations
│   ├── golang/                  # Go backend
│   │   ├── todo.md              # Go-specific implementation status
│   │   ├── app.yaml             # Config
│   │   └── internal/{config,metadata,store,engine,storage,auth,admin,multiapp,ai}/
│   ├── expressjs/               # Express backend
│   │   ├── todo.md              # Express-specific implementation status
│   │   ├── app.yaml             # Config
│   │   └── src/{config,metadata,store,engine,storage,auth,admin,multiapp,ai}/
│   ├── elixir-phoenix/          # Elixir backend
│   │   ├── todo.md              # Elixir-specific implementation status
│   │   ├── config/              # Config
│   │   └── lib/rocket/{metadata,store,engine,storage,auth,ai}/
│   ├── java-spring/             # Java Spring backend (planned)
│   └── dotnet/                  # .NET backend (planned)
```

Each backend follows the same module structure: `config` → `store` → `metadata` → `engine` → `auth` → `admin` → `multiapp`.

## Database

Postgres 15 via Docker Compose (port **5433**, credentials `rocket/rocket`). SQLite adapter available for zero-infra deployment.

- **Management DB** (`rocket`): `_apps`, `_platform_users`, `_platform_refresh_tokens`
- **Per-app DBs** (`rocket_{name}`): all system tables below + dynamic business tables

### System Tables (per-app)

```
_entities, _relations, _rules, _state_machines,
_workflows, _workflow_instances,
_users, _refresh_tokens, _invites,
_permissions, _webhooks, _webhook_logs,
_files
```

Full DDL in [docs/database.md](docs/database.md).

## Key Architecture Decisions

- **Dynamic data** — `map[string]any` / `Record<string, any>`, no typed structs per entity
- **Parameterized SQL only** — `$1, $2, ...` placeholders, never string interpolation
- **Plan-then-execute** for nested writes — validate and build op list before BEGIN
- **Includes use separate queries, not JOINs** — avoids cartesian explosions
- **Admin routes before dynamic routes** — prevents `/_admin/*` matching `/:entity`
- **Auto-migration never drops columns** — removing a field hides it, data stays
- **Whitelist permissions** — no `_permissions` row = denied; admin role bypasses all
- **Database-per-app** — each app gets its own database; management DB is control plane
- **Dual-auth middleware** — tries app JWT first, falls back to platform JWT
- **Async webhooks by default** — fire-and-forget after commit; sync optional (non-2xx rolls back)

## API Quick Reference

### Platform
```
POST /api/_platform/auth/login|refresh|logout
GET/POST /api/_platform/apps
GET/DELETE /api/_platform/apps/:name
```

### App Auth (no token required)
```
POST /api/:app/auth/login|refresh|logout
POST /api/:app/auth/accept-invite
```

### App Admin (requires admin role)
```
GET/POST       /api/:app/_admin/{entities,relations,rules,state-machines,workflows,users,permissions,webhooks}
GET/PUT/DELETE /api/:app/_admin/{entities,relations}/:name
GET/PUT/DELETE /api/:app/_admin/{rules,state-machines,workflows,users,permissions,webhooks}/:id
GET            /api/:app/_admin/webhook-logs[/:id]
POST           /api/:app/_admin/webhook-logs/:id/retry
GET/POST       /api/:app/_admin/invites
POST           /api/:app/_admin/invites/bulk
DELETE         /api/:app/_admin/invites/:id
GET/POST       /api/:app/_admin/export|import
```

### App Files
```
POST   /api/:app/_files/upload
GET    /api/:app/_files[/:id]
DELETE /api/:app/_files/:id
```

### App Workflows
```
GET  /api/:app/_workflows/pending|:id
POST /api/:app/_workflows/:id/approve|reject
```

### Dynamic Entity CRUD
```
GET    /api/:app/:entity           # ?filter[field.op]=val&sort=-field&page=1&per_page=25&include=rel
GET    /api/:app/:entity/:id       # ?include=rel1,rel2
POST   /api/:app/:entity           # Create (+ nested writes)
PUT    /api/:app/:entity/:id       # Update (+ nested writes)
DELETE /api/:app/:entity/:id       # Soft/hard delete
```

### Error Format
```json
{"error": {"code": "VALIDATION_FAILED", "message": "...", "details": [{"field": "x", "rule": "required", "message": "..."}]}}
```

Codes: `UNKNOWN_ENTITY` (404), `NOT_FOUND` (404), `VALIDATION_FAILED` (422), `UNKNOWN_FIELD` (400), `INVALID_PAYLOAD` (400), `CONFLICT` (409), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `INTERNAL_ERROR` (500)

## Running

```bash
docker compose up -d                                      # Postgres

cd backend/golang && go run ./cmd/server/                 # Go (port 8080)
cd backend/expressjs && npx tsx src/index.ts              # Express (port 8080)
cd backend/elixir-phoenix && mix phx.server               # Elixir (port 4000)

cd admin && npm run dev                                   # Admin UI (port 5173, proxies to 8080)
```

Default credentials: `platform@localhost / changeme` (platform), `admin@localhost / changeme` (per-app)

## Conventions

- File/folder names: `lowercase-hyphenated`
- All three backends must produce identical API responses
- Go: `snake_case.go`, `pgx` directly, `fmt.Errorf` wrapping, context threading
- TypeScript: strict mode, ESM, `pg` directly, async/await
- Elixir: Phoenix conventions, pattern matching, GenServer for background tasks
- **Feature workflow:** root `todo.md` is updated first (source of truth for all features/changes), then backend-specific `todo.md` files (`backend/*/todo.md`) are updated as each implementation progresses
- Each backend `todo.md` tracks implementation status only — feature definitions live in root `todo.md`
- Docs in `docs/` are shared and language-agnostic
- After implementing a backend feature, update the admin UI in `admin/` to expose it
- Update `man-days.md` with efforts
- Bump version number after each major feature, revision, or patch
