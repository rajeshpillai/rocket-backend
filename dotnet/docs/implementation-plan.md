# Rocket Backend — .NET Implementation Plan

> **Date:** 2026-02-16
> **Goal:** Implement the full Rocket metadata-driven backend in C# (.NET 9), producing identical API responses to Go, Express, Elixir, and Java Spring backends.
> **Note:** Admin UI (`admin/`) and Client app (`client/`) are shared across all backends — this implementation only needs to match the API contract.

---

## Technology Stack

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Framework | .NET 9 / ASP.NET Core Minimal APIs | Latest LTS-adjacent, high performance, minimal ceremony |
| Language | C# 13 | Records, pattern matching, raw string literals, collection expressions |
| Database | Npgsql (raw ADO.NET) | Direct parameterized SQL — no EF Core / Dapper, matches project philosophy |
| SQLite driver | `Microsoft.Data.Sqlite` | Zero-infra option |
| Connection pooling | Npgsql built-in (`NpgsqlDataSource`) | Native pooling, no external pool needed |
| JSON | `System.Text.Json` | Built-in, high perf, `JsonElement` / `Dictionary<string, object?>` for dynamic data |
| JWT | `Microsoft.AspNetCore.Authentication.JwtBearer` + `System.IdentityModel.Tokens.Jwt` | Standard ASP.NET JWT middleware |
| Password hashing | `BCrypt.Net-Next` | bcrypt cost 12, widely used |
| Expression engine | `DynamicExpresso` or `Microsoft.CodeAnalysis.CSharp.Scripting` | Safe sandboxed expression evaluation |
| Config | Custom YAML loader (YamlDotNet) for `app.yaml` | Match existing config format across backends |
| File upload | ASP.NET Core `IFormFile` | Built-in multipart support |
| Build tool | `dotnet` CLI + `.csproj` | Standard .NET build |
| Testing | xUnit + `Testcontainers.PostgreSql` | Integration tests with real Postgres |
| HTTP client | `IHttpClientFactory` + `HttpClient` | For webhook dispatch, API connectors |

### Key Design Decisions

1. **No Entity Framework** — All SQL is hand-written and parameterized (`NpgsqlCommand` with `$1, $2, ...` placeholders). This matches Go's `pgx` and Express's `pg` approach. We use a thin `Store` wrapper over `NpgsqlDataSource`.
2. **`Dictionary<string, object?>` everywhere** — Dynamic entity data never gets typed classes. `System.Text.Json` handles JSON ↔ Dictionary conversion.
3. **Minimal APIs over Controllers** — Use `app.MapGet/MapPost/MapPut/MapDelete` with route groups for cleaner routing. Fall back to controllers only if routing conflicts arise.
4. **Records for metadata types** — Use C# `record` types for immutable metadata (Entity, Field, Relation, etc.).
5. **`NpgsqlDataSource`** — Modern Npgsql pooling (replaces `NpgsqlConnection` + manual pool management). One `NpgsqlDataSource` per app database.
6. **Async all the way** — All DB and HTTP operations use `async/await`. No blocking calls.

---

## Project Structure

