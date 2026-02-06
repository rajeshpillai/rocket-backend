# Metadata Schemas — Technical Design

## Overview

Every business concept in Rocket is an **Entity** defined as JSON metadata. Entities, their fields, and their relations are stored in system Postgres tables (`_entities`, `_relations`) and loaded into an in-memory registry at startup. No Go structs are written per entity — the metadata *is* the schema.

## Entity Definition

Stored in the `_entities` table. Each row holds the full JSON definition of one entity.

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

### Entity Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `name` | string | yes | Unique identifier used in API routes (`/api/:entity`) |
| `table` | string | yes | Actual Postgres table name |
| `primary_key` | object | yes | PK configuration (see below) |
| `soft_delete` | bool | no | Default `true`. If true, deletes set `deleted_at` instead of removing rows |
| `fields` | array | yes | List of field definitions |

### Primary Key Configuration

```json
{ "field": "id", "type": "uuid", "generated": true }
```

| Property | Options | Description |
|----------|---------|-------------|
| `field` | any field name | Which field is the PK |
| `type` | `uuid`, `int`, `bigint`, `string` | PK data type |
| `generated` | `true` / `false` | If true, engine generates the value (uuid via `gen_random_uuid()`, int via sequence) |

**Composite keys:** Use an array of field names:
```json
{ "fields": ["tenant_id", "order_id"], "generated": false }
```

## Field Definition

Each field in the `fields` array describes one column.

```json
{ "name": "status", "type": "string", "required": true, "default": "draft", "enum": ["draft", "sent", "paid", "void"] }
```

### Field Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `name` | string | yes | Column name. Must match `[a-z][a-z0-9_]*` |
| `type` | string | yes | One of the supported field types (see below) |
| `required` | bool | no | Default `false`. If true, NULL and empty values are rejected |
| `unique` | bool | no | Default `false`. Engine creates a unique index |
| `default` | any | no | Default value inserted when field is absent from payload |
| `nullable` | bool | no | Default `false`. If true, column allows NULL |
| `enum` | array | no | Restricts values to this list. Validated before write |
| `precision` | int | no | Decimal places for `decimal` type |
| `auto` | string | no | `"create"` = set on insert, `"update"` = set on insert + update (for timestamps) |

### Supported Field Types

| Type | Postgres Type | Go scan type | Notes |
|------|--------------|--------------|-------|
| `string` | `TEXT` | `string` | General-purpose text |
| `text` | `TEXT` | `string` | Same as string, signals long-form content to UI |
| `int` | `INTEGER` | `int32` | 32-bit integer |
| `bigint` | `BIGINT` | `int64` | 64-bit integer |
| `decimal` | `NUMERIC(p,s)` | `decimal.Decimal` | Use `precision` to set scale |
| `boolean` | `BOOLEAN` | `bool` | |
| `uuid` | `UUID` | `string` | Stored as native Postgres UUID |
| `timestamp` | `TIMESTAMPTZ` | `time.Time` | Always stored with timezone |
| `date` | `DATE` | `time.Time` | Date only, no time component |
| `json` | `JSONB` | `map[string]any` | Arbitrary nested JSON |

### Auto Fields

Fields with `"auto"` are managed by the engine, not the client:

- `"auto": "create"` — set to `NOW()` on INSERT, never updated after
- `"auto": "update"` — set to `NOW()` on both INSERT and UPDATE

The engine silently ignores these fields if they appear in the request payload.

### Field Validation at Write Time

Before building SQL, the engine validates every incoming field:

```
1. Is the field name in the entity's field list? → Unknown field error if not
2. Is the value the correct type for this field? → Type mismatch error if not
3. Is the field required and missing/null? → Required field error
4. Does the field have an enum and value is not in it? → Enum violation error
5. Is the field marked unique? → Check deferred to DB constraint (not pre-checked)
```

---

## Relation Definition

Stored in the `_relations` table. Each row defines a relationship between two entities.

### One-to-Many

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

The FK (`invoice_id`) lives on the **target** table (`invoice_items`). The source entity "owns" the children.

### One-to-One

```json
{
  "name": "user_profile",
  "type": "one_to_one",
  "source": "user",
  "target": "profile",
  "source_key": "id",
  "target_key": "user_id",
  "ownership": "source",
  "on_delete": "cascade",
  "fetch": "eager",
  "write_mode": "replace"
}
```

Same as one-to-many structurally, but the engine enforces that at most one target record exists per source record.

### Many-to-Many

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

Requires an explicit **join table**. The join table holds only FK pairs (and optionally metadata like `created_at`). Neither entity "owns" the other.

### Relation Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `name` | string | yes | Unique identifier. Used as key in nested write payloads and `include` param |
| `type` | string | yes | `one_to_one`, `one_to_many`, `many_to_many` |
| `source` | string | yes | Source entity name |
| `target` | string | yes | Target entity name |
| `source_key` | string | yes | Field on source entity (usually PK) |
| `target_key` | string | yes* | FK field on target entity (*not used for many_to_many) |
| `join_table` | string | m2m only | Join table name for many_to_many |
| `source_join_key` | string | m2m only | FK column in join table pointing to source |
| `target_join_key` | string | m2m only | FK column in join table pointing to target |
| `ownership` | string | yes | `"source"`, `"target"`, or `"none"` |
| `on_delete` | string | yes | What happens when source is deleted (see below) |
| `fetch` | string | no | `"lazy"` (default) or `"eager"`. Eager = always included in GET responses |
| `write_mode` | string | no | Default write mode: `"diff"`, `"replace"`, or `"append"` |

### on_delete Behavior

| Value | Effect |
|-------|--------|
| `cascade` | Soft-delete (or hard-delete) all target records when source is deleted |
| `set_null` | Set the FK on target records to NULL when source is deleted |
| `restrict` | Reject the delete if any target records exist |
| `detach` | For many_to_many only: hard-delete join table rows (target records are untouched) |

### Relation Type Summary

| Type | FK lives on | Ownership | on_delete options |
|------|-------------|-----------|-------------------|
| `one_to_one` | target | source or target | `cascade`, `set_null`, `restrict` |
| `one_to_many` | target | source | `cascade`, `set_null`, `restrict` |
| `many_to_many` | join table | none | `detach`, `cascade` |

### How Relations Are Used

**In reads:** The `include` query param triggers separate queries to load related records (see [dynamic-rest-api.md](dynamic-rest-api.md)).

**In writes:** Relation names in the request body trigger nested write operations (see [nested-writes.md](nested-writes.md)).

**In deletes:** The `on_delete` policy determines cascading behavior.

**In filters:** `filter[relation.field]` triggers a JOIN or subquery to filter by related entity fields.

---

## Registry: In-Memory Metadata Store

At startup, all metadata is loaded from `_entities` and `_relations` into Go structs and stored in a `Registry`:

```
Registry
├── entities    map[string]*Entity       // keyed by entity name
├── relations   map[string][]*Relation   // keyed by source entity name
└── mu          sync.RWMutex             // protects concurrent access
```

- **Read handlers** acquire a read lock (`mu.RLock()`)
- **Admin write operations** acquire a write lock, reload all metadata from DB, rebuild maps, release lock
- Expressions (from `_rules`) are compiled to bytecode at load time and cached on the `Entity` struct
- Invalid metadata (unknown types, broken references) is logged and skipped — it doesn't crash the server

### Lookup Operations

```
registry.GetEntity("invoice")             → *Entity or nil
registry.GetRelations("invoice")          → []*Relation
registry.GetRelation("invoice", "items")  → *Relation or nil
```

Every handler starts with a registry lookup. Unknown entity → 404. Unknown relation in `include` → 400.
