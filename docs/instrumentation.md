# Phase 8: Instrumentation & Events

**Status:** Not started
**Priority:** High — foundational observability for a metadata-driven platform where users cannot add custom instrumentation

---

## Overview

Built-in APM (Application Performance Monitoring) using a **trace-span model**. Every HTTP request generates a trace, and each operation within that request creates a span. System events are auto-instrumented; business events are exposed via API.

### Why This Matters

Rocket is a metadata-driven engine — there is no per-entity application code for users to annotate with logging or tracing. The platform must provide observability out of the box, or operators have no visibility into what happened when a request was slow, a webhook failed, or a workflow stalled.

### Design Principles

1. **Zero-config for system events** — all system instrumentation is automatic
2. **Fire-and-forget** — event writes must never slow down the request path
3. **Per-app isolation** — events stored in each app's database, consistent with existing multi-app model
4. **OpenTelemetry-compatible naming** — use `trace_id`, `span_id`, `parent_span_id` so events can be exported to Jaeger/Zipkin later (no OTEL SDK dependency now)
5. **Configurable** — sampling rate, retention, enable/disable per app

---

## System Table

### `_events`

Added to bootstrap DDL alongside existing system tables.

```sql
CREATE TABLE IF NOT EXISTS _events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trace_id        UUID NOT NULL,
    span_id         UUID NOT NULL,
    parent_span_id  UUID,
    event_type      TEXT NOT NULL,       -- 'system' | 'business'
    source          TEXT NOT NULL,       -- 'http' | 'db' | 'engine' | 'auth' | 'webhook' | 'workflow' | 'storage'
    component       TEXT NOT NULL,       -- 'handler' | 'writer' | 'query' | 'rules' | 'state_machine' | 'permissions'
    action          TEXT NOT NULL,       -- 'request.start' | 'query.execute' | 'webhook.dispatch' | etc.
    entity          TEXT,                -- Which entity (nullable for non-entity ops)
    record_id       TEXT,                -- Which record (nullable)
    user_id         UUID,                -- Who triggered it (nullable)
    duration_ms     DOUBLE PRECISION,    -- Span duration (null for point-in-time events)
    status          TEXT,                -- 'ok' | 'error' | 'timeout' | 'skipped'
    metadata        JSONB,               -- Flexible payload (see Metadata Payloads below)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_trace ON _events (trace_id);
CREATE INDEX IF NOT EXISTS idx_events_entity_created ON _events (entity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_created ON _events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_type_source ON _events (event_type, source);
```

### Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID | Yes (auto) | Unique event identifier |
| `trace_id` | UUID | Yes | Correlation ID — groups all events from one HTTP request |
| `span_id` | UUID | Yes | This specific operation's identifier |
| `parent_span_id` | UUID | No | Parent span (null = root span, typically the HTTP request) |
| `event_type` | TEXT | Yes | `system` (auto-instrumented) or `business` (user-emitted via API) |
| `source` | TEXT | Yes | Which subsystem: `http`, `db`, `engine`, `auth`, `webhook`, `workflow`, `storage` |
| `component` | TEXT | Yes | Specific component: `handler`, `writer`, `query`, `rules`, `state_machine`, `permissions`, `nested_write` |
| `action` | TEXT | Yes | What happened: `request.start`, `query.execute`, `webhook.dispatch`, etc. |
| `entity` | TEXT | No | Entity name (e.g., `invoice`) — null for non-entity operations |
| `record_id` | TEXT | No | Record primary key — null for list/non-record operations |
| `user_id` | UUID | No | Authenticated user — null for unauthenticated requests |
| `duration_ms` | DOUBLE PRECISION | No | How long this span took — null for instantaneous events |
| `status` | TEXT | No | Outcome: `ok`, `error`, `timeout`, `skipped` |
| `metadata` | JSONB | No | Flexible payload — varies by source/action (see below) |
| `created_at` | TIMESTAMPTZ | Yes (auto) | When the event occurred |

