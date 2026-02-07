# Rules & Workflows — Technical Design

## The Problem

Simple field-level rules (`total >= 0`, `number not empty`) cover basic validation, but real business applications need:

- Conditional validation ("if status=paid, payment_date is required")
- Cross-field checks ("end_date must be after start_date")
- Cross-entity checks ("can't delete a customer who has open invoices")
- State machines (invoice: draft → sent → paid → void)
- Multi-step workflows (approval chains, escalation, parallel branches)
- Side effects (send email, call webhook, create related records)
- Custom logic that can't be expressed declaratively

## Design: Four Layers

```
Layer 1: Field Rules         — simple per-field checks (already exists)
Layer 2: Expression Rules    — cross-field, conditional, cross-entity logic
Layer 3: State Machines      — transition guards and actions on state fields
Layer 4: Workflows           — multi-step, event-driven, long-running processes

Escape Hatch: Webhooks       — call external HTTP endpoints for custom logic
```

Each layer builds on the previous. Most applications only need layers 1-3. Workflows are for complex, multi-entity, long-running processes.

---

## Layer 1: Field Rules (existing)

Per-field validation using simple operators. Already defined in [claude.md](../claude.md) and [dynamic-rest-api.md](dynamic-rest-api.md).

```json
{
  "entity": "invoice",
  "hook": "before_write",
  "conditions": [
    { "field": "total", "operator": "gte", "value": 0 },
    { "field": "number", "operator": "not_empty" }
  ],
  "message": "Invoice total must be non-negative and number is required"
}
```

**Limitation:** Can't express "if X then Y", can't reference other fields or entities.

---

## Layer 2: Expression Rules

### What It Solves

Any validation that involves multiple fields, conditional logic, or cross-entity lookups — without writing Go code.

### Expression Language

