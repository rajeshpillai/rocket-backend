# Rocket Backend

A metadata-driven backend engine where entities, relations, and business logic are defined as JSON metadata and interpreted at runtime. No code generation — define an entity via the admin API and immediately CRUD its data through dynamic REST endpoints.

## How It Works

1. Define an entity (e.g. `customer`) via `POST /api/_admin/entities` with its fields, types, and constraints as JSON
2. The engine auto-creates the Postgres table with correct columns, indexes, and constraints
3. Five REST endpoints are instantly available: `GET/POST/PUT/DELETE /api/customer`
4. Define relations between entities — nested writes, includes, and cascade deletes work automatically

## Features

- **Dynamic REST API** — single set of handlers serves all entities via `/api/:entity`
- **Auto-migration** — entity metadata changes trigger `CREATE TABLE` / `ALTER TABLE` automatically
- **Nested writes** — create/update parent + children in a single transaction
- **Write modes** — `diff` (non-destructive), `replace` (full truth), `append` (additive)
- **Filtering** — `?filter[field]=value`, `?filter[field.op]=value` (eq, neq, gt, gte, lt, lte, in, not_in, like)
- **Sorting** — `?sort=name,-created_at`
- **Pagination** — `?page=1&per_page=25` with total count in response meta
- **Includes** — `?include=items,customer` loads relations via separate queries
- **Soft delete** — configurable per entity, automatic `deleted_at` filtering
- **Cascade policies** — `cascade`, `set_null`, `restrict`, `detach` per relation
- **Validation** — required fields, enum constraints, type checking
- **Admin API** — full CRUD for entity and relation metadata at `/api/_admin/*`

## Implementations

The same backend is implemented in multiple languages, all sharing a single Postgres database:

| Language | Directory | Framework | Status |
|----------|-----------|-----------|--------|
| Go | [golang/](golang/) | Fiber v2 + pgx | Phase 0 complete |
| TypeScript | [expressjs/](expressjs/) | Express + pg | Phase 0 complete |

## Quick Start

### Prerequisites

- Docker (for Postgres)
- Go 1.21+ (for Go implementation)
- Node.js 20+ (for Express implementation)

### 1. Start Postgres

```bash
docker compose up -d
```

### 2. Run a backend

**Go:**
```bash
cd golang
go run ./cmd/server/
```

**Express.js:**
```bash
cd expressjs
npm install
npx tsx src/index.ts
```

Both start on port `8080` by default.

### 3. Create an entity

```bash
curl -X POST http://localhost:8080/api/_admin/entities \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "customer",
    "table": "customers",
    "primary_key": {"field": "id", "type": "uuid", "generated": true},
    "soft_delete": true,
    "fields": [
      {"name": "id", "type": "uuid", "required": true},
      {"name": "name", "type": "string", "required": true},
      {"name": "email", "type": "string", "required": true, "unique": true},
      {"name": "created_at", "type": "timestamp", "auto": "create"},
      {"name": "updated_at", "type": "timestamp", "auto": "update"}
    ]
  }'
```

### 4. Use it

```bash
# Create
curl -X POST http://localhost:8080/api/customer \
  -H 'Content-Type: application/json' \
  -d '{"name": "Acme", "email": "acme@example.com"}'

# List with filters
curl "http://localhost:8080/api/customer?filter[name]=Acme&sort=-created_at"

# Get by ID
curl http://localhost:8080/api/customer/<id>

# Update
curl -X PUT http://localhost:8080/api/customer/<id> \
  -H 'Content-Type: application/json' \
  -d '{"name": "Acme Corp"}'

# Delete (soft)
curl -X DELETE http://localhost:8080/api/customer/<id>
```

## Project Structure

```
rocket-backend/
├── docker-compose.yml          # Shared Postgres 15
├── docs/                       # Technical documentation
│   ├── dynamic-rest-api.md
│   ├── metadata-schemas.md
│   ├── nested-writes.md
│   ├── database.md
│   ├── auth-and-permissions.md
│   ├── rules-and-workflows.md
│   └── admin-ui.md
├── golang/                     # Go implementation
│   ├── app.yaml
│   ├── cmd/server/main.go
│   └── internal/
└── expressjs/                  # Express.js implementation
    ├── app.yaml
    ├── package.json
    └── src/
```

## API Reference

### Admin Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/_admin/entities` | List all entities |
| GET | `/api/_admin/entities/:name` | Get entity definition |
| POST | `/api/_admin/entities` | Create entity + auto-migrate table |
| PUT | `/api/_admin/entities/:name` | Update entity + re-migrate |
| DELETE | `/api/_admin/entities/:name` | Delete entity |
| GET | `/api/_admin/relations` | List all relations |
| POST | `/api/_admin/relations` | Create relation |
| DELETE | `/api/_admin/relations/:name` | Delete relation |

### Dynamic Entity Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/:entity` | List with filters, sorting, pagination |
| GET | `/api/:entity/:id` | Get by ID with optional includes |
| POST | `/api/:entity` | Create with optional nested writes |
| PUT | `/api/:entity/:id` | Update with optional nested writes |
| DELETE | `/api/:entity/:id` | Soft or hard delete with cascades |

### Error Format

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Validation failed",
    "details": [
      {"field": "email", "rule": "required", "message": "email is required"}
    ]
  }
}
```

## Roadmap

- [ ] Field validation rules (min, max, pattern)
- [ ] Expression rules
- [ ] State machines
- [ ] Workflows
- [ ] Auth (JWT) & permissions
- [ ] Webhooks
- [ ] SolidJS admin UI
