# YappyDraw Integration — Schema-Driven Backend from Diagrams

## Overview

YappyDraw is an API-driven drawing, diagramming, and mindmapping tool with a built-in scripting language (YappyDSL/YSL). This integration lets users design system schemas visually in YappyDraw and generate a fully working Rocket backend from the diagram — entities, relations, database tables, and REST endpoints, all from a single `.ysl` file or canvas drawing.

**YappyDraw location:** `/home/rajesh/work/yappy`

## How It Works

```
YappyDSL script (.ysl)          Visual diagram (canvas)
        │                               │
        ▼                               ▼
   YSL Parser ──────────────────► DSLDiagram IR
                                        │
                                        ▼
                                 Rocket Adapter
                                        │
                                        ▼
                              Rocket Import JSON
                                        │
                                        ▼
                          POST /api/:app/_admin/import
                                        │
                                        ▼
                         DB tables + REST API live
```

Both paths — text script and visual canvas — produce the same intermediate representation (`DSLDiagram`). The Rocket adapter converts that IR into Rocket's import format.

## YappyDraw Capabilities Used

### Existing features (no changes needed)

| Feature | How it maps |
|---------|-------------|
| UML Class shapes | Entity definitions (name + fields) |
| Connectors with arrowheads | Relations between entities |
| Binding system (`startBinding` / `endBinding`) | Knows which shapes a connector joins |
| Crowsfoot / bar / diamond arrowheads | ER diagram notation (1:1, 1:N, M:N) |
| `properties` field on nodes | Custom metadata storage |
| Adapter pattern (`src/dsl/adapters/`) | Plug in new output formats |
| DSLDiagram IR (`DSLNode[]` + `DSLEdge[]`) | Format-agnostic intermediate representation |
| JSON export | Serializable document format |
| YSL scripting (variables, loops, functions) | Scriptable schema generation |
| Frontmatter metadata | Diagram-level config (app name, layout) |
| `umlAttributes` / `umlMethods` on Class shapes | Field definitions on entities |

### New features to build

| Feature | Where |
|---------|-------|
| `entity` shape alias | `src/dsl/shape-aliases.ts` (one line) |
| Rocket adapter | `src/dsl/adapters/rocket/` (new module) |
| "Export to Rocket" action | Export menu or `Yappy.exportToRocket()` |
| Reverse: Rocket → YappyDSL | Depends on planned `exportDSL()` feature |

## Schema DSL Convention

### Entity definition

Use the `entity` shape type (alias for UML Class) with fields as indented children or `umlAttributes`:

```
customer [entity] "Customer"
  id: uuid [PK]
  name: string *
  email: string * unique
  phone: string
  status: string = active [draft,active,suspended]
  created_at: timestamp auto:create
  updated_at: timestamp auto:update
```

### Field syntax

```
field_name: type [modifiers]
```

| Token | Meaning | Rocket field property |
|-------|---------|----------------------|
| `field_name` | Column name | `name` |
| `type` | Field type | `type` (string, int, uuid, timestamp, etc.) |
| `*` | Required | `required: true` |
| `unique` | Unique constraint | `unique: true` |
| `= value` | Default value | `default: value` |
| `[a,b,c]` | Enum values | `enum: ["a","b","c"]` |
| `[PK]` | Primary key | `primary_key.field` |
| `auto:create` | Set on insert | `auto: "create"` |
| `auto:update` | Set on insert+update | `auto: "update"` |
| `decimal(N)` | Decimal precision | `type: "decimal", precision: N` |
| `nullable` | Allow NULL | `nullable: true` |

### Relation definition (edges)

```
source -> target "relation_name" { rel: "1:N", onDelete: "cascade" }
```

| Edge property | Meaning | Rocket relation property |
|---------------|---------|--------------------------|
| `source -> target` | Direction of ownership | `source`, `target` |
| `"relation_name"` | Edge label | `name` |
| `rel: "1:1"` | One-to-one | `type: "one_to_one"` |
| `rel: "1:N"` | One-to-many | `type: "one_to_many"` |
| `rel: "M:N"` | Many-to-many | `type: "many_to_many"` |
| `onDelete: "cascade"` | Delete behavior | `on_delete: "cascade"` |
| `onDelete: "set_null"` | Nullify FK | `on_delete: "set_null"` |
| `onDelete: "restrict"` | Prevent delete | `on_delete: "restrict"` |
| `onDelete: "detach"` | Remove join rows (M:N) | `on_delete: "detach"` |
| `fk: "field_name"` | Foreign key field | `target_key` |
| `joinTable: "name"` | Join table (M:N) | `join_table` |
| `fetch: "eager"` | Always include | `fetch: "eager"` |
| `writeMode: "replace"` | Write strategy | `write_mode: "replace"` |

### Arrowhead-based relation inference (visual diagrams)

When drawing on canvas instead of writing DSL, the adapter infers relation type from arrowheads:

| Start arrowhead | End arrowhead | Inferred type |
|-----------------|---------------|---------------|
| bar / null | crowsfoot | `one_to_many` |
| bar / null | bar / null | `one_to_one` |
| crowsfoot | crowsfoot | `many_to_many` |
| diamond | diamond | `many_to_many` |

