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

#### 3.1 Tiered Queue Architecture for Webhooks & Async Work

**Current:** Fire webhooks in background goroutines/tasks with in-process retry scheduler.

**Problem:**
- No guaranteed delivery if the process crashes mid-dispatch
- In-process retry scheduler is single-node (lost on restart)
- No backpressure — unbounded goroutines under high webhook volume
- Memory pressure at high RPS (each pending webhook holds payload in memory)

**Solution: Tiered queue progression — start with zero new infra, scale up only when needed**

The right queue depends on throughput requirements, which vary per app. Rather than mandating RabbitMQ or Kafka for every deployment, Rocket should support a tiered progression:

| Tier | Backend | Throughput | New Infra | When to Use |
|------|---------|-----------|-----------|-------------|
| **Tier 0** | In-process bounded pool | ~500/s | None | Default — development, low-traffic apps |
| **Tier 1** | PostgreSQL `SKIP LOCKED` | ~5K/s | None | Medium traffic — already have Postgres |
| **Tier 2** | Redis Streams | ~50K/s | Redis | High traffic — if Redis already deployed for caching |
| **Tier 3** | RabbitMQ | ~100K/s | RabbitMQ | Extreme throughput — dedicated message infrastructure |

**Configuration (app.yaml):**
```yaml
# Per-app queue configuration
queue:
  driver: postgres        # postgres (default) | redis | rabbitmq
  workers: 4              # Consumer concurrency
  batch_size: 50          # Dequeue batch size
  poll_interval: 500ms    # Polling interval (postgres/redis only)

  # Redis-specific (only if driver: redis)
  redis:
    url: redis://localhost:6379
    stream: rocket_jobs
    consumer_group: rocket_workers

  # RabbitMQ-specific (only if driver: rabbitmq)
  rabbitmq:
    url: amqp://guest:guest@localhost:5672/
    exchange: rocket
    queue: rocket_jobs
```

---

**Tier 0: In-Process Bounded Worker Pool (Default)**

Already covered in section 3.7. Uses a fixed-size goroutine pool with buffered channel. Good for development and low-traffic apps. No durability — jobs lost on crash.

---

**Tier 1: PostgreSQL Queue with `SKIP LOCKED` (Recommended Default for Production)**

Zero new infrastructure — uses the existing Postgres database as a job queue. The `SKIP LOCKED` clause (Postgres 9.5+) enables safe concurrent dequeue without conflicts.

```
┌──────────┐     ┌─────────────┐     ┌──────────┐
│  Write   │────▶│  _job_queue │────▶│ Workers  │
│ Pipeline │     │  (Postgres) │     │ (N=4)    │
└──────────┘     └─────────────┘     └──────────┘
     │                                     │
     │ INSERT job row                      │ SELECT ... FOR UPDATE SKIP LOCKED
     │ (non-blocking)                      │ Process → DELETE
     ▼                                     ▼
  Respond 200                         Background
```

**System table (`_job_queue`):**
```sql
CREATE TABLE _job_queue (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    queue       TEXT NOT NULL DEFAULT 'default',  -- 'webhooks', 'audit', 'workflows'
    payload     JSONB NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',  -- pending, processing, failed
    attempts    INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 5,
    run_after   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    error       TEXT
);

CREATE INDEX idx_job_queue_dequeue
    ON _job_queue (queue, run_after)
    WHERE status = 'pending';
```

**Dequeue query (safe for concurrent workers):**
```sql
-- Each worker runs this atomically — SKIP LOCKED prevents contention
WITH next_jobs AS (
    SELECT id FROM _job_queue
    WHERE queue = $1
      AND status = 'pending'
      AND run_after <= now()
    ORDER BY created_at
    LIMIT $2               -- batch_size (e.g., 50)
    FOR UPDATE SKIP LOCKED
)
UPDATE _job_queue
SET status = 'processing', attempts = attempts + 1
WHERE id IN (SELECT id FROM next_jobs)
RETURNING *;
```

