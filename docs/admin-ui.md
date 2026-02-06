# Admin UI — Technical Design

## Overview

The admin UI is a **SolidJS** single-page application that provides visual management of all Rocket metadata: entities, fields, relations, rules, state machines, workflows, permissions, and webhooks. It also includes a data browser for querying and editing entity data.

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | SolidJS |
| Build tool | Vite |
| Routing | @solidjs/router |
| HTTP client | fetch (native) |
| Styling | TBD (Tailwind CSS or vanilla CSS) |
| State | SolidJS signals + stores |

## Development Setup

```bash
# Terminal 1 — API server
cd cmd/server && go run .    # Fiber on :8080

# Terminal 2 — Admin UI dev server
cd admin && npm install && npm run dev    # Vite on :3000
```

In development, the Vite dev server proxies API calls to the Fiber backend:

```ts
// admin/vite.config.ts
export default defineConfig({
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:8080'
    }
  }
})
```

## Production Deployment

In production, the SolidJS app is built to static files and embedded in the Go binary:

```bash
cd admin && npm run build    # outputs to admin/dist/
```

```go
// cmd/server/main.go
//go:embed ../../admin/dist
var adminFS embed.FS

app.Static("/admin", adminFS)
```

Single binary deployment — no separate frontend server.

## Pages

### Entities Page

**Route:** `/admin/entities`

Lists all entities from `_entities` table. Each row shows entity name, table name, field count, and soft-delete status. Actions: create new entity, click to edit.

**API calls:**
- `GET /api/_admin/entities` — list all
- `POST /api/_admin/entities` — create new
- `DELETE /api/_admin/entities/:name` — delete entity

### Entity Detail Page

**Route:** `/admin/entities/:name`

Full editor for a single entity. Three sections:

**Fields section:**
- Table of fields with name, type, required, unique, default, enum columns
- Add field row, remove field, reorder fields
- Type selector dropdown with all supported types
- Enum editor (tag-style input for allowed values)

**Primary Key section:**
- Select which field is the PK
- Toggle auto-generation
- PK type is locked to the selected field's type

**Settings section:**
- Soft delete toggle
- Table name (editable, with validation)

**API calls:**
- `GET /api/_admin/entities/:name` — load entity definition
- `PUT /api/_admin/entities/:name` — save changes (triggers auto-migration)

### Relations Page

**Route:** `/admin/relations`

Lists all relations. Each row shows relation name, type (badge), source → target, write mode.

**Relation Editor (modal or inline):**
- Source entity selector
- Target entity selector
- Relation type radio: one_to_one, one_to_many, many_to_many
- Dynamic fields based on type:
  - one_to_one / one_to_many: source_key, target_key
  - many_to_many: join_table, source_join_key, target_join_key
- Ownership selector
- on_delete selector
- Fetch strategy: lazy / eager
- Default write mode: diff / replace / append

**API calls:**
- `GET /api/_admin/relations` — list all
- `POST /api/_admin/relations` — create
- `PUT /api/_admin/relations/:name` — update
- `DELETE /api/_admin/relations/:name` — delete

### Rules Page

**Route:** `/admin/rules`

Filterable by entity and hook point. Three rule type tabs:

**Field Rules tab:**
- Add conditions as rows: field, operator, value
- Operator dropdown changes available value input based on type

**Expression Rules tab:**
- Code editor textarea for expr-lang expressions
- Live test evaluator: paste a sample `record` JSON, see expression result
- Expression environment reference (record, old, related, user, action, now)

**Computed Fields tab:**
- Target field selector
- Expression editor
- Related data loader config (which relations to pre-fetch)

**API calls:**
- `GET /api/_admin/rules?entity=invoice` — list rules for entity
- `POST /api/_admin/rules` — create rule
- `PUT /api/_admin/rules/:id` — update rule
- `DELETE /api/_admin/rules/:id` — delete rule
- `POST /api/_admin/rules/test` — test expression against sample data

### State Machine Editor

**Route:** `/admin/state-machines/:entity`

Visual state diagram:

- States rendered as nodes (circles/boxes)
- Transitions rendered as directed arrows between states
- Click a transition to edit: guard expression, allowed roles, actions
- Add new state by creating a transition to a new name
- Initial state highlighted
- Drag to reposition (visual only, no logic impact)

