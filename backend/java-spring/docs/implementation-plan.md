# Rocket Backend — Java Spring Boot Implementation Plan

> **Date:** 2026-02-16
> **Goal:** Implement the full Rocket metadata-driven backend in Java (Spring Boot), producing identical API responses to Go, Express, and Elixir backends.
> **Note:** Admin UI (`admin/`) and Client app (`client/`) are shared across all backends — this implementation only needs to match the API contract.

---

## Technology Stack

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Framework | Spring Boot 3.x (Java 21) | Modern LTS, virtual threads, records |
| Web | Spring Web MVC | REST controllers, filters, exception handlers |
| Database | JDBC + HikariCP (raw SQL) | Matches project philosophy — no ORM, parameterized SQL only |
| Postgres driver | `org.postgresql:postgresql` | Standard JDBC driver |
| SQLite driver | `org.xerial:sqlite-jdbc` | Zero-infra option |
| JSON | Jackson | De/serialization, `Map<String, Object>` handling |
| JWT | `io.jsonwebtoken:jjwt` | HS256 signing + validation |
| Password hashing | Spring Security Crypto (`BCryptPasswordEncoder`) | bcrypt cost 12 |
| Expression engine | Spring Expression Language (SpEL) or [Aviator](https://github.com/killme2008/aviatorscript) | Safe expression evaluation (no side effects) |
| Config | SnakeYAML (app.yaml) + Spring `@ConfigurationProperties` | Match existing config format |
| File upload | Spring multipart support | Built-in |
| Build tool | Maven (or Gradle) | Standard Java build |
| Testing | JUnit 5 + Spring Boot Test + Testcontainers | Integration tests with real Postgres |

### Key Design Decisions

1. **No JPA/Hibernate** — All SQL is hand-written and parameterized, matching Go's `pgx` and Express's `pg`. We use `JdbcTemplate` / `NamedParameterJdbcTemplate` for safe parameterized queries.
2. **`Map<String, Object>` everywhere** — Dynamic data never gets typed structs per entity. Jackson handles JSON ↔ Map conversion.
3. **Virtual Threads (Java 21)** — Use `spring.threads.virtual.enabled=true` for lightweight concurrency instead of thread pools.
4. **Records for metadata types** — Use Java records for immutable metadata (Entity, Field, Relation, etc.) and POJOs only where mutability is needed.
5. **Expression engine** — SpEL is built into Spring and supports safe sandboxed evaluation. Alternative: Aviator for expr-lang compatibility. Decision to finalize during Phase 1.

---

## Project Structure

```
java-spring/
├── docs/
│   ├── implementation-plan.md       # This file
│   └── progress.md                  # Per-phase status tracking
├── todo.md                          # Implementation-specific todo (mirrors root phases)
├── app.yaml                         # Config (same format as Go/Express)
├── pom.xml                          # Maven build
├── src/
│   ├── main/
│   │   ├── java/com/rocket/
│   │   │   ├── RocketApplication.java
│   │   │   │
│   │   │   ├── config/
│   │   │   │   ├── AppConfig.java              # app.yaml loader → @ConfigurationProperties
│   │   │   │   ├── DatabaseConfig.java          # HikariCP DataSource setup
│   │   │   │   └── JacksonConfig.java           # ObjectMapper customization
│   │   │   │
│   │   │   ├── metadata/
│   │   │   │   ├── Entity.java                  # Entity record/POJO
│   │   │   │   ├── Field.java                   # Field record
│   │   │   │   ├── Relation.java                # Relation record
│   │   │   │   ├── Rule.java                    # Rule record
│   │   │   │   ├── Permission.java              # Permission record
│   │   │   │   ├── StateMachine.java            # State machine + transitions
│   │   │   │   ├── Workflow.java                # Workflow + steps
│   │   │   │   ├── Webhook.java                 # Webhook record
│   │   │   │   ├── UserContext.java             # Auth context (id, email, roles)
│   │   │   │   ├── Registry.java                # In-memory metadata cache (ReadWriteLock)
│   │   │   │   └── Loader.java                  # Load metadata from _* system tables
│   │   │   │
│   │   │   ├── store/
│   │   │   │   ├── Store.java                   # JdbcTemplate wrapper, query/exec helpers
│   │   │   │   ├── Bootstrap.java               # Create system tables DDL
│   │   │   │   ├── Migrator.java                # Auto-migration (ALTER TABLE ADD COLUMN)
│   │   │   │   ├── Dialect.java                 # SQL dialect interface
│   │   │   │   ├── PostgresDialect.java         # Postgres-specific SQL
│   │   │   │   └── SqliteDialect.java           # SQLite-specific SQL
│   │   │   │
│   │   │   ├── engine/
│   │   │   │   ├── CrudHandler.java             # List, GetById, Create, Update, Delete
│   │   │   │   ├── QueryBuilder.java            # SELECT with filters, sorts, pagination
│   │   │   │   ├── WriteExecutor.java           # Full write pipeline orchestrator
│   │   │   │   ├── NestedWriter.java            # Diff/replace/append + FK propagation
│   │   │   │   ├── IncludeLoader.java           # Load related entities (separate queries)
│   │   │   │   ├── RuleEngine.java              # Field rules, expression rules, computed fields
│   │   │   │   ├── StateMachineEngine.java      # Transition validation, guards, actions
│   │   │   │   ├── WorkflowEngine.java          # Workflow trigger, step execution, advance
│   │   │   │   ├── WebhookEngine.java           # Dispatch, retry, condition eval
│   │   │   │   └── ExpressionEvaluator.java     # SpEL/Aviator wrapper for safe expressions
│   │   │   │
│   │   │   ├── auth/
│   │   │   │   ├── AuthController.java          # /auth/login, /auth/refresh, /auth/logout
│   │   │   │   ├── AuthService.java             # Login, token generation, refresh rotation
│   │   │   │   ├── JwtUtil.java                 # HS256 sign/verify, extract claims
│   │   │   │   ├── PasswordService.java         # BCrypt hash/verify
│   │   │   │   ├── PermissionEngine.java        # CheckPermission, GetReadFilters
│   │   │   │   ├── AuthFilter.java              # OncePerRequestFilter — JWT extraction
│   │   │   │   └── InviteService.java           # Invite create, accept, bulk
│   │   │   │
│   │   │   ├── admin/
│   │   │   │   ├── AdminController.java         # All /_admin/* endpoints
│   │   │   │   ├── AdminService.java            # CRUD for entities, relations, rules, etc.
│   │   │   │   ├── SchemaExporter.java          # Export metadata as JSON
│   │   │   │   └── SchemaImporter.java          # Import with dependency ordering
│   │   │   │
│   │   │   ├── multiapp/
│   │   │   │   ├── AppContext.java              # Per-app: Store, Registry, handlers
│   │   │   │   ├── AppManager.java              # Get/Create/Delete/List/LoadAll apps
│   │   │   │   ├── PlatformController.java      # /_platform/* endpoints
│   │   │   │   ├── AppResolverFilter.java       # Extract :app from path, set AppContext
│   │   │   │   ├── DualAuthFilter.java          # Try app JWT → fallback to platform JWT
│   │   │   │   └── Scheduler.java               # Background jobs (timeouts, retries, cleanup)
│   │   │   │
│   │   │   ├── storage/
│   │   │   │   ├── FileStorage.java             # Interface: save, open, delete
│   │   │   │   └── LocalFileStorage.java        # Disk-based implementation
│   │   │   │
│   │   │   ├── instrument/
│   │   │   │   ├── Instrumenter.java            # StartSpan, EmitBusinessEvent
│   │   │   │   ├── Span.java                    # Span lifecycle
│   │   │   │   ├── EventBuffer.java             # Async batch flush
│   │   │   │   ├── EventController.java         # /_events endpoints
│   │   │   │   └── TraceFilter.java             # X-Trace-ID propagation
│   │   │   │
│   │   │   ├── controller/
│   │   │   │   ├── DynamicEntityController.java # /:entity routes (delegates to CrudHandler)
│   │   │   │   └── FileController.java          # /_files routes
│   │   │   │
│   │   │   └── common/
│   │   │       ├── ErrorResponse.java           # Standard error format
│   │   │       ├── ApiException.java            # Custom exceptions with error codes
│   │   │       └── GlobalExceptionHandler.java  # @ControllerAdvice for error formatting
│   │   │
│   │   └── resources/
│   │       └── application.properties           # Spring defaults (port, etc.)
│   │
│   └── test/
│       └── java/com/rocket/
│           ├── engine/                          # Unit tests per module
│           ├── store/
│           ├── auth/
│           └── integration/                     # Full API integration tests
│
└── docker-compose.yml                           # (optional, can reuse root docker-compose)
```

---

## Module Dependency Order

Build and implement in this order (each depends on the previous):

```
1. config        → Loads app.yaml, provides AppConfig
2. store         → Uses config for DB connection, provides Store + Bootstrap + Migrator
3. metadata      → Uses store to load from system tables, provides Registry
4. engine        → Uses metadata (Registry) + store (Store) for CRUD operations
5. auth          → Uses store + metadata for JWT/permissions
6. admin         → Uses store + metadata + migrator for admin CRUD
7. multiapp      → Orchestrates per-app instances of all above
8. storage       → File storage interface (independent, injected into engine)
9. instrument    → Wraps all layers with tracing (cross-cutting)
```

---

## Implementation Phases

### Phase 0: Foundation
**Estimated scope: ~4,000 LOC | Target: Sprint 1-2**

#### 0.1 Project Scaffolding
- [ ] Initialize Spring Boot 3.x project (Java 21, Maven)
- [ ] Configure `pom.xml` with dependencies (spring-web, postgresql, hikari, jackson, snakeyaml)
- [ ] Create `app.yaml` config file (same format as Go/Express)
- [ ] Implement `AppConfig` — load `app.yaml` via SnakeYAML into typed config
- [ ] Implement `DatabaseConfig` — HikariCP DataSource from config
- [ ] Implement `JacksonConfig` — ObjectMapper with snake_case, ISO dates
- [ ] Health endpoint (`GET /health`)

#### 0.2 Database Layer
- [ ] `Store` — wrapper around `JdbcTemplate` with helper methods:
  - `query(sql, params) → List<Map<String, Object>>`
  - `queryOne(sql, params) → Map<String, Object>`
  - `exec(sql, params) → int` (rows affected)
  - `execReturning(sql, params) → Map<String, Object>` (INSERT ... RETURNING *)
  - Transaction support via `TransactionTemplate` or `PlatformTransactionManager`
- [ ] `Bootstrap` — DDL for all system tables (_entities, _relations, _rules, _permissions, _state_machines, _workflows, _workflow_instances, _webhooks, _webhook_logs, _users, _refresh_tokens, _invites, _files, _events)
- [ ] `Migrator` — auto-migration: CREATE TABLE on entity create, ALTER TABLE ADD COLUMN on field add
  - Never drop columns
  - Type mapping: field type → Postgres column type
  - Handle unique constraints, soft_delete column
- [ ] `PostgresDialect` — Postgres-specific SQL (JSONB, $1 params, RETURNING, etc.)
- [ ] `SqliteDialect` — SQLite-specific SQL (JSON, ? params, last_insert_rowid, etc.)

#### 0.3 Metadata Types & Registry
- [ ] `Field` record — name, type, required, unique, default, enum, precision, auto (create/update)
- [ ] `Entity` record — name, table, primary_key, fields, soft_delete
- [ ] `Relation` record — name, type (one_to_many, many_to_one, many_to_many), source, target, keys, join_table, ownership, on_delete, fetch, write_mode
- [ ] `Registry` — thread-safe in-memory cache using `ReadWriteLock`:
  - entities by name, relations by name, relations grouped by source entity
  - `getEntity(name)`, `getRelation(name)`, `getRelationsForEntity(name)`
  - `reload()` — re-read all metadata from DB
- [ ] `Loader` — query _entities, _relations from DB, parse JSONB fields, populate Registry

#### 0.4 Query Builder
- [ ] Parse query params: `filter[field.op]=value`, `sort=-field,field`, `page=N`, `per_page=N`
- [ ] Supported operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `not_in`, `like`
- [ ] Validate filter/sort fields against entity metadata
- [ ] Build parameterized SELECT: `SELECT cols FROM table WHERE ... ORDER BY ... LIMIT $N OFFSET $N`
- [ ] Auto-append `deleted_at IS NULL` for soft-delete entities
- [ ] Count query for pagination metadata
- [ ] Return `{ sql, countSql, params }`

#### 0.5 CRUD Handlers (Engine)
- [ ] **List** — `GET /api/:app/:entity` → query builder → execute → includes → response
- [ ] **GetById** — `GET /api/:app/:entity/:id` → single row → includes → response
- [ ] **Create** — `POST /api/:app/:entity` → validate → INSERT RETURNING * → response
- [ ] **Update** — `PUT /api/:app/:entity/:id` → fetch existing → validate → UPDATE → response
- [ ] **Delete** — `DELETE /api/:app/:entity/:id` → soft/hard delete → response
- [ ] Include loader — parse `?include=rel1,rel2`, execute separate queries per relation, group by parent ID
- [ ] Pagination response: `{ data: [...], meta: { page, per_page, total, total_pages } }`

#### 0.6 Nested Writes
- [ ] Separate incoming payload into entity fields vs relation writes
- [ ] **diff mode**: compare incoming vs current DB state → INSERT new / UPDATE existing / DELETE marked `_delete:true`
- [ ] **replace mode**: incoming is complete truth → INSERT new / UPDATE existing / DELETE missing
- [ ] **append mode**: only INSERT new rows, ignore existing, no deletes
- [ ] FK propagation: capture parent PK on INSERT, inject into child FK fields
- [ ] Plan-then-execute: build operation list, then BEGIN → execute all → COMMIT
- [ ] Recursive depth support (parent → child → grandchild)

#### 0.7 Admin API
- [ ] Entity CRUD: `GET/POST /_admin/entities`, `GET/PUT/DELETE /_admin/entities/:name`
  - On create/update: run migrator (CREATE TABLE or ALTER TABLE)
  - On delete: remove from registry (table stays)
- [ ] Relation CRUD: `GET/POST /_admin/relations`, `GET/PUT/DELETE /_admin/relations/:name`
- [ ] Reload registry after any metadata change

#### 0.8 Dynamic Routing
- [ ] Register `/_admin/*` routes before `/:entity` routes
- [ ] `DynamicEntityController` catches `/{entity}` and `/{entity}/{id}` patterns
- [ ] Validate entity exists in registry, return `UNKNOWN_ENTITY` (404) if not

#### 0.9 Error Handling
- [ ] `GlobalExceptionHandler` (`@ControllerAdvice`) — format all errors as:
  ```json
  {"error": {"code": "...", "message": "...", "details": [...]}}
  ```
- [ ] Error codes: `UNKNOWN_ENTITY`, `NOT_FOUND`, `VALIDATION_FAILED`, `UNKNOWN_FIELD`, `INVALID_PAYLOAD`, `CONFLICT`, `UNAUTHORIZED`, `FORBIDDEN`, `INTERNAL_ERROR`

---

### Phase 1: Validation Rules
**Estimated scope: ~800 LOC | Target: Sprint 3**

- [ ] `_rules` bootstrap DDL (already in Phase 0 bootstrap, ensure it's there)
- [ ] `Rule` metadata type — entity, hook, type (field/expression/computed), definition, expression, field, message, stop_on_fail
- [ ] Loader + Registry integration — `getRulesForEntity(name, hook)`
- [ ] Admin API for rule CRUD (`/_admin/rules`)
- [ ] **Field rules engine**: evaluate min, max, min_length, max_length, pattern (regex), required, enum against field value
- [ ] **Expression rules engine**: evaluate boolean expression against context `{record, old, action, user}`
  - Expression returns `true` = violation (matches Go/Express behavior)
- [ ] **Computed fields**: evaluate expression, set result as field value before write
- [ ] Wire into write pipeline: `before_write` hook — run all rules, collect errors, return 422 if any fail
- [ ] `stop_on_fail` support — halt rule evaluation on first failure
- [ ] Expression engine decision: SpEL vs Aviator vs custom — must match expr-lang semantics (access `record.field`, `old.field`, arithmetic, comparisons, logical ops, `nil` checks)

---

### Phase 2: State Machines
**Estimated scope: ~700 LOC | Target: Sprint 3**

- [ ] `StateMachine` metadata type — entity, field, initial, transitions[]
- [ ] `Transition` — from (string or string[]), to, roles[], guard (expression), actions[]
- [ ] `TransitionAction` — type (set_field/webhook/create_record/send_event), config
- [ ] Custom JSON deserialization for `from` field (string or array)
- [ ] Loader + Registry — `getStateMachineForEntity(name)`
- [ ] Admin API for state machine CRUD (`/_admin/state-machines`)
- [ ] **Transition validation**: detect state field change → find matching transition → validate roles
- [ ] **Guard expressions**: evaluate guard (true = allowed, false = blocked)
- [ ] **Transition actions**:
  - `set_field` — set field value (special: `"now"` → current ISO timestamp)
  - `webhook` — fire HTTP request (fire-and-forget)
  - `create_record` / `send_event` — stubs (log only, implemented in Phase 11)
- [ ] Wire into write pipeline: after rules, before SQL execution

---

### Phase 3: Workflows
**Estimated scope: ~1,200 LOC | Target: Sprint 4**

- [ ] `Workflow` metadata type — name, trigger (entity, from_status, to_status), context, steps[]
- [ ] `WorkflowStep` — id, type (action/condition/approval), actions[], expression, timeout, on_approve/on_reject/on_timeout
- [ ] `StepGoto` — custom JSON (string step ID or object with actions)
- [ ] Loader + Registry — `getWorkflowsForTrigger(entity, fromStatus, toStatus)`
- [ ] Admin API for workflow CRUD (`/_admin/workflows`)
- [ ] **Workflow engine**:
  - `triggerWorkflows(entity, recordID, fromStatus, toStatus, record)` — called post-commit
  - `advanceWorkflow(instance)` — execute current step, advance or pause
  - `executeStep(step, instance)` — dispatch by step type
- [ ] **Step types**:
  - `action` — execute all actions sequentially, then goto next step
  - `condition` — evaluate expression, branch `on_true` / `on_false`
  - `approval` — pause, set deadline if timeout specified
- [ ] **Action types**: `set_field` (DB update), `webhook` (HTTP call), stubs for `create_record`, `send_event`
- [ ] Workflow instance management: create, update status/context/history, query pending
- [ ] Runtime endpoints: `GET /_workflows/pending`, `GET /_workflows/:id`, `POST /_workflows/:id/approve`, `POST /_workflows/:id/reject`
- [ ] Background timeout scheduler — `@Scheduled` (60s interval), find expired approvals, execute `on_timeout`
- [ ] Post-commit trigger hook: after state field changes in write pipeline

---

### Phase 4: Auth & Permissions
**Estimated scope: ~1,500 LOC | Target: Sprint 5**

- [ ] `JwtUtil` — HS256 signing/validation using jjwt, 15min access token TTL
- [ ] `PasswordService` — bcrypt hash (cost 12) / verify
- [ ] Seed admin user on first boot: `admin@localhost` / `changeme`, roles: `["admin"]`
- [ ] `AuthService` — login (email/password → access + refresh tokens), refresh (rotation), logout (revoke)
- [ ] `AuthController` — `POST /auth/login`, `/auth/refresh`, `/auth/logout`
- [ ] `AuthFilter` (`OncePerRequestFilter`) — extract `Authorization: Bearer <token>`, validate, set `UserContext` in request attributes
- [ ] Admin-only check — verify `user.roles` contains `"admin"` for `/_admin/*` routes
- [ ] Skip auth for: `/auth/*`, `/health`, public endpoints
- [ ] `Permission` metadata type — entity, action (create/read/update/delete), roles[], conditions[]
- [ ] `PermissionEngine`:
  - `checkPermission(entity, action, userRoles)` — whitelist check, admin bypass
  - `getReadFilters(entity, userRoles)` — return conditions as WHERE clause additions
  - Write permission conditions — fetch current record, evaluate conditions
- [ ] Wire permission checks into all 5 CRUD handlers
- [ ] User admin CRUD (`/_admin/users`) — password hashed, never returned in response
- [ ] Permission admin CRUD (`/_admin/permissions`)
- [ ] User invite endpoints:
  - `POST /_admin/invites` — create invite (email, roles, expiry)
  - `GET /_admin/invites` — list invites
  - `DELETE /_admin/invites/:id` — revoke invite
  - `POST /_admin/invites/bulk` — bulk create
  - `POST /auth/accept-invite` — public (token + password → user + auto-login)

---

### Phase 5: Webhooks
**Estimated scope: ~1,000 LOC | Target: Sprint 6**

- [ ] `Webhook` metadata type — entity, hook, url, method, headers, condition, async, retry config
- [ ] Loader + Registry — `getWebhooksForEntityHook(entity, hook)`
- [ ] Admin API for webhook CRUD (`/_admin/webhooks`)
- [ ] Admin API for webhook logs (`/_admin/webhook-logs`) with filters
- [ ] Manual retry endpoint (`POST /_admin/webhook-logs/:id/retry`)
- [ ] **Webhook dispatch engine**:
  - Build payload: `{ event, entity, action, record, old, changes, user, timestamp, idempotency_key }`
  - Evaluate condition expression (skip if false)
  - Resolve headers (`{{env.VAR}}` → `System.getenv(VAR)`)
  - HTTP call via `RestTemplate` / `WebClient`
- [ ] **Async webhooks** (after_write, after_delete): fire in separate thread post-commit, log result, retry on failure
- [ ] **Sync webhooks** (before_write, before_delete): fire inside transaction, non-2xx → throw → rollback
- [ ] Background retry scheduler — `@Scheduled` (30s), exponential backoff: `30s * 2^attempt`
- [ ] Wire into write pipeline (before_write sync) and post-commit (after_write async)
- [ ] Wire into delete flow (before_delete sync, after_delete async)

---

### Phase 6: Multi-App (Database-per-App)
**Estimated scope: ~1,200 LOC | Target: Sprint 7**

- [ ] Config additions: `platform_jwt_secret`, `app_pool_size`
- [ ] Management DB bootstrap: `_apps`, `_platform_users`, `_platform_refresh_tokens` tables
- [ ] Seed platform admin: `platform@localhost` / `changeme`
- [ ] `Store` additions: `createDatabase(name)`, `dropDatabase(name)`, create DataSource for per-app DB
- [ ] `AppContext` — holds per-app: Store, Registry, Migrator, all handlers
- [ ] `AppManager`:
  - `loadAll()` — on startup, load all apps from `_apps`, build AppContext per app
  - `createApp(name)` — create DB → bootstrap → seed admin → build context
  - `deleteApp(name)` — drop DB → remove context
  - `getContext(appName)` → AppContext
  - Thread-safe map (ConcurrentHashMap)
- [ ] `PlatformController` — `POST /_platform/auth/login|refresh|logout`, `GET/POST /_platform/apps`, `GET/DELETE /_platform/apps/:name`
- [ ] `AppResolverFilter` — extract `:app` from URL path, look up AppContext, set in request attribute
- [ ] `DualAuthFilter` — try app JWT secret first, fallback to platform JWT
- [ ] Platform auth filter — platform JWT only for `/_platform/*`
- [ ] Route structure: `/_platform/*` → platform handlers, `/:app/*` → app-scoped handlers
- [ ] Multi-app scheduler: iterate all AppContexts for timeouts, retries, event cleanup

---

### Phase 7: File Uploads
**Estimated scope: ~600 LOC | Target: Sprint 7**

- [ ] Config: `storage.driver`, `storage.local_path`, `storage.max_file_size`
- [ ] `FileStorage` interface: `save(appName, fileId, filename, inputStream)`, `open(appName, fileId, filename)`, `delete(appName, fileId, filename)`
- [ ] `LocalFileStorage` — disk-based: `{basePath}/{appName}/{fileId}/{filename}`
- [ ] `FileController`:
  - `POST /_files/upload` — multipart → save → return file metadata
  - `GET /_files` — list files for app
  - `GET /_files/:id` — stream file download
  - `DELETE /_files/:id` — delete file + storage
- [ ] `file` field type → JSONB in Postgres (type mapping in Dialect)
- [ ] Write pipeline integration: resolve file UUID → full JSONB `{id, filename, size, mime_type}` from `_files` table

---

### Phase 8: Instrumentation & Events
**Estimated scope: ~1,200 LOC | Target: Sprint 8**

- [ ] `_events` system table (already in bootstrap DDL)
- [ ] `Instrumenter` — `startSpan(source, component, action)` → Span
- [ ] `Span` — `end()`, `setStatus()`, `setMetadata()`, `traceId()`, `spanId()`
- [ ] Trace ID propagation via `ThreadLocal` (or `ScopedValue` on Java 21):
  - Generate UUID per request or accept `X-Trace-ID` header
  - `TraceFilter` — set trace context on request entry
- [ ] `EventBuffer` — async batch writer (ConcurrentLinkedQueue, flush every 500ms or 100 events)
- [ ] Auto-instrumented events: HTTP requests, auth, permissions, DB queries, write pipeline stages, nested writes, webhooks, workflows, file operations
- [ ] Business event API:
  - `POST /_events` — emit custom events
  - `GET /_events` — query with filters (source, entity, trace_id, user_id, status, date range, pagination)
  - `GET /_events/trace/:trace_id` — full trace waterfall
  - `GET /_events/stats` — aggregate stats
- [ ] Config: `instrumentation.enabled`, `instrumentation.retention_days`, `instrumentation.sampling_rate`
- [ ] Background retention cleanup (`@Scheduled`)

---

### Schema Export/Import
**Included in Phase 0 admin, refined here**

- [ ] `GET /_admin/export` — query all 7 metadata tables, strip IDs/timestamps, return JSON
- [ ] `POST /_admin/import` — parse JSON, insert in dependency order (entities → relations → rules → state machines → workflows → permissions → webhooks), idempotent dedup
- [ ] Sample data support: if `data` key present, insert into entity tables

---

### User Invites
**Included in Phase 4 auth**

- [ ] Covered above in Phase 4 section

---

### UI Configs
**Backend endpoint only (UI is shared)**

- [ ] `_ui_configs` system table — entity, scope, config JSONB, unique(entity, scope)
- [ ] Admin CRUD: `GET/POST/PUT/DELETE /_admin/ui-configs`
- [ ] Public read: `GET /_ui/configs`, `GET /_ui/config/:entity`
- [ ] Include in schema export/import

---

## Phase-by-Phase Sprint Plan

| Sprint | Phase | Deliverable | Est. LOC |
|--------|-------|------------|----------|
| 1-2 | Phase 0 | Foundation — config, DB, metadata, CRUD, nested writes, admin, errors | ~4,000 |
| 3 | Phase 1 + 2 | Validation rules + State machines | ~1,500 |
| 4 | Phase 3 | Workflows (steps, approval, timeout scheduler) | ~1,200 |
| 5 | Phase 4 | Auth, JWT, permissions, invites | ~1,500 |
| 6 | Phase 5 | Webhooks (sync/async, retry, logs) | ~1,000 |
| 7 | Phase 6 + 7 | Multi-app + file uploads | ~1,800 |
| 8 | Phase 8 | Instrumentation, events, tracing | ~1,200 |
| — | — | **Total estimated** | **~12,200** |

---

## Dynamic Routing Strategy (Spring-specific)

Spring MVC doesn't natively support Fiber/Express-style `/:entity` catch-all routing. Strategy:

```java
// Option A: PathVariable with catch-all controller
@RestController
@RequestMapping("/api/{app}")
public class DynamicEntityController {

    @GetMapping("/{entity}")
    public ResponseEntity<?> list(@PathVariable String app,
                                   @PathVariable String entity, ...) { ... }

    @GetMapping("/{entity}/{id}")
    public ResponseEntity<?> getById(@PathVariable String app,
                                      @PathVariable String entity,
                                      @PathVariable String id, ...) { ... }
    // POST, PUT, DELETE similarly
}

// Admin routes registered with higher @Order or specific prefix
@RestController
@RequestMapping("/api/{app}/_admin")
@Order(1)  // Higher priority than dynamic
public class AdminController { ... }
```

Spring resolves more specific paths (`/_admin/entities`) before wildcards (`/{entity}`), so admin routes will work correctly without explicit ordering hacks.

---

## Transaction Management

```java
// Use Spring's PlatformTransactionManager for manual control
@Service
public class WriteExecutor {

    private final PlatformTransactionManager txManager;

    public Map<String, Object> executeWrite(AppContext ctx, ...) {
        TransactionStatus tx = txManager.getTransaction(
            new DefaultTransactionDefinition(TransactionDefinition.PROPAGATION_REQUIRED)
        );
        try {
            // 1. Execute parent INSERT/UPDATE
            // 2. Execute nested child operations
            // 3. Execute after_write rules (inside tx)
            txManager.commit(tx);

            // 4. Fire async webhooks (outside tx)
            // 5. Trigger workflows (outside tx)
            return result;
        } catch (Exception e) {
            txManager.rollback(tx);
            throw e;
        }
    }
}
```

---

## Expression Engine Considerations

The Go/Express backends use `expr-lang` which supports:
- Field access: `record.status`, `old.total`
- Comparisons: `==`, `!=`, `>`, `>=`, `<`, `<=`
- Logical: `&&`, `||`, `!`
- Arithmetic: `+`, `-`, `*`, `/`
- Nil checks: `record.field == nil`
- Function calls: `len(record.items)`, `sum(related.items, 'quantity * unit_price')`
- Array operations: `"admin" in user.roles`

**Recommended approach for Java:**

| Option | Pros | Cons |
|--------|------|------|
| **SpEL** | Built into Spring, well-documented, sandboxable | Syntax differs from expr-lang (`#record.status` vs `record.status`) |
| **Aviator** | High performance, safe by default, closer to expr-lang syntax | External dependency |
| **MVEL** | Flexible, supports map access naturally | Less maintained |
| **Custom adapter** | Exact expr-lang compatibility | Higher effort |

**Recommendation:** Start with **SpEL** (zero extra dependencies) with a thin adapter layer that normalizes the expression context. If SpEL syntax limitations become a problem, swap in Aviator behind the same adapter interface. The adapter maps `record`, `old`, `user`, `action` variables into the expression context.

---

## Concurrency Model

| Concern | Go (goroutines) | Java Spring (virtual threads) |
|---------|-----------------|-------------------------------|
| Async webhooks | `go func(){}()` | `CompletableFuture.runAsync()` with virtual thread executor |
| Background scheduler | `time.NewTicker` goroutine | `@Scheduled` with `TaskScheduler` |
| Event buffer | Channel + goroutine consumer | `ConcurrentLinkedQueue` + `@Scheduled` flush |
| Metadata registry | `sync.RWMutex` | `ReentrantReadWriteLock` |
| App context map | `sync.Map` | `ConcurrentHashMap` |
| Trace ID propagation | `context.Context` | `ThreadLocal` / `ScopedValue` (Java 21) |

---

## Testing Strategy

### Unit Tests
- Metadata validation (Field, Entity, Relation JSON parsing)
- Query builder (SQL generation, parameter numbering)
- Rule evaluation (field rules, expression rules)
- State machine logic (transition matching, guard evaluation)
- JWT generation/validation
- Password hashing

### Integration Tests (Testcontainers + Postgres)
- Full CRUD lifecycle (create → read → update → delete)
- Nested writes (diff/replace/append modes)
- Permission enforcement (granted/denied/row-level)
- Transaction rollback on validation failure
- Webhook sync/async flow
- Workflow execution (trigger → steps → approval → timeout)
- Multi-app isolation

### API Compatibility Tests
- Run the same API test suite against Go, Express, and Java backends
- Verify identical response structure, error codes, and behavior

---

## Running

```bash
# Start Postgres (reuse root docker-compose)
docker compose up -d

# Run Java Spring backend
cd java-spring
mvn spring-boot:run          # Default port 8080

# Or build and run JAR
mvn package
java -jar target/rocket-spring.jar

# Admin UI (proxies to 8080)
cd admin && npm run dev
```

---

## Risk & Mitigation

| Risk | Mitigation |
|------|------------|
| Expression engine incompatibility with expr-lang | Adapter interface — swap implementation without changing callers |
| Spring MVC routing conflicts with dynamic `:entity` | Explicit path ordering + prefix matching; admin routes are more specific |
| HikariCP pool exhaustion with many apps | Configurable `app_pool_size`, lazy app loading, connection timeout |
| JSONB handling differences | Use Jackson `ObjectMapper` consistently; test round-trip serialization |
| Virtual thread pinning on synchronized blocks | Use `ReentrantLock` instead of `synchronized` for critical sections |

---

## Success Criteria

1. All Phase 0-8 features functional and tested
2. API responses identical to Go/Express backends (same JSON structure, error codes, HTTP status codes)
3. Admin UI (`admin/`) works with Java backend without modifications
4. Client app (`client/`) works with Java backend without modifications
5. All integration tests pass against Testcontainers Postgres
6. Performance: comparable to Express backend for typical CRUD operations