```
dotnet/
├── docs/
│   ├── implementation-plan.md         # This file
│   └── progress.md                    # Per-phase status tracking
├── todo.md                            # Implementation-specific todo (mirrors root phases)
├── app.yaml                           # Config (same format as Go/Express)
├── Rocket.sln                         # Solution file
├── src/
│   └── Rocket.Api/
│       ├── Rocket.Api.csproj
│       ├── Program.cs                 # Entry point — service registration + middleware + routing
│       │
│       ├── Config/
│       │   ├── AppConfig.cs           # app.yaml POCO (server, database, jwt, storage, instrumentation)
│       │   └── ConfigLoader.cs        # YamlDotNet → AppConfig
│       │
│       ├── Metadata/
│       │   ├── Entity.cs              # record: name, table, primary_key, fields, soft_delete
│       │   ├── Field.cs               # record: name, type, required, unique, default, enum, precision, auto
│       │   ├── Relation.cs            # record: name, type, source, target, keys, join_table, ownership, on_delete, write_mode
│       │   ├── Rule.cs                # record: entity, hook, type, definition, expression, field, message, stop_on_fail
│       │   ├── Permission.cs          # record: entity, action, roles, conditions
│       │   ├── StateMachine.cs        # record: entity, field, initial, transitions
│       │   ├── Transition.cs          # record: from (string|string[]), to, roles, guard, actions
│       │   ├── Workflow.cs            # record: name, trigger, context, steps
│       │   ├── WorkflowStep.cs        # record: id, type, actions, expression, timeout, gotos
│       │   ├── Webhook.cs             # record: entity, hook, url, method, headers, condition, async, retry
│       │   ├── UserContext.cs         # record: id, email, roles
│       │   ├── Registry.cs            # Thread-safe in-memory cache (ReaderWriterLockSlim)
│       │   └── Loader.cs             # Load metadata from system tables into Registry
│       │
│       ├── Store/
│       │   ├── Store.cs               # NpgsqlDataSource wrapper — Query, QueryOne, Exec, ExecReturning, BeginTransaction
│       │   ├── Bootstrap.cs           # System table DDL (CREATE TABLE IF NOT EXISTS)
│       │   ├── Migrator.cs            # Auto-migration (CREATE TABLE / ALTER TABLE ADD COLUMN)
│       │   ├── IDialect.cs            # SQL dialect interface
│       │   ├── PostgresDialect.cs     # Postgres-specific SQL (JSONB, $1 params, RETURNING)
│       │   └── SqliteDialect.cs       # SQLite-specific SQL (json, @p params, last_insert_rowid)
│       │
│       ├── Engine/
│       │   ├── CrudHandler.cs         # List, GetById, Create, Update, Delete
│       │   ├── QueryBuilder.cs        # Build SELECT: filters, sorts, pagination, soft-delete
│       │   ├── WriteExecutor.cs       # Full write pipeline orchestrator (plan → tx → commit → post-commit)
│       │   ├── NestedWriter.cs        # Diff/replace/append + FK propagation
│       │   ├── IncludeLoader.cs       # Separate queries per relation, group by parent ID
│       │   ├── RuleEngine.cs          # Field rules, expression rules, computed fields
│       │   ├── StateMachineEngine.cs  # Transition validation, guards, actions
│       │   ├── WorkflowEngine.cs      # Trigger, step execution, advance
│       │   ├── WebhookEngine.cs       # Dispatch, retry, condition eval, header resolution
│       │   └── ExpressionEvaluator.cs # DynamicExpresso wrapper for safe eval
│       │
│       ├── Auth/
│       │   ├── AuthEndpoints.cs       # /auth/login, /auth/refresh, /auth/logout route handlers
│       │   ├── AuthService.cs         # Login, token generation, refresh rotation, logout
│       │   ├── JwtUtil.cs             # HS256 sign/verify, extract claims
│       │   ├── PasswordService.cs     # BCrypt hash/verify (cost 12)
│       │   ├── PermissionEngine.cs    # CheckPermission, GetReadFilters, admin bypass
│       │   ├── AuthMiddleware.cs      # JWT extraction + validation middleware
│       │   └── InviteService.cs       # Invite create, accept, bulk
│       │
│       ├── Admin/
│       │   ├── AdminEndpoints.cs      # All /_admin/* route handlers
│       │   ├── AdminService.cs        # CRUD for entities, relations, rules, state machines, etc.
│       │   ├── SchemaExporter.cs      # Export metadata as JSON
│       │   └── SchemaImporter.cs      # Import with dependency ordering + dedup
│       │
│       ├── MultiApp/
│       │   ├── AppContext.cs           # Per-app: Store, Registry, all handlers
│       │   ├── AppManager.cs           # Get/Create/Delete/List/LoadAll apps
│       │   ├── PlatformEndpoints.cs    # /_platform/auth/*, /_platform/apps/*
│       │   ├── AppResolverMiddleware.cs # Extract :app from path, resolve AppContext
│       │   ├── DualAuthMiddleware.cs   # Try app JWT → fallback platform JWT
│       │   └── Scheduler.cs            # Background jobs (IHostedService — timeouts, retries, cleanup)
│       │
│       ├── Storage/
│       │   ├── IFileStorage.cs         # Interface: SaveAsync, OpenAsync, DeleteAsync
│       │   └── LocalFileStorage.cs     # Disk-based: {basePath}/{app}/{fileId}/{filename}
│       │
│       ├── Instrument/
│       │   ├── Instrumenter.cs         # StartSpan, EmitBusinessEvent
│       │   ├── Span.cs                 # End, SetStatus, SetMetadata
│       │   ├── EventBuffer.cs          # Channel<T> based async batch writer
│       │   ├── EventEndpoints.cs       # /_events route handlers
│       │   └── TraceMiddleware.cs      # X-Trace-ID propagation via AsyncLocal
│       │
│       ├── Endpoints/
│       │   ├── DynamicEntityEndpoints.cs # /{entity} and /{entity}/{id} route handlers
│       │   ├── FileEndpoints.cs          # /_files route handlers
│       │   └── WorkflowEndpoints.cs      # /_workflows route handlers
│       │
│       └── Common/
│           ├── ErrorResponse.cs         # { error: { code, message, details } }
│           ├── ApiException.cs          # Custom exception with error code + HTTP status
│           └── ExceptionMiddleware.cs   # Global exception → standard error response
│
└── tests/
    └── Rocket.Api.Tests/
        ├── Rocket.Api.Tests.csproj
        ├── Unit/
        │   ├── QueryBuilderTests.cs
        │   ├── RuleEngineTests.cs
        │   ├── StateMachineTests.cs
        │   ├── JwtUtilTests.cs
        │   └── NestedWriterTests.cs
        └── Integration/
            ├── CrudTests.cs
            ├── AuthTests.cs
            ├── PermissionTests.cs
            ├── WebhookTests.cs
            ├── WorkflowTests.cs
            └── MultiAppTests.cs
```