**Go implementation:**
```go
type PgQueue struct {
    db          *pgxpool.Pool
    workers     int
    batchSize   int
    pollInterval time.Duration
    handlers    map[string]JobHandler  // queue name → handler func
}

type JobHandler func(payload map[string]any) error

// Enqueue — non-blocking, just inserts a row
func (q *PgQueue) Enqueue(ctx context.Context, queue string, payload map[string]any) error {
    _, err := q.db.Exec(ctx,
        `INSERT INTO _job_queue (queue, payload) VALUES ($1, $2)`,
        queue, payload)
    return err
}

// Start N workers polling the queue
func (q *PgQueue) Start(ctx context.Context) {
    for i := 0; i < q.workers; i++ {
        go q.worker(ctx, i)
    }
}

func (q *PgQueue) worker(ctx context.Context, id int) {
    ticker := time.NewTicker(q.pollInterval)
    defer ticker.Stop()

    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            q.processBatch(ctx)
        }
    }
}

func (q *PgQueue) processBatch(ctx context.Context) {
    // Dequeue batch with SKIP LOCKED
    rows, _ := q.db.Query(ctx, dequeueSQL, "webhooks", q.batchSize)
    defer rows.Close()

    for rows.Next() {
        var job Job
        rows.Scan(&job.ID, &job.Queue, &job.Payload, /* ... */)

        handler := q.handlers[job.Queue]
        if err := handler(job.Payload); err != nil {
            // Retry with exponential backoff
            retryAfter := time.Duration(math.Pow(2, float64(job.Attempts))) * 30 * time.Second
            q.db.Exec(ctx,
                `UPDATE _job_queue SET status='pending', run_after=$1, error=$2 WHERE id=$3`,
                time.Now().Add(retryAfter), err.Error(), job.ID)
        } else {
            // Success — remove from queue
            q.db.Exec(ctx, `DELETE FROM _job_queue WHERE id=$1`, job.ID)
        }
    }
}
```

