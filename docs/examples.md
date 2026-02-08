# Rocket Backend — Examples & Cookbook

A practical, end-to-end guide with real API calls demonstrating how to define entities, relations, rules, state machines, workflows, webhooks, permissions, nested writes, file uploads, and schema export/import.

All examples assume:
- Backend running on `http://localhost:8080`
- App name: `demo`
- Platform token obtained via `/api/_platform/auth/login`
- App admin token obtained via `/api/demo/auth/login`

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Entity Definition](#2-entity-definition)
3. [Relation Definition](#3-relation-definition)
4. [Dynamic CRUD Operations](#4-dynamic-crud-operations)
5. [Nested Writes](#5-nested-writes)
6. [Validation Rules](#6-validation-rules)
7. [State Machines](#7-state-machines)
8. [Workflows](#8-workflows)
9. [Webhooks](#9-webhooks)
10. [Permissions](#10-permissions)
11. [File Uploads](#11-file-uploads)
12. [Schema Export & Import](#12-schema-export--import)
13. [Complete Scenario: Invoice System](#13-complete-scenario-invoice-system)

---

## 1. Authentication

### Platform Login

```bash
curl -X POST http://localhost:8080/api/_platform/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "platform@localhost",
    "password": "changeme"
  }'
```

**Response:**
```json
{
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIs...",
    "refresh_token": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "expires_in": 900
  }
}
```

### Create an App

```bash
curl -X POST http://localhost:8080/api/_platform/apps \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "demo",
    "display_name": "Demo Application"
  }'
```

This provisions a new database `rocket_demo` with all system tables and a seed admin user.

### App Login

```bash
curl -X POST http://localhost:8080/api/demo/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@localhost",
    "password": "changeme"
  }'
```

**Response:**
```json
{
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIs...",
    "refresh_token": "f7e8d9c0-b1a2-3456-7890-abcdef012345",
    "expires_in": 900
  }
}
```

### Refresh Token

```bash
curl -X POST http://localhost:8080/api/demo/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refresh_token": "f7e8d9c0-b1a2-3456-7890-abcdef012345"
  }'
```

---

## 2. Entity Definition

### Simple Entity: Customer

```bash
curl -X POST http://localhost:8080/api/demo/_admin/entities \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "customer",
    "table": "customers",
    "primary_key": {
      "field": "id",
      "type": "uuid",
      "generated": true
    },
    "soft_delete": true,
    "fields": [
      { "name": "id", "type": "uuid", "required": true },
      { "name": "name", "type": "string", "required": true },
      { "name": "email", "type": "string", "required": true, "unique": true },
      { "name": "phone", "type": "string" },
      { "name": "status", "type": "string", "enum": ["active", "inactive", "suspended"] },
      { "name": "credit_limit", "type": "decimal", "precision": 2 },
      { "name": "notes", "type": "text" },
      { "name": "metadata", "type": "json" },
      { "name": "created_at", "type": "timestamp", "auto": "create" },
      { "name": "updated_at", "type": "timestamp", "auto": "update" }
    ]
  }'
```

### Entity with All Field Types

```bash
curl -X POST http://localhost:8080/api/demo/_admin/entities \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "product",
    "table": "products",
    "primary_key": {
      "field": "id",
      "type": "uuid",
      "generated": true
    },
    "soft_delete": true,
    "fields": [
      { "name": "id", "type": "uuid", "required": true },
      { "name": "sku", "type": "string", "required": true, "unique": true },
      { "name": "name", "type": "string", "required": true },
      { "name": "description", "type": "text" },
      { "name": "price", "type": "decimal", "precision": 2, "required": true },
      { "name": "quantity", "type": "int", "default": 0 },
      { "name": "weight_grams", "type": "bigint" },
      { "name": "is_active", "type": "boolean", "default": true },
      { "name": "category", "type": "string", "enum": ["electronics", "clothing", "food", "other"] },
      { "name": "launch_date", "type": "date" },
      { "name": "image", "type": "file" },
      { "name": "specs", "type": "json" },
      { "name": "created_at", "type": "timestamp", "auto": "create" },
      { "name": "updated_at", "type": "timestamp", "auto": "update" }
    ]
  }'
```

**Supported field types:**

| Type | PostgreSQL | Notes |
|------|------------|-------|
| `string` / `text` | TEXT | General-purpose text |
| `int` | INTEGER | 32-bit integer |
| `bigint` | BIGINT | 64-bit integer |
| `decimal` | NUMERIC(18,N) | Use `precision` for decimal places |
| `boolean` | BOOLEAN | true/false |
| `uuid` | UUID | Universally unique identifier |
| `timestamp` | TIMESTAMPTZ | Timezone-aware datetime |
| `date` | DATE | Date only (no time) |
| `json` | JSONB | Unstructured JSON data |
| `file` | JSONB | File reference: `{id, filename, size, mime_type}` |

**Special field properties:**

| Property | Description |
|----------|-------------|
| `required` | Field must be present on create |
| `unique` | Database UNIQUE constraint |
| `enum` | Array of allowed string values |
| `default` | Default value if not provided |
| `precision` | Decimal places (for `decimal` type) |
| `auto: "create"` | Auto-set on insert (e.g., `created_at`) |
| `auto: "update"` | Auto-set on insert and update (e.g., `updated_at`) |
| `nullable` | Explicitly allow NULL values |

### Entity with Auto-Increment Primary Key

```bash
curl -X POST http://localhost:8080/api/demo/_admin/entities \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "sequence_log",
    "table": "sequence_logs",
    "primary_key": {
      "field": "id",
      "type": "bigint",
      "generated": true
    },
    "soft_delete": false,
    "fields": [
      { "name": "id", "type": "bigint", "required": true },
      { "name": "event", "type": "string", "required": true },
      { "name": "payload", "type": "json" },
      { "name": "created_at", "type": "timestamp", "auto": "create" }
    ]
  }'
```

### Update Entity (Add a Field)

```bash
curl -X PUT http://localhost:8080/api/demo/_admin/entities/customer \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "customer",
    "table": "customers",
    "primary_key": {
      "field": "id",
      "type": "uuid",
      "generated": true
    },
    "soft_delete": true,
    "fields": [
      { "name": "id", "type": "uuid", "required": true },
      { "name": "name", "type": "string", "required": true },
      { "name": "email", "type": "string", "required": true, "unique": true },
      { "name": "phone", "type": "string" },
      { "name": "status", "type": "string", "enum": ["active", "inactive", "suspended"] },
      { "name": "credit_limit", "type": "decimal", "precision": 2 },
      { "name": "notes", "type": "text" },
      { "name": "metadata", "type": "json" },
      { "name": "tier", "type": "string", "enum": ["bronze", "silver", "gold", "platinum"] },
      { "name": "created_at", "type": "timestamp", "auto": "create" },
      { "name": "updated_at", "type": "timestamp", "auto": "update" }
    ]
  }'
```

> **Note:** Auto-migration adds new columns. Removed fields are hidden from the API but data is preserved in the database.

---

## 3. Relation Definition

### One-to-Many: Customer has Invoices

```bash
# First, create the invoice entity
curl -X POST http://localhost:8080/api/demo/_admin/entities \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "invoice",
    "table": "invoices",
    "primary_key": { "field": "id", "type": "uuid", "generated": true },
    "soft_delete": true,
    "fields": [
      { "name": "id", "type": "uuid", "required": true },
      { "name": "number", "type": "string", "required": true, "unique": true },
      { "name": "customer_id", "type": "uuid", "required": true },
      { "name": "status", "type": "string", "enum": ["draft", "sent", "paid", "void"] },
      { "name": "total", "type": "decimal", "precision": 2, "default": 0 },
      { "name": "payment_date", "type": "date" },
      { "name": "payment_amount", "type": "decimal", "precision": 2 },
      { "name": "sent_at", "type": "timestamp" },
      { "name": "paid_at", "type": "timestamp" },
      { "name": "voided_at", "type": "timestamp" },
      { "name": "notes", "type": "text" },
      { "name": "created_at", "type": "timestamp", "auto": "create" },
      { "name": "updated_at", "type": "timestamp", "auto": "update" }
    ]
  }'

# Then, create the relation
curl -X POST http://localhost:8080/api/demo/_admin/relations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "invoices",
    "type": "one_to_many",
    "source": "customer",
    "target": "invoice",
    "source_key": "id",
    "target_key": "customer_id",
    "ownership": "source",
    "on_delete": "cascade",
    "fetch": "lazy",
    "write_mode": "diff"
  }'
```

### One-to-Many: Invoice has Line Items

```bash
# Create line item entity
curl -X POST http://localhost:8080/api/demo/_admin/entities \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "invoice_item",
    "table": "invoice_items",
    "primary_key": { "field": "id", "type": "uuid", "generated": true },
    "soft_delete": false,
    "fields": [
      { "name": "id", "type": "uuid", "required": true },
      { "name": "invoice_id", "type": "uuid", "required": true },
      { "name": "description", "type": "string", "required": true },
      { "name": "quantity", "type": "int", "required": true },
      { "name": "unit_price", "type": "decimal", "precision": 2, "required": true },
      { "name": "created_at", "type": "timestamp", "auto": "create" }
    ]
  }'

# Create the relation
curl -X POST http://localhost:8080/api/demo/_admin/relations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "items",
    "type": "one_to_many",
    "source": "invoice",
    "target": "invoice_item",
    "source_key": "id",
    "target_key": "invoice_id",
    "ownership": "source",
    "on_delete": "cascade",
    "fetch": "lazy",
    "write_mode": "diff"
  }'
```

### Many-to-Many: Products and Tags

```bash
# Create tag entity
curl -X POST http://localhost:8080/api/demo/_admin/entities \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "tag",
    "table": "tags",
    "primary_key": { "field": "id", "type": "uuid", "generated": true },
    "soft_delete": false,
    "fields": [
      { "name": "id", "type": "uuid", "required": true },
      { "name": "label", "type": "string", "required": true, "unique": true },
      { "name": "color", "type": "string" }
    ]
  }'

# Create many-to-many relation
curl -X POST http://localhost:8080/api/demo/_admin/relations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "tags",
    "type": "many_to_many",
    "source": "product",
    "target": "tag",
    "source_key": "id",
    "target_key": "id",
    "join_table": "product_tags",
    "source_join_key": "product_id",
    "target_join_key": "tag_id",
    "ownership": "none",
    "on_delete": "detach",
    "fetch": "lazy",
    "write_mode": "replace"
  }'
```

### One-to-One: User has Profile

```bash
curl -X POST http://localhost:8080/api/demo/_admin/relations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "profile",
    "type": "one_to_one",
    "source": "user",
    "target": "user_profile",
    "source_key": "id",
    "target_key": "user_id",
    "ownership": "source",
    "on_delete": "cascade",
    "fetch": "eager",
    "write_mode": "diff"
  }'
```

**Relation properties reference:**

| Property | Values | Description |
|----------|--------|-------------|
| `type` | `one_to_one`, `one_to_many`, `many_to_many` | Relation cardinality |
| `ownership` | `source`, `target`, `none` | Who owns the related records |
| `on_delete` | `cascade`, `set_null`, `restrict`, `detach` | Behavior when parent is deleted |
| `fetch` | `lazy` (default), `eager` | Auto-load related data on read |
| `write_mode` | `diff` (default), `replace`, `append` | Default mode for nested writes |

---

## 4. Dynamic CRUD Operations

### Create a Record

```bash
curl -X POST http://localhost:8080/api/demo/customer \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Acme Corp",
    "email": "billing@acme.com",
    "phone": "+1-555-0100",
    "status": "active",
    "credit_limit": 50000.00,
    "metadata": { "industry": "technology", "size": "enterprise" }
  }'
```

**Response:**
```json
{
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "name": "Acme Corp",
    "email": "billing@acme.com",
    "phone": "+1-555-0100",
    "status": "active",
    "credit_limit": 50000.00,
    "metadata": { "industry": "technology", "size": "enterprise" },
    "created_at": "2025-01-15T10:30:00Z",
    "updated_at": "2025-01-15T10:30:00Z"
  }
}
```

### Get by ID

```bash
curl http://localhost:8080/api/demo/customer/a1b2c3d4-e5f6-7890-abcd-ef1234567890 \
  -H "Authorization: Bearer $TOKEN"
```

### List with Filters, Sorting, and Pagination

```bash
# Filter by status, sort by name ascending, page 1, 10 per page
curl "http://localhost:8080/api/demo/customer?filter[status]=active&sort=name&page=1&per_page=10" \
  -H "Authorization: Bearer $TOKEN"

# Multiple filter operators
curl "http://localhost:8080/api/demo/invoice?filter[total.gte]=1000&filter[status.in]=draft,sent&sort=-created_at&page=1&per_page=25" \
  -H "Authorization: Bearer $TOKEN"

# With includes (load related data)
curl "http://localhost:8080/api/demo/invoice?include=items&filter[status]=draft" \
  -H "Authorization: Bearer $TOKEN"

# Multiple includes
curl "http://localhost:8080/api/demo/customer/a1b2c3d4?include=invoices" \
  -H "Authorization: Bearer $TOKEN"
```

**Filter operators:**

| Operator | Example | Description |
|----------|---------|-------------|
| `eq` (default) | `filter[status]=active` | Equals |
| `neq` | `filter[status.neq]=void` | Not equals |
| `gt` | `filter[total.gt]=100` | Greater than |
| `gte` | `filter[total.gte]=100` | Greater than or equal |
| `lt` | `filter[total.lt]=1000` | Less than |
| `lte` | `filter[total.lte]=1000` | Less than or equal |
| `in` | `filter[status.in]=draft,sent` | In list |
| `not_in` | `filter[status.not_in]=void,deleted` | Not in list |
| `like` | `filter[name.like]=%acme%` | SQL LIKE pattern |

### Update a Record

```bash
curl -X PUT http://localhost:8080/api/demo/customer/a1b2c3d4-e5f6-7890-abcd-ef1234567890 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "credit_limit": 75000.00,
    "status": "active"
  }'
```

### Soft Delete

```bash
curl -X DELETE http://localhost:8080/api/demo/customer/a1b2c3d4-e5f6-7890-abcd-ef1234567890 \
  -H "Authorization: Bearer $TOKEN"
```

> For entities with `soft_delete: true`, this sets `deleted_at` to now. The record is excluded from queries but preserved in the database.

---

## 5. Nested Writes

Nested writes let you create/update parent and child records in a single atomic transaction.

### Create Invoice with Line Items (Single Request)

```bash
curl -X POST http://localhost:8080/api/demo/invoice \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "INV-001",
    "customer_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "draft",
    "total": 1500.00,
    "items": {
      "_write_mode": "diff",
      "data": [
        { "description": "Widget A", "quantity": 10, "unit_price": 100.00 },
        { "description": "Widget B", "quantity": 5, "unit_price": 100.00 }
      ]
    }
  }'
```

**What happens:**
1. Invoice is created, gets auto-generated UUID
2. Each item in `data` is created with `invoice_id` auto-set to the new invoice's ID
3. All within a single transaction (all-or-nothing)

### Update with Diff Mode (Default)

Diff mode: items with an ID are updated, items without an ID are created, items with `_delete: true` are removed. **Items not in the payload are untouched.**

```bash
curl -X PUT http://localhost:8080/api/demo/invoice/inv-uuid-123 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "total": 2500.00,
    "items": {
      "_write_mode": "diff",
      "data": [
        { "id": "existing-item-1", "quantity": 20 },
        { "description": "Widget C", "quantity": 3, "unit_price": 200.00 },
        { "id": "existing-item-2", "_delete": true }
      ]
    }
  }'
```

**Result:**
- `existing-item-1`: updated (quantity changed to 20)
- New item: created (Widget C)
- `existing-item-2`: deleted
- Any other existing items: **untouched**

### Replace Mode

Replace mode: the entire child collection is replaced. Items not in the payload are deleted.

```bash
curl -X PUT http://localhost:8080/api/demo/product/prod-uuid-456 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Laptop Pro",
    "tags": {
      "_write_mode": "replace",
      "data": [
        { "id": "tag-electronics-uuid" },
        { "id": "tag-premium-uuid" }
      ]
    }
  }'
```

**Result:** Product now has exactly these two tags. Any previously associated tags are removed from the join table.

### Append Mode

Append mode: only adds new records. Never updates or deletes existing records.

```bash
curl -X PUT http://localhost:8080/api/demo/invoice/inv-uuid-123 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "items": {
      "_write_mode": "append",
      "data": [
        { "description": "Additional Service", "quantity": 1, "unit_price": 500.00 }
      ]
    }
  }'
```

**Result:** New item is added. All existing items are untouched. Items with an ID in the payload are ignored (no updates).

### Write Mode Comparison

| Mode | New items (no ID) | Existing items (with ID) | Missing items (in DB, not in payload) |
|------|-------------------|--------------------------|---------------------------------------|
| `diff` (default) | INSERT | UPDATE | No action |
| `replace` | INSERT | UPDATE | DELETE |
| `append` | INSERT | Skip (ignored) | No action |

---

## 6. Validation Rules

Rules execute during entity write operations. Three types: **field**, **expression**, and **computed**.

### Field Rule: Basic Validation

```bash
curl -X POST http://localhost:8080/api/demo/_admin/rules \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "invoice",
    "hook": "before_write",
    "type": "field",
    "definition": {
      "field": "total",
      "operator": "gte",
      "value": 0,
      "message": "Invoice total must be non-negative"
    },
    "priority": 1,
    "active": true
  }'
```

**Supported operators for field rules:**

| Operator | Example Value | Description |
|----------|---------------|-------------|
| `eq` | `"paid"` | Equals exact value |
| `neq` | `"void"` | Not equal to value |
| `gt` | `0` | Greater than |
| `gte` | `0` | Greater than or equal |
| `lt` | `100000` | Less than |
| `lte` | `100000` | Less than or equal |
| `in` | `["draft", "sent"]` | Value must be in list |
| `not_in` | `["void", "cancelled"]` | Value must not be in list |
| `like` | `"INV-%"` | SQL LIKE pattern match |

### Expression Rule: Conditional Validation

Expression rules use the [expr-lang](https://github.com/expr-lang/expr) engine. The expression returns `true` when the rule is **violated** (true = fail, false = pass).

**Expression environment variables:**

| Variable | Type | Description |
|----------|------|-------------|
| `record` | `map[string]any` | Incoming payload (new data) |
| `old` | `map[string]any` | Current DB state (nil for creates) |
| `action` | `string` | `"create"` or `"update"` |
| `user` | `map{id, roles}` | Current authenticated user |
| `now` | `timestamp` | Current time |
| `related` | `map[string]any` | Pre-loaded related data (via `related_load`) |

#### Conditional Required Field

```bash
curl -X POST http://localhost:8080/api/demo/_admin/rules \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "invoice",
    "hook": "before_write",
    "type": "expression",
    "definition": {
      "expression": "record.status == '\''paid'\'' && record.payment_date == nil",
      "message": "Payment date is required when status is paid"
    },
    "priority": 10,
    "active": true
  }'
```

#### Cross-Field Comparison

```bash
curl -X POST http://localhost:8080/api/demo/_admin/rules \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "project",
    "hook": "before_write",
    "type": "expression",
    "definition": {
      "expression": "record.end_date != nil && record.end_date <= record.start_date",
      "message": "End date must be after start date"
    },
    "priority": 10,
    "active": true
  }'
```

#### Prevent Modification of Locked Records

```bash
curl -X POST http://localhost:8080/api/demo/_admin/rules \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "invoice",
    "hook": "before_write",
    "type": "expression",
    "definition": {
      "expression": "action == '\''update'\'' && old != nil && old.status == '\''void'\''",
      "message": "Voided invoices cannot be modified"
    },
    "priority": 5,
    "active": true
  }'
```

#### Cross-Entity Validation (with Related Data Loading)

```bash
curl -X POST http://localhost:8080/api/demo/_admin/rules \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "customer",
    "hook": "before_delete",
    "type": "expression",
    "definition": {
      "expression": "len(related.invoices) > 0",
      "message": "Cannot delete customer with existing invoices",
      "related_load": [
        { "relation": "invoices", "filter": { "status.in": ["draft", "sent", "paid"] } }
      ]
    },
    "priority": 1,
    "active": true
  }'
```

The `related_load` field tells the engine to pre-fetch related records before evaluating the expression. This avoids hidden database calls inside the expression.

#### Role-Based Field Restriction

```bash
curl -X POST http://localhost:8080/api/demo/_admin/rules \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "invoice",
    "hook": "before_write",
    "type": "expression",
    "definition": {
      "expression": "action == '\''update'\'' && old != nil && old.status != record.status && !(\"admin\" in user.roles)",
      "message": "Only admins can change invoice status directly"
    },
    "priority": 3,
    "active": true
  }'
```

### Computed Field: Auto-Calculate Values

Computed rules run **after** validation but **before** SQL execution. They set field values automatically.

```bash
curl -X POST http://localhost:8080/api/demo/_admin/rules \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "invoice_item",
    "hook": "before_write",
    "type": "computed",
    "definition": {
      "field": "line_total",
      "expression": "record.quantity * record.unit_price"
    },
    "priority": 100,
    "active": true
  }'
```

### Rule Execution Order

Within a single hook (e.g., `before_write`), rules execute in this order:

```
1. Field rules (Layer 1)         — fast, no DB lookups
2. Expression rules (Layer 2)    — may need related_load
3. Computed fields               — set derived values
4. State machine guards (Layer 3) — if entity has a state machine
```

Within each layer, rules execute by `priority` (lower number = runs first).

**`stop_on_fail` behavior:**
- `true`: halts the entire rule chain on failure; remaining rules are skipped
- `false` (default): all rules run and all errors are collected

### Validation Error Response

When rules fail, the API returns:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Validation failed",
    "details": [
      {
        "field": "total",
        "rule": "gte",
        "message": "Invoice total must be non-negative"
      },
      {
        "field": "payment_date",
        "rule": "expression",
        "message": "Payment date is required when status is paid"
      }
    ]
  }
}
```

---

## 7. State Machines

State machines control allowed transitions on a field (typically `status`) with role-based access, guard expressions, and transition actions.

### Define a State Machine: Invoice Lifecycle

```bash
curl -X POST http://localhost:8080/api/demo/_admin/state-machines \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "invoice",
    "field": "status",
    "definition": {
      "initial": "draft",
      "transitions": [
        {
          "from": "draft",
          "to": "sent",
          "roles": ["admin", "accountant"],
          "guard": null,
          "actions": [
            { "type": "set_field", "field": "sent_at", "value": "now" }
          ]
        },
        {
          "from": "sent",
          "to": "paid",
          "roles": ["admin", "accountant"],
          "guard": "record.payment_date != nil && record.payment_amount >= record.total",
          "actions": [
            { "type": "set_field", "field": "paid_at", "value": "now" },
            { "type": "webhook", "url": "https://accounting.example.com/hooks/invoice-paid", "method": "POST" }
          ]
        },
        {
          "from": ["draft", "sent"],
          "to": "void",
          "roles": ["admin"],
          "guard": null,
          "actions": [
            { "type": "set_field", "field": "voided_at", "value": "now" }
          ]
        }
      ]
    },
    "active": true
  }'
```

### State Diagram

```
                 ┌──────────────────────────┐
                 │                          │
  ┌───────┐     │   ┌──────┐    ┌──────┐  │
  │ draft │─────┼──►│ sent │───►│ paid │  │
  └───┬───┘     │   └───┬──┘    └──────┘  │
      │         │       │                  │
      │         │       │                  │
      └─────────┴───────┘                  │
              │                            │
              ▼                            │
          ┌──────┐                         │
          │ void │◄────────────────────────┘
          └──────┘      (admin only)
```

### Transition Properties

| Property | Type | Description |
|----------|------|-------------|
| `from` | `string` or `string[]` | Source state(s) — supports multiple sources |
| `to` | `string` | Target state |
| `roles` | `string[]` | User roles allowed this transition (empty = any authenticated user) |
| `guard` | `string` or `null` | Expression that must return `true` to allow transition |
| `actions` | `object[]` | Operations to execute on successful transition |

### Transition Actions

| Action Type | Properties | Timing |
|-------------|------------|--------|
| `set_field` | `field`, `value` (use `"now"` for current timestamp) | Before SQL write (in transaction) |
| `webhook` | `url`, `method` | After commit (async, non-blocking) |
| `create_record` | `entity`, record fields | In transaction |
| `send_event` | `event` name | After commit |

### How Transitions Execute

When a user updates `status` from `sent` to `paid`:

```
1. Engine detects state field changed (old.status="sent" → record.status="paid")
2. Finds matching transition: from="sent", to="paid"
3. Checks roles: user must have "admin" or "accountant"
   → Missing? Returns 403 Forbidden
4. Evaluates guard: record.payment_date != nil && record.payment_amount >= record.total
   → Fails? Returns 422 "Guard condition not met"
5. Executes actions:
   a. set_field: paid_at = now (mutates record before SQL write)
   b. webhook: queued for async delivery after commit
6. Normal write proceeds (INSERT/UPDATE with paid_at set)
7. After commit: webhook fires to accounting system
```

### Invalid Transition Error

```bash
# Try to go from "draft" directly to "paid" (not allowed)
curl -X PUT http://localhost:8080/api/demo/invoice/inv-uuid \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "status": "paid" }'
```

**Response:**
```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Invalid transition from draft to paid"
  }
}
```

### Guard Failure Error

```bash
# Try to mark as paid without payment_date
curl -X PUT http://localhost:8080/api/demo/invoice/inv-uuid \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "status": "paid" }'
```

**Response:**
```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Guard condition failed for transition from sent to paid"
  }
}
```

### Example: Order Processing State Machine

```bash
curl -X POST http://localhost:8080/api/demo/_admin/state-machines \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "order",
    "field": "status",
    "definition": {
      "initial": "pending",
      "transitions": [
        {
          "from": "pending",
          "to": "confirmed",
          "roles": ["admin", "sales"],
          "guard": "record.total > 0",
          "actions": [
            { "type": "set_field", "field": "confirmed_at", "value": "now" }
          ]
        },
        {
          "from": "confirmed",
          "to": "processing",
          "roles": ["admin", "warehouse"],
          "actions": [
            { "type": "webhook", "url": "https://warehouse.example.com/pick-order", "method": "POST" }
          ]
        },
        {
          "from": "processing",
          "to": "shipped",
          "roles": ["admin", "warehouse"],
          "actions": [
            { "type": "set_field", "field": "shipped_at", "value": "now" },
            { "type": "webhook", "url": "https://notifications.example.com/order-shipped", "method": "POST" }
          ]
        },
        {
          "from": "shipped",
          "to": "delivered",
          "roles": ["admin", "logistics"],
          "actions": [
            { "type": "set_field", "field": "delivered_at", "value": "now" }
          ]
        },
        {
          "from": ["pending", "confirmed"],
          "to": "cancelled",
          "roles": ["admin", "sales"],
          "actions": [
            { "type": "set_field", "field": "cancelled_at", "value": "now" },
            { "type": "webhook", "url": "https://notifications.example.com/order-cancelled", "method": "POST" }
          ]
        }
      ]
    },
    "active": true
  }'
```

---

## 8. Workflows

Workflows are multi-step, long-running processes triggered by state changes. They support approval gates, conditional branching, and timed escalation.

### Define a Workflow: Purchase Order Approval

```bash
curl -X POST http://localhost:8080/api/demo/_admin/workflows \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "purchase_order_approval",
    "trigger": {
      "type": "state_change",
      "entity": "purchase_order",
      "field": "status",
      "to": "pending_approval"
    },
    "context": {
      "record_id": "trigger.record_id",
      "entity": "purchase_order",
      "amount": "trigger.record.amount",
      "requester_id": "trigger.record.created_by"
    },
    "steps": [
      {
        "id": "manager_approval",
        "type": "approval",
        "assignee": { "type": "role", "role": "manager" },
        "timeout": "72h",
        "on_approve": { "goto": "check_amount" },
        "on_reject": { "goto": "rejected" },
        "on_timeout": { "goto": "escalate" }
      },
      {
        "id": "check_amount",
        "type": "condition",
        "expression": "context.amount > 10000",
        "on_true": { "goto": "finance_approval" },
        "on_false": { "goto": "approved" }
      },
      {
        "id": "finance_approval",
        "type": "approval",
        "assignee": { "type": "role", "role": "finance_manager" },
        "timeout": "48h",
        "on_approve": { "goto": "approved" },
        "on_reject": { "goto": "rejected" },
        "on_timeout": { "goto": "escalate" }
      },
      {
        "id": "escalate",
        "type": "action",
        "actions": [
          { "type": "webhook", "url": "https://notifications.example.com/escalation", "method": "POST" },
          {
            "type": "set_field",
            "entity": "purchase_order",
            "record_id": "context.record_id",
            "field": "escalated",
            "value": true
          }
        ],
        "then": { "goto": "finance_approval" }
      },
      {
        "id": "approved",
        "type": "action",
        "actions": [
          {
            "type": "set_field",
            "entity": "purchase_order",
            "record_id": "context.record_id",
            "field": "status",
            "value": "approved"
          },
          { "type": "webhook", "url": "https://procurement.example.com/po-approved", "method": "POST" }
        ],
        "then": "end"
      },
      {
        "id": "rejected",
        "type": "action",
        "actions": [
          {
            "type": "set_field",
            "entity": "purchase_order",
            "record_id": "context.record_id",
            "field": "status",
            "value": "rejected"
          },
          { "type": "webhook", "url": "https://notifications.example.com/po-rejected", "method": "POST" }
        ],
        "then": "end"
      }
    ],
    "active": true
  }'
```

### Workflow Flow Diagram

```
   Trigger: purchase_order.status → "pending_approval"
                    │
                    ▼
          ┌─────────────────┐
          │ manager_approval │  (approval, 72h timeout)
          └────┬────┬────┬──┘
               │    │    │
          approve reject timeout
               │    │    │
               ▼    │    ▼
        ┌──────────┐│ ┌──────────┐
        │ check    ││ │ escalate │──── webhook + set escalated=true
        │ amount   ││ └────┬─────┘
        └──┬───┬───┘│      │
           │   │    │      └──► back to finance_approval
      >10k │   │≤10k│
           ▼   │    ▼
  ┌────────────┐│ ┌──────────┐
  │ finance    ││ │ rejected │──── set status=rejected + webhook
  │ approval   ││ └──────────┘
  └──┬────┬──┬─┘│             then: end
     │    │  │  │
  approve │ timeout
     │  reject│
     ▼    │   ▼
  ┌──────┐│ ┌──────────┐
  │apprvd││ │ escalate │
  └──────┘│ └──────────┘
     │    │
     │    ▼
     │ ┌──────────┐
     │ │ rejected │
     │ └──────────┘
     ▼
  set status=approved + webhook
  then: end
```

### Step Types Reference

#### Action Step — Execute operations immediately

```json
{
  "id": "notify_team",
  "type": "action",
  "actions": [
    { "type": "set_field", "entity": "order", "record_id": "context.record_id", "field": "notified", "value": true },
    { "type": "webhook", "url": "https://slack.example.com/notify", "method": "POST" }
  ],
  "then": { "goto": "next_step" }
}
```

#### Condition Step — Branch based on expression

```json
{
  "id": "check_priority",
  "type": "condition",
  "expression": "context.amount > 50000",
  "on_true": { "goto": "vp_approval" },
  "on_false": { "goto": "auto_approve" }
}
```

#### Approval Step — Pause and wait for human decision

```json
{
  "id": "director_approval",
  "type": "approval",
  "assignee": { "type": "role", "role": "director" },
  "timeout": "48h",
  "on_approve": { "goto": "approved" },
  "on_reject": { "goto": "rejected" },
  "on_timeout": { "goto": "escalate_to_vp" }
}
```

**Assignee types:**

| Type | Property | Description |
|------|----------|-------------|
| `role` | `role` | Any user with this role can approve |
| `relation` | `path` | Follow a relation to find the assignee |
| `fixed` | `user` | Specific user ID |

### Workflow Context

Context is resolved from the trigger event and available to all steps:

```json
{
  "context": {
    "record_id": "trigger.record_id",
    "entity": "purchase_order",
    "amount": "trigger.record.amount",
    "department": "trigger.record.department",
    "requester_id": "trigger.record.created_by"
  }
}
```

- `trigger.record_id` — the ID of the record that triggered the workflow
- `trigger.record.<field>` — any field from the triggering record
- Context values are available in condition expressions as `context.<key>`

### Workflow Runtime Endpoints

#### List Pending Approvals

```bash
curl http://localhost:8080/api/demo/_workflows/pending \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**
```json
{
  "data": [
    {
      "id": "wf-instance-uuid-1",
      "workflow_id": "wf-def-uuid",
      "workflow_name": "purchase_order_approval",
      "status": "running",
      "current_step": "manager_approval",
      "current_step_deadline": "2025-01-18T10:30:00Z",
      "context": {
        "record_id": "po-uuid-123",
        "amount": 25000,
        "requester_id": "user-uuid-456"
      },
      "history": [],
      "created_at": "2025-01-15T10:30:00Z",
      "updated_at": "2025-01-15T10:30:00Z"
    }
  ]
}
```

#### Approve a Step

```bash
curl -X POST http://localhost:8080/api/demo/_workflows/wf-instance-uuid-1/approve \
  -H "Authorization: Bearer $TOKEN"
```

#### Reject a Step

```bash
curl -X POST http://localhost:8080/api/demo/_workflows/wf-instance-uuid-1/reject \
  -H "Authorization: Bearer $TOKEN"
```

#### Get Instance Details

```bash
curl http://localhost:8080/api/demo/_workflows/wf-instance-uuid-1 \
  -H "Authorization: Bearer $TOKEN"
```

**Response (after manager approved, finance pending):**
```json
{
  "data": {
    "id": "wf-instance-uuid-1",
    "workflow_name": "purchase_order_approval",
    "status": "running",
    "current_step": "finance_approval",
    "current_step_deadline": "2025-01-20T10:30:00Z",
    "context": {
      "record_id": "po-uuid-123",
      "amount": 25000,
      "requester_id": "user-uuid-456"
    },
    "history": [
      {
        "step": "manager_approval",
        "status": "approved",
        "by": "manager-user-uuid",
        "at": "2025-01-16T14:00:00Z"
      },
      {
        "step": "check_amount",
        "status": "on_true",
        "at": "2025-01-16T14:00:00Z"
      }
    ]
  }
}
```

### Timeouts

- A background scheduler runs every 60 seconds
- Queries for instances where `status='running' AND current_step_deadline < NOW()`
- Executes the `on_timeout` path for timed-out approval steps
- The workflow continues from the timeout destination step

### Example: Employee Onboarding Workflow

```bash
curl -X POST http://localhost:8080/api/demo/_admin/workflows \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "employee_onboarding",
    "trigger": {
      "type": "state_change",
      "entity": "employee",
      "field": "status",
      "to": "onboarding"
    },
    "context": {
      "record_id": "trigger.record_id",
      "entity": "employee",
      "department": "trigger.record.department",
      "employee_name": "trigger.record.name"
    },
    "steps": [
      {
        "id": "create_accounts",
        "type": "action",
        "actions": [
          { "type": "webhook", "url": "https://it.example.com/create-accounts", "method": "POST" },
          { "type": "set_field", "entity": "employee", "record_id": "context.record_id", "field": "accounts_created", "value": true }
        ],
        "then": { "goto": "hr_checklist" }
      },
      {
        "id": "hr_checklist",
        "type": "approval",
        "assignee": { "type": "role", "role": "hr" },
        "timeout": "168h",
        "on_approve": { "goto": "check_department" },
        "on_reject": { "goto": "onboarding_failed" },
        "on_timeout": { "goto": "remind_hr" }
      },
      {
        "id": "remind_hr",
        "type": "action",
        "actions": [
          { "type": "webhook", "url": "https://notifications.example.com/remind", "method": "POST" }
        ],
        "then": { "goto": "hr_checklist" }
      },
      {
        "id": "check_department",
        "type": "condition",
        "expression": "context.department == '\''engineering'\''",
        "on_true": { "goto": "setup_dev_env" },
        "on_false": { "goto": "complete" }
      },
      {
        "id": "setup_dev_env",
        "type": "action",
        "actions": [
          { "type": "webhook", "url": "https://devops.example.com/setup-env", "method": "POST" }
        ],
        "then": { "goto": "complete" }
      },
      {
        "id": "complete",
        "type": "action",
        "actions": [
          { "type": "set_field", "entity": "employee", "record_id": "context.record_id", "field": "status", "value": "active" }
        ],
        "then": "end"
      },
      {
        "id": "onboarding_failed",
        "type": "action",
        "actions": [
          { "type": "set_field", "entity": "employee", "record_id": "context.record_id", "field": "status", "value": "onboarding_failed" },
          { "type": "webhook", "url": "https://hr.example.com/onboarding-failed", "method": "POST" }
        ],
        "then": "end"
      }
    ],
    "active": true
  }'
```

---

## 9. Webhooks

Webhooks fire HTTP requests to external endpoints when entity events occur.

### Async Webhook: Notify on Payment

```bash
curl -X POST http://localhost:8080/api/demo/_admin/webhooks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "invoice",
    "hook": "after_write",
    "url": "https://accounting.example.com/hooks/invoice-updated",
    "method": "POST",
    "headers": {
      "X-API-Key": "{{env.WEBHOOK_SECRET}}",
      "X-Source": "rocket-backend"
    },
    "condition": "record.status == '\''paid'\'' && (old == nil || old.status != '\''paid'\'')",
    "async": true,
    "retry": {
      "max_attempts": 5,
      "backoff": "exponential"
    },
    "active": true
  }'
```

### Webhook Payload (Sent by Engine)

When the webhook fires, the engine sends this payload:

```json
{
  "event": "after_write",
  "entity": "invoice",
  "action": "update",
  "record": {
    "id": "inv-uuid-123",
    "number": "INV-001",
    "status": "paid",
    "total": 1500.00,
    "payment_date": "2025-01-15",
    "payment_amount": 1500.00,
    "paid_at": "2025-01-15T10:30:00Z"
  },
  "old": {
    "id": "inv-uuid-123",
    "number": "INV-001",
    "status": "sent",
    "total": 1500.00,
    "payment_date": null,
    "payment_amount": null,
    "paid_at": null
  },
  "changes": {
    "status": { "old": "sent", "new": "paid" },
    "payment_date": { "old": null, "new": "2025-01-15" },
    "payment_amount": { "old": null, "new": 1500.00 },
    "paid_at": { "old": null, "new": "2025-01-15T10:30:00Z" }
  },
  "user": {
    "id": "user-uuid-456",
    "roles": ["accountant"]
  },
  "timestamp": "2025-01-15T10:30:00Z",
  "idempotency_key": "wh_a1b2c3d4e5f6"
}
```

### Sync Webhook: External Validation (Veto Power)

Sync webhooks fire **inside** the transaction. A non-2xx response causes a rollback.

```bash
curl -X POST http://localhost:8080/api/demo/_admin/webhooks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "order",
    "hook": "before_write",
    "url": "https://fraud-detection.example.com/check",
    "method": "POST",
    "headers": {
      "Authorization": "Bearer {{env.FRAUD_API_KEY}}"
    },
    "condition": "action == '\''create'\'' && record.total > 5000",
    "async": false,
    "retry": {
      "max_attempts": 1,
      "backoff": "exponential"
    },
    "active": true
  }'
```

> **Warning:** Sync webhooks add latency and create a failure dependency. Use sparingly.

### Webhook on Delete

```bash
curl -X POST http://localhost:8080/api/demo/_admin/webhooks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "customer",
    "hook": "after_delete",
    "url": "https://crm.example.com/hooks/customer-deleted",
    "method": "POST",
    "headers": {
      "X-API-Key": "{{env.CRM_API_KEY}}"
    },
    "async": true,
    "retry": {
      "max_attempts": 3,
      "backoff": "exponential"
    },
    "active": true
  }'
```

### Hook Types Reference

| Hook | Timing | Can Veto? | Use Case |
|------|--------|-----------|----------|
| `before_write` | Inside tx, before commit | Yes (sync only) | External validation, fraud checks |
| `after_write` | After commit | No | Notifications, sync to external systems |
| `before_delete` | Inside tx, before commit | Yes (sync only) | Prevent deletion based on external rules |
| `after_delete` | After commit | No | Cleanup in external systems |

### Async vs Sync Comparison

| | Async (default) | Sync |
|-|-----------------|------|
| **Timing** | After commit, in background | Inside transaction, before commit |
| **Failure impact** | Logged, retried later | Transaction rolls back |
| **Latency** | No impact on API response | Adds webhook latency to API response |
| **Retry** | Automatic via background scheduler | No retry (failure = rollback) |
| **Use case** | Notifications, sync, logging | Validation, approval gates |

### Retry Strategy

- **Exponential backoff:** `30s x 2^attempt` (30s, 60s, 120s, 240s, ...)
- **Linear backoff:** `30s` per attempt
- Background scheduler runs every 30 seconds
- Delivery tracked in `_webhook_logs` table

### Header Templates

Headers support environment variable interpolation:

```json
{
  "headers": {
    "Authorization": "Bearer {{env.EXTERNAL_API_TOKEN}}",
    "X-API-Key": "{{env.WEBHOOK_SECRET}}",
    "X-Custom": "static-value"
  }
}
```

`{{env.VAR_NAME}}` is resolved at webhook dispatch time from the server's environment variables.

### Condition Expressions

Webhook conditions use the same expression engine as rules. Available variables:

| Variable | Description |
|----------|-------------|
| `record` | New record data |
| `old` | Previous record data (nil for creates) |
| `changes` | `{field: {old, new}}` for changed fields |
| `action` | `"create"`, `"update"`, or `"delete"` |
| `entity` | Entity name |
| `event` | Hook name |
| `user` | `{id, roles}` |

**Examples:**
- `record.status == 'paid'` — fire only for paid records
- `action == 'create'` — fire only on create
- `record.total > 1000 && action == 'create'` — high-value new orders only
- `old != nil && old.status != record.status` — fire only when status changes

### View Webhook Logs

```bash
# List all logs
curl "http://localhost:8080/api/demo/_admin/webhook-logs" \
  -H "Authorization: Bearer $TOKEN"

# Filter by webhook ID
curl "http://localhost:8080/api/demo/_admin/webhook-logs?webhook_id=wh-uuid-123" \
  -H "Authorization: Bearer $TOKEN"

# Filter by status
curl "http://localhost:8080/api/demo/_admin/webhook-logs?status=failed" \
  -H "Authorization: Bearer $TOKEN"

# Manual retry
curl -X POST http://localhost:8080/api/demo/_admin/webhook-logs/log-uuid-456/retry \
  -H "Authorization: Bearer $TOKEN"
```

---

## 10. Permissions

Permissions use a **whitelist model**: no permission row = denied. The `admin` role bypasses all checks.

### Grant Read Access to All Users

```bash
curl -X POST http://localhost:8080/api/demo/_admin/permissions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "product",
    "action": "read",
    "roles": ["admin", "user", "guest"],
    "conditions": []
  }'
```

### Grant Create Access to Specific Roles

```bash
curl -X POST http://localhost:8080/api/demo/_admin/permissions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "invoice",
    "action": "create",
    "roles": ["admin", "accountant"],
    "conditions": []
  }'
```

### Row-Level Security: Read Filter

For `read` actions, conditions are **injected as WHERE clauses** instead of denying the request. Users only see records that match the conditions.

```bash
# Accountants can only read invoices in "draft" or "sent" status
curl -X POST http://localhost:8080/api/demo/_admin/permissions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "invoice",
    "action": "read",
    "roles": ["accountant"],
    "conditions": [
      { "field": "status", "operator": "in", "value": ["draft", "sent", "paid"] }
    ]
  }'
```

**What happens when an accountant queries invoices:**
```
GET /api/demo/invoice

Engine adds: WHERE ... AND status IN ('draft', 'sent', 'paid')

Result: Voided invoices are invisible to accountants
```

### Write Permission with Conditions

For `update` and `delete` actions, conditions are checked against the **current record** in the database.

```bash
# Users can only update invoices that are still in draft
curl -X POST http://localhost:8080/api/demo/_admin/permissions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "invoice",
    "action": "update",
    "roles": ["accountant"],
    "conditions": [
      { "field": "status", "operator": "in", "value": ["draft", "sent"] }
    ]
  }'
```

**What happens:**
1. Accountant tries `PUT /api/demo/invoice/uuid-123`
2. Engine fetches current record: `SELECT status FROM invoices WHERE id=$1`
3. Checks condition: `status IN ('draft', 'sent')`
4. If status is `"paid"` → 403 Forbidden
5. If status is `"draft"` → allowed, proceed with update

### Delete Permission

```bash
# Only admins can delete invoices, and only if they're in draft
curl -X POST http://localhost:8080/api/demo/_admin/permissions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "invoice",
    "action": "delete",
    "roles": ["admin"],
    "conditions": [
      { "field": "status", "operator": "eq", "value": "draft" }
    ]
  }'
```

### Condition Operators

| Operator | Example | Description |
|----------|---------|-------------|
| `eq` | `{"field": "status", "operator": "eq", "value": "draft"}` | Equals |
| `neq` | `{"field": "status", "operator": "neq", "value": "void"}` | Not equals |
| `gt` | `{"field": "total", "operator": "gt", "value": 0}` | Greater than |
| `gte` | `{"field": "total", "operator": "gte", "value": 100}` | Greater or equal |
| `lt` | `{"field": "total", "operator": "lt", "value": 100000}` | Less than |
| `lte` | `{"field": "total", "operator": "lte", "value": 100000}` | Less or equal |
| `in` | `{"field": "status", "operator": "in", "value": ["draft", "sent"]}` | In list |
| `not_in` | `{"field": "status", "operator": "not_in", "value": ["void"]}` | Not in list |
| `like` | `{"field": "name", "operator": "like", "value": "%Corp%"}` | SQL LIKE |

### Permission Evaluation Flow

```
1. User requests: PUT /api/demo/invoice/uuid-123
   User context: { roles: ["accountant"] }

2. Engine looks up: _permissions WHERE entity="invoice" AND action="update"

3. For each matching policy:
   a. Check if user has any of policy's roles
      → ["accountant"] intersects ["admin", "accountant"]? → yes

   b. If conditions exist, check against current record:
      → Fetch current record from DB
      → Evaluate: status IN ["draft", "sent"]?
      → Current status = "draft" → passes

4. If ANY policy passes → authorized
   If NO policy passes → 403 Forbidden
```

### Create Users with Roles

```bash
# Create an accountant user
curl -X POST http://localhost:8080/api/demo/_admin/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "jane@example.com",
    "password": "secure_password_123",
    "roles": ["accountant"],
    "active": true
  }'

# Create a user with multiple roles
curl -X POST http://localhost:8080/api/demo/_admin/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "bob@example.com",
    "password": "another_secure_password",
    "roles": ["sales", "warehouse"],
    "active": true
  }'
```

### Full Permission Setup Example: Product Catalog

```bash
# Everyone can read products
curl -X POST http://localhost:8080/api/demo/_admin/permissions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity": "product", "action": "read", "roles": ["admin", "editor", "viewer"]}'

# Only editors and admins can create products
curl -X POST http://localhost:8080/api/demo/_admin/permissions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity": "product", "action": "create", "roles": ["admin", "editor"]}'

# Editors can only update active products
curl -X POST http://localhost:8080/api/demo/_admin/permissions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "product",
    "action": "update",
    "roles": ["editor"],
    "conditions": [
      { "field": "is_active", "operator": "eq", "value": true }
    ]
  }'

# Only admins can delete products
curl -X POST http://localhost:8080/api/demo/_admin/permissions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entity": "product", "action": "delete", "roles": ["admin"]}'
```

---

## 11. File Uploads

The `file` field type stores file references as JSONB. Files are uploaded separately and referenced by UUID.

### Upload a File

```bash
curl -X POST http://localhost:8080/api/demo/_files/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/invoice.pdf"
```

**Response:**
```json
{
  "data": {
    "id": "file-uuid-abc123",
    "filename": "invoice.pdf",
    "mime_type": "application/pdf",
    "size": 245312,
    "url": "/api/demo/_files/file-uuid-abc123"
  }
}
```

### Use File UUID in Entity Write

When creating or updating a record with a `file` field, pass the file UUID. The engine resolves it to full JSONB metadata.

```bash
curl -X PUT http://localhost:8080/api/demo/product/prod-uuid-456 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Laptop Pro",
    "image": "file-uuid-abc123"
  }'
```

**Stored in database as:**
```json
{
  "image": {
    "id": "file-uuid-abc123",
    "filename": "invoice.pdf",
    "size": 245312,
    "mime_type": "application/pdf"
  }
}
```

### Serve/Download a File

```bash
# Streams the file with correct Content-Type header
curl http://localhost:8080/api/demo/_files/file-uuid-abc123 \
  -H "Authorization: Bearer $TOKEN" \
  --output invoice.pdf
```

### List All Files (Admin Only)

```bash
curl http://localhost:8080/api/demo/_files \
  -H "Authorization: Bearer $TOKEN"
```

### Delete a File (Admin Only)

```bash
curl -X DELETE http://localhost:8080/api/demo/_files/file-uuid-abc123 \
  -H "Authorization: Bearer $TOKEN"
```

### Storage Configuration

In `app.yaml`:

```yaml
storage:
  driver: local          # or s3 (future)
  local_path: uploads/   # base directory for file storage
  max_file_size: 52428800  # 50MB in bytes
```

Files are stored per-app in: `uploads/{app_name}/`

---

## 12. Schema Export & Import

Export all metadata as a single JSON document and import it into another app or environment.

### Export Schema

```bash
curl http://localhost:8080/api/demo/_admin/export \
  -H "Authorization: Bearer $TOKEN" \
  --output demo-schema.json
```

**Response structure:**
```json
{
  "data": {
    "version": 1,
    "exported_at": "2025-01-15T10:30:00Z",
    "entities": [
      {
        "name": "customer",
        "table": "customers",
        "primary_key": { "field": "id", "type": "uuid", "generated": true },
        "soft_delete": true,
        "fields": [...]
      }
    ],
    "relations": [
      {
        "name": "invoices",
        "type": "one_to_many",
        "source": "customer",
        "target": "invoice",
        ...
      }
    ],
    "rules": [...],
    "state_machines": [...],
    "workflows": [...],
    "permissions": [...],
    "webhooks": [...]
  }
}
```

### Import Schema

```bash
curl -X POST http://localhost:8080/api/demo/_admin/import \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @demo-schema.json
```

**Response:**
```json
{
  "data": {
    "imported": {
      "entities": 5,
      "relations": 8,
      "rules": 12,
      "state_machines": 2,
      "workflows": 3,
      "permissions": 20,
      "webhooks": 4
    },
    "errors": []
  }
}
```

### Import Behavior

- **Idempotent deduplication:** existing entities/relations (by name), rules (by entity+hook+type+definition), state machines (by entity+field), permissions (by entity+action), webhooks (by entity+hook+url) are skipped
- **Tables auto-created:** the migrator runs for each imported entity
- **Atomic:** either the full import succeeds or it rolls back
- **Sample data:** the import format supports a `sample_data` key with per-entity record arrays

### Use Cases

| Scenario | How |
|----------|-----|
| Version control | Export JSON, commit to git |
| Dev → Staging → Prod | Export from dev, import to staging/prod |
| Backup | Periodic exports as disaster recovery |
| Template sharing | Share schema JSON between teams or orgs |
| App cloning | Create new app, import existing schema |

---

## 13. Complete Scenario: Invoice System

This section walks through building a complete invoice management system using all features together.

### Step 1: Create Entities

```bash
# Customer entity
curl -X POST http://localhost:8080/api/demo/_admin/entities \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "customer",
    "table": "customers",
    "primary_key": { "field": "id", "type": "uuid", "generated": true },
    "soft_delete": true,
    "fields": [
      { "name": "id", "type": "uuid", "required": true },
      { "name": "name", "type": "string", "required": true },
      { "name": "email", "type": "string", "required": true, "unique": true },
      { "name": "status", "type": "string", "enum": ["active", "inactive"] },
      { "name": "credit_limit", "type": "decimal", "precision": 2 },
      { "name": "created_at", "type": "timestamp", "auto": "create" },
      { "name": "updated_at", "type": "timestamp", "auto": "update" }
    ]
  }'

# Invoice entity
curl -X POST http://localhost:8080/api/demo/_admin/entities \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "invoice",
    "table": "invoices",
    "primary_key": { "field": "id", "type": "uuid", "generated": true },
    "soft_delete": true,
    "fields": [
      { "name": "id", "type": "uuid", "required": true },
      { "name": "number", "type": "string", "required": true, "unique": true },
      { "name": "customer_id", "type": "uuid", "required": true },
      { "name": "status", "type": "string", "enum": ["draft", "pending_approval", "sent", "paid", "void"] },
      { "name": "total", "type": "decimal", "precision": 2, "default": 0 },
      { "name": "payment_date", "type": "date" },
      { "name": "payment_amount", "type": "decimal", "precision": 2 },
      { "name": "sent_at", "type": "timestamp" },
      { "name": "paid_at", "type": "timestamp" },
      { "name": "voided_at", "type": "timestamp" },
      { "name": "escalated", "type": "boolean", "default": false },
      { "name": "attachment", "type": "file" },
      { "name": "notes", "type": "text" },
      { "name": "created_at", "type": "timestamp", "auto": "create" },
      { "name": "updated_at", "type": "timestamp", "auto": "update" }
    ]
  }'

# Invoice item entity
curl -X POST http://localhost:8080/api/demo/_admin/entities \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "invoice_item",
    "table": "invoice_items",
    "primary_key": { "field": "id", "type": "uuid", "generated": true },
    "soft_delete": false,
    "fields": [
      { "name": "id", "type": "uuid", "required": true },
      { "name": "invoice_id", "type": "uuid", "required": true },
      { "name": "description", "type": "string", "required": true },
      { "name": "quantity", "type": "int", "required": true },
      { "name": "unit_price", "type": "decimal", "precision": 2, "required": true },
      { "name": "line_total", "type": "decimal", "precision": 2 },
      { "name": "created_at", "type": "timestamp", "auto": "create" }
    ]
  }'
```

### Step 2: Create Relations

```bash
# Customer → Invoices
curl -X POST http://localhost:8080/api/demo/_admin/relations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "invoices",
    "type": "one_to_many",
    "source": "customer",
    "target": "invoice",
    "source_key": "id",
    "target_key": "customer_id",
    "ownership": "source",
    "on_delete": "restrict",
    "fetch": "lazy",
    "write_mode": "diff"
  }'

# Invoice → Items
curl -X POST http://localhost:8080/api/demo/_admin/relations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "items",
    "type": "one_to_many",
    "source": "invoice",
    "target": "invoice_item",
    "source_key": "id",
    "target_key": "invoice_id",
    "ownership": "source",
    "on_delete": "cascade",
    "fetch": "lazy",
    "write_mode": "diff"
  }'
```

### Step 3: Add Validation Rules

```bash
# Rule 1: Invoice total must be non-negative
curl -X POST http://localhost:8080/api/demo/_admin/rules \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "invoice",
    "hook": "before_write",
    "type": "field",
    "definition": { "field": "total", "operator": "gte", "value": 0, "message": "Total must be non-negative" },
    "priority": 1,
    "active": true
  }'

# Rule 2: Payment date required when paid
curl -X POST http://localhost:8080/api/demo/_admin/rules \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "invoice",
    "hook": "before_write",
    "type": "expression",
    "definition": {
      "expression": "record.status == '\''paid'\'' && record.payment_date == nil",
      "message": "Payment date is required when marking as paid"
    },
    "priority": 10,
    "active": true
  }'

# Rule 3: Voided invoices cannot be modified
curl -X POST http://localhost:8080/api/demo/_admin/rules \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "invoice",
    "hook": "before_write",
    "type": "expression",
    "definition": {
      "expression": "action == '\''update'\'' && old != nil && old.status == '\''void'\''",
      "message": "Voided invoices cannot be modified",
      "stop_on_fail": true
    },
    "priority": 1,
    "active": true
  }'

# Rule 4: Cannot delete customer with open invoices
curl -X POST http://localhost:8080/api/demo/_admin/rules \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "customer",
    "hook": "before_delete",
    "type": "expression",
    "definition": {
      "expression": "len(related.invoices) > 0",
      "message": "Cannot delete customer with existing invoices",
      "related_load": [
        { "relation": "invoices", "filter": { "status.in": ["draft", "sent", "paid"] } }
      ]
    },
    "priority": 1,
    "active": true
  }'

# Rule 5: Computed line total on invoice items
curl -X POST http://localhost:8080/api/demo/_admin/rules \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "invoice_item",
    "hook": "before_write",
    "type": "computed",
    "definition": {
      "field": "line_total",
      "expression": "record.quantity * record.unit_price"
    },
    "priority": 100,
    "active": true
  }'
```

### Step 4: Add State Machine

```bash
curl -X POST http://localhost:8080/api/demo/_admin/state-machines \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "invoice",
    "field": "status",
    "definition": {
      "initial": "draft",
      "transitions": [
        {
          "from": "draft",
          "to": "pending_approval",
          "roles": ["admin", "accountant"],
          "guard": "record.total > 0",
          "actions": []
        },
        {
          "from": "pending_approval",
          "to": "sent",
          "roles": ["admin", "manager"],
          "actions": [
            { "type": "set_field", "field": "sent_at", "value": "now" }
          ]
        },
        {
          "from": "sent",
          "to": "paid",
          "roles": ["admin", "accountant"],
          "guard": "record.payment_date != nil && record.payment_amount >= record.total",
          "actions": [
            { "type": "set_field", "field": "paid_at", "value": "now" },
            { "type": "webhook", "url": "https://accounting.example.com/invoice-paid", "method": "POST" }
          ]
        },
        {
          "from": ["draft", "pending_approval", "sent"],
          "to": "void",
          "roles": ["admin"],
          "actions": [
            { "type": "set_field", "field": "voided_at", "value": "now" }
          ]
        }
      ]
    },
    "active": true
  }'
```

### Step 5: Add Approval Workflow

```bash
curl -X POST http://localhost:8080/api/demo/_admin/workflows \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "invoice_approval",
    "trigger": {
      "type": "state_change",
      "entity": "invoice",
      "field": "status",
      "to": "pending_approval"
    },
    "context": {
      "record_id": "trigger.record_id",
      "entity": "invoice",
      "amount": "trigger.record.total"
    },
    "steps": [
      {
        "id": "check_amount",
        "type": "condition",
        "expression": "context.amount > 5000",
        "on_true": { "goto": "manager_review" },
        "on_false": { "goto": "auto_approve" }
      },
      {
        "id": "manager_review",
        "type": "approval",
        "assignee": { "type": "role", "role": "manager" },
        "timeout": "48h",
        "on_approve": { "goto": "auto_approve" },
        "on_reject": { "goto": "send_back" },
        "on_timeout": { "goto": "escalate" }
      },
      {
        "id": "escalate",
        "type": "action",
        "actions": [
          { "type": "set_field", "entity": "invoice", "record_id": "context.record_id", "field": "escalated", "value": true },
          { "type": "webhook", "url": "https://notifications.example.com/escalation", "method": "POST" }
        ],
        "then": { "goto": "manager_review" }
      },
      {
        "id": "auto_approve",
        "type": "action",
        "actions": [
          { "type": "set_field", "entity": "invoice", "record_id": "context.record_id", "field": "status", "value": "sent" }
        ],
        "then": "end"
      },
      {
        "id": "send_back",
        "type": "action",
        "actions": [
          { "type": "set_field", "entity": "invoice", "record_id": "context.record_id", "field": "status", "value": "draft" },
          { "type": "webhook", "url": "https://notifications.example.com/invoice-rejected", "method": "POST" }
        ],
        "then": "end"
      }
    ],
    "active": true
  }'
```

### Step 6: Add Webhooks

```bash
# Notify accounting when invoice is paid
curl -X POST http://localhost:8080/api/demo/_admin/webhooks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "invoice",
    "hook": "after_write",
    "url": "https://accounting.example.com/hooks/invoice-event",
    "method": "POST",
    "headers": { "X-API-Key": "{{env.ACCOUNTING_API_KEY}}" },
    "condition": "record.status == '\''paid'\'' && (old == nil || old.status != '\''paid'\'')",
    "async": true,
    "retry": { "max_attempts": 5, "backoff": "exponential" },
    "active": true
  }'

# Sync with CRM when customer is created
curl -X POST http://localhost:8080/api/demo/_admin/webhooks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "customer",
    "hook": "after_write",
    "url": "https://crm.example.com/hooks/customer-sync",
    "method": "POST",
    "headers": { "Authorization": "Bearer {{env.CRM_TOKEN}}" },
    "condition": "action == '\''create'\''",
    "async": true,
    "retry": { "max_attempts": 3, "backoff": "exponential" },
    "active": true
  }'
```

### Step 7: Set Up Permissions

```bash
# Accountants: full invoice CRUD (with conditions)
curl -X POST http://localhost:8080/api/demo/_admin/permissions -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"entity": "invoice", "action": "read", "roles": ["accountant", "manager"]}'

curl -X POST http://localhost:8080/api/demo/_admin/permissions -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"entity": "invoice", "action": "create", "roles": ["accountant"]}'

curl -X POST http://localhost:8080/api/demo/_admin/permissions -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"entity": "invoice", "action": "update", "roles": ["accountant"], "conditions": [{"field": "status", "operator": "in", "value": ["draft"]}]}'

curl -X POST http://localhost:8080/api/demo/_admin/permissions -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"entity": "invoice", "action": "update", "roles": ["manager"], "conditions": [{"field": "status", "operator": "in", "value": ["draft", "pending_approval", "sent"]}]}'

# Customer read access
curl -X POST http://localhost:8080/api/demo/_admin/permissions -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"entity": "customer", "action": "read", "roles": ["accountant", "manager", "sales"]}'

# Invoice item access follows invoice
curl -X POST http://localhost:8080/api/demo/_admin/permissions -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"entity": "invoice_item", "action": "read", "roles": ["accountant", "manager"]}'

curl -X POST http://localhost:8080/api/demo/_admin/permissions -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"entity": "invoice_item", "action": "create", "roles": ["accountant"]}'

curl -X POST http://localhost:8080/api/demo/_admin/permissions -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"entity": "invoice_item", "action": "update", "roles": ["accountant"]}'
```

### Step 8: Use the System

```bash
# 1. Create a customer
curl -X POST http://localhost:8080/api/demo/customer \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Acme Corp",
    "email": "billing@acme.com",
    "status": "active",
    "credit_limit": 100000
  }'
# Response: { "data": { "id": "cust-uuid-1", ... } }

# 2. Upload an invoice attachment
curl -X POST http://localhost:8080/api/demo/_files/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@contract.pdf"
# Response: { "data": { "id": "file-uuid-1", ... } }

# 3. Create an invoice with line items (nested write)
curl -X POST http://localhost:8080/api/demo/invoice \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "INV-2025-001",
    "customer_id": "cust-uuid-1",
    "status": "draft",
    "total": 7500.00,
    "attachment": "file-uuid-1",
    "items": {
      "_write_mode": "diff",
      "data": [
        { "description": "Consulting - January", "quantity": 40, "unit_price": 150.00 },
        { "description": "Software License", "quantity": 5, "unit_price": 300.00 }
      ]
    }
  }'
# Response: { "data": { "id": "inv-uuid-1", ... } }
# - Invoice created with status "draft" (state machine initial state)
# - Two line items created with computed line_total values
# - File UUID resolved to full JSONB metadata in attachment field

# 4. Submit for approval (state transition: draft → pending_approval)
curl -X PUT http://localhost:8080/api/demo/invoice/inv-uuid-1 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "status": "pending_approval" }'
# State machine validates: total > 0 ✓
# Workflow triggers: invoice_approval starts
# Condition step: amount (7500) > 5000 → goes to manager_review
# Workflow pauses at manager_review step, waiting for approval

# 5. Check pending approvals
curl http://localhost:8080/api/demo/_workflows/pending \
  -H "Authorization: Bearer $TOKEN"

# 6. Manager approves
curl -X POST http://localhost:8080/api/demo/_workflows/wf-instance-uuid/approve \
  -H "Authorization: Bearer $TOKEN"
# Workflow advances to auto_approve step
# auto_approve sets invoice.status = "sent"
# State machine fires: sent_at = now

# 7. Record payment (state transition: sent → paid)
curl -X PUT http://localhost:8080/api/demo/invoice/inv-uuid-1 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "paid",
    "payment_date": "2025-02-01",
    "payment_amount": 7500.00
  }'
# Expression rule validates: payment_date required when paid ✓
# State machine guard: payment_date != nil && payment_amount >= total ✓
# State machine action: paid_at = now
# State machine action: webhook fires to accounting system
# Webhook fires: after_write webhook to accounting.example.com

# 8. Query invoices with related data
curl "http://localhost:8080/api/demo/invoice?include=items&filter[status]=paid&sort=-paid_at" \
  -H "Authorization: Bearer $TOKEN"

# 9. Export the entire schema for backup
curl http://localhost:8080/api/demo/_admin/export \
  -H "Authorization: Bearer $TOKEN" \
  --output invoice-system-schema.json
```

### How All Layers Interact

```
Request: PUT /api/demo/invoice/uuid { status: "paid", payment_date: "2025-02-01", payment_amount: 7500 }

Layer 0 — Permission Check:
  → User has "accountant" role
  → Permission found: entity=invoice, action=update, roles=[accountant]
  → Condition: status IN ["draft"] → current status is "sent" → FAILS
  → Try next permission: roles=[manager], status IN ["draft","pending_approval","sent"] → PASSES

Layer 1 — Field Rules:
  → total >= 0 ✓

Layer 2 — Expression Rules:
  → "paid && payment_date == nil" → payment_date is set → passes ✓
  → "update && old.status == void" → old.status is "sent" → passes ✓

Layer 3 — State Machine:
  → Transition: sent → paid
  → Roles check: user has "accountant" ✓
  → Guard: payment_date != nil && payment_amount >= total → true ✓
  → Action: set_field paid_at = now
  → Action: webhook queued (accounting system)

Write Executed:
  → UPDATE invoices SET status='paid', payment_date='2025-02-01',
    payment_amount=7500, paid_at=NOW() WHERE id=$1

Post-Commit:
  → State machine webhook fires (accounting system)
  → after_write webhook fires (condition: status became "paid")
  → Both fire asynchronously with retry on failure
```

---

## Quick Reference: Expression Cheat Sheet

| Pattern | Expression | Returns true when violated |
|---------|------------|---------------------------|
| Conditional required | `record.status == 'paid' && record.payment_date == nil` | Paid but no payment date |
| Cross-field compare | `record.end_date <= record.start_date` | End before start |
| Prevent update | `action == 'update' && old.status == 'void'` | Modifying voided record |
| Cross-entity check | `len(related.invoices) > 0` | Has existing invoices |
| Role restriction | `action == 'update' && !('admin' in user.roles)` | Non-admin trying to update |
| Numeric range | `record.discount < 0 \|\| record.discount > 100` | Discount out of range |
| Null check | `record.email == nil \|\| record.email == ''` | Missing email |

## Quick Reference: Feature Interaction Matrix

| Feature | Creates At | Executes At | Can Block Write? |
|---------|-----------|-------------|-----------------|
| Field Rules | Admin API | before_write | Yes (422) |
| Expression Rules | Admin API | before_write, before_delete | Yes (422) |
| Computed Fields | Admin API | before_write (after validation) | No (sets values) |
| State Machine | Admin API | On state field change | Yes (422, 403) |
| Workflow | Admin API | Post-commit (triggered by state change) | No (async) |
| Webhook (async) | Admin API | Post-commit | No |
| Webhook (sync) | Admin API | Pre-commit (in transaction) | Yes (rollback on non-2xx) |
| Permissions | Admin API | Before any operation | Yes (403) |