---

## Module Dependency Order

Build and implement in this order:

```
1. config        → Loads app.yaml, provides AppConfig
2. store         → Uses config for DB connection, provides Store + Bootstrap + Migrator
3. metadata      → Uses store to load from system tables, provides Registry
4. engine        → Uses metadata (Registry) + store (Store) for CRUD operations
5. auth          → Uses store + metadata for JWT/permissions
6. admin         → Uses store + metadata + migrator for admin CRUD
7. multiapp      → Orchestrates per-app instances of all above
8. storage       → File storage interface (independent, injected via DI)
9. instrument    → Wraps all layers with tracing (cross-cutting)
```

---

## Implementation Phases

### Phase 0: Foundation
**Estimated scope: ~3,500 LOC | Target: Sprint 1-2**

#### 0.1 Project Scaffolding
- [ ] Initialize .NET 9 project (`dotnet new web`)
- [ ] Configure `.csproj` with dependencies (Npgsql, YamlDotNet, BCrypt.Net-Next, System.IdentityModel.Tokens.Jwt, DynamicExpresso)
- [ ] Create `app.yaml` config file (same format as Go/Express)
- [ ] Implement `ConfigLoader` — load `app.yaml` via YamlDotNet into `AppConfig` record
- [ ] Register `NpgsqlDataSource` in DI with HikariCP-equivalent pooling settings
- [ ] Configure `System.Text.Json` — snake_case naming, ISO dates, `Dictionary<string, object?>` handling
- [ ] Health endpoint (`GET /health`)
- [ ] `Program.cs` — service registration, middleware pipeline, route mapping

#### 0.2 Database Layer
- [ ] `Store` — wrapper around `NpgsqlDataSource`:
  - `QueryAsync(sql, params) → List<Dictionary<string, object?>>`
  - `QueryOneAsync(sql, params) → Dictionary<string, object?>?`
  - `ExecAsync(sql, params) → int` (rows affected)
  - `ExecReturningAsync(sql, params) → Dictionary<string, object?>`
  - `BeginTransactionAsync() → NpgsqlTransaction`
  - All methods accept optional `NpgsqlTransaction` for transactional writes
- [ ] `Bootstrap` — DDL for all system tables (_entities, _relations, _rules, _permissions, _state_machines, _workflows, _workflow_instances, _webhooks, _webhook_logs, _users, _refresh_tokens, _invites, _files, _events, _ui_configs)
- [ ] `Migrator` — auto-migration:
  - CREATE TABLE on entity create
  - ALTER TABLE ADD COLUMN on field add
  - Never drop columns
  - Type mapping: field type → Postgres column type
  - Handle unique constraints, soft_delete column (`deleted_at TIMESTAMPTZ`)
- [ ] `PostgresDialect` — Postgres-specific SQL (JSONB, `$1` params, `RETURNING *`, text array `TEXT[]`)
- [ ] `SqliteDialect` — SQLite-specific SQL (json, `@p` params, `last_insert_rowid()`)

#### 0.3 Metadata Types & Registry
- [ ] `Field` record — name, type, required, unique, defaultValue, enumValues, precision, auto
- [ ] `Entity` record — name, table, primaryKey, fields, softDelete
- [ ] `Relation` record — name, type (one_to_many/many_to_one/many_to_many), source, target, keys, joinTable, ownership, onDelete, fetch, writeMode
- [ ] `Registry` — thread-safe in-memory cache using `ReaderWriterLockSlim`:
  - Entities by name, relations by name, relations grouped by source entity
  - `GetEntity(name)`, `GetRelation(name)`, `GetRelationsForEntity(name)`
  - `Reload()` — re-read all metadata from DB
