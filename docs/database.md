# Database — Technical Design

## Overview

Rocket uses PostgreSQL 15+ as the primary datastore, accessed via **pgx v5** directly — no ORM, no query builder library. SQL is constructed as parameterized strings with `$N` placeholders. The database holds both **system tables** (engine metadata) and **business tables** (created dynamically from entity definitions).

## Connection

```go
pool, err := pgxpool.New(ctx, connString)
```

- Connection pooling via `pgxpool`
- Connection string from `app.yaml` or `DATABASE_URL` env var
- Pool size configured per environment (default: 10 connections)
- All queries use `pool.Query()` / `pool.QueryRow()` / `pool.Exec()` with `context.Context`

## System Tables

These tables are created by the initial migration and managed by the engine. They store all metadata that drives the runtime.

```sql
-- Entity definitions
CREATE TABLE _entities (
    name        TEXT PRIMARY KEY,
    table_name  TEXT NOT NULL UNIQUE,
    definition  JSONB NOT NULL,          -- full entity JSON (fields, PK, soft_delete)
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Relation definitions
CREATE TABLE _relations (
    name        TEXT PRIMARY KEY,
    source      TEXT NOT NULL REFERENCES _entities(name),
    target      TEXT NOT NULL REFERENCES _entities(name),
    definition  JSONB NOT NULL,          -- full relation JSON (type, keys, ownership, etc.)
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Validation rules (field rules, expression rules, computed fields)
CREATE TABLE _rules (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity      TEXT NOT NULL REFERENCES _entities(name),
    hook        TEXT NOT NULL,            -- before_write, after_write, before_delete
    type        TEXT NOT NULL,            -- field, expression, computed
    definition  JSONB NOT NULL,          -- rule-specific JSON
    priority    INT DEFAULT 0,           -- execution order within same hook
    enabled     BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Permission policies
CREATE TABLE _permissions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity      TEXT NOT NULL REFERENCES _entities(name),
    action      TEXT NOT NULL,            -- read, create, update, delete
    roles       TEXT[] NOT NULL,          -- array of role names
    conditions  JSONB,                   -- optional field conditions
    enabled     BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- State machine definitions
CREATE TABLE _state_machines (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity      TEXT NOT NULL REFERENCES _entities(name) UNIQUE,
    field       TEXT NOT NULL,            -- which field is the state field
    initial     TEXT NOT NULL,            -- initial state for new records
    transitions JSONB NOT NULL,          -- array of transition objects
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Workflow definitions
CREATE TABLE _workflows (
    name        TEXT PRIMARY KEY,
    trigger     JSONB NOT NULL,          -- what starts this workflow
    context     JSONB,                   -- variables extracted from trigger
    steps       JSONB NOT NULL,          -- array of step objects
    enabled     BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Running/completed workflow instances
CREATE TABLE _workflow_instances (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow        TEXT NOT NULL REFERENCES _workflows(name),
    status          TEXT NOT NULL DEFAULT 'running',  -- running, completed, failed, cancelled
    current_step    TEXT,
    context         JSONB NOT NULL,       -- runtime context data
    history         JSONB DEFAULT '[]',   -- array of completed step records
    step_deadline   TIMESTAMPTZ,          -- timeout for current step
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Webhook registrations
CREATE TABLE _webhooks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity      TEXT NOT NULL REFERENCES _entities(name),
    hook        TEXT NOT NULL,            -- after_write, before_write, etc.
    url         TEXT NOT NULL,
    method      TEXT DEFAULT 'POST',
    headers     JSONB,
    condition   TEXT,                     -- expr expression (optional)
    async       BOOLEAN DEFAULT true,
    retry       JSONB,                   -- { max_attempts, backoff }
    enabled     BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Mutation audit trail
CREATE TABLE _audit_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity      TEXT NOT NULL,
    record_id   TEXT NOT NULL,
    action      TEXT NOT NULL,            -- create, update, delete
    changes     JSONB,                   -- { field: { old: x, new: y } }
    user_id     TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_log_entity_record ON _audit_log (entity, record_id);
CREATE INDEX idx_audit_log_created_at ON _audit_log (created_at);
CREATE INDEX idx_workflow_instances_status ON _workflow_instances (status) WHERE status = 'running';
```

## Business Tables

Business tables (e.g., `invoices`, `invoice_items`, `customers`) are created and altered dynamically by the auto-migration system when entities are defined via the admin UI.

### Table Naming

