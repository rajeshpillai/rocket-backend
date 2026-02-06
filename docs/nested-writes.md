# Nested Writes — Technical Design

## Overview

Rocket supports creating and updating parent + child records across relations in a single API call, inside a single database transaction. This is the critical capability that enables inline editing from UI without custom handlers.

## Nested Write Payload Format

When a request body contains a key that matches a relation name, the engine treats it as a nested write.

### Example: Create Invoice with Items and Tags

```
POST /api/invoice
```

```json
{
  "number": "INV-001",
  "status": "draft",
  "customer_id": "cust-uuid",
  "total": 1500.00,
  "items": {
    "_write_mode": "diff",
    "data": [
      { "description": "Widget A", "quantity": 10, "unit_price": 100.00 },
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

### Payload Structure

Top-level keys are split into two categories:

1. **Entity fields** — keys that match a field in the entity metadata → go into the parent INSERT/UPDATE
2. **Relation keys** — keys that match a relation name in the registry → trigger nested writes

Each relation key contains:

| Property | Type | Description |
|----------|------|-------------|
| `_write_mode` | string | `"diff"` (default), `"replace"`, or `"append"`. Overrides the relation's default write mode |
| `data` | array | The child records to write |

Each item in `data` can contain:

| Property | Meaning |
|----------|---------|
| Fields without PK | New record → INSERT |
| Fields with PK | Existing record → UPDATE (in diff/replace modes) |
| `"_delete": true` | Mark for deletion (soft-delete or hard-delete depending on entity config) |

---

## Write Modes

Every nested write uses one of three modes. The mode can be set per-relation in metadata (`write_mode` on the relation definition) or overridden per-request via `_write_mode` in the payload.

### diff (default)

Compares incoming data against current DB state. Only acts on what's explicitly provided. Safe and non-destructive.

```
1. Fetch current children: SELECT * FROM items WHERE invoice_id = $1 AND deleted_at IS NULL
2. Build lookup map of existing rows by PK
3. For each incoming row:
   a. Has PK + exists in DB     → UPDATE (only changed fields)
   b. Has no PK                 → INSERT (new child record)
   c. Has _delete: true         → soft-delete (or hard-delete for join tables)
4. Existing rows NOT in incoming → NO ACTION (left untouched)
```

**Key behavior:** Missing rows are *not* deleted. This makes diff safe for partial updates — you can send only the rows you want to modify.

### replace

Incoming payload is the **complete truth**. Anything not in the payload is removed.

```
1. Fetch current children
2. Build lookup map of existing rows by PK
3. For each incoming row:
   a. Has PK + exists in DB     → UPDATE
   b. Has no PK                 → INSERT
4. Existing rows NOT in incoming → soft-delete (or hard-delete for join tables)
```

**Key behavior:** Missing rows *are* deleted. Use this when the UI sends the full list of children (e.g., a tag picker that sends all selected tags).

### append

Only adds new records. Never modifies or deletes existing ones.

```
1. For each incoming row:
   a. Has no PK → INSERT
   b. Has PK    → SKIP (ignored, no update)
2. No deletes ever
```

**Key behavior:** Purely additive. Use for comment threads, activity logs, or any case where existing records should never change.

### Mode Comparison

| Behavior | diff | replace | append |
|----------|------|---------|--------|
| Insert new rows | yes | yes | yes |
| Update existing rows | yes | yes | no |
| Delete missing rows | no | yes | no |
| Delete marked rows (`_delete`) | yes | yes | no |

---

## Transaction Guarantees

All nested writes execute inside a single Postgres transaction. The full execution order:

```
1. Parse request body

2. Resolve entity metadata from registry

3. Separate parent fields from relation writes
   parentFields = { number, status, total, customer_id }
   relationWrites = {
     items: { mode: "diff", data: [...] },
     tags:  { mode: "replace", data: [...] }
   }

4. Permission check (reject early if unauthorized)

5. Validation: field rules → expression rules → computed fields → state machine