- [ ] `Loader` — query _entities, _relations from DB, parse JSONB fields, populate Registry

#### 0.4 Query Builder
- [ ] Parse query string: `filter[field.op]=value`, `sort=-field,field`, `page=N`, `per_page=N`
- [ ] Supported operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `not_in`, `like`
- [ ] Validate filter/sort fields against entity metadata
- [ ] Build parameterized SELECT: `SELECT cols FROM table WHERE ... ORDER BY ... LIMIT $N OFFSET $N`
- [ ] Auto-append `deleted_at IS NULL` for soft-delete entities
- [ ] Count query for pagination metadata
- [ ] Return `(sql, countSql, parameters)`

#### 0.5 CRUD Handlers (Engine)
- [ ] **List** — `GET /:entity` → query builder → execute → includes → response
- [ ] **GetById** — `GET /:entity/:id` → single row → includes → response
- [ ] **Create** — `POST /:entity` → validate → INSERT RETURNING * → response
- [ ] **Update** — `PUT /:entity/:id` → fetch existing → validate → UPDATE → response
- [ ] **Delete** — `DELETE /:entity/:id` → soft/hard delete → response
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
  - On create/update: run migrator
  - On delete: remove from registry (table stays in DB)
- [ ] Relation CRUD: `GET/POST /_admin/relations`, `GET/PUT/DELETE /_admin/relations/:name`
- [ ] Reload registry after any metadata change

#### 0.8 Dynamic Routing
- [ ] Route registration order: `/_admin/*` before `/{entity}` (Minimal APIs resolves specific routes first)
- [ ] `DynamicEntityEndpoints` — route group `/{entity}` and `/{entity}/{id}`
- [ ] Validate entity exists in registry, return `UNKNOWN_ENTITY` (404) if not

#### 0.9 Error Handling
- [ ] `ExceptionMiddleware` — catch all exceptions, format as:
  ```json
  {"error": {"code": "...", "message": "...", "details": [...]}}
  ```
- [ ] Error codes: `UNKNOWN_ENTITY`, `NOT_FOUND`, `VALIDATION_FAILED`, `UNKNOWN_FIELD`, `INVALID_PAYLOAD`, `CONFLICT`, `UNAUTHORIZED`, `FORBIDDEN`, `INTERNAL_ERROR`
- [ ] `ApiException` — custom exception type with code + HTTP status + optional details array

---

### Phase 1: Validation Rules
**Estimated scope: ~700 LOC | Target: Sprint 3**

- [ ] `Rule` record — entity, hook, type (field/expression/computed), definition, expression, field, message, stopOnFail
- [ ] Loader + Registry integration — `GetRulesForEntity(name, hook)`
- [ ] Admin API for rule CRUD (`/_admin/rules`)
- [ ] **Field rules engine**: evaluate min, max, min_length, max_length, pattern (Regex), required, enum
- [ ] **Expression rules engine**: evaluate boolean expression against context `{record, old, action, user}`
  - Expression returns `true` = violation (matches Go/Express behavior)
- [ ] **Computed fields**: evaluate expression, set result as field value before write
- [ ] Wire into write pipeline: `before_write` hook — run all rules, collect errors, return 422 if any fail
- [ ] `stopOnFail` support — halt rule evaluation on first failure
- [ ] Expression engine: `DynamicExpresso` with sandboxed context (no side effects, map access via `record["field"]`)

---

### Phase 2: State Machines
**Estimated scope: ~650 LOC | Target: Sprint 3**

- [ ] `StateMachine` record — entity, field, initial, transitions[]
- [ ] `Transition` — from (string or string[]), to, roles[], guard (expression), actions[]
- [ ] `TransitionAction` — type (set_field/webhook/create_record/send_event), config
- [ ] Custom JSON converter for `from` field (string or array) — `JsonConverter<TransitionFrom>`
- [ ] Loader + Registry — `GetStateMachineForEntity(name)`
- [ ] Admin API for state machine CRUD (`/_admin/state-machines`)
- [ ] **Transition validation**: detect state field change → find matching transition → validate roles
- [ ] **Guard expressions**: evaluate guard (true = allowed, false = blocked)
- [ ] **Transition actions**:
  - `set_field` — set field value (special: `"now"` → `DateTime.UtcNow` ISO string)
  - `webhook` — fire HTTP request via `HttpClient` (fire-and-forget)
  - `create_record` / `send_event` — stubs (log only)
- [ ] Wire into write pipeline: after rules, before SQL execution

---

### Phase 3: Workflows
**Estimated scope: ~1,100 LOC | Target: Sprint 4**