---

## Trace ID Propagation

Each HTTP request gets a `trace_id` that flows through all operations.

### Generation

1. Check for `X-Trace-ID` header on incoming request (allows cross-service correlation)
2. If not present, generate a new UUID
3. Thread the trace_id through all downstream operations

### Language-Specific Mechanism

| Language | Mechanism | How |
|----------|-----------|-----|
| **Go** | `context.Context` | Add `trace_id` and current `span_id` to context; all functions already accept `ctx` |
| **Express.js** | `AsyncLocalStorage` | Set in HTTP middleware; accessible anywhere without parameter threading |
| **Elixir** | `Logger.metadata` | Set `:trace_id` and `:span_id` in Plug pipeline; available in all downstream processes |

### Response Header

Every HTTP response includes `X-Trace-ID: <uuid>` so clients can reference it for debugging.

---

## Instrumenter Interface

### Go

```go
// Package: internal/instrument

type Instrumenter interface {
    // StartSpan creates a child span under the current span in ctx.
    // Returns a new context (with this span as current) and the Span.
    StartSpan(ctx context.Context, source, component, action string) (context.Context, Span)

    // EmitBusinessEvent records a point-in-time business event.
    EmitBusinessEvent(ctx context.Context, action, entity, recordID string, metadata map[string]any)
}

type Span interface {
    End()                                  // Records duration, enqueues to write buffer
    SetStatus(status string)               // "ok", "error", "timeout"
    SetMetadata(key string, value any)     // Add to metadata JSONB
    SetEntity(entity, recordID string)     // Associate with an entity/record
    TraceID() string
    SpanID() string
}
```

### Express.js (TypeScript)

```typescript
// File: src/instrument/types.ts

interface Instrumenter {
    startSpan(source: string, component: string, action: string): Span;
    emitBusinessEvent(action: string, entity: string, recordId: string, metadata: Record<string, any>): void;
}

interface Span {
    end(): void;
    setStatus(status: string): void;
    setMetadata(key: string, value: any): void;
    setEntity(entity: string, recordId: string): void;
    readonly traceId: string;
    readonly spanId: string;
}
```

### Elixir

```elixir
# Module: Rocket.Instrument

@callback start_span(source :: String.t(), component :: String.t(), action :: String.t()) :: Span.t()
@callback emit_business_event(action :: String.t(), entity :: String.t(), record_id :: String.t(), metadata :: map()) :: :ok

# Span struct
defmodule Rocket.Instrument.Span do
  defstruct [:trace_id, :span_id, :parent_span_id, :source, :component, :action,
             :entity, :record_id, :start_time, :status, :metadata]

  def finish(span)        # Computes duration, sends to buffer
  def set_status(span, s) # Returns updated span
  def set_metadata(span, key, value)
end
```

---

## Auto-Instrumented System Events

All system events are instrumented automatically — no per-entity configuration needed.

### HTTP Layer

| Action | Source | Component | Trigger | Metadata |
|--------|--------|-----------|---------|----------|
| `request.start` | `http` | `handler` | HTTP middleware (before) | `{method, path, query_params}` |
| `request.end` | `http` | `handler` | HTTP middleware (after) | `{method, path, status_code, duration_ms, response_size}` |

The HTTP middleware creates the **root span** for every request. All subsequent spans are children of this span.

### Auth Layer

| Action | Source | Component | Trigger | Metadata |
|--------|--------|-----------|---------|----------|
| `auth.validate` | `auth` | `middleware` | JWT validation | `{token_type: "app"\|"platform", user_id, email, roles}` |
| `auth.login` | `auth` | `handler` | Successful login | `{email, token_type}` |
| `auth.denied` | `auth` | `middleware` | Auth rejection | `{reason: "missing_token"\|"expired"\|"invalid"\|"disabled_user"}` |

### Permission Layer