**API calls:**
- `GET /api/_admin/state-machines/:entity` — load state machine
- `PUT /api/_admin/state-machines/:entity` — save state machine

### Workflow Builder

**Route:** `/admin/workflows/:name`

Step-by-step flow editor:

- Steps shown as a vertical or horizontal flowchart
- Step types: action, condition, approval, wait, parallel
- Condition steps show branching (true/false paths)
- Approval steps show assignee config, timeout, and outcome paths
- Drag to reorder or reconnect steps
- Trigger config: entity, field, state value

**API calls:**
- `GET /api/_admin/workflows` — list all workflows
- `GET /api/_admin/workflows/:name` — load workflow definition
- `POST /api/_admin/workflows` — create workflow
- `PUT /api/_admin/workflows/:name` — update workflow

### Permissions Page

**Route:** `/admin/permissions`

Grid view: rows = entities, columns = actions (read, create, update, delete). Each cell shows which roles have access.

**Permission Editor (modal):**
- Entity selector
- Action selector
- Role multi-select (checkboxes)
- Optional conditions (same condition builder as rules)

**API calls:**
- `GET /api/_admin/permissions` — list all
- `POST /api/_admin/permissions` — create
- `PUT /api/_admin/permissions/:id` — update
- `DELETE /api/_admin/permissions/:id` — delete

### Webhooks Page

**Route:** `/admin/webhooks`

List of registered webhooks with entity, hook, URL, async/sync badge, enabled toggle.

**Webhook Editor (modal):**
- Entity selector
- Hook point selector
- URL input
- Method selector (POST, PUT)
- Headers key-value editor (supports `{{env.VAR}}` template syntax)
- Condition expression (optional)
- Async toggle
- Retry config: max attempts, backoff strategy

**API calls:**
- `GET /api/_admin/webhooks` — list all
- `POST /api/_admin/webhooks` — create
- `PUT /api/_admin/webhooks/:id` — update
- `DELETE /api/_admin/webhooks/:id` — delete

### Workflow Monitor

**Route:** `/admin/workflows/monitor`

Lists running and recent workflow instances:

- Instance ID, workflow name, current step, status, created_at
- Click to expand: full step history with timestamps, outcomes, and user actions
- Manual approve/reject buttons for pending approval steps

**API calls:**
- `GET /api/_workflows?status=running` — list running instances
- `GET /api/_workflows/:id` — instance detail with history
- `POST /api/_workflows/:id/approve` — approve current step
- `POST /api/_workflows/:id/reject` — reject current step

### Data Browser

**Route:** `/admin/data/:entity`

Generic table view for any entity:

- Column headers from entity field metadata
- Sortable columns (click header)
- Filter bar with field + operator + value inputs
- Pagination controls
- Click row to edit inline (triggers PUT with nested writes if relations are shown)
- Delete button per row (soft-delete)
- Include selector to load relations as nested columns

**API calls:**
- Uses the standard `/api/:entity` endpoints (same as any API consumer)

---

## Admin API Routes

All admin endpoints live under `/api/_admin/` and require the `admin` role.

```
/api/_admin/entities          GET, POST
/api/_admin/entities/:name    GET, PUT, DELETE
/api/_admin/relations         GET, POST
/api/_admin/relations/:name   GET, PUT, DELETE
/api/_admin/rules             GET, POST
/api/_admin/rules/:id         GET, PUT, DELETE
/api/_admin/rules/test        POST
/api/_admin/state-machines/:entity    GET, PUT
/api/_admin/workflows         GET, POST
/api/_admin/workflows/:name   GET, PUT, DELETE
/api/_admin/permissions       GET, POST
/api/_admin/permissions/:id   GET, PUT, DELETE
/api/_admin/webhooks          GET, POST
/api/_admin/webhooks/:id      GET, PUT, DELETE
/api/_admin/users             GET, POST
/api/_admin/users/:id         GET, PUT, DELETE
```

When any metadata is saved via these endpoints, the handler calls `registry.Reload()` to refresh the in-memory metadata registry immediately.