- [ ] `Workflow` record — name, trigger (entity, from_status, to_status), context, steps[]
- [ ] `WorkflowStep` — id, type (action/condition/approval), actions[], expression, timeout, gotos
- [ ] `StepGoto` — custom JSON converter (string step ID or object with actions)
- [ ] Loader + Registry — `GetWorkflowsForTrigger(entity, fromStatus, toStatus)`
- [ ] Admin API for workflow CRUD (`/_admin/workflows`)
- [ ] **Workflow engine**:
  - `TriggerWorkflowsAsync(entity, recordId, fromStatus, toStatus, record)`
  - `AdvanceWorkflowAsync(instance)` — execute current step, advance or pause
  - `ExecuteStepAsync(step, instance)` — dispatch by step type
- [ ] **Step types**:
  - `action` — execute all actions sequentially, goto next
  - `condition` — evaluate expression, branch `on_true` / `on_false`
  - `approval` — pause, set deadline if timeout specified
- [ ] **Action types**: `set_field` (DB update), `webhook` (HTTP call), stubs for rest
- [ ] Workflow instance management: create, update status/context/history
- [ ] Runtime endpoints: `GET /_workflows/pending`, `GET /_workflows/:id`, `POST /_workflows/:id/approve`, `POST /_workflows/:id/reject`
- [ ] Background timeout scheduler — `IHostedService` with `PeriodicTimer` (60s interval)
- [ ] Post-commit trigger hook: after state field changes in write pipeline

---

### Phase 4: Auth & Permissions
**Estimated scope: ~1,400 LOC | Target: Sprint 5**

- [ ] `JwtUtil` — HS256 signing/validation using `System.IdentityModel.Tokens.Jwt`, 15min access TTL
- [ ] `PasswordService` — BCrypt.Net hash (cost 12) / verify
- [ ] Seed admin user on first boot: `admin@localhost` / `changeme`, roles: `["admin"]`
- [ ] `AuthService` — login (email/password → access + refresh tokens), refresh (rotation), logout (revoke)
- [ ] `AuthEndpoints` — `POST /auth/login`, `/auth/refresh`, `/auth/logout`
- [ ] `AuthMiddleware` — extract `Authorization: Bearer <token>`, validate, set `UserContext` in `HttpContext.Items`
- [ ] Admin-only check — verify `user.Roles` contains `"admin"` for `/_admin/*` routes
- [ ] Skip auth for: `/auth/*`, `/health`, public endpoints
- [ ] `Permission` record — entity, action (create/read/update/delete), roles[], conditions[]
- [ ] `PermissionEngine`:
  - `CheckPermission(entity, action, userRoles)` — whitelist check, admin bypass
  - `GetReadFilters(entity, userRoles)` — return conditions as WHERE clause additions
  - Write permission conditions — fetch current record, evaluate conditions
- [ ] Wire permission checks into all 5 CRUD handlers
- [ ] User admin CRUD (`/_admin/users`) — password hashed, never returned in response
- [ ] Permission admin CRUD (`/_admin/permissions`)
- [ ] User invite endpoints:
  - `POST /_admin/invites` — create invite
  - `GET /_admin/invites` — list
  - `DELETE /_admin/invites/:id` — revoke
  - `POST /_admin/invites/bulk` — bulk create
  - `POST /auth/accept-invite` — public (token + password → user + auto-login)

---

### Phase 5: Webhooks
**Estimated scope: ~900 LOC | Target: Sprint 6**

- [ ] `Webhook` record — entity, hook, url, method, headers, condition, async, retry config
- [ ] Loader + Registry — `GetWebhooksForEntityHook(entity, hook)`
- [ ] Admin API for webhook CRUD (`/_admin/webhooks`)
- [ ] Admin API for webhook logs (`/_admin/webhook-logs`) with filters
- [ ] Manual retry endpoint (`POST /_admin/webhook-logs/:id/retry`)
- [ ] **Webhook dispatch engine**:
  - Build payload: `{ event, entity, action, record, old, changes, user, timestamp, idempotency_key }`
  - Evaluate condition expression (skip if false)
  - Resolve headers (`{{env.VAR}}` → `Environment.GetEnvironmentVariable(VAR)`)
  - HTTP call via `IHttpClientFactory`
- [ ] **Async webhooks** (after_write, after_delete): `Task.Run` post-commit, log result, retry on failure
- [ ] **Sync webhooks** (before_write, before_delete): fire inside transaction, non-2xx → throw → rollback
- [ ] Background retry scheduler — `IHostedService` (30s), exponential backoff: `30s * 2^attempt`
- [ ] Wire into write pipeline (before_write sync) and post-commit (after_write async)
- [ ] Wire into delete flow (before_delete sync, after_delete async)