| Action | Source | Component | Trigger | Metadata |
|--------|--------|-----------|---------|----------|
| `permission.check` | `auth` | `permissions` | Permission evaluation | `{entity, action, role, result: "allowed"\|"denied", condition_count}` |
| `permission.denied` | `auth` | `permissions` | Access denied | `{entity, action, role, reason}` |

### Database Layer

| Action | Source | Component | Trigger | Metadata |
|--------|--------|-----------|---------|----------|
| `query.execute` | `db` | `query` | Every SQL execution | `{sql_fingerprint, duration_ms, rows_affected, operation: "SELECT"\|"INSERT"\|"UPDATE"\|"DELETE"}` |

**SQL fingerprinting:** Replace literal values with `?` to group similar queries (e.g., `SELECT * FROM invoices WHERE id = ?`). Never log actual parameter values (may contain PII).

### Write Pipeline

| Action | Source | Component | Trigger | Metadata |
|--------|--------|-----------|---------|----------|
| `write.validate` | `engine` | `writer` | Field validation | `{entity, field_count, error_count}` |
| `write.rules` | `engine` | `rules` | Rule evaluation | `{entity, rule_count, passed, failed, computed_count}` |
| `write.state_machine` | `engine` | `state_machine` | State transition | `{entity, field, from_state, to_state, guard_result}` |
| `write.insert` | `engine` | `writer` | Record INSERT | `{entity, record_id}` |
| `write.update` | `engine` | `writer` | Record UPDATE | `{entity, record_id, changed_fields}` |
| `write.delete` | `engine` | `writer` | Record DELETE | `{entity, record_id, soft: true\|false}` |

### Nested Writes

| Action | Source | Component | Trigger | Metadata |
|--------|--------|-----------|---------|----------|
| `nested_write.plan` | `engine` | `nested_write` | Write plan creation | `{entity, child_count, mode}` |
| `nested_write.child` | `engine` | `nested_write` | Per-child operation | `{relation, target_entity, operation: "create"\|"update"\|"delete", mode: "diff"\|"replace"\|"append"}` |

### Webhook Layer

| Action | Source | Component | Trigger | Metadata |
|--------|--------|-----------|---------|----------|
| `webhook.match` | `webhook` | `dispatcher` | Webhook condition evaluation | `{entity, hook, matched_count, total_count}` |
| `webhook.dispatch` | `webhook` | `dispatcher` | HTTP call to webhook URL | `{webhook_id, url, method, async, duration_ms}` |
| `webhook.success` | `webhook` | `dispatcher` | 2xx response | `{webhook_id, url, status_code, duration_ms}` |
| `webhook.fail` | `webhook` | `dispatcher` | Non-2xx or error | `{webhook_id, url, status_code, error, attempt}` |
| `webhook.circuit_open` | `webhook` | `dispatcher` | Circuit breaker tripped | `{webhook_id, url, failures, threshold}` |

### Workflow Layer

| Action | Source | Component | Trigger | Metadata |
|--------|--------|-----------|---------|----------|
| `workflow.trigger` | `workflow` | `engine` | Workflow started | `{workflow_id, workflow_name, instance_id, trigger_entity, trigger_record}` |
| `workflow.advance` | `workflow` | `engine` | Step completed | `{instance_id, from_step, to_step, step_type}` |
| `workflow.approve` | `workflow` | `engine` | Approval action | `{instance_id, step, approver_id}` |
| `workflow.reject` | `workflow` | `engine` | Rejection action | `{instance_id, step, rejector_id, reason}` |
| `workflow.timeout` | `workflow` | `engine` | Deadline expired | `{instance_id, step, deadline}` |

### File Storage Layer

| Action | Source | Component | Trigger | Metadata |
|--------|--------|-----------|---------|----------|
| `file.upload` | `storage` | `file_handler` | File uploaded | `{file_id, filename, mime_type, size, user_id}` |
| `file.serve` | `storage` | `file_handler` | File served | `{file_id, filename, mime_type, size}` |
| `file.delete` | `storage` | `file_handler` | File deleted | `{file_id, filename}` |

