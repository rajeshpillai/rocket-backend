# Dynamic REST API — Technical Design

## How It Works

Rocket serves every entity through a single set of parameterized Fiber routes. There are no per-entity handlers — the `:entity` path param is resolved against an in-memory metadata registry on every request.

## Startup Sequence

```
App boots
  → pgx connects to Postgres
  → SELECT * FROM _entities, _relations, _rules, _permissions
  → Parsed into Go structs (Entity, Relation, Rule, Permission)
  → Stored in Registry (sync.RWMutex-protected map[string]*Entity)
  → Five Fiber routes registered
  → Server listening on :8080
```

When an entity is created or updated via the admin UI, the registry is refreshed in-place (write-lock, swap, unlock). No restart required.

## Route Registration

```go
api := app.Group("/api")
api.Use(auth.Middleware())       // JWT validation on all routes

api.Get("/:entity", handler.List)
api.Get("/:entity/:id", handler.GetByID)
api.Post("/:entity", handler.Create)
api.Put("/:entity/:id", handler.Update)
api.Delete("/:entity/:id", handler.Delete)
```

Every entity — invoice, customer, product, anything defined in `_entities` — is served by these five handlers.

## Data Representation

Since entities are defined at runtime, there are no compile-time Go structs per entity. All data flows as:

- **Reads:** `[]map[string]any` — pgx scans columns dynamically based on field metadata
- **Writes:** `map[string]any` — parsed from JSON request body, validated against field metadata before SQL execution

The metadata `Field` definitions (type, required, enum, unique) provide the type safety that Go structs normally would.

## Request Flow: Read

Example: `GET /api/invoice?filter[status]=paid&filter[total.gte]=1000&sort=-created_at&page=1&per_page=25&include=items`

```
1. Auth middleware
   → Extract JWT from Authorization header
   → Validate token, decode claims { user_id, roles }
   → Set c.Locals("user", userCtx)

2. handler.List
   → entity := c.Params("entity")             // "invoice"
   → meta := registry.Get(entity)              // *Entity struct
   → if meta == nil → 404 { "error": "unknown entity" }

3. Permission check
   → Lookup _permissions for (entity=invoice, action=read)
   → Check user.Roles against allowed roles
   → If conditions exist (e.g. status IN [draft, sent]), append to query filters
   → Reject early if unauthorized → 403

4. Parse query params → QueryPlan
   → filter[status]=paid       → WhereClause{ Field: "status", Op: "eq", Value: "paid" }
   → filter[total.gte]=1000    → WhereClause{ Field: "total", Op: "gte", Value: 1000 }
   → sort=-created_at          → OrderClause{ Field: "created_at", Dir: "DESC" }
   → page=1, per_page=25       → Limit: 25, Offset: 0
   → include=items             → []string{"items"}

5. Validate query fields
   → Every field in filters/sorts is checked against meta.Fields
   → Unknown field → 400 { "error": "unknown field: foo" }
   → This prevents SQL injection through filter params

6. Build SQL from QueryPlan + metadata
   SELECT id, number, status, total, customer_id, created_at, updated_at
   FROM invoices
   WHERE deleted_at IS NULL
     AND status = $1
     AND total >= $2
   ORDER BY created_at DESC
   LIMIT $3 OFFSET $4

   Params: ["paid", 1000, 25, 0]

7. Execute via pgx
   → rows, err := pool.Query(ctx, sql, params...)
   → Scan into []map[string]any using column metadata for type conversion

8. Count query (for pagination meta)
   SELECT COUNT(*) FROM invoices WHERE deleted_at IS NULL AND status = $1 AND total >= $2

9. Load includes (separate queries, not JOINs)
   → Collect parent IDs: [uuid1, uuid2, ..., uuid25]
   → Lookup relation "items" in registry → one_to_many, target=invoice_item, target_key=invoice_id
   → SELECT * FROM invoice_items WHERE invoice_id = ANY($1) AND deleted_at IS NULL
   → Group results by invoice_id
   → Attach to each parent map: parent["items"] = [child1, child2, ...]

10. Return response
    {
      "data": [ { "id": "...", "number": "INV-001", "items": [...] }, ... ],
      "meta": { "page": 1, "per_page": 25, "total": 142 }
    }
```