---

### Phase 6: Multi-App (Database-per-App)
**Estimated scope: ~1,100 LOC | Target: Sprint 7**

- [ ] Config additions: `platform_jwt_secret`, `app_pool_size`
- [ ] Management DB bootstrap: `_apps`, `_platform_users`, `_platform_refresh_tokens` tables
- [ ] Seed platform admin: `platform@localhost` / `changeme`
- [ ] `Store` additions: `CreateDatabaseAsync(name)`, `DropDatabaseAsync(name)`, create `NpgsqlDataSource` per-app DB
- [ ] `AppContext` — holds per-app: Store, Registry, Migrator, all handlers
- [ ] `AppManager`:
  - `LoadAllAsync()` — on startup, load all apps from `_apps`, build AppContext per app
  - `CreateAppAsync(name)` — create DB → bootstrap → seed admin → build context
  - `DeleteAppAsync(name)` — drop DB → remove context
  - `GetContext(appName)` → AppContext
  - Thread-safe via `ConcurrentDictionary<string, AppContext>`
- [ ] `PlatformEndpoints` — `POST /_platform/auth/login|refresh|logout`, `GET/POST /_platform/apps`, `GET/DELETE /_platform/apps/:name`
- [ ] `AppResolverMiddleware` — extract `:app` from URL path, look up AppContext, set in `HttpContext.Items`
- [ ] `DualAuthMiddleware` — try app JWT secret first, fallback to platform JWT
- [ ] Platform auth middleware — platform JWT only for `/_platform/*`
- [ ] Route structure: `/_platform/*` → platform handlers, `/{app}/*` → app-scoped handlers
- [ ] Multi-app scheduler: `IHostedService` iterates all AppContexts for timeouts, retries, event cleanup

---

### Phase 7: File Uploads
**Estimated scope: ~550 LOC | Target: Sprint 7**

- [ ] Config: `storage.driver`, `storage.local_path`, `storage.max_file_size`
- [ ] `IFileStorage` interface: `SaveAsync(appName, fileId, filename, stream)`, `OpenAsync(...)`, `DeleteAsync(...)`
- [ ] `LocalFileStorage` — disk-based: `{basePath}/{appName}/{fileId}/{filename}`
- [ ] `FileEndpoints`:
  - `POST /_files/upload` — multipart `IFormFile` → save → return metadata
  - `GET /_files` — list files for app
  - `GET /_files/:id` — stream file download via `Results.File()`
  - `DELETE /_files/:id` — delete file + storage
- [ ] `file` field type → JSONB in Postgres (type mapping in Dialect)
- [ ] Write pipeline integration: resolve file UUID → full JSONB `{id, filename, size, mime_type}` from `_files` table

---

### Phase 8: Instrumentation & Events
**Estimated scope: ~1,100 LOC | Target: Sprint 8**

- [ ] `_events` system table (already in bootstrap DDL)
- [ ] `Instrumenter` — `StartSpan(source, component, action)` → Span
- [ ] `Span` — `End()`, `SetStatus()`, `SetMetadata()`, `TraceId`, `SpanId`
- [ ] Trace ID propagation via `AsyncLocal<TraceContext>`:
  - Generate UUID per request or accept `X-Trace-ID` header
  - `TraceMiddleware` — set trace context on request entry
- [ ] `EventBuffer` — async batch writer using `System.Threading.Channels.Channel<T>` (flush every 500ms or 100 events)
- [ ] Auto-instrumented events: HTTP requests, auth, permissions, DB queries, write pipeline stages, nested writes, webhooks, workflows, file operations
- [ ] Business event API:
  - `POST /_events` — emit custom events
  - `GET /_events` — query with filters (source, entity, trace_id, user_id, status, date range, pagination)
  - `GET /_events/trace/:trace_id` — full trace waterfall
  - `GET /_events/stats` — aggregate stats
- [ ] Config: `instrumentation.enabled`, `instrumentation.retention_days`, `instrumentation.sampling_rate`
- [ ] Background retention cleanup — `IHostedService`

---

### Schema Export/Import
**Included in Phase 0 admin, refined here**