---

## Trace Example

A single `POST /api/myapp/invoice` with nested items and a webhook produces this trace:

```
Trace: f47ac10b-58cc-4372-a567-0e02b2c3d479
│
├─ [http.handler] request.start                         0ms
│  method=POST path=/api/myapp/invoice
│
├─ [auth.middleware] auth.validate                      0.1ms
│  user_id=abc123 roles=[admin]
│
├─ [auth.permissions] permission.check                  0.2ms
│  entity=invoice action=create result=allowed
│
├─ [engine.writer] write.validate                       0.3ms
│  entity=invoice field_count=5
│
├─ [engine.rules] write.rules                           0.5ms
│  entity=invoice rule_count=3 passed=3
│
├─ [engine.state_machine] write.state_machine            0.1ms
│  entity=invoice field=status from=null to=draft
│
├─ [db.query] query.execute                              1.2ms
│  sql=INSERT INTO invoices (...) VALUES (?) rows=1
│
├─ [engine.nested_write] nested_write.plan               0.1ms
│  entity=invoice child_count=3 mode=append
│
│  ├─ [engine.nested_write] nested_write.child           0.8ms
│  │  relation=items target=invoice_item op=create
│  │
│  │  └─ [db.query] query.execute                        0.7ms
│  │     sql=INSERT INTO invoice_items (...) VALUES (?)
│  │
│  ├─ [engine.nested_write] nested_write.child           0.7ms
│  │  (same pattern for item 2)
│  │
│  └─ [engine.nested_write] nested_write.child           0.6ms
│     (same pattern for item 3)
│
├─ [webhook.dispatcher] webhook.match                    0.1ms
│  entity=invoice hook=after_write matched=1
│
├─ [webhook.dispatcher] webhook.dispatch                 145ms  (async)
│  url=https://erp.example.com/hook status=200
│
├─ [workflow.engine] workflow.trigger                     0.8ms
│  workflow=invoice_approval instance_id=xyz789
│
└─ [http.handler] request.end                            5.2ms
   status=201 response_size=342
```

---

## Performance: Fire-and-Forget Writes

Event writes must **never block the request path**. Use the async write buffer pattern (see `docs/scalability-review.md` section 3.4).

### Write Strategy

```
Request Thread                 Write Buffer                  PostgreSQL
     │                              │                             │
     │  span.End()                  │                             │
     │ ──── enqueue event ─────────▶│                             │
     │  (non-blocking, ~1μs)        │                             │
     │                              │ (accumulate in memory)      │
     │  return 200 to client        │                             │
     │                              │ ── flush every 100ms ──────▶│
     │                              │    or every 500 events      │ batch INSERT
     │                              │                             │ sync_commit=off
```

### Implementation Details

1. **Span.End()** serializes the event and enqueues it to an in-memory buffer
2. Buffer flushes when either:
   - 500 events accumulated (batch size threshold)
   - 100ms elapsed since last flush (time threshold)
3. Flush uses a single transaction with `SET LOCAL synchronous_commit = off`
4. If the buffer is full (backpressure), events are dropped (not queued indefinitely)

### Language-Specific Buffering

| Language | Buffer Implementation |
|----------|----------------------|
| **Go** | `sync.Mutex`-guarded slice + `time.Ticker` goroutine for periodic flush |
| **Express.js** | Array + `setInterval` for periodic flush |
| **Elixir** | `GenServer` with `handle_cast` for enqueue + `Process.send_after` for periodic flush |

### Overhead Budget

| Operation | Target |
|-----------|--------|
| `StartSpan()` | < 1μs (UUID generation + context set) |
| `Span.End()` | < 2μs (serialize + buffer enqueue) |
| Buffer flush (500 events) | < 10ms (single batch INSERT) |
| Memory per buffered event | ~500 bytes |
| Max buffer memory | ~250KB (500 events × 500 bytes) |