### Frontmatter

```
---
title: Invoice System
rocket_app: invoicing
soft_delete: true
layout: tree-right
---
```

| Key | Purpose |
|-----|---------|
| `title` | Diagram title |
| `rocket_app` | Target Rocket app name |
| `soft_delete` | Default soft_delete for all entities (overridable per entity) |
| `layout` | Visual layout strategy |

## Full Example

### YSL script

```
---
title: SaaS Project Manager
rocket_app: project_manager
layout: tree-right
---

# Reusable timestamp fields
fn timestamps()
  created_at: timestamp auto:create
  updated_at: timestamp auto:update
end

# ── Entities ──

user [entity] "User"
  id: uuid [PK]
  email: string * unique
  name: string *
  role: string = member [admin,member,viewer]
  timestamps()

project [entity] "Project"
  id: uuid [PK]
  name: string *
  description: text
  owner_id: uuid *
  timestamps()

task [entity] "Task"
  id: uuid [PK]
  title: string *
  body: text
  status: string = todo [todo,in_progress,review,done]
  priority: string = medium [low,medium,high,critical]
  project_id: uuid *
  assignee_id: uuid
  due_date: date
  timestamps()

tag [entity] "Tag"
  id: uuid [PK]
  name: string * unique
  color: string = "#6b7280"

comment [entity] "Comment"
  id: uuid [PK]
  body: text *
  task_id: uuid *
  author_id: uuid *
  created_at: timestamp auto:create

# ── Relations ──

user -> project "user_projects" { rel: "1:N", onDelete: "restrict", fk: "owner_id" }
project -> task "project_tasks" { rel: "1:N", onDelete: "cascade" }
user -> task "assigned_tasks" { rel: "1:N", onDelete: "set_null", fk: "assignee_id" }
task -> comment "task_comments" { rel: "1:N", onDelete: "cascade" }
user -> comment "user_comments" { rel: "1:N", onDelete: "cascade", fk: "author_id" }
task -- tag "task_tags" { rel: "M:N", joinTable: "task_tags", onDelete: "detach" }
```

### Generated Rocket import JSON

The adapter produces the following from the script above:

```json
{
  "version": 1,
  "entities": [
    {
      "name": "user",
      "table": "users",
      "primary_key": { "field": "id", "type": "uuid", "generated": true },
      "soft_delete": true,
      "fields": [
        { "name": "id", "type": "uuid", "required": true },
        { "name": "email", "type": "string", "required": true, "unique": true },
        { "name": "name", "type": "string", "required": true },
        { "name": "role", "type": "string", "default": "member", "enum": ["admin", "member", "viewer"] },
        { "name": "created_at", "type": "timestamp", "auto": "create" },
        { "name": "updated_at", "type": "timestamp", "auto": "update" }
      ]
    },
    {
      "name": "project",
      "table": "projects",
      "primary_key": { "field": "id", "type": "uuid", "generated": true },
      "soft_delete": true,
      "fields": [
        { "name": "id", "type": "uuid", "required": true },
        { "name": "name", "type": "string", "required": true },
        { "name": "description", "type": "text" },
        { "name": "owner_id", "type": "uuid", "required": true },
        { "name": "created_at", "type": "timestamp", "auto": "create" },
        { "name": "updated_at", "type": "timestamp", "auto": "update" }
      ]
    },
    {
      "name": "task",
      "table": "tasks",
      "primary_key": { "field": "id", "type": "uuid", "generated": true },
      "soft_delete": true,
      "fields": [
        { "name": "id", "type": "uuid", "required": true },
        { "name": "title", "type": "string", "required": true },
        { "name": "body", "type": "text" },
        { "name": "status", "type": "string", "default": "todo", "enum": ["todo", "in_progress", "review", "done"] },
        { "name": "priority", "type": "string", "default": "medium", "enum": ["low", "medium", "high", "critical"] },
        { "name": "project_id", "type": "uuid", "required": true },
        { "name": "assignee_id", "type": "uuid" },
        { "name": "due_date", "type": "date" },
        { "name": "created_at", "type": "timestamp", "auto": "create" },
        { "name": "updated_at", "type": "timestamp", "auto": "update" }
      ]
    },
    {
      "name": "tag",
      "table": "tags",
      "primary_key": { "field": "id", "type": "uuid", "generated": true },
      "soft_delete": true,
      "fields": [
        { "name": "id", "type": "uuid", "required": true },
        { "name": "name", "type": "string", "required": true, "unique": true },
        { "name": "color", "type": "string", "default": "#6b7280" }
      ]
    },
    {
      "name": "comment",
      "table": "comments",
      "primary_key": { "field": "id", "type": "uuid", "generated": true },
      "soft_delete": true,
      "fields": [
        { "name": "id", "type": "uuid", "required": true },
        { "name": "body", "type": "text", "required": true },
        { "name": "task_id", "type": "uuid", "required": true },
        { "name": "author_id", "type": "uuid", "required": true },
        { "name": "created_at", "type": "timestamp", "auto": "create" }
      ]
    }
  ],
  "relations": [
    {
      "name": "user_projects",
      "type": "one_to_many",
      "source": "user",
      "target": "project",
      "source_key": "id",
      "target_key": "owner_id",
      "ownership": "source",
      "on_delete": "restrict"
    },
    {
      "name": "project_tasks",
      "type": "one_to_many",
      "source": "project",
      "target": "task",
      "source_key": "id",
      "target_key": "project_id",
      "ownership": "source",
      "on_delete": "cascade"
    },
    {
      "name": "assigned_tasks",
      "type": "one_to_many",
      "source": "user",
      "target": "task",
      "source_key": "id",
      "target_key": "assignee_id",
      "ownership": "source",
      "on_delete": "set_null"
    },
    {
      "name": "task_comments",
      "type": "one_to_many",
      "source": "task",
      "target": "comment",
      "source_key": "id",
      "target_key": "task_id",
      "ownership": "source",
      "on_delete": "cascade"
    },
    {
      "name": "user_comments",
      "type": "one_to_many",
      "source": "user",
      "target": "comment",
      "source_key": "id",
      "target_key": "author_id",
      "ownership": "source",
      "on_delete": "cascade"
    },
    {
      "name": "task_tags",
      "type": "many_to_many",
      "source": "task",
      "target": "tag",
      "join_table": "task_tags",
      "source_join_key": "task_id",
      "target_join_key": "tag_id",
      "ownership": "none",
      "on_delete": "detach"
    }
  ]
}
```

