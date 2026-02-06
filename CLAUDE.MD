# Rocket Backend — Implementation Guide

## Overview

Rocket is a metadata-driven backend engine built with **Go + Fiber**. Business logic (entities, relations, validations, permissions, workflows) is defined as JSON metadata and interpreted at runtime — no per-entity code generation. A **SolidJS** admin UI provides visual schema/entity management.

## Tech Stack

| Layer | Choice |
|-------|--------|
| Language | Go 1.22+ |
| HTTP framework | [Fiber v2](https://gofiber.io) |
| Database | PostgreSQL 15+ (primary), MongoDB (future) |
| DB driver | pgx v5 (no ORM) |
| Migrations | golang-migrate |
| Auth | JWT (access + refresh tokens) |
| Expressions | [expr-lang/expr](https://github.com/expr-lang/expr) (safe, compiled, no side effects) |
| Config | YAML files + env vars (via Viper) |
| Admin UI | SolidJS + Vite |
| API format | JSON REST |

## Project Structure

```
rocket-backend/
├── cmd/
│   └── server/
│       └── main.go              # Entry point — init Fiber, load metadata, register routes
├── internal/
│   ├── config/                  # Viper-based config loading (app.yaml, .env)
│   ├── metadata/
│   │   ├── loader.go            # Load entity/relation JSON from DB or filesystem
│   │   ├── registry.go          # In-memory registry of all loaded entities
│   │   ├── entity.go            # Entity struct definition
│   │   ├── field.go             # Field struct + type system
│   │   └── relation.go          # Relation struct definition
│   ├── engine/
│   │   ├── router.go            # Dynamic route registration from metadata
│   │   ├── query.go             # SELECT builder — filters, joins, pagination
│   │   ├── writer.go            # INSERT/UPDATE/DELETE execution
│   │   ├── nested_write.go      # Plan + execute nested writes in one tx
│   │   ├── diff.go              # Diff engine for relation write mode
│   │   └── soft_delete.go       # Soft-delete filter injection
│   ├── validation/
│   │   ├── engine.go            # Rule interpreter — field rules + expression rules
│   │   ├── rules.go             # Built-in rule types (required, min, max, regex, unique)
│   │   └── expr.go              # expr-lang/expr compilation, caching, evaluation
│   ├── auth/
│   │   ├── jwt.go               # JWT issue/verify
│   │   ├── middleware.go         # Fiber middleware — extract user from token
│   │   └── permissions.go       # Policy evaluation against metadata
│   ├── audit/
│   │   └── logger.go            # Write audit rows on every mutation
│   ├── statemachine/
│   │   └── engine.go            # Transition validation, guard evaluation, action execution
│   ├── events/
│   │   └── emitter.go           # Publish mutation events (in-process bus)
│   ├── webhook/
│   │   ├── dispatcher.go        # Async/sync webhook dispatch with retry
│   │   └── registry.go          # Webhook registration and condition matching
│   ├── workflow/
│   │   ├── runner.go            # Step-based workflow execution from metadata
│   │   ├── instance.go          # Workflow instance persistence and resumption
│   │   └── scheduler.go         # Timeout checker goroutine
│   └── store/
│       ├── postgres.go          # pgx connection pool, query execution helpers
│       └── migrator.go          # Auto-migration from entity metadata to DDL
├── admin/                       # SolidJS frontend (separate Vite project)
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Entities.tsx     # List / create / edit entities
│   │   │   ├── EntityDetail.tsx # Field editor, relation editor
│   │   │   ├── Rules.tsx        # Validation rule builder
│   │   │   └── Permissions.tsx  # Role + policy manager
│   │   └── components/
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
├── metadata/                    # Default seed metadata (JSON files)
│   └── examples/
│       ├── invoice.json
│       └── customer.json
├── migrations/                  # SQL migration files (golang-migrate format)
├── go.mod
├── go.sum
├── app.yaml                     # Application config
└── CLAUDE.MD
```

## Metadata Schemas

### Entity Definition

Stored in a `_entities` Postgres table (and editable via admin UI). JSON shape:

```json
{
  "name": "invoice",
  "table": "invoices",
  "primary_key": { "field": "id", "type": "uuid", "generated": true },
  "soft_delete": true,
  "fields": [
    { "name": "id", "type": "uuid", "required": true },
    { "name": "number", "type": "string", "required": true, "unique": true },
    { "name": "status", "type": "string", "default": "draft", "enum": ["draft", "sent", "paid", "void"] },
    { "name": "total", "type": "decimal", "precision": 2 },
    { "name": "customer_id", "type": "uuid", "required": true },
    { "name": "created_at", "type": "timestamp", "auto": "create" },
    { "name": "updated_at", "type": "timestamp", "auto": "update" },
    { "name": "deleted_at", "type": "timestamp", "nullable": true }
  ]
}
```

### Field Types

`string`, `text`, `int`, `bigint`, `decimal`, `boolean`, `uuid`, `timestamp`, `date`, `json`

### Relation Definition

Stored in `_relations` table:

```json
{
  "name": "invoice_items",
  "type": "one_to_many",
  "source": "invoice",
  "target": "invoice_item",
  "source_key": "id",
  "target_key": "invoice_id",
  "ownership": "source",
  "on_delete": "cascade",
  "fetch": "lazy",
  "write_mode": "diff"
}
```

```json
{
  "name": "invoice_tags",
  "type": "many_to_many",
  "source": "invoice",
  "target": "tag",
  "join_table": "invoice_tags",
  "source_join_key": "invoice_id",
  "target_join_key": "tag_id",
  "ownership": "none",
  "on_delete": "detach",
  "write_mode": "diff"
}
```

### Relation Types & Rules

| Type | FK lives on | Ownership | on_delete options |
|------|-------------|-----------|-------------------|
| `one_to_one` | target | source or target | `cascade`, `set_null`, `restrict` |
| `one_to_many` | target | source | `cascade`, `set_null`, `restrict` |
| `many_to_many` | join table | none | `detach`, `cascade` (hard-delete join rows) |

### Validation Rule Definition

Stored in `_rules` table. Three rule types:

**type: "field"** — simple per-field checks:
```json
{
  "entity": "invoice",
  "hook": "before_write",
  "type": "field",
  "conditions": [
    { "field": "total", "operator": "gte", "value": 0 },
    { "field": "number", "operator": "not_empty" }
  ],
  "message": "Invoice total must be non-negative and number is required"
}
```

**type: "expression"** — cross-field, conditional, cross-entity logic using [expr-lang/expr](https://github.com/expr-lang/expr):
```json
{
  "entity": "invoice",
  "hook": "before_write",
  "type": "expression",
  "expression": "record.status == 'paid' && record.payment_date == nil",
  "message": "Payment date is required when status is paid"
}
```

**type: "computed"** — derived field values:
```json
{
  "entity": "invoice",
  "hook": "before_write",
  "type": "computed",
  "field": "total",
  "expression": "sum(related.items, 'quantity * unit_price')",
  "related_load": [{ "relation": "items" }]
}
```

Expression environment: `record`, `old`, `related`, `user`, `action`, `now`.

**Hook points:** `before_write`, `after_write`, `before_delete`

**Field operators:** `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `not_in`, `not_empty`, `regex`, `unique`

See [docs/rules-and-workflows.md](docs/rules-and-workflows.md) for full expression rules, state machines, and workflow design.

### State Machine Definition

Stored in `_state_machines` table. Controls allowed transitions on a state field:

```json
{
  "entity": "invoice",
  "field": "status",
  "initial": "draft",
  "transitions": [
    { "from": "draft", "to": "sent", "roles": ["admin", "accountant"], "guard": "record.total > 0" },
    { "from": "sent", "to": "paid", "roles": ["admin"], "guard": "record.payment_date != nil" },
    { "from": ["draft", "sent"], "to": "void", "roles": ["admin"] }
  ]
}
```

### Workflow Definition

Stored in `_workflows` table. Multi-step, event-driven processes with approvals, conditions, and branching:

```json
{
  "name": "purchase_order_approval",
  "trigger": { "type": "state_change", "entity": "purchase_order", "field": "status", "to": "pending_approval" },
  "steps": [
    { "id": "manager_approval", "type": "approval", "timeout": "72h", "on_approve": { "goto": "check_amount" } },
    { "id": "check_amount", "type": "condition", "expression": "context.amount > 10000", "on_true": { "goto": "finance" } }
  ]
}
```

Runtime state tracked in `_workflow_instances` table. See [docs/rules-and-workflows.md](docs/rules-and-workflows.md).

### Permission Definition

Stored in `_permissions` table:

```json
{
  "entity": "invoice",
  "action": "update",
  "roles": ["admin", "accountant"],
  "conditions": [
    { "field": "status", "operator": "in", "value": ["draft", "sent"] }
  ]
}
```

**Actions:** `read`, `create`, `update`, `delete`

Permissions are evaluated early — before validation or writes.

## API Design

All entity operations go through a single dynamic router. Routes are registered at startup from loaded metadata.

### Endpoints (per entity)

```
GET    /api/:entity              # List with filters, pagination, sorting
GET    /api/:entity/:id          # Get by ID (with optional relation includes)
POST   /api/:entity              # Create (supports nested children)
PUT    /api/:entity/:id          # Update (supports nested children)
DELETE /api/:entity/:id          # Soft-delete (or hard-delete if configured)
```

### Query Parameters

```
GET /api/invoice?filter[status]=paid&filter[total.gte]=1000&sort=-created_at&page=1&per_page=25&include=items,customer
```

| Param | Format | Example |
|-------|--------|---------|
| `filter[field]` | Exact match | `filter[status]=paid` |
| `filter[field.op]` | Operator match | `filter[total.gte]=1000` |
| `sort` | Comma-separated, `-` prefix for desc | `sort=-created_at,number` |
| `page` | Page number (1-based) | `page=2` |
| `per_page` | Page size (default 25, max 100) | `per_page=50` |
| `include` | Comma-separated relations | `include=items,customer` |

### Nested Write Payload

```json
{
  "number": "INV-001",
  "status": "draft",
  "customer_id": "cust-uuid",
  "total": 1500.00,
  "items": {
    "_write_mode": "diff",
    "data": [
      { "description": "Widget", "quantity": 10, "unit_price": 100.00 },
      { "id": "existing-item-uuid", "quantity": 20 },
      { "id": "to-delete-uuid", "_delete": true }
    ]
  },
  "tags": {
    "_write_mode": "replace",
    "data": [
      { "id": "tag-uuid-1" },
      { "id": "tag-uuid-2" }
    ]
  }
}
```

### Response Format

```json
{
  "data": { ... },
  "meta": { "page": 1, "per_page": 25, "total": 142 }
}
```

Errors:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Validation failed",
    "details": [
      { "field": "total", "rule": "gte", "message": "must be >= 0" }
    ]
  }
}
```

## Engine Behavior

### Write Execution Order

1. Parse request body
2. Resolve entity metadata from registry
3. Evaluate **permissions** (reject early if unauthorized)
4. Run **before_write** field rules (Layer 1)
5. Run **before_write** expression rules (Layer 2)
6. Evaluate **computed fields** — set derived values on record
7. Validate **state machine** transition if state field changed (Layer 3)
8. **Plan** the write: build ordered list of SQL operations (parent first, children next, join table ops last)
9. Begin **transaction**
10. Execute parent write — capture generated PK
11. Propagate parent PK to child FKs
12. Execute child writes per write mode (append/replace/diff)
13. Execute join table operations for many-to-many
14. Execute state machine **transition actions** (set_field, create_record)
15. Run **after_write** rules (inside tx — can abort)
16. Write **audit log** row
17. **Commit** transaction
18. Fire state machine **post-commit actions** (webhooks, send_event)
19. Dispatch **webhooks** (async)
20. Emit **event** — may trigger **workflow** instances (Layer 4)
21. Return response

### Diff Algorithm (write_mode: "diff")

1. Fetch current child rows for parent (excluding soft-deleted)
2. Match incoming rows to existing by PK
3. Rows with PK present in both → UPDATE
4. Rows in incoming without PK → INSERT
5. Rows in existing but not in incoming → no action (diff does NOT delete missing rows)
6. Rows in incoming with `_delete: true` → soft-delete (or hard-delete for join tables)

### Soft Delete

- Every entity with `soft_delete: true` gets a `deleted_at` column
- All SELECT queries append `WHERE deleted_at IS NULL` automatically
- DELETE endpoint sets `deleted_at = NOW()` instead of removing the row
- Hard delete only when entity config has `soft_delete: false`

## Database

### System Tables (managed by engine)

```sql
_entities            -- entity metadata JSON
_relations           -- relation metadata JSON
_rules               -- validation rules (field, expression, computed)
_permissions         -- permission policies JSON
_state_machines      -- state field transitions, guards, actions
_workflows           -- workflow definitions (trigger, steps, branches)
_workflow_instances  -- running/completed workflow state + history
_webhooks            -- external HTTP hook registrations
_audit_log           -- mutation audit trail
```

### Audit Log Schema

```sql
CREATE TABLE _audit_log (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity     TEXT NOT NULL,
    record_id  TEXT NOT NULL,
    action     TEXT NOT NULL,       -- create, update, delete
    changes    JSONB,               -- {field: {old: x, new: y}}
    user_id    TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Auto-Migration

When an entity is created or updated via the admin UI, the engine:

1. Compares entity field metadata to actual Postgres columns (via `information_schema`)
2. Generates `ALTER TABLE ADD COLUMN` for new fields
3. Generates `ALTER TABLE ALTER COLUMN` for type changes (with safety checks)
4. Never drops columns automatically — column removal is manual only

## Auth

- Login endpoint: `POST /api/auth/login` returns `{ access_token, refresh_token }`
- Refresh endpoint: `POST /api/auth/refresh`
- Access token: short-lived JWT (15 min) with `{ user_id, roles }` claims
- Refresh token: long-lived (7 days), stored in DB, rotated on use
- Fiber middleware extracts token, validates, and sets `c.Locals("user")` with user context
- All `/api/:entity` routes require auth. Admin UI routes require `admin` role.

## Admin UI (SolidJS)

The admin UI is a SolidJS SPA served by Fiber in production (static files) or by Vite dev server in development.

### Pages

| Page | Purpose |
|------|---------|
| Entities | List all entities, create new, click to edit |
| Entity Detail | Add/remove/edit fields, configure PK, soft delete |
| Relations | Define relations between entities, set write modes |
| Rules | Field rules + expression rules with live test evaluator |
| State Machines | Visual state diagram editor — transitions, guards, actions |
| Workflows | Step-by-step flow builder — approvals, conditions, branches |
| Permissions | Assign CRUD permissions per entity per role |
| Webhooks | Register external endpoints, view delivery logs |
| Workflow Monitor | Running instances, step history, manual approve/reject |
| Data Browser | Generic table view to query/edit entity data |

### Dev Setup

```bash
cd admin && npm install && npm run dev   # Vite dev server on :3000
cd cmd/server && go run .                # Fiber API on :8080
```

In production, `admin/dist/` is embedded in the Go binary via `go:embed` and served at `/admin`.

## Conventions

- Use `pgx` directly — no ORM, no query builder library. Build SQL strings with parameterized queries.
- All SQL must use `$1, $2` placeholders — never string interpolation.
- Every exported function has a clear single responsibility.
- Errors are returned, not panicked. Use `fmt.Errorf("operation: %w", err)` for wrapping.
- Context (`context.Context`) is passed through all DB and engine calls.
- Metadata is loaded into memory at startup and refreshed on changes via admin UI.
- JSON serialization uses Go struct tags: `json:"field_name"`.
- File names use `snake_case.go`. Package names are short, single-word where possible.

## Non-Goals

- This is not an ORM — SQL is explicit and visible.
- No code generation — everything is metadata-interpreted at runtime.
- No GraphQL — REST only for now.
- No microservices — single binary deployment.
