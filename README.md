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
| Go | [golang/](golang/) | Fiber v2 + pgx | Phase 7 complete |
| TypeScript | [expressjs/](expressjs/) | Express + pg | Phase 7 complete |

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

### Default Credentials

| Scope | Email | Password | Notes |
|-------|-------|----------|-------|
| Platform admin | `platform@localhost` | `changeme` | Seeded on first boot. Use to create/manage apps. |
| Per-app admin | `admin@localhost` | `changeme` | Seeded per app on creation. Use to manage entities, users, etc. |

### 3. Start the Admin UI

```bash
cd admin
npm install
npm run dev
```

Opens at [http://localhost:5173/admin](http://localhost:5173/admin). The dev server proxies API requests to `localhost:8080`, so make sure a backend is running.

### 4. Create an entity

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

### 5. Use it

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
├── docs/                       # Shared technical documentation
├── admin/                      # SolidJS admin UI (Vite + Tailwind)
│   ├── package.json
│   └── src/
├── golang/                     # Go implementation
│   ├── app.yaml
│   ├── cmd/server/main.go
│   ├── docs/                   # Go-specific implementation docs
│   └── internal/
└── expressjs/                  # Express.js implementation
    ├── app.yaml
    ├── package.json
    ├── docs/                   # Express-specific implementation docs
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
| PUT | `/api/_admin/relations/:name` | Update relation |
| DELETE | `/api/_admin/relations/:name` | Delete relation |
| GET | `/api/_admin/rules` | List all rules |
| POST | `/api/_admin/rules` | Create validation rule |
| PUT | `/api/_admin/rules/:id` | Update rule |
| DELETE | `/api/_admin/rules/:id` | Delete rule |
| GET | `/api/_admin/state-machines` | List all state machines |
| POST | `/api/_admin/state-machines` | Create state machine |
| PUT | `/api/_admin/state-machines/:id` | Update state machine |
| DELETE | `/api/_admin/state-machines/:id` | Delete state machine |

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

## What Can You Build?

Rocket Backend replaces the entire custom backend for data-driven applications. Define your schema via the admin UI or API, and you get a production-ready REST API with auth, permissions, business logic, and integrations — no code required.

### CRM / Sales Pipeline
Entities: `company`, `contact`, `deal`, `activity`. Relations link contacts to companies, deals to contacts. State machine on `deal.stage` (lead &rarr; qualified &rarr; proposal &rarr; won/lost) with guard expressions ("amount > 10000 requires manager approval"). Webhooks notify Slack on deal stage changes. Permissions let sales reps see only their own deals.

### Project Management / Issue Tracker
Entities: `project`, `task`, `comment`, `attachment` (file field). State machine on `task.status` (todo &rarr; in_progress &rarr; review &rarr; done). Workflow triggers approval when a task moves to "done" — PM must approve before it closes. Rules enforce that `due_date` cannot be in the past. Row-level permissions: team members see their project's tasks only.

### E-Commerce / Order Management
Entities: `product`, `order`, `order_item`, `customer`. Nested writes create an order with its items in one transaction. State machine on `order.status` (pending &rarr; paid &rarr; shipped &rarr; delivered) with `set_field` actions (auto-set `shipped_at` on transition). Sync webhook validates payment with external gateway before committing. Computed field calculates `order.total` from items.

### HR / Employee Management
Entities: `employee`, `department`, `leave_request`, `document` (file field). Workflow on leave requests: employee submits &rarr; manager approval step &rarr; HR approval step &rarr; auto-set status to "approved". Timeout: if manager doesn't respond in 48 hours, escalate. Permissions: employees see only their own leave requests, managers see their department's.

### Content Management / Blog
Entities: `post`, `category`, `tag`, `media` (file field). Many-to-many relation between posts and tags (auto-created join table). State machine on `post.status` (draft &rarr; review &rarr; published &rarr; archived). Rules enforce `title` min length and `slug` pattern. Webhook triggers static site rebuild on publish.

### Inventory / Warehouse
Entities: `product`, `warehouse`, `stock_movement`, `supplier`. Rules enforce `quantity >= 0`. Computed field calculates `stock_level` from movements. Webhook alerts when stock drops below threshold (condition expression: `record.stock_level < 10`). Async webhooks sync inventory to external ERP.

### Helpdesk / Ticketing
Entities: `ticket`, `customer`, `agent`, `response`. State machine on `ticket.priority` and `ticket.status` (open &rarr; assigned &rarr; in_progress &rarr; resolved &rarr; closed). Workflow: high-priority tickets trigger approval from team lead before assignment. SLA tracking via timeout scheduler. Row-level permissions: customers see only their tickets.

### Multi-Tenant SaaS
Each client gets their own isolated app (separate database) via the multi-app system. Export a schema from a template app, import it into each new client's app. Per-app JWT secrets, independent user bases, no data leakage between tenants. Platform admin manages all apps from a single dashboard.

## Example Schemas

Ready-to-import schema files are available in the [`examples/`](examples/) folder. Create an app, then import any schema via the Admin UI (Entities page > Import Schema) or the API:

**Full workflow — create an app and load a schema in 3 steps:**

```bash
# 1. Login as platform admin
TOKEN=$(curl -s -X POST http://localhost:8080/api/_platform/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"platform@localhost","password":"changeme"}' | jq -r '.data.access_token')

# 2. Create a new app
curl -X POST http://localhost:8080/api/_platform/apps \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"helpdesk","display_name":"Helpdesk App"}'

# 3. Import the schema (platform token works in any app)
curl -X POST http://localhost:8080/api/helpdesk/_admin/import \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d @examples/helpdesk-ticketing.json
```

The import creates all tables, relations, rules, state machines, workflows, permissions, and webhooks. The app is immediately ready to use — start creating tickets at `POST /api/helpdesk/ticket`.

To update an existing app, just re-import — the import is **idempotent** (skips items that already exist).

| Schema | File | Entities | Features Demonstrated |
|--------|------|----------|----------------------|
| **Helpdesk / Ticketing** | [helpdesk-ticketing.json](examples/helpdesk-ticketing.json) | customer, agent, ticket, response | State machine (open &rarr; assigned &rarr; resolved &rarr; closed), critical ticket escalation workflow, file attachments on responses, role-based permissions |
| **Content Management** | [content-management.json](examples/content-management.json) | author, category, tag, post, comment, media | Many-to-many (post &harr; tags), editorial workflow (draft &rarr; review &rarr; published), slug pattern validation, file uploads, comment moderation |
| **Employee Management** | [employee-management.json](examples/employee-management.json) | department, employee, leave_request, document, attendance | Multi-step leave approval workflow (auto-approve &le;5 days, manager+HR for longer), employee status state machine, date validation rules, document file uploads |

## Roadmap

- [x] Field validation rules (min, max, pattern)
- [x] Expression rules & computed fields
- [x] State machines (transitions, guards, actions)
- [x] SolidJS admin UI
- [x] Workflows (trigger, approval, condition steps, timeout scheduler)
- [x] Auth (JWT) & permissions (HS256, row-level security, whitelist model)
- [x] Webhooks (async/sync, retry with exponential backoff)
- [x] Multi-app (database-per-app isolation, platform auth)
- [x] File uploads (storage interface, local disk, JSONB metadata, UUID resolution)
- [x] Schema export/import (JSON portability between apps/systems)
