# API Connectors & Workflow Actions

## Overview

Rocket's API Connectors allow admins to configure reusable HTTP integrations (internal microservices, third-party APIs) entirely from the Admin UI. Connectors are consumed by workflows, state machines, and rules — enabling business logic that reaches external systems without writing code.

If no connectors are configured, the engine works normally — all existing features are unaffected.

## System Table

### `_api_connectors`

Stores reusable API connection configurations.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | Auto-generated |
| `name` | TEXT UNIQUE | Label: "payment-gateway", "crm-api", etc. |
| `base_url` | TEXT | Base URL: `https://api.stripe.com/v1` |
| `auth_type` | TEXT | `none` \| `bearer` \| `basic` \| `api_key` \| `custom_header` |
| `auth_config` | JSONB | Auth credentials (secrets via `{{env.VAR}}` references) |
| `default_headers` | JSONB | Headers sent with every request |
| `timeout_ms` | INT DEFAULT 5000 | Request timeout in milliseconds |
| `retry` | JSONB | Retry config: `{max_attempts, backoff_ms}` |
| `active` | BOOLEAN DEFAULT true | Enable/disable without deleting |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

### Auth Config Examples

**Bearer Token**
```json
{
  "auth_type": "bearer",
  "auth_config": {
    "token": "{{env.STRIPE_API_KEY}}"
  }
}
```

**Basic Auth**
```json
{
  "auth_type": "basic",
  "auth_config": {
    "username": "{{env.API_USER}}",
    "password": "{{env.API_PASS}}"
  }
}
```

**API Key (query param or header)**
```json
{
  "auth_type": "api_key",
  "auth_config": {
    "key_name": "X-API-Key",
    "key_value": "{{env.MY_API_KEY}}",
    "in": "header"
  }
}
```

**Custom Header**
```json
{
  "auth_type": "custom_header",
  "auth_config": {
    "headers": {
      "X-Postmark-Server-Token": "{{env.POSTMARK_TOKEN}}"
    }
  }
}
```

Secrets are never stored in plaintext — `{{env.VAR}}` references are resolved at request time from environment variables (same pattern as webhook headers and email provider config).

---

## Current Workflow Step Types

The workflow engine currently supports three step types:

### 1. Action Step (`"action"`)

Executes a sequence of actions sequentially, then advances to the next step.

```json
{
  "id": "notify",
  "type": "action",
  "actions": [
    { "type": "set_field", "entity": "order", "field": "notified_at", "record_id": "context.record_id", "value": "now" },
    { "type": "webhook", "url": "https://hooks.slack.com/...", "method": "POST" }
  ],
  "then": { "goto": "check_amount" }
}
```

### 2. Condition Step (`"condition"`)

Evaluates a boolean expression and branches to different paths.

```json
{
  "id": "check_amount",
  "type": "condition",
  "expression": "context.record.amount > 10000",
  "on_true": { "goto": "manager_approval" },
  "on_false": { "goto": "auto_approve" }
}
```

**Environment variables available in expressions:**
- `context` — full workflow context (record, entity, action, custom data)
- `context.record` — the entity record that triggered the workflow
- `context.record_id` — the record's ID
- `context.entity` — entity name

### 3. Approval Step (`"approval"`)

Pauses the workflow and waits for human approval, with optional timeout.

```json
{
  "id": "manager_approval",
  "type": "approval",
  "timeout": "72h",
  "on_approve": { "goto": "process_order" },
  "on_reject": { "goto": "notify_rejected" },
  "on_timeout": { "goto": "escalate" }
}
```

**Timeout formats:** `"72h"`, `"48h"`, `"30m"`, `"60s"`

**User actions:** `POST /_workflows/:id/approve` or `POST /_workflows/:id/reject`

---

## Current Workflow Action Types

Actions execute within workflow steps (primarily in `"action"` steps) and state machine transitions.

### 1. Set Field (`"set_field"`) — Live

Updates a field on an entity record.

```json
{
  "type": "set_field",
  "entity": "order",
  "field": "approved_at",
  "record_id": "context.record_id",
  "value": "now"
}
```

- `value: "now"` is a special token that resolves to the current ISO 8601 timestamp
- `record_id` is a dot-path into the workflow context

### 2. Webhook (`"webhook"`) — Live