---

## Configuration

### app.yaml

```yaml
instrumentation:
  enabled: true              # Master switch (default: true)
  retention_days: 7          # Auto-delete events older than this (default: 7)
  sampling_rate: 1.0         # 0.0-1.0 — fraction of requests to instrument (default: 1.0)
  buffer_size: 500           # Flush buffer at this count (default: 500)
  flush_interval_ms: 100     # Flush buffer at this interval (default: 100)
```

### Sampling

At `sampling_rate < 1.0`, the HTTP middleware decides per-request whether to instrument:

```go
if rand.Float64() > config.Instrumentation.SamplingRate {
    // Skip instrumentation for this request
    // ctx gets a no-op instrumenter that discards all spans
}
```

When sampling is active, a request is either **fully instrumented** or **not instrumented at all** — never partial.

### Disable Per-Source

Future enhancement: allow disabling specific sources (e.g., disable DB query instrumentation in production to reduce volume). Not in v1 scope.

---

## API Endpoints

### Emit Business Event

```
POST /api/:app/_events
```

**Auth:** Required (any authenticated user)

**Request Body:**
```json
{
    "action": "order.confirmed",
    "entity": "order",
    "record_id": "uuid-of-order",
    "metadata": {
        "total_amount": 150.00,
        "item_count": 3,
        "payment_method": "credit_card"
    }
}
```

**Response:** `201 Created`
```json
{
    "data": {
        "id": "event-uuid",
        "trace_id": "current-trace-uuid",
        "span_id": "generated-span-uuid",
        "event_type": "business",
        "action": "order.confirmed",
        "entity": "order",
        "record_id": "uuid-of-order",
        "created_at": "2026-02-09T10:30:00Z"
    }
}
```

**Notes:**
- `trace_id` is inherited from the current request's trace (via `X-Trace-ID` header or auto-generated)
- Business events are written synchronously (not buffered) since the client expects confirmation
- No `duration_ms` — business events are point-in-time

### Query Events

```
GET /api/:app/_events
```

**Auth:** Required (admin role)

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `source` | string | Filter by source (`http`, `db`, `engine`, `auth`, `webhook`, `workflow`, `storage`) |
| `component` | string | Filter by component |
| `action` | string | Filter by action (supports prefix match: `webhook.*`) |
| `entity` | string | Filter by entity name |
| `event_type` | string | `system` or `business` |
| `trace_id` | UUID | Filter by trace ID |
| `user_id` | UUID | Filter by user |
| `status` | string | Filter by status (`ok`, `error`, `timeout`) |
| `from` | ISO datetime | Events after this timestamp |
| `to` | ISO datetime | Events before this timestamp |
| `sort` | string | Sort field (default: `-created_at`) |
| `page` | int | Page number (default: 1) |
| `per_page` | int | Page size (default: 50, max: 100) |

**Response:**
```json
{
    "data": [
        {
            "id": "...",
            "trace_id": "...",
            "span_id": "...",
            "parent_span_id": null,
            "event_type": "system",
            "source": "http",
            "component": "handler",
            "action": "request.end",
            "entity": "invoice",
            "record_id": null,
            "user_id": "...",
            "duration_ms": 12.5,
            "status": "ok",
            "metadata": {"method": "GET", "path": "/api/myapp/invoice", "status_code": 200},
            "created_at": "2026-02-09T10:30:00Z"
        }
    ],
    "meta": {
        "page": 1,
        "per_page": 50,
        "total": 1234
    }
}
```

### Trace Waterfall

```
GET /api/:app/_events/trace/:trace_id
```

**Auth:** Required (admin role)