- Table name comes from `entity.table` in the metadata (e.g., entity `"invoice"` → table `"invoices"`)
- The engine never infers table names — they're always explicit in metadata

### Column Mapping

Entity field types map to Postgres types:

| Field Type | Postgres Column Type |
|------------|---------------------|
| `string` | `TEXT` |
| `text` | `TEXT` |
| `int` | `INTEGER` |
| `bigint` | `BIGINT` |
| `decimal` | `NUMERIC` (with precision if specified) |
| `boolean` | `BOOLEAN` |
| `uuid` | `UUID` |
| `timestamp` | `TIMESTAMPTZ` |
| `date` | `DATE` |
| `json` | `JSONB` |

## Auto-Migration

When an entity is created or updated via the admin UI, the engine automatically syncs the Postgres table to match the metadata.

### Process

```
1. Read current table columns from information_schema:
   SELECT column_name, data_type, is_nullable
   FROM information_schema.columns
   WHERE table_name = $1

2. Compare against entity field metadata

3. For each difference:
   a. Field exists in metadata but not in table → ALTER TABLE ADD COLUMN
   b. Field type changed → ALTER TABLE ALTER COLUMN TYPE (with safety check)
   c. Field exists in table but not in metadata → NO ACTION (never drop columns)

4. Handle constraints:
   a. unique: true → CREATE UNIQUE INDEX IF NOT EXISTS
   b. required: true → ALTER COLUMN SET NOT NULL (only if all rows have values)

5. If entity is brand new → CREATE TABLE with all columns
```

### Safety Rules

- **Never drop columns.** Removing a field from metadata hides it from the API but keeps the data in Postgres. Column removal is a manual DBA operation.
- **Type changes are guarded.** Only safe casts are allowed (e.g., `int → bigint`). Unsafe casts (e.g., `text → int`) are rejected with an error.
- **NOT NULL additions check existing data.** If a column is being set to NOT NULL and any rows have NULL values, the migration fails with a descriptive error.
- **All DDL runs outside the request transaction.** Migration is a separate operation triggered by admin UI saves, not during normal API requests.

### Soft Delete Column

When `soft_delete: true` is set on an entity, the engine ensures the table has:

```sql
deleted_at TIMESTAMPTZ NULL
```

And creates an index for efficient filtering:

```sql
CREATE INDEX idx_{table}_deleted_at ON {table} (deleted_at) WHERE deleted_at IS NULL;
```

## Transactions

All write operations (create, update, delete) execute inside a single Postgres transaction.

```go
tx, err := pool.Begin(ctx)
if err != nil {
    return err
}
defer tx.Rollback(ctx) // no-op if committed

// ... execute all operations using tx ...

err = tx.Commit(ctx)
```

### Transaction Scope

Everything between BEGIN and COMMIT:

- Parent INSERT/UPDATE
- Child writes (nested relations)
- Join table operations (many-to-many)
- State machine transition actions (set_field, create_record)
- After-write rule evaluation
- Audit log insertion

Everything after COMMIT (no transaction):

- Webhook dispatch (async)
- Event emission
- Workflow triggering

### Why Audit Log Is Inside the Transaction

If the write succeeds but audit logging fails, the write is rolled back. This guarantees that every mutation has an audit trail — there's no window where a change exists without a log entry.

## Query Execution

All queries are built as parameterized strings. The engine never interpolates values into SQL.

```go
// Good — parameterized
query := "SELECT id, name FROM customers WHERE status = $1 AND created_at > $2"
rows, err := pool.Query(ctx, query, "active", since)

// Never — string interpolation
query := fmt.Sprintf("SELECT * FROM customers WHERE status = '%s'", status) // FORBIDDEN
```

### Parameter Numbering

The query builder maintains a parameter counter and appends to a `[]any` params slice:

```go
type QueryBuilder struct {
    sql    strings.Builder
    params []any
    paramN int
}

func (qb *QueryBuilder) AddParam(v any) string {
    qb.paramN++
    qb.params = append(qb.params, v)
    return fmt.Sprintf("$%d", qb.paramN)
}
```

This ensures parameter numbers are always sequential and match the params slice.

## Indexes

The engine manages these indexes automatically:

| Index Type | When Created |
|------------|-------------|
| Primary key | On table creation |
| Unique | When a field has `unique: true` |
| Foreign key | When a relation references this table |
| Soft delete partial | When entity has `soft_delete: true` |

Custom indexes beyond these must be created manually via SQL migrations.