Dispatches an HTTP request to an external endpoint. Uses the raw URL directly (no connector).

```json
{
  "type": "webhook",
  "url": "https://hooks.slack.com/services/...",
  "method": "POST",
  "headers": { "Content-Type": "application/json" }
}
```

- Payload: JSON-encoded workflow instance context
- Fire-and-forget (async), non-2xx logs error but doesn't block workflow

### 3. Create Record (`"create_record"`) — Stub

Creates a new entity record during workflow execution.

```json
{
  "type": "create_record",
  "entity": "audit_entry",
  "fields": {
    "source": "workflow",
    "action": "approved",
    "record_id": "{{context.record_id}}",
    "approved_by": "{{context.approved_by}}"
  }
}
```

**Status:** Currently logged as stub across all backends. Planned for full implementation.

### 4. Send Event (`"send_event"`) — Stub

Emits a named business event (for Phase 8 instrumentation system).

```json
{
  "type": "send_event",
  "event": "order.approved",
  "metadata": {
    "order_id": "{{context.record_id}}",
    "amount": "{{context.record.amount}}"
  }
}
```

**Status:** Currently logged as stub. Will integrate with Phase 8 events system.

---

## Planned Action Types

### 5. HTTP Request (`"http_request"`) — Planned

Makes an HTTP request using a configured API connector, with response mapping back into workflow context.

```json
{
  "type": "http_request",
  "connector": "payment-gateway",
  "method": "POST",
  "path": "/charges",
  "body": {
    "amount": "{{context.record.amount}}",
    "currency": "usd",
    "customer_id": "{{context.record.customer_id}}"
  },
  "response_mapping": {
    "context.charge_id": "response.id",
    "context.charge_status": "response.status"
  },
  "on_success": { "goto": "update_order" },
  "on_error": { "goto": "handle_payment_failure" }
}
```

**Key differences from `webhook`:**
- Uses a named connector (reusable auth, base URL, headers, retry config)
- Supports response mapping — extracts values from the response and writes them into workflow context
- Supports branching — `on_success` / `on_error` determine next step
- Supports `path` relative to connector's `base_url`
- Synchronous within the workflow (waits for response before advancing)

### 6. Send Email (`"send_email"`) — Planned (Phase 10)

Sends an email using configured email providers and templates (see [email-providers.md](email-providers.md)).

```json
{
  "type": "send_email",
  "template": "order_confirmation",
  "to": "{{context.record.email}}",
  "variables": {
    "order_id": "{{context.record_id}}",
    "amount": "{{context.record.amount}}",
    "app_name": "MyApp"
  }
}
```

### 7. Update Record (`"update_record"`) — Planned

Updates an existing record (more flexible than `set_field` — multiple fields at once, different entity).

```json
{
  "type": "update_record",
  "entity": "invoice",
  "record_id": "{{context.record.invoice_id}}",
  "fields": {
    "status": "paid",
    "paid_at": "now",
    "payment_ref": "{{context.charge_id}}"
  }
}
```

### 8. Delete Record (`"delete_record"`) — Planned

Soft-deletes a record.

```json
{
  "type": "delete_record",
  "entity": "temporary_hold",
  "record_id": "{{context.record.hold_id}}"
}
```

### 9. Transform / Map (`"transform"`) — Planned

Computes values and writes them into workflow context without touching the database. Useful for preparing data between steps.

```json
{
  "type": "transform",
  "mappings": {
    "context.full_name": "context.record.first_name + ' ' + context.record.last_name",
    "context.discount": "context.record.amount > 1000 ? 0.1 : 0"
  }
}
```

### 10. Delay (`"delay"`) — Planned

Pauses workflow execution for a specified duration (scheduled resume via background scheduler).

```json
{
  "type": "delay",
  "duration": "24h"
}
```

---

## Planned Step Types

### 4. HTTP Request Step (`"http_request"`) — Planned

A dedicated step type (not just an action) that makes an HTTP request and branches based on the response.

```json
{
  "id": "validate_address",
  "type": "http_request",
  "connector": "address-validator",
  "method": "POST",
  "path": "/validate",
  "body": {
    "street": "{{context.record.street}}",
    "city": "{{context.record.city}}",
    "zip": "{{context.record.zip}}"
  },
  "response_mapping": {
    "context.address_valid": "response.valid",
    "context.normalized_address": "response.normalized"
  },
  "on_success": { "goto": "check_validity" },
  "on_error": { "goto": "manual_review" }
}
```