**Why PostgreSQL before Redis/RabbitMQ:**
- Zero new infrastructure — you already have Postgres
- ACID guarantees — jobs survive crashes (in-process pool doesn't)
- `SKIP LOCKED` provides ~5K dequeues/s with 4 workers — sufficient for most apps
- Built-in retry with exponential backoff (just update `run_after`)
- Observability for free (`SELECT count(*) FROM _job_queue WHERE status='failed'`)
- No new client library, no new deployment concern

**Limitations:**
- Postgres is not a purpose-built queue — at >5K/s sustained, row churn causes vacuum pressure
- Polling introduces latency (configurable `poll_interval`, default 500ms)
- Not suitable for sub-millisecond latency requirements

---

**Tier 2: Redis Streams (When Postgres Queue Bottlenecks)**

If Redis is already deployed for caching (section 2.1), Redis Streams provide a purpose-built queue with consumer groups, acknowledgments, and ~50K/s throughput.

```go
// Redis Streams enqueue
func (q *RedisQueue) Enqueue(ctx context.Context, queue string, payload map[string]any) error {
    data, _ := json.Marshal(payload)
    return q.rdb.XAdd(ctx, &redis.XAddArgs{
        Stream: "rocket:" + queue,
        Values: map[string]any{"payload": data},
    }).Err()
}

// Redis Streams consumer group
func (q *RedisQueue) Start(ctx context.Context) {
    // Create consumer group (idempotent)
    q.rdb.XGroupCreateMkStream(ctx, "rocket:webhooks", "rocket_workers", "0")

    for i := 0; i < q.workers; i++ {
        go q.consume(ctx, fmt.Sprintf("worker-%d", i))
    }
}

func (q *RedisQueue) consume(ctx context.Context, consumer string) {
    for {
        results, _ := q.rdb.XReadGroup(ctx, &redis.XReadGroupArgs{
            Group:    "rocket_workers",
            Consumer: consumer,
            Streams:  []string{"rocket:webhooks", ">"},
            Count:    int64(q.batchSize),
            Block:    5 * time.Second,  // Block instead of polling
        }).Result()

        for _, msg := range results[0].Messages {
            // Process and acknowledge
            handler(msg.Values["payload"])
            q.rdb.XAck(ctx, "rocket:webhooks", "rocket_workers", msg.ID)
        }
    }
}
```

**When to upgrade from Postgres to Redis:**
- Sustained webhook volume >5K/s
- Redis already deployed for cache/sessions
- Need sub-second processing latency (Redis blocks instead of polling)

---

**Tier 3: RabbitMQ (Extreme Throughput)**

Only for deployments requiring >50K/s sustained throughput or advanced routing (topic exchanges, dead-letter queues, priority queues).

```go
// RabbitMQ enqueue
func (q *RabbitQueue) Enqueue(ctx context.Context, queue string, payload map[string]any) error {
    data, _ := json.Marshal(payload)
    return q.channel.Publish("rocket", queue, false, false,
        amqp.Publishing{
            ContentType:  "application/json",
            Body:         data,
            DeliveryMode: amqp.Persistent,
        })
}

// RabbitMQ consumer
func (q *RabbitQueue) Start(ctx context.Context) {
    msgs, _ := q.channel.Consume("rocket_webhooks", "", false, false, false, false, nil)
    for i := 0; i < q.workers; i++ {
        go func() {
            for msg := range msgs {
                handler(msg.Body)
                msg.Ack(false)
            }
        }()
    }
}
```

**When to upgrade from Redis to RabbitMQ:**
- Sustained volume >50K/s
- Need dead-letter queues for failed message inspection
- Need priority queues (urgent webhooks processed first)
- Multiple services consuming the same events (fanout exchanges)
- Note: Kafka is not recommended — its complexity (partitions, consumer groups, offset management, ZooKeeper/KRaft) is overkill for Rocket's use case. RabbitMQ provides equivalent throughput with simpler operations.

---

**Queue interface (all tiers implement this):**
```go
type Queue interface {
    Enqueue(ctx context.Context, queue string, payload map[string]any) error
    Start(ctx context.Context)                       // Start consuming
    Stop() error                                     // Graceful shutdown
    Stats(ctx context.Context) (QueueStats, error)   // Depth, failed count
}
```

**Benefits of the tiered approach:**
- Start simple — default Postgres queue requires zero new infrastructure
- Scale incrementally — upgrade queue driver per-app as needed, not globally
- Same application code — only the `queue.driver` config changes
- Production-ready at every tier — each tier has durability and retry

#### 3.2 Event-Driven Workflows

**Current:** Polling scheduler checks every 60s for timed-out workflow instances.

**Problem:**
- High latency (up to 60s delay for timeout detection)
- Inefficient (queries all instances every tick even when none are due)

**Solution: Use the same tiered queue (section 3.1) for workflow events**

Workflow events (approval, rejection, timeout) are enqueued to the same queue infrastructure. No separate event system needed.

```
┌──────────┐
│ Approval │
│  Action  │
└────┬─────┘
     │ Enqueue workflow event
     ▼
┌──────────────┐
│ Queue (3.1)  │ ← Same Postgres/Redis/RabbitMQ queue
└──────┬───────┘
       │ Worker picks up
       ▼
┌──────────────┐
│  Workflow    │ ← Advances instance
│   Engine     │
└──────────────┘
```

**Implementation (uses the Queue interface from 3.1):**
```go
// On approval action — enqueue instead of direct call
func (w *WorkflowHandler) Approve(instanceID string) {
    w.queue.Enqueue(ctx, "workflows", map[string]any{
        "action":      "advance",
        "instance_id": instanceID,
        "timestamp":   time.Now(),
    })
}

// Worker handler for workflow queue
func workflowJobHandler(payload map[string]any) error {
    instanceID := payload["instance_id"].(string)
    return workflowEngine.AdvanceWorkflow(instanceID)
}

// Timeout scheduling — enqueue with delayed run_after
func (w *WorkflowEngine) ScheduleTimeout(instanceID string, deadline time.Time) {
    // For Postgres queue: INSERT with run_after = deadline
    // For Redis: use XADD with a delay wrapper
    // For RabbitMQ: use message TTL + dead-letter exchange
    w.queue.EnqueueDelayed(ctx, "workflows", map[string]any{
        "action":      "timeout",
        "instance_id": instanceID,
    }, deadline)
}
```

**Benefits:**
- Near-instant reaction (no polling delay — workers process immediately)
- Reduced database load (no periodic queries scanning all instances)
- Unified infrastructure — workflows use the same queue as webhooks
- Timeouts become scheduled jobs, not polling-discovered events

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
| `_events` (Phase 8) | N/A (not built yet) | Yes | High-volume instrumentation data, fire-and-forget |
| `_audit_logs` (Phase 9) | N/A (not built yet) | Yes | Non-critical for response, write-heavy |
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

### Short-term (Month 1) — continued
10. [ ] Add PostgreSQL-based job queue (`_job_queue` table with `SKIP LOCKED`) — Tier 1 queue for webhooks, workflows, audit
11. [ ] Migrate webhook dispatch + workflow events to queue interface

### Medium-term (Quarter 1)
12. [ ] Set up read replicas
13. [ ] Implement query result cache
14. [ ] Add rate limiting
15. [ ] 202 Accepted pattern for bulk operations
16. [ ] Idempotency key enforcement for at-least-once delivery
17. [ ] Add `queue.driver` config — support Redis Streams (Tier 2) for high-throughput apps

### Long-term (Year 1)
18. [ ] Add RabbitMQ queue driver (Tier 3) for extreme throughput deployments
19. [ ] Implement CQRS for high-traffic entities
20. [ ] Within-app sharding (database-per-app already exists)
21. [ ] Move files to S3 + CDN
22. [ ] GraphQL federation
23. [ ] Advanced monitoring/tracing

---

## Cost Implications

### Infrastructure Costs (10K RPS)

| Component | Current | Scaled | Monthly Cost | Notes |
|-----------|---------|--------|--------------|-------|
| **App Servers** | 1 × $50 | 5 × $50 | $250 | |
| **Database** | 1 × $100 | 1 primary + 3 replicas × $100 | $400 | Includes Postgres queue (Tier 1) at no extra cost |
| **Redis** | - | 1 cluster × $50 | $50 | Optional: cache + Tier 2 queue |
| **Message Queue** | - | 1 × $30 | $30 | Optional: RabbitMQ (Tier 3) — only if >50K/s |
| **S3 + CDN** | - | ~$100/TB | $100 | |
| **Load Balancer** | - | 1 × $20 | $20 | |
| **Total (minimal)** | $150 | Postgres queue only | **$770** | No Redis, no RabbitMQ |
| **Total (full)** | $150 | All tiers | **$850** | |

**ROI:** 10× capacity increase for 5.1-5.6× cost increase (depending on queue tier)

---

## Conclusion

The Rocket Backend has a **solid foundation** but requires significant enhancements for high-scale production:

### Critical Path
1. **Fire-and-forget optimization** (write buffer, bounded worker pools, circuit breakers)
2. **PostgreSQL job queue** (`_job_queue` + `SKIP LOCKED` — zero new infra, replaces in-process schedulers)
3. **Database optimization** (read replicas, connection pooling, write tuning)
4. **Caching layer** (Redis for metadata + query results)
5. **Queue tier upgrade** (Redis Streams or RabbitMQ — only for apps exceeding ~5K/s sustained)
6. **Horizontal scaling** (load balancer + stateless servers)

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