6. Plan the write — build ordered operation list:
   Op 1: INSERT/UPDATE parent record
   Op 2: Child writes for each one_to_one / one_to_many relation
   Op 3: Join table writes for each many_to_many relation

7. BEGIN transaction

8. Execute Op 1 — parent write
   - For INSERT: capture generated PK from RETURNING clause
   - For UPDATE: PK is known from the URL (:id)

9. Propagate parent PK to children
   - Every child INSERT gets the parent PK injected as its FK value
   - e.g., invoice_item.invoice_id = parent.id

10. Execute Op 2 — child writes (per write mode)
    For each one_to_many relation:
    a. Fetch current children (for diff/replace modes)
    b. Compute operations (inserts, updates, deletes)
    c. Execute all SQL operations

11. Execute Op 3 — join table writes
    For each many_to_many relation:
    a. Fetch current join rows
    b. Compute attach/detach operations
    c. Execute INSERT/DELETE on join table

12. Execute state machine transition actions (set_field, create_record)

13. Run after_write rules (inside tx — can abort with rollback)

14. Write audit log row

15. COMMIT

16. Post-commit: webhooks, events, workflow triggers

17. Return response
```

### Failure Handling

- If **any** step fails (validation, SQL error, after_write rule), the entire transaction is rolled back
- Partial updates never happen — either everything succeeds or nothing does
- The error response indicates which step failed:

```json
{
  "error": {
    "code": "NESTED_WRITE_FAILED",
    "message": "Failed to insert invoice_item",
    "details": [
      { "relation": "items", "index": 2, "error": "unique constraint on sku" }
    ]
  }
}
```

---

## Nested Depth

Nested writes support depth > 1. Example: Invoice → Items → Tax Lines

```json
{
  "number": "INV-001",
  "items": {
    "_write_mode": "diff",
    "data": [
      {
        "description": "Widget",
        "quantity": 10,
        "tax_lines": {
          "_write_mode": "replace",
          "data": [
            { "tax_type": "GST", "rate": 0.18 },
            { "tax_type": "CESS", "rate": 0.01 }
          ]
        }
      }
    ]
  }
}
```

The engine processes this recursively:

```
1. INSERT invoice → get invoice.id
2. INSERT invoice_item (invoice_id = invoice.id) → get item.id
3. INSERT tax_lines for that item (item_id = item.id)
```

Parent PK propagation happens at each level. The plan-then-execute approach ensures the full operation tree is validated before any SQL runs.

---

## Many-to-Many Writes

Many-to-many relations operate on the **join table**, not the target entity.

### diff mode

```json
{
  "tags": {
    "_write_mode": "diff",
    "data": [
      { "id": "tag-1" },
      { "id": "tag-3" }
    ]
  }
}
```

```
Current join rows: [(invoice_id, tag-1), (invoice_id, tag-2)]
Incoming:          [tag-1, tag-3]

Result:
  tag-1 → already exists → no action
  tag-2 → not in incoming → no action (diff doesn't remove)
  tag-3 → not in current → INSERT into join table
```

### replace mode

```
Current join rows: [(invoice_id, tag-1), (invoice_id, tag-2)]
Incoming:          [tag-1, tag-3]

Result:
  tag-1 → keep (exists in both)
  tag-2 → DELETE from join table (not in incoming)
  tag-3 → INSERT into join table
```

### Join Table Deletes

Join table rows are always **hard-deleted** (not soft-deleted) because they carry no business data — they only represent a link between two entities.

---

## FK Propagation

When the parent is being created (INSERT), its PK doesn't exist yet. The engine handles this:

```
1. Execute parent INSERT with RETURNING id
2. Capture the returned PK value
3. For each child write, inject the parent PK as the FK value:
   - child["invoice_id"] = parentPK
4. This happens before child SQL is built, so the FK is part of the INSERT
```

For nested depth > 1, this cascades: parent PK → child FK, child PK → grandchild FK.

For UPDATE operations, the parent PK is already known (from the URL `:id`), so propagation is only needed for new child INSERTs.