**Response:**
```json
{
    "trace_id": "f47ac10b-...",
    "root_span": {
        "span_id": "...",
        "source": "http",
        "component": "handler",
        "action": "request.end",
        "duration_ms": 12.5,
        "status": "ok",
        "metadata": {"method": "POST", "path": "/api/myapp/invoice", "status_code": 201},
        "created_at": "2026-02-09T10:30:00Z",
        "children": [
            {
                "span_id": "...",
                "source": "auth",
                "component": "middleware",
                "action": "auth.validate",
                "duration_ms": 0.1,
                "status": "ok",
                "children": []
            },
            {
                "span_id": "...",
                "source": "engine",
                "component": "writer",
                "action": "write.insert",
                "entity": "invoice",
                "record_id": "...",
                "duration_ms": 1.2,
                "status": "ok",
                "children": [
                    {
                        "span_id": "...",
                        "source": "db",
                        "component": "query",
                        "action": "query.execute",
                        "duration_ms": 0.7,
                        "metadata": {"sql_fingerprint": "INSERT INTO invoices (?) VALUES (?)"}
                    }
                ]
            }
        ]
    },
    "span_count": 15,
    "total_duration_ms": 12.5
}
```

**Implementation:** Query all events for the trace_id, then build a tree in memory using `parent_span_id` relationships. Root span has `parent_span_id = null`.

### Stats

```
GET /api/:app/_events/stats
```

**Auth:** Required (admin role)

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `from` | ISO datetime | Start of window (default: 24 hours ago) |
| `to` | ISO datetime | End of window (default: now) |
| `group_by` | string | `source`, `entity`, `action` (default: `source`) |

**Response:**
```json
{
    "window": {
        "from": "2026-02-08T10:30:00Z",
        "to": "2026-02-09T10:30:00Z"
    },
    "summary": {
        "total_events": 45230,
        "total_traces": 8420,
        "avg_duration_ms": 15.3,
        "error_rate": 0.023,
        "p95_duration_ms": 45.2
    },
    "by_source": [
        {"source": "http", "count": 16840, "avg_duration_ms": 18.5, "error_rate": 0.012},
        {"source": "db", "count": 42100, "avg_duration_ms": 2.1, "error_rate": 0.001},
        {"source": "engine", "count": 16840, "avg_duration_ms": 5.3, "error_rate": 0.015},
        {"source": "webhook", "count": 1250, "avg_duration_ms": 145.0, "error_rate": 0.08},
        {"source": "workflow", "count": 320, "avg_duration_ms": 3.2, "error_rate": 0.0}
    ],
    "slowest_traces": [
        {"trace_id": "...", "duration_ms": 1250, "action": "request.end", "entity": "invoice", "created_at": "..."},
        {"trace_id": "...", "duration_ms": 890, "action": "request.end", "entity": "customer", "created_at": "..."}
    ]
}
```

**Implementation:** Uses PostgreSQL aggregate queries:
```sql
-- Summary
SELECT count(*), avg(duration_ms), percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)
FROM _events WHERE source = 'http' AND action = 'request.end' AND created_at BETWEEN $1 AND $2;

-- Error rate
SELECT count(*) FILTER (WHERE status = 'error')::float / count(*) FROM _events WHERE ...;

-- Group by source
SELECT source, count(*), avg(duration_ms),
       count(*) FILTER (WHERE status = 'error')::float / count(*) as error_rate
FROM _events WHERE created_at BETWEEN $1 AND $2
GROUP BY source ORDER BY count(*) DESC;
```

---

## Retention & Cleanup

### Background Job

A scheduler runs periodically (default: every hour) to delete old events:

```sql
DELETE FROM _events WHERE created_at < now() - interval '$1 days';
```

### Multi-App

The cleanup scheduler iterates all app contexts (same pattern as webhook retry and workflow timeout schedulers).

### Configurable Per-App

Retention is configured in `app.yaml` via `instrumentation.retention_days`. Default: 7 days.

### Volume Estimates