This is equivalent to an action step with a single `http_request` action but provides cleaner branching syntax.

### 5. Loop Step (`"loop"`) — Planned (Phase 12)

Iterates over a collection in the workflow context.

```json
{
  "id": "process_items",
  "type": "loop",
  "collection": "context.record.line_items",
  "item_var": "context.current_item",
  "body": { "goto": "validate_item" },
  "then": { "goto": "finalize" }
}
```

### 6. Parallel Step (`"parallel"`) — Planned (Phase 12)

Executes multiple branches concurrently and waits for all/any to complete.

```json
{
  "id": "parallel_checks",
  "type": "parallel",
  "branches": [
    { "goto": "check_inventory" },
    { "goto": "check_credit" },
    { "goto": "validate_address" }
  ],
  "join": "all",
  "then": { "goto": "process_order" }
}
```

---

## State Machine Transition Actions

State machines execute actions when a valid transition occurs. These actions run synchronously before the SQL commit.

| Action Type | Status | Description |
|-------------|--------|-------------|
| `set_field` | Live | Sets a field on the transitioning record (`"now"` = timestamp) |
| `webhook` | Live | Fires HTTP request (async, fire-and-forget, errors logged as warnings) |
| `create_record` | Stub | Creates a new entity record |
| `send_event` | Stub | Emits a business event (Phase 8) |
| `http_request` | Planned | Makes an HTTP request via API connector |
| `send_email` | Planned | Sends email via configured provider (Phase 10) |

### Planned: `http_request` Transition Action

```json
{
  "from": ["pending"],
  "to": "processing",
  "actions": [
    { "type": "set_field", "field": "started_at", "value": "now" },
    {
      "type": "http_request",
      "connector": "erp-system",
      "method": "POST",
      "path": "/orders/{{record.id}}/start",
      "body": { "order_id": "{{record.id}}", "status": "processing" }
    }
  ]
}
```

---

## Rule Types

Rules validate and compute fields within the write pipeline, evaluated at the `before_write` hook.

| Rule Type | Status | Description |
|-----------|--------|-------------|
| `field` | Live | Validates individual field values (min, max, min_length, max_length, pattern, required, enum) |
| `expression` | Live | Validates records against boolean expressions |
| `computed` | Live | Auto-calculates field value from expressions |
| `http_validate` | Planned | Validates against external API before write |

### Planned: `http_validate` Rule Type

Calls an external API as part of the validation pipeline. Non-2xx or `{valid: false}` blocks the write.

```json
{
  "entity": "order",
  "hook": "before_write",
  "type": "http_validate",
  "definition": {
    "connector": "fraud-check",
    "method": "POST",
    "path": "/check",
    "body": {
      "email": "{{record.email}}",
      "amount": "{{record.amount}}",
      "ip": "{{request.ip}}"
    },
    "valid_field": "response.approved",
    "error_field": "response.reason",
    "message": "Order failed fraud check"
  }
}
```

**Behavior:**
- Executes synchronously in the write pipeline (after field/expression rules, before SQL)
- Timeout: uses connector's `timeout_ms` setting
- On HTTP error or `valid_field` evaluates to `false`: returns validation error with `error_field` value or fallback `message`
- On success: write proceeds normally

---

## Webhook Hook Types (Existing)

Webhooks are the original HTTP integration in Rocket — metadata-driven, triggered by entity lifecycle events.

| Hook | Timing | Behavior |
|------|--------|----------|
| `after_write` | After commit | Async, fire-and-forget, retry on failure |
| `before_write` | Before commit | Sync, non-2xx rolls back transaction |
| `after_delete` | After commit | Async |
| `before_delete` | Before commit | Sync, non-2xx rolls back |

**Key difference between webhooks and API connectors:**
- **Webhooks** are event-driven — they fire automatically when entities are created/updated/deleted. They push data out.
- **API connectors** are action-driven — they're invoked explicitly from workflows, state machines, or rules. They call external APIs and optionally consume the response.

---

## Admin API Endpoints

### API Connectors