## Request Flow: Write

Example: `POST /api/invoice` with nested items and tags.

### Request Body

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

### Execution Steps

```
1. Parse JSON body → map[string]any

2. Resolve entity metadata
   → meta := registry.Get("invoice")

3. Separate fields from relations
   → Iterate body keys
   → If key matches a field in meta.Fields → parent field map
   → If key matches a relation name in registry → relation write map
   → Unknown key → 400 error

   Result:
     parentFields = { "number": "INV-001", "status": "draft", "total": 1500.00, "customer_id": "cust-uuid" }
     relationWrites = {
       "items": { writeMode: "diff", data: [...] },
       "tags":  { writeMode: "replace", data: [...] }
     }

4. Permission check
   → Lookup _permissions for (entity=invoice, action=create)
   → Validate user roles + conditions
   → Reject → 403

5. Run before_write validation rules
   → Lookup _rules for (entity=invoice, hook=before_write)
   → Evaluate each condition against parentFields:
     - total >= 0? ✓
     - number not empty? ✓
   → If any fail → 422 with field-level error details

6. Plan the write (build operation list, don't execute yet)
   Op 1: INSERT INTO invoices (id, number, status, total, customer_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())
         RETURNING id
   Op 2: For "items" (one_to_many, write_mode=diff):
         - Row without PK → INSERT INTO invoice_items (..., invoice_id=$parent_id)
         - Row with PK    → UPDATE invoice_items SET quantity=$1 WHERE id=$2
         - Row with _delete → UPDATE invoice_items SET deleted_at=NOW() WHERE id=$1
   Op 3: For "tags" (many_to_many, write_mode=replace):
         - DELETE FROM invoice_tags WHERE invoice_id=$parent_id
         - INSERT INTO invoice_tags (invoice_id, tag_id) VALUES ($parent_id, $1), ($parent_id, $2)

7. BEGIN transaction

8. Execute Op 1 — capture generated parent ID
   → parentID = "generated-uuid"

9. Propagate parent ID to child operations
   → Inject parentID as invoice_id in all child INSERT/UPDATE ops

10. Execute Op 2 — child writes for "items"
    → INSERT new item (no PK) with invoice_id = parentID
    → UPDATE existing item by PK
    → Soft-delete item marked with _delete

11. Execute Op 3 — join table ops for "tags"
    → DELETE existing join rows for this invoice
    → INSERT new join rows

12. Run after_write rules (inside transaction)
    → If any fail → ROLLBACK → 422

13. Write audit log row
    INSERT INTO _audit_log (entity, record_id, action, changes, user_id)
    VALUES ('invoice', $parentID, 'create', $changesJSON, $userID)

14. COMMIT transaction

15. Emit event (outside transaction)
    → Publish { entity: "invoice", action: "create", record_id: parentID } to event bus

16. Return response
    {
      "data": { "id": "generated-uuid", "number": "INV-001", ... }
    }
```

## SQL Building

### Principles

- SQL is built as strings with `$N` parameter placeholders — never string interpolation
- Every field name in a query is validated against entity metadata before being placed in SQL
- Table names come from `meta.Table`, never from user input directly
- The query builder is a set of Go functions, not a library

### Select Builder

```
Input:  Entity metadata + QueryPlan (filters, sorts, pagination, soft_delete flag)
Output: SQL string + []any params

Process:
  1. Start with SELECT {columns} FROM {table}
  2. Columns come from meta.Fields — only known fields are projected
  3. If soft_delete=true → append WHERE deleted_at IS NULL
  4. For each filter → validate field exists, validate operator, append WHERE clause, add param
  5. For each sort → validate field exists, append ORDER BY clause
  6. Append LIMIT $N OFFSET $N
```

### Insert Builder

```
Input:  Entity metadata + field values map
Output: SQL string + []any params

Process:
  1. Filter incoming map to only known fields from meta.Fields
  2. Auto-generate PK if meta.PrimaryKey.Generated=true
  3. Auto-set created_at, updated_at if fields have auto="create"/"update"
  4. Build INSERT INTO {table} ({columns}) VALUES ({$params}) RETURNING {pk}
```