| Scenario | Events/Request | RPS | Events/Day | Storage/Day |
|----------|---------------|-----|------------|-------------|
| Simple CRUD | ~5 | 100 | ~43M | ~21 GB |
| CRUD + webhook | ~8 | 100 | ~69M | ~34 GB |
| Simple CRUD | ~5 | 10 | ~4.3M | ~2.1 GB |
| With sampling (10%) | ~5 | 100 | ~4.3M | ~2.1 GB |

At high RPS, sampling and shorter retention are essential.

---

## Admin UI

### Event Stream Page

**Route:** `/apps/:app/events`

- Filterable data table showing events in reverse chronological order
- Columns: timestamp, source, component, action, entity, status, duration
- Color-coded rows by source:
  - `http` = blue
  - `db` = gray
  - `engine` = green
  - `auth` = purple
  - `webhook` = orange
  - `workflow` = teal
  - `storage` = brown
  - `error` status = red background
- Click any row → navigate to trace waterfall view
- Auto-refresh toggle (poll every 2s when enabled)

### Trace Waterfall Page

**Route:** `/apps/:app/events/trace/:traceId`

- Nested timeline view showing all spans for a single trace
- Each span displayed as a horizontal bar proportional to its duration
- Expandable metadata for each span
- Visual nesting via indentation (parent → child relationship)
- Total trace duration shown at top

### Stats Dashboard

**Route:** `/apps/:app/events/stats`

- Time range selector (last 1h, 6h, 24h, 7d)
- Summary cards: total requests, avg latency, error rate, p95 latency
- Breakdown table by source (count, avg duration, error rate)
- Top 10 slowest traces table (clickable → trace waterfall)

---

## Implementation Order

### Step 1: Core Library
- [ ] Event struct/type definitions
- [ ] Span implementation (start, end, metadata)
- [ ] Write buffer (in-memory accumulator with periodic flush)
- [ ] `_events` table DDL in bootstrap
- [ ] Config loading (`instrumentation` section in app.yaml)

### Step 2: HTTP Instrumentation
- [ ] Trace ID middleware (generate/accept, set response header)
- [ ] Request start/end spans (wraps every request)
- [ ] Gives immediate value — can see all requests with latency

### Step 3: DB Query Instrumentation
- [ ] Wrapper around postgres query/exec functions
- [ ] SQL fingerprinting (strip literals)
- [ ] Duration tracking

### Step 4: Write Pipeline Instrumentation
- [ ] Instrument validate, rules, state machine stages
- [ ] Instrument insert/update/delete operations
- [ ] Instrument nested write planning and child operations

### Step 5: Auth & Permission Instrumentation
- [ ] Auth middleware spans (validate, login, denied)
- [ ] Permission check spans

### Step 6: Webhook & Workflow Instrumentation
- [ ] Webhook dispatch spans (match, dispatch, success, fail)
- [ ] Workflow engine spans (trigger, advance, approve, reject, timeout)
- [ ] File storage spans

### Step 7: API Endpoints
- [ ] `POST /api/:app/_events` (emit business event)
- [ ] `GET /api/:app/_events` (query with filters + pagination)
- [ ] `GET /api/:app/_events/trace/:trace_id` (waterfall)
- [ ] `GET /api/:app/_events/stats` (aggregates)

### Step 8: Multi-App & Retention
- [ ] Retention cleanup scheduler
- [ ] Multi-app scheduler integration
- [ ] Sampling support

### Step 9: Admin UI
- [ ] Event stream page
- [ ] Trace waterfall page
- [ ] Stats dashboard

---

## What's NOT in Scope (v1)

- **Distributed tracing** — single-process only (no cross-service span propagation)
- **OTEL SDK dependency** — compatible naming only, no Collector/exporter
- **Real-time streaming** — polling-based UI, no WebSocket push
- **Per-field change tracking** — that's audit log (Phase 9), not instrumentation
- **Custom dashboards/widgets** — fixed layout for v1
- **Per-source enable/disable** — all-or-nothing via `enabled` flag
- **Alerting** — no threshold-based alerts on metrics (future phase)