## Reverse Direction: Rocket → YappyDraw

Export an existing Rocket app schema as a YappyDSL script or visual diagram.

### Flow

```
GET /api/:app/_admin/export
        │
        ▼
  Rocket Export JSON
        │
        ▼
  Reverse Adapter
        │
        ▼
  YappyDSL script (.ysl)     or     DSLDiagram IR → canvas
```

### Use cases

- Visualize an existing backend as an ER diagram
- Hand off system design to non-technical stakeholders
- Round-trip editing: export → tweak visually → re-import

## Implementation Plan

### Phase 1: Adapter (YappyDraw side)

Build a `rocket-adapter` in YappyDraw's existing adapter registry.

**Files to create/modify in YappyDraw:**

| File | Change |
|------|--------|
| `src/dsl/shape-aliases.ts` | Add `entity` → `umlClass` alias |
| `src/dsl/adapters/rocket/rocket-adapter.ts` | New: parse DSLDiagram IR → Rocket import JSON |
| `src/dsl/adapters/rocket/field-parser.ts` | New: parse field syntax (`name: type * unique = default`) |
| `src/dsl/adapters/rocket/relation-inferrer.ts` | New: infer relation type from edge properties/arrowheads |
| `src/dsl/adapters/adapter-registry.ts` | Register the Rocket adapter |

### Phase 2: Export action (YappyDraw side)

| File | Change |
|------|--------|
| `src/utils/export.ts` | Add `exportToRocket()` function |
| UI export menu | Add "Export to Rocket" option |
| `window.Yappy` API | Expose `Yappy.exportToRocket()` |

### Phase 3: Import in Rocket Admin UI

| File | Change |
|------|--------|
| `admin/src/pages/` | New page: "Import from YappyDraw" |
| Upload `.ysl` file or paste DSL text | Parse client-side, preview entities/relations, then POST to import API |

### Phase 4: Reverse adapter (Rocket → YappyDSL)

| File | Change |
|------|--------|
| `src/dsl/adapters/rocket/rocket-to-dsl.ts` (YappyDraw) | Convert Rocket export JSON → DSLDiagram IR |
| `src/dsl/export/` (YappyDraw) | Depends on planned `exportDSL()` feature for text output |
| `admin/src/pages/` (Rocket) | "View as Diagram" button on schema export page |

## Edge Cases & Design Decisions

### FK field inference

When no `fk` property is specified on an edge, the adapter infers the foreign key field name:

```
user -> task                    # infers target_key: "user_id"
user -> task { fk: "owner_id" } # explicit target_key: "owner_id"
```

Rule: `lowercase(source_entity_name) + "_id"` unless overridden.

### Many-to-many join table

When `rel: "M:N"` is specified:

```
task -- tag "task_tags" { rel: "M:N" }
# Infers:
#   join_table: "task_tags"
#   source_join_key: "task_id"
#   target_join_key: "tag_id"
```

If `joinTable` is provided, it overrides the inferred name. Join keys are always `source_name_id` and `target_name_id`.

### Table name inference

Entity name is singularized in the DSL, table name is pluralized:

```
user [entity] "User"    # table: "users"
task [entity] "Task"    # table: "tasks"
```

Simple pluralization: append `s`, with common exceptions (`y` → `ies`, `s/sh/ch/x` → `es`).

### Self-referencing relations

```
employee -> employee "reports_to" { rel: "1:N", onDelete: "set_null", fk: "manager_id" }
```

Source and target are the same entity. The `fk` property is required to avoid ambiguity.

### Soft delete default

All entities default to `soft_delete: true` unless overridden in frontmatter or per-entity:

```
---
soft_delete: false    # global default
---

audit_log [entity] "AuditLog" { soft_delete: false }
```