```
GET    /_admin/api-connectors              # List all connectors
POST   /_admin/api-connectors              # Create connector
GET    /_admin/api-connectors/:id          # Get connector
PUT    /_admin/api-connectors/:id          # Update connector
DELETE /_admin/api-connectors/:id          # Delete connector
POST   /_admin/api-connectors/:id/test     # Test connector (sends a GET to base_url)
```

### Test Endpoint

`POST /_admin/api-connectors/:id/test` sends a simple request to verify connectivity and auth:

```json
// Request (optional override)
{
  "method": "GET",
  "path": "/health"
}

// Response
{
  "data": {
    "status": "ok",
    "response_status": 200,
    "response_time_ms": 142
  }
}
```

---

## Admin UI

### Settings > API Connectors

- List configured connectors with status badges (active/inactive)
- Create/edit form: name, base URL, auth type dropdown, auth config editor, default headers, timeout, retry config
- "Test Connection" button: verifies connectivity
- Secret fields show `{{env.VAR}}` reference, never the resolved value

---

## Variable Resolution

All action types support `{{variable}}` template syntax for dynamic values:

| Pattern | Context | Example |
|---------|---------|---------|
| `{{context.record.field}}` | Workflow context | `{{context.record.email}}` |
| `{{context.record_id}}` | Workflow context | Record ID that triggered workflow |
| `{{record.field}}` | State machine / rules | `{{record.amount}}` |
| `{{env.VAR}}` | Environment variable | `{{env.STRIPE_KEY}}` |
| `"now"` | Special token | Resolves to current ISO 8601 timestamp |
| `{{response.field}}` | HTTP response body | `{{response.data.id}}` (dot-path into JSON) |

---

## Execution Flow Summary

### Write Pipeline (existing)

```
1. Validate fields (required, enums, types)
2. Evaluate rules (before_write hook):
   a. Field rules (min, max, pattern, etc.)
   b. Expression rules (boolean expressions)
   c. http_validate rules [planned] — call external API
   d. Computed fields (set calculated values)
3. Evaluate state machines:
   a. Validate transition (from → to)
   b. Evaluate guard expression
   c. Execute transition actions (set_field, webhook, http_request)
4. Fire sync webhooks (before_write) — non-2xx → rollback
5. Execute SQL (INSERT/UPDATE)
6. Commit transaction
7. Fire async webhooks (after_write) — background
8. Trigger workflows — check if state field changed
```

### Workflow Execution

```
1. Trigger creates instance at first step
2. advanceWorkflow() loop:
   a. Get current step executor
   b. Execute step:
      - action → run actions sequentially
      - condition → evaluate expression, branch
      - approval → pause, set deadline
      - http_request [planned] → call API, map response, branch
   c. If paused → save state, return
   d. If nextGoto → advance to next step
   e. If no next step → mark completed
3. Approval resolution:
   - POST /_workflows/:id/approve → on_approve.goto
   - POST /_workflows/:id/reject → on_reject.goto
4. Timeout scheduler (60s tick):
   - Check current_step_deadline
   - Move to on_timeout.goto
```

---

## Implementation Notes

### HTTP Client

All backends already have HTTP client infrastructure from webhook dispatch:
- **Go**: `net/http` (standard library)
- **Express.js**: `fetch` (built-in)
- **Elixir**: `Req` library

API connector requests reuse the same HTTP client with added:
- Base URL + path concatenation
- Auth header injection (resolved from `{{env.VAR}}`)
- Configurable timeout
- Response body parsing (JSON → map)
- Response mapping into workflow context

### Connector Resolution

At action execution time:
1. Look up `_api_connectors` WHERE `name = '<connector_name>'` AND `active = true`
2. If not found → action fails with descriptive error
3. Resolve `{{env.VAR}}` in auth_config and default_headers
4. Build full URL: `base_url + path`
5. Inject auth headers based on `auth_type`
6. Resolve `{{variable}}` in body template
7. Execute HTTP request with `timeout_ms`
8. Parse response as JSON
9. Apply `response_mapping` to write values into workflow context

### Response Mapping

Dot-path extraction from JSON response:

```
"response_mapping": {
  "context.charge_id": "response.id",           → response["id"]
  "context.items":     "response.data.items",    → response["data"]["items"]
  "context.total":     "response.meta.total"     → response["meta"]["total"]
}
```

Values are written into the workflow instance's `context` JSONB, available to subsequent steps.
