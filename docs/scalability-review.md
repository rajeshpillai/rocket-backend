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
| **Webhooks** | Background goroutines/tasks | No guaranteed delivery, no backpressure |
| **Workflows** | Polling scheduler (60s) | Inefficient, high latency |
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
- Concurrent queries: 1,000 × 0.1 = 100
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
- No prepared statement caching
- N+1 queries in includes
- Full table scans on filters

**Solutions:**

**A. Prepared Statement Cache**
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

**B. Batch Includes (Fix N+1)**
```go
// Current: N+1 queries
for _, parent := range parents {
    children := queryChildren(parent.ID)  // N queries
}

// Optimized: 1 query
parentIDs := extractIDs(parents)
children := queryChildrenBatch(parentIDs)  // 1 query with IN clause
groupByParent(children)
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

**When:** Single database can't handle write load

**Strategy: Shard by App**
```
App "crm"     → Database: rocket_crm_shard_0
App "helpdesk" → Database: rocket_helpdesk_shard_0
App "ecommerce" → Database: rocket_ecommerce_shard_1
```

**Implementation:**
```go
type ShardRouter struct {
    shards map[string]*Store  // app_name → shard
}

func (r *ShardRouter) GetShard(appName string) *Store {
    return r.shards[appName]
}
```

**Benefits:**
- Horizontal write scaling
- Fault isolation (one app's load doesn't affect others)
- Independent backups/maintenance

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

**Optimization: Session Cache**
```go
// Cache decoded JWT to avoid repeated validation
type SessionCache struct {
    cache *redis.Client
}

func (s *SessionCache) ValidateToken(token string) (*UserContext, error) {
    // Check cache
    key := fmt.Sprintf("session:%s", hash(token))
    if cached, err := s.cache.Get(key).Result(); err == nil {
        return unmarshal(cached), nil
    }
    
    // Validate JWT
    user := validateJWT(token)
    
    // Cache for token lifetime
    s.cache.Set(key, marshal(user), 15*time.Minute)
    
    return user, nil
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
| **Database connections** | 10/app | 50/app + replicas |
| **Cache hit rate** | 0% (no cache) | >90% |
| **Webhook throughput** | ~100/s | 10,000/s (queue) |

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
1. ✅ Add database connection pool metrics
2. ✅ Implement prepared statement cache
3. ✅ Fix N+1 queries in includes
4. ✅ Add Redis for metadata cache

### Short-term (Month 1)
5. ✅ Set up read replicas
6. ✅ Implement query result cache
7. ✅ Add rate limiting
8. ✅ Move to message queue for webhooks

### Medium-term (Quarter 1)
9. ✅ Implement CQRS for high-traffic entities
10. ✅ Add database sharding
11. ✅ Move files to S3 + CDN
12. ✅ Event-driven workflows

### Long-term (Year 1)
13. ✅ GraphQL federation
14. ✅ Edge computing deployment
15. ✅ Advanced monitoring/tracing

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
1. **Database optimization** (read replicas, connection pooling)
2. **Caching layer** (Redis for metadata + query results)
3. **Async processing** (message queues for webhooks)
4. **Horizontal scaling** (load balancer + stateless servers)

### Expected Results
- **10-100× RPS increase** (1K → 10K-100K RPS)
- **5-10× latency reduction** (200ms → 20-50ms p95)
- **99.9% uptime** (fault tolerance, auto-scaling)

### Next Steps
1. Benchmark current performance (establish baseline)
2. Implement Phase 1 (database optimization)
3. Add monitoring/alerting
4. Load test and iterate

**The architecture is scalable — it just needs the right infrastructure and patterns applied.**