- [ ] `GET /_admin/export` — query all metadata tables, strip IDs/timestamps, return JSON
- [ ] `POST /_admin/import` — parse JSON, insert in dependency order (entities → relations → rules → state machines → workflows → permissions → webhooks), idempotent dedup
- [ ] Sample data support

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
| 1-2 | Phase 0 | Foundation — config, DB, metadata, CRUD, nested writes, admin, errors | ~3,500 |
| 3 | Phase 1 + 2 | Validation rules + State machines | ~1,350 |
| 4 | Phase 3 | Workflows (steps, approval, timeout scheduler) | ~1,100 |
| 5 | Phase 4 | Auth, JWT, permissions, invites | ~1,400 |
| 6 | Phase 5 | Webhooks (sync/async, retry, logs) | ~900 |
| 7 | Phase 6 + 7 | Multi-app + file uploads | ~1,650 |
| 8 | Phase 8 | Instrumentation, events, tracing | ~1,100 |
| — | — | **Total estimated** | **~11,000** |

---

## Routing Strategy (.NET Minimal APIs)

Minimal APIs in .NET 9 resolve routes by specificity — more specific patterns win over parameterized ones. This means `/_admin/entities` is matched before `/{entity}`.

```csharp
// Program.cs — route registration order
var app = builder.Build();

// 1. Global middleware
app.UseMiddleware<ExceptionMiddleware>();
app.UseMiddleware<TraceMiddleware>();

// 2. Platform routes (no app context needed)
var platform = app.MapGroup("/api/_platform");
platform.MapPlatformEndpoints();

// 3. App-scoped routes (AppResolverMiddleware injects AppContext)
var appGroup = app.MapGroup("/api/{app}")
    .AddEndpointFilter<AppResolverFilter>();

// 3a. Auth routes (no JWT required)
appGroup.MapAuthEndpoints();       // /api/{app}/auth/*

// 3b. Protected routes (JWT required)
var protectedGroup = appGroup
    .AddEndpointFilter<DualAuthFilter>();

// 3c. Admin routes (admin role required)
var adminGroup = protectedGroup.MapGroup("/_admin")
    .AddEndpointFilter<AdminOnlyFilter>();
adminGroup.MapAdminEndpoints();    // /api/{app}/_admin/*

// 3d. File routes
protectedGroup.MapFileEndpoints(); // /api/{app}/_files/*

// 3e. Workflow routes
protectedGroup.MapWorkflowEndpoints(); // /api/{app}/_workflows/*

// 3f. Event routes
protectedGroup.MapEventEndpoints(); // /api/{app}/_events/*

// 3g. UI config routes
protectedGroup.MapUiConfigEndpoints(); // /api/{app}/_ui/*

// 3h. Dynamic entity routes (LAST — catch-all)
protectedGroup.MapDynamicEntityEndpoints(); // /api/{app}/{entity}[/{id}]
```

---

## Transaction Management

```csharp
public class WriteExecutor
{
    public async Task<Dictionary<string, object?>> ExecuteWriteAsync(
        AppContext ctx, ...)
    {
        await using var conn = await ctx.Store.OpenConnectionAsync();
        await using var tx = await conn.BeginTransactionAsync();

        try
        {
            // 1. Execute parent INSERT/UPDATE
            // 2. Execute nested child operations (FK propagation)
            // 3. Execute sync webhooks (before_write — inside tx)
            // 4. Execute after_write rules (inside tx)
            await tx.CommitAsync();

            // 5. Fire async webhooks (outside tx)
            _ = Task.Run(() => webhookEngine.DispatchAsyncWebhooksAsync(...));
            // 6. Trigger workflows (outside tx)
            _ = Task.Run(() => workflowEngine.TriggerWorkflowsAsync(...));

            return result;
        }
        catch
        {
            await tx.RollbackAsync();
            throw;
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
- Nil checks: `record.field == nil`
- Array membership: `"admin" in user.roles`
- Functions: `len()`, `sum()`

**Options for .NET:**

| Option | Pros | Cons |
|--------|------|------|
| **DynamicExpresso** | Lightweight, C#-like syntax, sandboxable, dictionary access | Requires wrapper for dot-path access on dictionaries |
| **Roslyn Scripting** | Full C# expressions, powerful | Heavier, startup cost, security surface |
| **NCalc** | Lightweight, math-focused | Limited string/collection ops |
| **Custom adapter** | Exact expr-lang compat | High effort |

**Recommendation:** Start with **DynamicExpresso** — it supports C#-like expressions with sandboxing, and we can create a thin adapter that wraps `Dictionary<string, object?>` values as accessible parameters. Syntax example: `record["status"] == "paid" && old["status"] != "paid"`. If needed, create a preprocessor that converts `record.status` → `record["status"]` to maintain expr-lang compatibility in stored expressions.

---

## Concurrency Model

| Concern | Go | .NET |
|---------|-----|------|
| Async webhooks | `go func(){}()` | `Task.Run()` or `Channel<T>` consumer |
| Background scheduler | `time.NewTicker` goroutine | `IHostedService` + `PeriodicTimer` |
| Event buffer | Channel + goroutine consumer | `Channel<T>` + `BackgroundService` reader |
| Metadata registry | `sync.RWMutex` | `ReaderWriterLockSlim` |
| App context map | `sync.Map` | `ConcurrentDictionary<string, AppContext>` |
| Trace ID propagation | `context.Context` | `AsyncLocal<TraceContext>` |
| HTTP client | stdlib `net/http` | `IHttpClientFactory` (pooled) |
| DB connection pool | pgx pool | `NpgsqlDataSource` (built-in pooling) |

---

## .NET-Specific Advantages

1. **`System.Threading.Channels`** — ideal for event buffer (bounded/unbounded, backpressure)
2. **`IHostedService`** — clean lifecycle for background schedulers (startup/shutdown hooks)
3. **`NpgsqlDataSource`** — modern connection management, multiplexing support
4. **`AsyncLocal<T>`** — native async-aware thread-local, perfect for trace propagation
5. **`IHttpClientFactory`** — handles `HttpClient` lifecycle, avoids socket exhaustion
6. **Records** — immutable metadata types with value equality built-in
7. **Pattern matching** — clean `switch` expressions for step types, action types, rule types
8. **Minimal APIs** — low-ceremony routing, endpoint filters as middleware

---

## Testing Strategy

### Unit Tests (xUnit)
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
- Run same test suite against Go, Express, and .NET backends
- Verify identical response structure, error codes, behavior

---

## Running

```bash
# Start Postgres (reuse root docker-compose)
docker compose up -d

