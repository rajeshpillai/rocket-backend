# Rocket Backend — Scalability Architecture Review

**Review Date:** February 9, 2026  
**Focus:** High RPS, High Throughput, Production Scale  
**Scope:** Architectural patterns and processes for scaling beyond single-server deployment

---

## Executive Summary

The current Rocket Backend architecture is **excellent for small-to-medium deployments** (up to ~1,000 RPS per server). To scale to **high RPS (10K-100K+) and high throughput**, significant architectural enhancements are required.

### Current Architecture Limitations

| Component | Current Design | Bottleneck at Scale |
|-----------|----------------|---------------------|
| **Database** | Single Postgres per app | Write contention, connection exhaustion |
| **Metadata Registry** | In-memory cache | No distributed cache, cold starts |
| **File Storage** | Local disk | No shared storage, single point of failure |
| **Webhooks** | Background goroutines/tasks | No guaranteed delivery, no backpressure, unbounded concurrency |
| **Workflows** | Polling scheduler (60s) | Inefficient, high latency |
| **Write Pipeline** | Synchronous (validate → write → log → respond) | Non-critical writes (audit, webhook logs) block the response path |
| **Auth** | JWT validation on every request | CPU overhead, no session cache |

---

## Scalability Roadmap

### Phase 1: Database Optimization (Foundation)
### Phase 2: Caching Layer (Performance)
### Phase 3: Async Processing (Throughput)
### Phase 4: Horizontal Scaling (RPS)
### Phase 5: Advanced Patterns (Enterprise Scale)

---

## Phase 1: Database Optimization

### 🔴 Critical Issues

#### 1.1 Connection Pool Exhaustion

**Current:**
```yaml
app_pool_size: 10  # Per-app database pool
```

**Problem:** At 1,000 RPS with 100ms avg query time:
- Concurrent queries: 1,000 × 0.1 = 100 (assuming 1 query/request; real requests often run 2-5 queries in a transaction, so actual concurrency is higher)
- Pool size: 10
- **Result:** Connection starvation, request queuing

**Solution:**
```yaml
# Dynamic pool sizing based on load
app_pool_size: 50  # Increase per-app pool
max_pool_size: 200  # Global limit across all apps
pool_timeout: 5s    # Fail fast instead of queuing
```

**Implementation:**
- Add connection pool metrics (active, idle, waiting)
- Auto-scale pool size based on queue depth
- Use PgBouncer for connection pooling (transaction mode)

#### 1.2 Read/Write Separation

**Current:** All queries hit primary database

**Solution: Read Replicas**
```
┌─────────────┐
│   Primary   │ ← Writes only
│  (Postgres) │
└──────┬──────┘
       │ Replication
       ├──────────────┬──────────────┐
       ▼              ▼              ▼
  ┌─────────┐   ┌─────────┐   ┌─────────┐
  │ Replica │   │ Replica │   │ Replica │ ← Reads
  └─────────┘   └─────────┘   └─────────┘
```

**Implementation:**
```go
// Store with read/write separation
type Store struct {
    primary  *pgxpool.Pool  // Writes
    replicas []*pgxpool.Pool  // Reads (round-robin)
}

func (s *Store) Query(ctx context.Context, sql string, args ...any) {
    // Route to replica
    replica := s.replicas[s.nextReplica()]
    return replica.Query(ctx, sql, args...)
}

func (s *Store) Exec(ctx context.Context, sql string, args ...any) {
    // Route to primary
    return s.primary.Exec(ctx, sql, args...)
}
```

**Benefits:**
- 3× read capacity with 3 replicas
- Reduced primary load
- Geographic distribution possible

#### 1.3 Query Optimization