Use [expr-lang/expr](https://github.com/expr-lang/expr) — a Go-native expression evaluator. It's safe (no side effects, no system access), fast (compiles to bytecode), and supports the exact syntax we need.

Why expr and not a custom parser:
- Battle-tested, widely used in Go projects
- Compiles expressions at metadata load time (not per-request)
- Type-checked at compile time against a provided environment
- No loops, no assignments, no function definitions — safe for user-authored rules

### Expression Environment

Every expression has access to these variables:

```
record       — the incoming payload (map[string]any)
old          — the current DB state for updates, nil for creates (map[string]any)
related      — lazy-loaded related entities (map[string]any or []map[string]any)
user         — current user context { id, roles }
action       — "create", "update", or "delete"
now          — current timestamp
```

### Schema: `_rules` table (extended)

```json
{
  "entity": "invoice",
  "hook": "before_write",
  "type": "expression",
  "expression": "record.status == 'paid' && record.payment_date == nil",
  "message": "Payment date is required when status is paid",
  "stop_on_fail": true
}
```

The `type` field distinguishes:
- `"field"` — Layer 1, simple operator-based (backward compatible)
- `"expression"` — Layer 2, expr-lang expression

### Examples

**Conditional required field:**
```json
{
  "entity": "invoice",
  "hook": "before_write",
  "type": "expression",
  "expression": "record.status == 'paid' && record.payment_date == nil",
  "message": "Payment date is required when status is paid"
}
```
Expression returns `true` when the rule is **violated**. True = fail, false = pass.

**Cross-field comparison:**
```json
{
  "entity": "project",
  "hook": "before_write",
  "type": "expression",
  "expression": "record.end_date != nil && record.end_date <= record.start_date",
  "message": "End date must be after start date"
}
```

**Prevent update of locked records:**
```json
{
  "entity": "invoice",
  "hook": "before_write",
  "type": "expression",
  "expression": "action == 'update' && old.status == 'void'",
  "message": "Voided invoices cannot be modified"
}
```

**Cross-entity check (using `related`):**
```json
{
  "entity": "customer",
  "hook": "before_delete",
  "type": "expression",
  "expression": "len(related.invoices) > 0",
  "message": "Cannot delete customer with existing invoices",
  "related_load": [
    { "relation": "invoices", "filter": { "status.in": ["draft", "sent", "paid"] } }
  ]
}
```

The `related_load` field tells the engine which relations to pre-fetch before evaluating the expression. This keeps the expression itself simple and avoids hidden DB calls.

**Role-based field restriction:**
```json
{
  "entity": "invoice",
  "hook": "before_write",
  "type": "expression",
  "expression": "action == 'update' && old.status != record.status && !('admin' in user.roles)",
  "message": "Only admins can change invoice status"
}
```

### Computed Fields

Expressions can also set field values, not just validate. Use `type: "computed"`:

```json
{
  "entity": "invoice",
  "hook": "before_write",
  "type": "computed",
  "field": "total",
  "expression": "sum(related.items, 'quantity * unit_price')",
  "related_load": [
    { "relation": "items" }
  ]
}
```

Computed rules run **after** validation rules but **before** SQL execution. The engine sets the computed value on the record before writing.

### Execution Order Within a Hook

```
before_write hook:
  1. Field rules (Layer 1)         — fast, no DB lookups
  2. Expression rules (Layer 2)    — may need related_load
  3. Computed fields                — set derived values
  4. State machine guards (Layer 3) — if entity has state config

If any rule fails with stop_on_fail=true, remaining rules are skipped.
If stop_on_fail=false (default), all rules run and all errors are collected.
```

### Compilation & Caching

- Expressions are compiled to bytecode when metadata is loaded into the registry
- Compiled programs are cached in memory alongside entity metadata
- On registry refresh (admin UI changes an entity), expressions are recompiled
- Invalid expressions are caught at save time in the admin UI (compile check before writing to `_rules`)

---

## Layer 3: State Machines

### What It Solves

Entities with a "status" or "stage" field that must follow specific transitions. Instead of writing expression rules for every invalid transition, define the allowed transitions once.

### Schema: `_state_machines` table

```json
{
  "entity": "invoice",
  "field": "status",
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
        { "type": "webhook", "url": "/hooks/invoice-paid", "method": "POST" }
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
}
```

### How It Works

```
1. On update, engine detects the state field changed (old.status != record.status)
2. Look up state machine for this entity
3. Find matching transition: from=old.status, to=record.status
   → No match? Reject with 422 "Invalid transition from {old} to {new}"
4. Check roles: user must have one of the transition's allowed roles
   → Fail? Reject with 403
5. Evaluate guard expression (if present) using same expr environment
   → Fail? Reject with 422 and guard message
6. Execute transition actions (inside the same transaction):
   - set_field: set a field value on the record before SQL write
   - webhook: queue a webhook call (executed after commit)
   - create_record: insert a related record (e.g., create an audit entry)
   - send_event: emit a named event for workflow triggers
7. Proceed with normal write flow
```

### Transition Actions

| Action Type | Description | Runs |
|-------------|-------------|------|
| `set_field` | Set a field on the current record | Before SQL write (in tx) |
| `create_record` | Insert a record in another entity | In transaction |
| `webhook` | HTTP POST to an external URL | After commit |
| `send_event` | Emit a named event | After commit |

### Why Separate From Expression Rules

- State machines are **visual** — the admin UI can render them as a state diagram
- Transitions are a natural concept for business users ("invoice goes from draft to sent")
- Guards and actions are scoped to a specific transition, not a generic hook
- Easier to debug: "transition from sent to paid failed because guard returned true"

---

## Layer 4: Workflows

### What It Solves

Multi-step, long-running processes that span multiple entities, require human decisions, or involve external systems. Examples:

- Purchase order approval: requester → manager → finance → approved/rejected
- Employee onboarding: create account → assign equipment → schedule training → complete
- Order fulfillment: order placed → payment confirmed → inventory reserved → shipped → delivered

### Schema: `_workflows` table

```json
{
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
      "assignee": { "type": "relation", "path": "requester.manager_id" },
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
        { "type": "webhook", "url": "/hooks/escalate", "method": "POST" },
        { "type": "set_field", "entity": "purchase_order", "record_id": "context.record_id", "field": "escalated", "value": true }
      ],
      "then": { "goto": "finance_approval" }
    },
    {
      "id": "approved",
      "type": "action",
      "actions": [
        { "type": "set_field", "entity": "purchase_order", "record_id": "context.record_id", "field": "status", "value": "approved" },
        { "type": "send_event", "event": "po_approved" }
      ],
      "then": "end"
    },
    {
      "id": "rejected",
      "type": "action",
      "actions": [
        { "type": "set_field", "entity": "purchase_order", "record_id": "context.record_id", "field": "status", "value": "rejected" },
        { "type": "webhook", "url": "/hooks/po-rejected", "method": "POST" }
      ],
      "then": "end"
    }
  ]
}
```

### Step Types

| Type | Purpose | Blocks? |
|------|---------|---------|
| `action` | Execute actions (set fields, webhooks, create records) | No — runs immediately |
| `condition` | Branch based on expression | No — evaluates immediately |
| `approval` | Wait for a user to approve/reject | Yes — pauses workflow |
| `wait` | Wait for time duration or external event | Yes — pauses workflow |
| `parallel` | Run multiple branches concurrently | Yes — waits for all/any |

### Workflow Execution Runtime

```
_workflow_instances table:
{
  id:           UUID,
  workflow:     "purchase_order_approval",
  status:       "running" | "completed" | "failed" | "cancelled",
  current_step: "manager_approval",
  context:      { record_id: "...", amount: 50000, ... },
  history:      [
    { step: "manager_approval", status: "approved", by: "user-123", at: "2025-..." }
  ],
  created_at:   timestamp,
  updated_at:   timestamp
}
```

### How Workflows Run

```
1. Trigger fires (e.g., state machine transition emits event)
2. Engine creates a workflow instance row in _workflow_instances
3. Engine evaluates the first step:
   - If action/condition → execute immediately, advance to next step
   - If approval/wait → persist current_step, return (workflow is now paused)

4. When a paused workflow receives input:
   - Approval: user calls POST /api/_workflows/:instance_id/approve (or /reject)
   - Wait: timer fires or external event arrives

5. Engine loads instance, evaluates the goto, advances to next step
6. Repeat until step.then = "end"
7. Mark instance as completed
```

### Approval Endpoints

```
POST /api/_workflows/:instance_id/approve   — approve current step
POST /api/_workflows/:instance_id/reject    — reject current step
GET  /api/_workflows/pending?assignee=me    — list my pending approvals
GET  /api/_workflows/:instance_id           — get instance status + history
```

### Resumability & Idempotency

- Workflow state is persisted in `_workflow_instances` after every step
- If the server crashes mid-step, on restart a background goroutine scans for `status=running` instances and resumes them
- Each step execution checks `history` to avoid re-executing completed steps
- Action steps are idempotent: webhooks include an idempotency key, field sets are safe to repeat

### Timeouts

- A background goroutine runs a ticker (every 60s) that queries:
  `SELECT * FROM _workflow_instances WHERE status='running' AND current_step_deadline < NOW()`
- For each timed-out instance, it executes the `on_timeout` path

---

## Escape Hatch: Webhooks

### What It Solves

Logic that can't be expressed declaratively — external integrations, complex calculations, third-party API calls. The engine calls out to HTTP endpoints at hook points.

### Schema: `_webhooks` table

```json
{
  "entity": "invoice",
  "hook": "after_write",
  "url": "https://internal-service.example.com/hooks/invoice-updated",
  "method": "POST",
  "headers": { "X-API-Key": "{{env.WEBHOOK_SECRET}}" },
  "condition": "record.status == 'paid' && old.status != 'paid'",
  "async": true,
  "retry": { "max_attempts": 3, "backoff": "exponential" }
}
```

### Webhook Payload (sent by engine)

```json
{
  "event": "after_write",
  "entity": "invoice",
  "action": "update",
  "record": { "id": "...", "status": "paid", ... },
  "old": { "id": "...", "status": "sent", ... },
  "changes": { "status": { "old": "sent", "new": "paid" } },
  "user": { "id": "user-123", "roles": ["accountant"] },
  "timestamp": "2025-01-15T10:30:00Z",
  "idempotency_key": "wh_abc123"
}
```

### Sync vs Async

| Mode | Behavior |
|------|----------|
| `async: true` (default) | Fire after commit, don't wait for response. Retry on failure. |
| `async: false` | Call inside transaction, before commit. If webhook returns non-2xx, transaction rolls back. Use sparingly. |

Sync webhooks allow external services to veto a write. But they add latency and a failure dependency, so async is the default.

---

## How Layers Compose

Real-world example: **Invoice lifecycle**

```
Entity: invoice
  Fields: number, status, total, payment_date, customer_id, ...

Layer 1 — Field rules:
  - number: not_empty
  - total: gte 0

Layer 2 — Expression rules:
  - "if status=paid, payment_date is required"
  - "total must equal sum of items" (computed field)

Layer 3 — State machine:
  - draft → sent (guard: total > 0, action: set sent_at)
  - sent → paid (guard: payment_date set, action: webhook to accounting)
  - [draft, sent] → void (roles: admin only)

Layer 4 — Workflow:
  - On transition to "pending_approval": start approval workflow
  - Manager approval → finance approval if amount > 10000 → approved

Escape hatch — Webhooks:
  - after_write + status=paid: notify external accounting system
  - after_write + status=void: trigger refund in payment gateway
```

Each layer is optional. A simple CRUD entity might only use Layer 1. A complex financial entity might use all four plus webhooks.

---

## System Tables Summary

| Table | Purpose |
|-------|---------|
| `_rules` | Field rules (type=field) + expression rules (type=expression) + computed fields (type=computed) |
| `_state_machines` | State field config, transitions, guards, actions per entity |
| `_workflows` | Workflow definitions (trigger, steps, branches) |
| `_workflow_instances` | Running/completed workflow state + history |
| `_webhooks` | External HTTP hook registrations |

---

## Admin UI Pages (additions)

| Page | Purpose |
|------|---------|
| Expression Rules | Write and test expressions with a live evaluator |
| State Machine Editor | Visual state diagram — drag states, draw transitions, set guards |
| Workflow Builder | Step-by-step flow editor — add approval steps, conditions, actions |
| Webhook Manager | Register external endpoints, view delivery logs |
| Workflow Monitor | List running instances, view step history, manually approve/reject |