# Run .NET backend
cd dotnet/src/Rocket.Api
dotnet run                          # Default port 8080

# Or build and run
dotnet publish -c Release -o out
./out/Rocket.Api

# Run tests
cd dotnet
dotnet test

# Admin UI (proxies to 8080)
cd admin && npm run dev
```

---

## NuGet Dependencies

```xml
<!-- Rocket.Api.csproj -->
<ItemGroup>
  <!-- Web -->
  <!-- (included via Microsoft.NET.Sdk.Web) -->

  <!-- Database -->
  <PackageReference Include="Npgsql" Version="9.*" />
  <PackageReference Include="Microsoft.Data.Sqlite" Version="9.*" />

  <!-- JWT -->
  <PackageReference Include="Microsoft.AspNetCore.Authentication.JwtBearer" Version="9.*" />
  <PackageReference Include="System.IdentityModel.Tokens.Jwt" Version="8.*" />

  <!-- Password Hashing -->
  <PackageReference Include="BCrypt.Net-Next" Version="4.*" />

  <!-- Config -->
  <PackageReference Include="YamlDotNet" Version="16.*" />

  <!-- Expression Engine -->
  <PackageReference Include="DynamicExpresso.Core" Version="2.*" />

  <!-- JSON (System.Text.Json is built-in) -->
</ItemGroup>

<!-- Rocket.Api.Tests.csproj -->
<ItemGroup>
  <PackageReference Include="xunit" Version="2.*" />
  <PackageReference Include="Testcontainers.PostgreSql" Version="4.*" />
  <PackageReference Include="Microsoft.AspNetCore.Mvc.Testing" Version="9.*" />
</ItemGroup>
```

---

## Risk & Mitigation

| Risk | Mitigation |
|------|------------|
| Expression engine syntax mismatch with expr-lang | Adapter layer + preprocessor to normalize `record.field` → `record["field"]` |
| `System.Text.Json` dynamic dictionary handling | Custom `JsonConverter` for `Dictionary<string, object?>` to handle nested types correctly |
| Npgsql parameter naming (`$1` vs `@p1`) | Postgres dialect generates `$1`-style params; Npgsql supports both |
| Background service lifecycle on shutdown | `IHostedService.StopAsync` with `CancellationToken` — drain event buffer, finish in-flight webhooks |
| Route conflicts between admin and dynamic | Minimal APIs resolves specific patterns first; integration tests verify routing |

---

## Success Criteria

1. All Phase 0-8 features functional and tested
2. API responses identical to Go/Express/Java backends (same JSON structure, error codes, HTTP status codes)
3. Admin UI (`admin/`) works with .NET backend without modifications
4. Client app (`client/`) works with .NET backend without modifications
5. All integration tests pass against Testcontainers Postgres
6. Performance: at least on par with Go backend for typical CRUD operations (ASP.NET is historically very fast)