**Current Issues:**
- No explicit prepared statement caching (note: Go's pgx driver has implicit prepared statement caching built-in; this is more relevant for Express.js using the `pg` driver)
- Includes already batch by parent IDs (`WHERE source_key = ANY($1)`), but further optimization is possible (e.g., multi-relation batch loading in a single round-trip)
- Full table scans on filters (no automatic indexing of filterable fields)

**Solutions:**

**A. Prepared Statement Cache (Express.js / Elixir)**

Go's pgx driver handles this automatically. For Express.js and Elixir, consider explicit statement preparation for hot-path queries:
```go
type PreparedStmtCache struct {
    cache map[string]*pgconn.StatementDescription
    mu    sync.RWMutex
}

func (c *PreparedStmtCache) Get(sql string) (*pgconn.StatementDescription, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    stmt, ok := c.cache[sql]
    return stmt, ok
}
```

**B. Optimize Includes (reduce round-trips)**

Includes already batch correctly — each relation fires one query with `WHERE key = ANY(parentIDs)`. Further optimization could combine multiple relation includes into a single database round-trip:
```go
// Current: 1 query per included relation (already batched by parent IDs)
// e.g., include=items,tags → 2 queries (one for items, one for tags)

// Further optimization: pipeline multiple relation queries
pipeline := pgx.Pipeline{}
pipeline.Queue(itemsSQL, parentIDs)
pipeline.Queue(tagsSQL, parentIDs)
results := pipeline.Execute()  // 1 round-trip for all relations
```

**C. Automatic Indexing**
```go
// Auto-create indexes on filter fields
func (m *Migrator) EnsureIndexes(entity *Entity) error {
    for _, field := range entity.Fields {
        if field.Indexed || field.Unique {
            sql := fmt.Sprintf("CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_%s_%s ON %s (%s)",
                entity.Table, field.Name, entity.Table, field.Name)
            m.exec(sql)
        }
    }
}
```

#### 1.4 Database Sharding (10K+ RPS)

**When:** Single database can't handle write load within a single app

**Current state:** The project already uses database-per-app isolation (Phase 6) — each app gets its own PostgreSQL database (`rocket_{appname}`). This provides natural fault isolation and independent scaling per app.

**Next step: Within-app sharding** for apps that outgrow a single database:
```
App "ecommerce" (high volume) →
  rocket_ecommerce_shard_0  (customers A-M)
  rocket_ecommerce_shard_1  (customers N-Z)
```

**Implementation:**
```go
type ShardRouter struct {
    shards map[string][]*Store  // app_name → shard list
}

func (r *ShardRouter) GetShard(appName string, shardKey string) *Store {
    shards := r.shards[appName]
    idx := hash(shardKey) % len(shards)
    return shards[idx]
}
```

**Benefits:**
- Horizontal write scaling within a single high-traffic app
- Fault isolation already exists at the app level (database-per-app)
- Independent backups/maintenance per shard

---

## Phase 2: Caching Layer

### 🟡 High Impact Optimizations

#### 2.1 Metadata Registry Cache (Redis)

**Current:** In-memory registry per server (cold start on restart)

**Problem:**
- Metadata loaded from DB on every server start
- No cache invalidation across servers
- Stale metadata on updates

**Solution: Distributed Cache**
```
┌──────────────┐
│    Redis     │ ← Metadata cache (entities, relations, rules)
│  (Cluster)   │
└──────┬───────┘
       │
   ┌───┴───┬───────┬───────┐
   ▼       ▼       ▼       ▼
 Server  Server  Server  Server
```

**Implementation:**
```go
type CachedRegistry struct {
    redis  *redis.Client
    local  *sync.Map  // L1 cache (in-memory)
    ttl    time.Duration
}

func (r *CachedRegistry) GetEntity(name string) (*Entity, error) {
    // L1: Check local cache
    if entity, ok := r.local.Load(name); ok {
        return entity.(*Entity), nil
    }
    
    // L2: Check Redis
    key := fmt.Sprintf("entity:%s", name)
    data, err := r.redis.Get(ctx, key).Bytes()
    if err == nil {
        entity := unmarshal(data)
        r.local.Store(name, entity)  // Populate L1
        return entity, nil
    }
    
    // L3: Load from database
    entity := r.loadFromDB(name)
    r.redis.Set(ctx, key, marshal(entity), r.ttl)  // Cache in Redis
    r.local.Store(name, entity)  // Cache locally
    return entity, nil
}

// Cache invalidation on metadata updates
func (r *CachedRegistry) InvalidateEntity(name string) {
    r.local.Delete(name)
    r.redis.Del(ctx, fmt.Sprintf("entity:%s", name))
    // Pub/Sub to notify other servers
    r.redis.Publish(ctx, "metadata:invalidate", name)
}
```

**Benefits:**
- Fast cold starts (metadata already in Redis)
- Consistent cache across servers
- Reduced database load

#### 2.2 Query Result Cache

**Use Case:** Frequently accessed, rarely changing data

**Implementation:**
```go
func (h *Handler) List(c *fiber.Ctx) error {
    entity := h.resolveEntity(c)
    
    // Generate cache key from query params
    cacheKey := fmt.Sprintf("query:%s:%s", entity.Name, hashQueryParams(c))
    
    // Check cache
    if cached, err := h.cache.Get(cacheKey); err == nil {
        return c.JSON(cached)
    }
    
    // Execute query
    result := h.executeQuery(entity, c)
    
    // Cache result (5 min TTL)
    h.cache.Set(cacheKey, result, 5*time.Minute)
    
    return c.JSON(result)
}
```

**Cache Invalidation:**
```go
// Invalidate on writes
func (h *Handler) Create(c *fiber.Ctx) error {
    entity := h.resolveEntity(c)
    record := h.executeWrite(entity, c.Body())
    
    // Invalidate all cached queries for this entity
    h.cache.DeletePattern(fmt.Sprintf("query:%s:*", entity.Name))
    
    return c.JSON(record)
}
```

#### 2.3 CDN for Static Assets

**File Uploads:** Move from local disk to S3 + CloudFront

```
┌─────────┐
│ Browser │
└────┬────┘
     │ GET /files/abc123
     ▼
┌────────────┐
│ CloudFront │ ← Edge cache (global)
└─────┬──────┘
      │ Cache miss
      ▼
┌──────────┐
│ S3 Bucket│ ← Object storage
└──────────┘
```

**Implementation:**
```go
type S3Storage struct {
    client *s3.Client
    bucket string
    cdn    string  // CloudFront URL
}

func (s *S3Storage) GetURL(fileID string) string {
    // Return CDN URL instead of direct S3
    return fmt.Sprintf("%s/%s", s.cdn, fileID)
}
```

---

## Phase 3: Async Processing

### 🟢 Throughput Improvements

#### 3.1 Message Queue for Webhooks

**Current:** Fire webhooks in background goroutines/tasks

**Problem:**
- No guaranteed delivery
- No retry visibility
- Memory pressure on high volume

**Solution: Message Queue (RabbitMQ, SQS, Kafka)**
```
┌──────────┐
│  Write   │
│ Pipeline │
└────┬─────┘
     │ Publish webhook event
     ▼
┌──────────────┐
│ Message Queue│
└──────┬───────┘
       │ Consume
       ▼
┌──────────────┐
│   Webhook    │ ← Dedicated workers
│   Workers    │   (auto-scale based on queue depth)
└──────────────┘
```

**Implementation:**
```go
// Publish webhook event
func (w *WebhookEngine) Dispatch(hook *Webhook, payload map[string]any) {
    event := WebhookEvent{
        HookID:    hook.ID,
        URL:       hook.URL,
        Payload:   payload,
        Timestamp: time.Now(),
    }
    w.queue.Publish("webhooks", event)
}

// Worker consumes events
func (w *WebhookWorker) Start() {
    w.queue.Subscribe("webhooks", func(event WebhookEvent) {
        w.sendHTTP(event.URL, event.Payload)
    })
}
```

**Benefits:**
- Guaranteed delivery (at-least-once)
- Backpressure handling (queue buffers spikes)
- Horizontal scaling (add more workers)
- Visibility (queue depth metrics)

#### 3.2 Event-Driven Workflows

**Current:** Polling scheduler checks every 60s

**Problem:**
- High latency (up to 60s delay)
- Inefficient (queries all instances every tick)

**Solution: Event-Driven**
```
┌──────────┐
│ Approval │
│  Action  │
└────┬─────┘
     │ Publish event
     ▼
┌──────────────┐
│ Event Stream │ (Kafka, NATS)
└──────┬───────┘
       │ Subscribe
       ▼
┌──────────────┐
│  Workflow    │ ← Reacts to events
│   Engine     │   (no polling)
└──────────────┘
```

**Implementation:**
```go
// Publish approval event
func (w *WorkflowHandler) Approve(instanceID string) {
    w.events.Publish("workflow.approved", WorkflowEvent{
        InstanceID: instanceID,
        Timestamp:  time.Now(),
    })
}

// Workflow engine subscribes
func (e *WorkflowEngine) Start() {
    e.events.Subscribe("workflow.approved", func(event WorkflowEvent) {
        e.advanceWorkflow(event.InstanceID)
    })
}
```

**Benefits:**
- Near-instant reaction (no polling delay)
- Reduced database load (no periodic queries)
- Event sourcing (audit trail built-in)

#### 3.3 Batch Processing

**Use Case:** Bulk operations, data imports

**Implementation:**
```go
// Batch create endpoint
func (h *Handler) BatchCreate(c *fiber.Ctx) error {
    var records []map[string]any
    c.BodyParser(&records)
    
    // Process in batches of 100
    batchSize := 100
    for i := 0; i < len(records); i += batchSize {
        batch := records[i:min(i+batchSize, len(records))]
        h.processBatch(batch)
    }
}

func (h *Handler) processBatch(records []map[string]any) {
    // Single transaction for entire batch
    tx := h.store.Begin()
    defer tx.Rollback()

    for _, record := range records {
        h.insertRecord(tx, record)
    }

    tx.Commit()
}
```

#### 3.4 Async Write Buffer (Write-Behind Pattern)

**Current:** Every write operation in the pipeline is synchronous — the HTTP response waits for all database writes to complete, including non-critical ones like webhook logs and (future) audit logs.

**Problem at high RPS:**
- Webhook log INSERT blocks the response even though the client doesn't need it
- Future audit logs will add another synchronous INSERT per write
- At 10K RPS, these "fire-and-forget" writes double the connection pool pressure

**Solution: In-memory write buffer that flushes to the database in batches**

```
┌──────────┐     ┌─────────────┐     ┌──────────┐
│  Write   │────▶│ Write Buffer│────▶│ Postgres │
│ Pipeline │     │ (in-memory) │     │ (batch)  │
└──────────┘     └─────────────┘     └──────────┘
     │                  │
     │ Respond 200      │ Flush every 100ms
     │ immediately      │ or every 500 rows
     ▼                  ▼
  Client             Background
```

**Implementation:**
```go
type WriteBuffer struct {
    mu      sync.Mutex
    items   []BufferedWrite
    maxSize int           // Flush at this count (e.g., 500)
    maxAge  time.Duration // Flush at this interval (e.g., 100ms)
    store   *Store
}

type BufferedWrite struct {
    SQL    string
    Args   []any
    Table  string
}

// Non-blocking enqueue — caller doesn't wait for DB write
func (b *WriteBuffer) Enqueue(sql string, args []any, table string) {
    b.mu.Lock()
    b.items = append(b.items, BufferedWrite{SQL: sql, Args: args, Table: table})
    shouldFlush := len(b.items) >= b.maxSize
    b.mu.Unlock()

    if shouldFlush {
        go b.Flush()
    }
}

// Batch flush — single transaction for all buffered writes
func (b *WriteBuffer) Flush() {
    b.mu.Lock()
    if len(b.items) == 0 {
        b.mu.Unlock()
        return
    }
    batch := b.items
    b.items = make([]BufferedWrite, 0, b.maxSize)
    b.mu.Unlock()

    tx := b.store.Begin()
    defer tx.Rollback()

    for _, w := range batch {
        tx.Exec(w.SQL, w.Args...)
    }
    tx.Commit()
}

// Background ticker — ensures data is written even under low load
func (b *WriteBuffer) Start() {
    ticker := time.NewTicker(b.maxAge)
    for range ticker.C {
        b.Flush()
    }
}
```

**Usage in the write pipeline:**
```go
// Before (synchronous — blocks response):
LogWebhookDelivery(ctx, db, webhook, payload, result)  // INSERT INTO _webhook_logs

// After (fire-and-forget — response returns immediately):
writeBuffer.Enqueue(webhookLogSQL, webhookLogArgs, "_webhook_logs")
```

**Applicable to these tables:**
| Table | Current | Buffered? | Why |
|-------|---------|-----------|-----|
| `_webhook_logs` | Sync INSERT per dispatch | Yes | Client doesn't need log confirmation |
| `_audit_logs` (Phase 8) | N/A (not built yet) | Yes | Non-critical for response, write-heavy |
| `_workflow_instances` history | Sync JSONB append | Partial | History append can be deferred |
| Business tables | Sync INSERT/UPDATE | No | Client needs confirmation |

**Benefits:**
- **5-10× fewer DB round-trips** (500 individual INSERTs → 1 batched transaction)
- **Response latency drops** (no waiting for non-critical writes)
- **Connection pool pressure reduced** (batch uses 1 connection instead of 500)

**Elixir-specific:** Use `GenServer` with `handle_cast` for the buffer + `Process.send_after` for periodic flush. BEAM's message passing gives you natural backpressure.

**Express.js-specific:** Use an in-process array with `setInterval` for periodic flush. Consider `pg`'s `COPY` stream API for bulk inserts.

#### 3.5 202 Accepted Pattern (Deferred Processing)

**Use Case:** Writes where the client doesn't need the final result immediately — bulk imports, webhook-triggered side effects, report generation.

**Current:** All writes are synchronous — the response includes the created/updated record.

**Solution: Accept immediately, process asynchronously, provide status endpoint**

```
Client                    Server                     Background
  │                         │                           │
  │  POST /api/app/entity   │                           │
  │ ───────────────────────▶│                           │
  │                         │ Validate payload          │
  │                         │ Enqueue job               │
  │  202 Accepted           │                           │
  │  {job_id: "abc123"}     │                           │
  │ ◀───────────────────────│                           │
  │                         │ ────▶ Process write ──────▶│
  │                         │                           │ INSERT/UPDATE
  │  GET /api/app/_jobs/abc │                           │
  │ ───────────────────────▶│                           │
  │  {status: "completed",  │                           │
  │   result: {...}}        │                           │
  │ ◀───────────────────────│                           │
```

**Implementation:**
```go
func (h *Handler) AsyncCreate(c *fiber.Ctx) error {
    entity := h.resolveEntity(c)
    body := c.Body()

    // Fast validation (schema check, required fields) — synchronous
    if err := h.validatePayload(entity, body); err != nil {
        return c.Status(422).JSON(err)
    }

    // Enqueue for background processing
    jobID := uuid.New().String()
    h.queue.Publish("writes", WriteJob{
        ID:     jobID,
        Entity: entity.Name,
        Action: "create",
        Body:   body,
        UserID: getUserID(c),
    })

    // Respond immediately
    return c.Status(202).JSON(fiber.Map{
        "job_id": jobID,
        "status": "accepted",
        "poll":   fmt.Sprintf("/api/%s/_jobs/%s", getApp(c), jobID),
    })
}
```

**When to use 202 vs 200:**
| Scenario | Response | Why |
|----------|----------|-----|
| Single record create/update | 200 (sync) | Client typically needs the created ID |
| Bulk import (100+ records) | 202 (async) | Processing takes too long for a single request |
| Webhook-triggered writes | 202 (async) | External caller just needs acknowledgment |
| Report generation | 202 (async) | Computation-heavy, results polled later |

#### 3.6 Circuit Breaker (External Service Protection)

**Current:** Webhook dispatch retries indefinitely with exponential backoff. If a downstream service is down, every webhook attempt opens a connection, waits for timeout, and fails.

**Problem at high RPS:**
- 1,000 webhooks/s to a down service = 1,000 connections held until timeout
- Goroutine/task leak (each attempt blocks for timeout duration)
- Connection pool starvation for other work

**Solution: Circuit breaker per webhook URL**

```
┌──────────┐
│  Closed  │ ← Normal operation (requests pass through)
│          │
└────┬─────┘
     │ N failures in window
     ▼
┌──────────┐
│   Open   │ ← Fail fast (no HTTP call, immediate error)
│          │   Duration: 30s-5min
└────┬─────┘
     │ Timer expires
     ▼
┌──────────┐
│Half-Open │ ← Allow 1 probe request
│          │   Success → Closed, Failure → Open
└──────────┘
```

**Implementation:**
```go
type CircuitBreaker struct {
    mu           sync.Mutex
    state        string // "closed", "open", "half_open"
    failures     int
    threshold    int           // Open after N failures (e.g., 5)
    resetTimeout time.Duration // How long to stay open (e.g., 60s)
    lastFailure  time.Time
}

func (cb *CircuitBreaker) Allow() bool {
    cb.mu.Lock()
    defer cb.mu.Unlock()

    switch cb.state {
    case "closed":
        return true
    case "open":
        if time.Since(cb.lastFailure) > cb.resetTimeout {
            cb.state = "half_open"
            return true // Allow probe
        }
        return false // Fail fast
    case "half_open":
        return false // Only one probe at a time
    }
    return false
}

func (cb *CircuitBreaker) RecordSuccess() {
    cb.mu.Lock()
    cb.state = "closed"
    cb.failures = 0
    cb.mu.Unlock()
}

func (cb *CircuitBreaker) RecordFailure() {
    cb.mu.Lock()
    cb.failures++
    cb.lastFailure = time.Now()
    if cb.failures >= cb.threshold {
        cb.state = "open"
    }
    cb.mu.Unlock()
}

// Usage in webhook dispatch
func (w *WebhookEngine) dispatchWithCircuitBreaker(hook *Webhook, payload map[string]any) {
    cb := w.getBreaker(hook.URL) // One breaker per destination URL

    if !cb.Allow() {
        // Log as "circuit_open", don't attempt HTTP call
        w.logSkipped(hook, "circuit_open")
        return
    }

    result := w.sendHTTP(hook.URL, payload)
    if result.Success {
        cb.RecordSuccess()
    } else {
        cb.RecordFailure()
    }
}
```

**Benefits:**
- Prevents connection/goroutine leak to down services
- Fail-fast (microseconds instead of 30s timeout)
- Auto-recovery when downstream service comes back
- Metrics visibility (circuit state per URL)

#### 3.7 Bounded Worker Pool with Backpressure

**Current:** Async webhooks spawn unbounded goroutines (`go func()`) / tasks (`Task.start`). Under high load, this can exhaust memory.

**Problem:**
```go
// Current: unbounded — 10K webhooks = 10K goroutines
for _, wh := range matchingWebhooks {
    go func(wh *Webhook) {
        dispatchWebhook(wh, payload)  // Each holds a connection + memory
    }(wh)
}
```

**Solution: Fixed-size worker pool with buffered channel**

```go
type WorkerPool struct {
    jobs    chan func()
    workers int
    metrics *PoolMetrics
}

func NewWorkerPool(workers, queueSize int) *WorkerPool {
    pool := &WorkerPool{
        jobs:    make(chan func(), queueSize),
        workers: workers,
        metrics: &PoolMetrics{},
    }
    for i := 0; i < workers; i++ {
        go pool.worker()
    }
    return pool
}

func (p *WorkerPool) worker() {
    for job := range p.jobs {
        job()
    }
}

// Submit returns false if queue is full (backpressure signal)
func (p *WorkerPool) Submit(job func()) bool {
    select {
    case p.jobs <- job:
        return true
    default:
        p.metrics.Rejected++
        return false // Queue full — caller can log, retry later, or drop
    }
}

// Usage:
webhookPool := NewWorkerPool(50, 10000) // 50 workers, 10K queue depth

for _, wh := range matchingWebhooks {
    hook := wh
    if !webhookPool.Submit(func() { dispatchWebhook(hook, payload) }) {
        // Queue full — log to _webhook_logs as "deferred" for retry scheduler
        logDeferredWebhook(hook, payload)
    }
}
```

**Sizing guidelines:**

| Scenario | Workers | Queue Depth | Rationale |
|----------|---------|-------------|-----------|
| Webhook dispatch | 50 | 10,000 | Each worker holds 1 HTTP connection; 50 concurrent outbound calls |
| Audit log writes | 10 | 50,000 | Batched, low latency per write |
| Notification dispatch | 20 | 5,000 | SMTP can be slow; limit concurrency |

**Elixir-specific:** Use `Task.Supervisor` with `max_children` for bounded concurrency. BEAM's scheduler provides natural backpressure via process mailbox limits.

**Express.js-specific:** Use `p-limit` or `p-queue` for bounded concurrency, since Node.js is single-threaded and unbounded `Promise.all` can exhaust event loop time.

#### 3.8 PostgreSQL Write Throughput Tuning

**For fire-and-forget tables** (webhook logs, audit logs, activity streams) where durability guarantees can be relaxed:

**A. `synchronous_commit = off` (per-transaction)**

By default, PostgreSQL waits for WAL flush to disk before confirming a commit. For non-critical tables, disable this per-transaction to get 2-5× write throughput:

```go
func (b *WriteBuffer) FlushAsync() {
    tx := b.store.Begin()
    defer tx.Rollback()

    // Relax durability for this transaction only
    // Data may be lost on server crash (last ~200ms of writes)
    tx.Exec("SET LOCAL synchronous_commit = off")

    for _, w := range batch {
        tx.Exec(w.SQL, w.Args...)
    }
    tx.Commit()
}
```

**Risk:** If PostgreSQL crashes (not the app — the database server itself), up to ~200ms of committed transactions may be lost. Acceptable for logs, not for business data.

**B. COPY protocol for bulk inserts**

PostgreSQL's `COPY` is 5-10× faster than individual INSERTs for batch operations:

```go
// Instead of 500 individual INSERTs:
func (b *WriteBuffer) FlushWithCopy(rows []WebhookLog) {
    conn := b.store.Acquire()
    defer conn.Release()

    _, err := conn.CopyFrom(
        ctx,
        pgx.Identifier{"_webhook_logs"},
        []string{"webhook_id", "entity", "hook", "url", "status", "created_at"},
        pgx.CopyFromSlice(len(rows), func(i int) ([]any, error) {
            r := rows[i]
            return []any{r.WebhookID, r.Entity, r.Hook, r.URL, r.Status, r.CreatedAt}, nil
        }),
    )
}
```

**C. Unlogged tables (extreme throughput)**

For truly ephemeral data (e.g., real-time metrics, session scratch):
```sql
CREATE UNLOGGED TABLE _metrics_buffer (...);
-- No WAL writes, not replicated, lost on crash. 10-20× faster writes.
```

**When to use each approach:**

| Technique | Speedup | Data Loss Risk | Use For |
|-----------|---------|----------------|---------|
| Normal INSERT | 1× | None | Business records |
| `synchronous_commit = off` | 2-5× | ~200ms on DB crash | Webhook logs, audit logs |
| COPY protocol | 5-10× | None (just faster) | Batch imports, buffer flush |
| Unlogged tables | 10-20× | All data on crash | Metrics buffers, scratch tables |

#### 3.9 Idempotency for At-Least-Once Delivery

**Problem:** Fire-and-forget with retries can cause duplicate processing. If a webhook dispatch succeeds but the log write fails, the retry scheduler will re-dispatch.

**Current:** `_webhook_logs` has an `idempotency_key` column but it's not used as a dedup mechanism.

**Solution: Check idempotency key before processing**

```go
func (w *WebhookWorker) Process(event WebhookEvent) {
    // Dedup check — skip if already processed
    key := fmt.Sprintf("%s:%s:%s", event.HookID, event.Entity, event.RecordID)
    if w.store.Exists("SELECT 1 FROM _webhook_logs WHERE idempotency_key = $1 AND status = 'delivered'", key) {
        return // Already delivered, skip
    }

    result := w.sendHTTP(event.URL, event.Payload)
    w.logDelivery(event, result, key)
}
```

**For business writes via 202 pattern:**
```go
func (h *Handler) AsyncCreate(c *fiber.Ctx) error {
    // Client provides idempotency key via header
    idempotencyKey := c.Get("Idempotency-Key")
    if idempotencyKey != "" {
        if existing := h.getJobByKey(idempotencyKey); existing != nil {
            return c.Status(200).JSON(existing) // Return cached result
        }
    }
    // ... enqueue job with idempotency key
}
```

#### 3.10 Load Shedding

**Problem:** When queue depth exceeds capacity, continuing to accept requests degrades performance for everyone. Better to reject early than to queue indefinitely.

**Implementation:**
```go
func loadSheddingMiddleware(pool *WorkerPool) fiber.Handler {
    return func(c *fiber.Ctx) error {
        queueDepth := len(pool.jobs)
        queueCapacity := cap(pool.jobs)
        utilization := float64(queueDepth) / float64(queueCapacity)

        // Shed load when queue is >80% full
        if utilization > 0.8 {
            return c.Status(503).JSON(fiber.Map{
                "error": fiber.Map{
                    "code":    "SERVICE_OVERLOADED",
                    "message": "Server is at capacity, please retry later",
                },
            })
        }

        // Add queue depth to response headers for client visibility
        c.Set("X-Queue-Depth", fmt.Sprintf("%d", queueDepth))
        c.Set("X-Queue-Capacity", fmt.Sprintf("%d", queueCapacity))

        return c.Next()
    }
}
```

**Client-side retry with backoff:**
```
Retry-After: 5  ← Server hints when to retry (seconds)
```

---

## Phase 4: Horizontal Scaling

### 🔵 RPS Scaling

#### 4.1 Stateless Application Servers

**Current:** Stateless (good!) but needs optimization

**Load Balancer Setup:**
```
                    ┌─────────────┐
Internet ──────────▶│ Load Balancer│
                    │  (NGINX/ALB) │
                    └──────┬───────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
   ┌─────────┐        ┌─────────┐        ┌─────────┐
   │ Server 1│        │ Server 2│        │ Server 3│
   └─────────┘        └─────────┘        └─────────┘
```

**Health Checks:**
```go
app.Get("/health", func(c *fiber.Ctx) error {
    // Check database connectivity
    if err := store.Ping(); err != nil {
        return c.Status(503).JSON(fiber.Map{"status": "unhealthy"})
    }
    
    // Check Redis connectivity
    if err := redis.Ping(); err != nil {
        return c.Status(503).JSON(fiber.Map{"status": "unhealthy"})
    }
    
    return c.JSON(fiber.Map{"status": "healthy"})
})
```

#### 4.2 Session Management

**Current:** JWT (stateless) ✅

**Optimization: Token Revocation Cache**

Note: HS256 signature verification is a single HMAC operation (~microseconds), so caching decoded JWTs for performance provides negligible benefit and adds a Redis network round-trip. The real value of a session cache is **centralized token revocation** — the ability to invalidate a token before it expires (e.g., on password change, account lock, or logout).

```go
// Cache for token revocation checks (not for JWT validation speed)
type SessionCache struct {
    cache *redis.Client
}

func (s *SessionCache) ValidateToken(token string) (*UserContext, error) {
    // Check if token has been revoked
    key := fmt.Sprintf("revoked:%s", hash(token))
    if _, err := s.cache.Get(key).Result(); err == nil {
        return nil, ErrTokenRevoked
    }

    // Validate JWT (fast — local HMAC operation)
    user := validateJWT(token)
    return user, nil
}

func (s *SessionCache) RevokeToken(token string, ttl time.Duration) {
    key := fmt.Sprintf("revoked:%s", hash(token))
    s.cache.Set(key, "1", ttl)  // TTL matches token expiry
}
```

#### 4.3 Rate Limiting (Per-User)

**Implementation:**
```go
func rateLimitMiddleware(redis *redis.Client) fiber.Handler {
    return func(c *fiber.Ctx) error {
        user := getUser(c)
        key := fmt.Sprintf("ratelimit:%s", user.ID)
        
        // Sliding window: 1000 requests per hour
        count := redis.Incr(ctx, key).Val()
        if count == 1 {
            redis.Expire(ctx, key, 1*time.Hour)
        }
        
        if count > 1000 {
            return c.Status(429).JSON(fiber.Map{
                "error": "Rate limit exceeded",
            })
        }
        
        return c.Next()
    }
}
```

---

## Phase 5: Advanced Patterns

### 🟣 Enterprise Scale (100K+ RPS)

#### 5.1 CQRS (Command Query Responsibility Segregation)

**Separate read and write models:**

```
┌─────────┐
│  Write  │ ──▶ Primary DB ──▶ Event Stream
│  Model  │                         │
└─────────┘                         │
                                    ▼
┌─────────┐                  ┌──────────┐
│  Read   │ ◀──────────────  │ Read DB  │
│  Model  │                  │(Postgres,│
└─────────┘                  │Elastic)  │
                             └──────────┘
```

**Benefits:**
- Optimized read models (denormalized, indexed)
- Independent scaling (read vs write)
- Event sourcing (full audit trail)

#### 5.2 GraphQL Federation

**Use Case:** Complex queries, reduce over-fetching

```graphql
type Customer {
  id: ID!
  name: String!
  orders: [Order!]!  # Nested fetch
}

query {
  customer(id: "123") {
    name
    orders {
      total
      items {
        product { name }
      }
    }
  }
}
```

**Implementation:** Apollo Federation over REST API

#### 5.3 Edge Computing

**Deploy to edge locations (Cloudflare Workers, Lambda@Edge):**

```
User (Tokyo) ──▶ Edge (Tokyo) ──▶ Cache hit (0ms DB)
User (NYC)   ──▶ Edge (NYC)   ──▶ Cache hit (0ms DB)
```

**Benefits:**
- Sub-10ms latency globally
- Reduced origin load
- DDoS protection

---

## Monitoring & Observability

### Essential Metrics

#### Application Metrics
```go
// Prometheus metrics
var (
    requestDuration = prometheus.NewHistogramVec(
        prometheus.HistogramOpts{
            Name: "http_request_duration_seconds",
            Buckets: []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5},
        },
        []string{"method", "endpoint", "status"},
    )
    
    dbConnections = prometheus.NewGaugeVec(
        prometheus.GaugeOpts{
            Name: "db_connections",
        },
        []string{"state"},  // active, idle, waiting
    )
)
```

#### Database Metrics
- Query latency (p50, p95, p99)
- Connection pool utilization
- Slow query log (>100ms)
- Replication lag

#### Cache Metrics
- Hit rate (target: >90%)
- Eviction rate
- Memory usage

#### Alert Thresholds
```yaml
alerts:
  - name: HighErrorRate
    condition: error_rate > 1%
    duration: 5m
    
  - name: HighLatency
    condition: p95_latency > 500ms
    duration: 5m
    
  - name: DatabaseConnections
    condition: db_connections_waiting > 10
    duration: 1m
```

---

## Performance Benchmarks

### Target Metrics

| Metric | Current | Target (Optimized) |
|--------|---------|-------------------|
| **RPS per server** | ~1,000 | 10,000+ |
| **p95 Latency** | ~200ms | <50ms |
| **p95 Latency (fire-and-forget writes)** | ~200ms | <10ms (async buffer) |
| **Database connections** | 10/app | 50/app + replicas |
| **DB writes per webhook** | 1 INSERT/dispatch | 1 batch INSERT/500 dispatches |
| **Cache hit rate** | 0% (no cache) | >90% |
| **Webhook throughput** | ~100/s (unbounded goroutines) | 10,000/s (bounded pool + queue) |
| **Webhook failure mode** | Timeout (30s hold) | Circuit breaker (fail-fast <1ms) |

### Load Testing

```bash
# Apache Bench
ab -n 100000 -c 100 http://localhost:8080/api/myapp/customer

# k6 (realistic scenarios)
k6 run --vus 1000 --duration 5m load-test.js
```

---

## Implementation Priority

### Immediate (Week 1-2)
1. [ ] Add database connection pool metrics
2. [ ] Implement bounded worker pool for webhooks (replace unbounded `go func()` / `Task.start`)
3. [ ] Add async write buffer for `_webhook_logs` (write-behind pattern)
4. [ ] Add circuit breaker for webhook dispatch

### Short-term (Month 1)
5. [ ] Implement prepared statement cache (Express.js / Elixir — pgx handles this for Go)
6. [ ] Add Redis for metadata cache
7. [ ] Add automatic indexing for filterable/sortable fields
8. [ ] PostgreSQL write tuning (`synchronous_commit = off` for log tables, COPY for batch flush)
9. [ ] Add load shedding middleware (503 when queue > 80% full)

### Medium-term (Quarter 1)
10. [ ] Move to message queue for webhooks (RabbitMQ / SQS / Kafka)
11. [ ] Set up read replicas
12. [ ] Implement query result cache
13. [ ] Add rate limiting
14. [ ] 202 Accepted pattern for bulk operations
15. [ ] Idempotency key enforcement for at-least-once delivery

### Long-term (Year 1)
16. [ ] Implement CQRS for high-traffic entities
17. [ ] Within-app sharding (database-per-app already exists)
18. [ ] Move files to S3 + CDN
19. [ ] Event-driven workflows (replace polling schedulers)
20. [ ] GraphQL federation
21. [ ] Edge computing deployment
22. [ ] Advanced monitoring/tracing

---

## Cost Implications

### Infrastructure Costs (10K RPS)

| Component | Current | Scaled | Monthly Cost |
|-----------|---------|--------|--------------|
| **App Servers** | 1 × $50 | 5 × $50 | $250 |
| **Database** | 1 × $100 | 1 primary + 3 replicas × $100 | $400 |
| **Redis** | - | 1 cluster × $50 | $50 |
| **Message Queue** | - | 1 × $30 | $30 |
| **S3 + CDN** | - | ~$100/TB | $100 |
| **Load Balancer** | - | 1 × $20 | $20 |
| **Total** | $150 | | **$850** |

**ROI:** 10× capacity increase for 5.6× cost increase

---

## Conclusion

The Rocket Backend has a **solid foundation** but requires significant enhancements for high-scale production:

### Critical Path
1. **Fire-and-forget optimization** (write buffer, bounded worker pools, circuit breakers)
2. **Database optimization** (read replicas, connection pooling, write tuning)
3. **Caching layer** (Redis for metadata + query results)
4. **Async processing** (message queues for webhooks, 202 pattern for bulk ops)
5. **Horizontal scaling** (load balancer + stateless servers)

### Expected Results
- **10-100× RPS increase** (1K → 10K-100K RPS)
- **5-10× latency reduction** (200ms → 20-50ms p95)
- **99.9% uptime** (fault tolerance, auto-scaling)

### Next Steps
1. Benchmark current performance (establish baseline)
2. Implement Phase 1 (database optimization)
3. Add monitoring/alerting
4. Load test and iterate

### Language-Specific Scaling Notes

- **Go (Fiber):** Goroutine-based concurrency handles high connection counts well. pgx connection pooling and implicit prepared statements are built-in advantages. Consider `GOMAXPROCS` tuning for multi-core.
- **Express.js (Node):** Single-threaded event loop; use `cluster` module or PM2 to utilize multiple cores. The `pg` driver lacks implicit prepared statement caching — add explicit caching for hot queries. `new Function()` used in expression evaluation is a security concern at scale (see ag-review-1.md).
- **Elixir (Phoenix):** BEAM VM provides unique scaling properties — lightweight processes, built-in distribution (clustering via `libcluster`), and fault tolerance via supervision trees. The polling schedulers (workflow timeouts, webhook retries) could be replaced with `Process.send_after/3` for more efficient per-instance timers. Phoenix PubSub can replace Redis Pub/Sub for metadata cache invalidation across nodes.

**The architecture is scalable — it just needs the right infrastructure and patterns applied.**