---

## Files to Create/Modify

### Go (`golang/internal/`)

| File | Purpose |
|------|---------|
| `instrument/instrument.go` | Instrumenter interface, Span implementation, trace context helpers |
| `instrument/buffer.go` | Write buffer (accumulate + batch flush) |
| `instrument/handler.go` | Event API endpoints (emit, query, trace, stats) |
| `store/bootstrap.go` | Add `_events` table DDL |
| `config/config.go` | Add `InstrumentationConfig` struct |
| `engine/handler.go` | Add instrumentation spans to CRUD handlers |
| `engine/nested_write.go` | Add instrumentation spans to write pipeline |
| `engine/rules.go` | Add instrumentation spans |
| `engine/state_machine.go` | Add instrumentation spans |
| `engine/webhook.go` | Add instrumentation spans |
| `engine/workflow.go` | Add instrumentation spans |
| `auth/middleware.go` | Add instrumentation spans |
| `engine/permissions.go` | Add instrumentation spans |
| `store/postgres.go` | Wrap query/exec with instrumentation |
| `multiapp/app_routes.go` | Register event API routes |
| `multiapp/scheduler.go` | Add retention cleanup to multi-app scheduler |

### Express.js (`expressjs/src/`)

| File | Purpose |
|------|---------|
| `instrument/types.ts` | Instrumenter, Span interfaces |
| `instrument/instrument.ts` | Implementation, AsyncLocalStorage setup |
| `instrument/buffer.ts` | Write buffer with setInterval flush |
| `instrument/handler.ts` | Event API endpoints |
| `store/bootstrap.ts` | Add `_events` table DDL |
| `config/index.ts` | Add instrumentation config |
| `engine/handler.ts` | Add spans |
| `engine/nested-write.ts` | Add spans |
| `engine/rules.ts` | Add spans |
| `engine/state-machine.ts` | Add spans |
| `engine/webhook.ts` | Add spans |
| `engine/workflow.ts` | Add spans |
| `auth/middleware.ts` | Add spans |
| `auth/permissions.ts` | Add spans |
| `store/postgres.ts` | Wrap query functions |
| `multiapp/app-routes.ts` | Register event routes |
| `multiapp/scheduler.ts` | Add retention cleanup |

### Elixir (`elixir-phoenix/lib/`)

| File | Purpose |
|------|---------|
| `rocket/instrument/instrument.ex` | Behaviour, Span struct, helpers |
| `rocket/instrument/buffer.ex` | GenServer write buffer |
| `rocket_web/controllers/event_controller.ex` | Event API endpoints |
| `rocket/store/bootstrap.ex` | Add `_events` table DDL |
| `rocket/config.ex` | Add instrumentation config |
| `rocket_web/controllers/engine_controller.ex` | Add spans |
| `rocket/engine/nested_write.ex` | Add spans |
| `rocket/engine/rules.ex` | Add spans |
| `rocket/engine/state_machine.ex` | Add spans |
| `rocket/engine/webhook.ex` | Add spans |
| `rocket/engine/workflow.ex` | Add spans |
| `rocket_web/plugs/auth_plug.ex` | Add spans |
| `rocket/auth/permissions.ex` | Add spans |
| `rocket/store/postgres.ex` | Wrap query functions |
| `rocket_web/router.ex` | Register event routes |
| `rocket/multiapp/scheduler.ex` | Add retention cleanup |

### Admin UI (`admin/src/`)

| File | Purpose |
|------|---------|
| `pages/EventStream.tsx` | Event list page with filters |
| `pages/TraceWaterfall.tsx` | Trace detail with nested timeline |
| `pages/EventStats.tsx` | Stats dashboard |
| `api/events.ts` | API client for event endpoints |
| `types/event.ts` | TypeScript types |
| `App.tsx` | Add routes |
| `components/Sidebar.tsx` | Add navigation item |
