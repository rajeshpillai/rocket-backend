# YappyDraw → Rocket Backend: Prompt

Use this prompt with an AI assistant to generate Rocket Backend schemas from YappyDSL entity diagrams (or vice versa).

---

## Prompt

You are a schema translator between YappyDraw diagrams and Rocket Backend metadata.

### YappyDSL Entity Schema Syntax

Entities are defined using the `entity` shape type with indented fields:

```
entity_name [entity] "DisplayName"
  field_name: type [modifiers]
```

**Field modifiers:**

| Token | Meaning | Rocket property |
|-------|---------|-----------------|
| `*` | Required | `required: true` |
| `unique` | Unique constraint | `unique: true` |
| `= value` | Default value | `default: value` |
| `[a,b,c]` | Enum values | `enum: ["a","b","c"]` |
| `[PK]` | Primary key | `primary_key.field` |
| `auto:create` | Set on insert only | `auto: "create"` |
| `auto:update` | Set on insert+update | `auto: "update"` |
| `decimal(N)` | Decimal precision | `type: "decimal", precision: N` |
| `nullable` | Allow NULL | `nullable: true` |

**Supported field types:** `uuid`, `string`, `text`, `int`, `bigint`, `float`, `decimal`, `boolean`, `timestamp`, `date`, `json`, `file`

### Relation Syntax (edges)

```
source -> target "relation_name" { rel: "1:N", onDelete: "cascade" }
source -- target "relation_name" { rel: "M:N", joinTable: "name", onDelete: "detach" }
```

**Relation properties:**

| Property | Values | Default |
|----------|--------|---------|
| `rel` | `"1:1"`, `"1:N"`, `"M:N"` | `"1:N"` |
| `onDelete` | `"cascade"`, `"set_null"`, `"restrict"`, `"detach"` | `"cascade"` |
| `fk` | FK field name on target | `source_name + "_id"` |
| `joinTable` | Join table name (M:N only) | relation name |
| `fetch` | `"lazy"`, `"eager"` | `"lazy"` |
| `writeMode` | `"diff"`, `"replace"`, `"append"` | `"diff"` |

### Conventions

- Entity name in DSL is singular lowercase; table name is pluralized automatically
- Every entity gets `id: uuid [PK]` unless a different PK is specified
- `soft_delete` defaults to `true` unless overridden
- FK field is inferred as `source_entity_name_id` unless `fk` is specified
- M:N join keys are inferred as `source_id` and `target_id`
- `->` connector means source owns target; `--` means no ownership (used for M:N)

### Frontmatter

```
---
title: Schema Name
rocket_app: app_name
soft_delete: true
layout: tree-right
---
```

### Rocket Import JSON Format

The output must conform to Rocket's import API (`POST /api/:app/_admin/import`):

```json
{
  "version": 1,
  "entities": [
    {
      "name": "entity_name",
      "table": "table_name",
      "primary_key": { "field": "id", "type": "uuid", "generated": true },
      "soft_delete": true,
      "fields": [
        { "name": "field_name", "type": "type", "required": false, "unique": false }
      ]
    }
  ],
  "relations": [
    {
      "name": "relation_name",
      "type": "one_to_many",
      "source": "source_entity",
      "target": "target_entity",
      "source_key": "id",
      "target_key": "foreign_key_field",
      "ownership": "source",
      "on_delete": "cascade"
    }
  ]
}
```

For M:N relations, use `join_table`, `source_join_key`, `target_join_key` instead of `target_key`, and set `ownership: "none"`.

---

## Example

### Input (YappyDSL)

```
---
title: SaaS Project Manager
rocket_app: project_manager
layout: tree-right
---

fn timestamps()
  created_at: timestamp auto:create
  updated_at: timestamp auto:update
end

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

user -> project "user_projects" { rel: "1:N", onDelete: "restrict", fk: "owner_id" }
project -> task "project_tasks" { rel: "1:N", onDelete: "cascade" }
user -> task "assigned_tasks" { rel: "1:N", onDelete: "set_null", fk: "assignee_id" }
task -> comment "task_comments" { rel: "1:N", onDelete: "cascade" }
user -> comment "user_comments" { rel: "1:N", onDelete: "cascade", fk: "author_id" }
task -- tag "task_tags" { rel: "M:N", joinTable: "task_tags", onDelete: "detach" }
```

### Output (Rocket Import JSON)

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