### Update Builder

```
Input:  Entity metadata + field values map + record ID
Output: SQL string + []any params

Process:
  1. Filter incoming map to only known fields (exclude PK and auto fields)
  2. Auto-set updated_at
  3. Build UPDATE {table} SET {col=$N, ...} WHERE {pk}=$N
```

## Relation Loading Strategy

Relations are loaded as **separate queries**, not JOINs. This avoids cartesian explosions when including multiple relations.

```
Example: GET /api/invoice?include=items,customer

Query 1 (parent):
  SELECT * FROM invoices WHERE ... LIMIT 25
  → 25 invoice rows, collect IDs

Query 2 (items — one_to_many):
  SELECT * FROM invoice_items WHERE invoice_id = ANY($1) AND deleted_at IS NULL
  → Group by invoice_id, attach to parent maps

Query 3 (customer — many_to_one / reverse lookup):
  Collect unique customer_ids from parent rows
  SELECT * FROM customers WHERE id = ANY($1) AND deleted_at IS NULL
  → Index by id, attach to parent maps
```

This is the same strategy used by Hasura and PostgREST — predictable query count, no row multiplication.

## Write Modes

Every relation write in a nested payload specifies a `_write_mode`:

### diff (default)

Compares incoming rows against current state. Safe, non-destructive.

```
1. Fetch current children: SELECT * FROM items WHERE parent_id=$1 AND deleted_at IS NULL
2. Match incoming rows to existing by PK
3. Has PK + exists in DB   → UPDATE
4. No PK                    → INSERT
5. Exists in DB + missing from incoming → NO ACTION (not deleted)
6. Has _delete: true        → soft-delete (or hard-delete for join tables)
```

### replace

Incoming payload is the complete truth. Anything not in the payload is removed.

```
1. Fetch current children
2. Incoming rows with PK matching existing → UPDATE
3. Incoming rows without PK → INSERT
4. Existing rows not in incoming → soft-delete (or hard-delete for join tables)
```

### append

Only adds new records. Never modifies or deletes existing ones.

```
1. Incoming rows without PK → INSERT
2. Incoming rows with PK → IGNORED (no update)
3. No deletes
```

## Soft Delete

- Entities with `soft_delete: true` have a `deleted_at TIMESTAMPTZ` column
- All SELECT queries automatically append `WHERE deleted_at IS NULL`
- DELETE endpoint executes `UPDATE {table} SET deleted_at = NOW() WHERE id = $1`
- Hard delete only when entity metadata has `soft_delete: false`
- Join table rows (many_to_many) are always hard-deleted since they carry no business data

## Error Responses

All errors follow a consistent structure:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": []
  }
}
```

| Code | HTTP Status | When |
|------|-------------|------|
| `UNKNOWN_ENTITY` | 404 | `:entity` param not found in registry |
| `NOT_FOUND` | 404 | Record ID doesn't exist |
| `UNAUTHORIZED` | 401 | Missing or invalid JWT |
| `FORBIDDEN` | 403 | Permission policy rejects the action |
| `VALIDATION_FAILED` | 422 | Validation rules failed |
| `UNKNOWN_FIELD` | 400 | Filter/sort references a field not in metadata |
| `INVALID_PAYLOAD` | 400 | Request body can't be parsed or has wrong types |
| `CONFLICT` | 409 | Unique constraint violation |
| `INTERNAL_ERROR` | 500 | Unexpected failure |

## Registry Refresh

When the admin UI creates/updates/deletes an entity:

```
1. Admin UI calls internal endpoint: POST /api/_admin/entities
2. Handler writes to _entities table
3. Handler calls registry.Reload()
   → Acquires write lock (sync.RWMutex)
   → Re-reads all metadata from DB
   → Rebuilds in-memory maps
   → Releases lock
4. All subsequent requests use updated metadata
```

Read handlers acquire read locks, so registry refreshes don't block concurrent requests (except for the brief swap).
