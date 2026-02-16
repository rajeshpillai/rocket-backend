# Rocket Backend — .NET (ASP.NET Core Minimal APIs) Implementation

## Phase 0: Foundation
- [ ] Project scaffolding (.NET 9, Rocket.Api.csproj, Rocket.sln, app.yaml)
- [ ] Config loader (AppConfig from app.yaml via YamlDotNet)
- [ ] Database layer (Store with NpgsqlDataSource, async query/exec helpers)
- [ ] System table bootstrap (all _* tables DDL)
- [ ] SQL dialect abstraction (Postgres + SQLite)
- [ ] Metadata types (Entity, Field, Relation records) + Registry with ReaderWriterLockSlim
- [ ] Metadata loader (read from _entities, _relations system tables)
- [ ] Auto-migrator (CREATE TABLE on entity create, ALTER TABLE ADD COLUMN on field add)
- [ ] Query builder (filters, sorting, pagination, soft-delete, parameterized SQL)
- [ ] CRUD handlers (list, getById, create, update, delete)
- [ ] Include loader (separate queries for relations, no JOINs)
- [ ] Nested writes (diff/replace/append modes, FK propagation, plan-then-execute)
- [ ] Admin API for entity + relation CRUD with auto-migration
- [ ] Dynamic routing (Minimal APIs route groups, admin before dynamic)
- [ ] Standard error format (ExceptionMiddleware, error codes)
- [ ] Health endpoint

## Phase 1: Validation Rules
- [ ] Rule metadata types + loader + registry integration
- [ ] Admin API for rule CRUD (`/_admin/rules`)
- [ ] Field rules engine (min, max, min_length, max_length, pattern, required, enum)
- [ ] Expression rules engine (DynamicExpresso, boolean eval against record context)
- [ ] Computed fields (expression → set value before write)
- [ ] Wire into write pipeline (`before_write` hook)
- [ ] Unique constraint violations → 409 CONFLICT

## Phase 2: State Machines
- [ ] StateMachine, Transition, TransitionAction metadata types
- [ ] Custom JsonConverter for `from` field (string or array)
- [ ] Loader + registry integration
- [ ] Admin API for state machine CRUD (`/_admin/state-machines`)
- [ ] Transition validation (from/to matching, array `from`, role check)
- [ ] Guard expressions (true = allowed)
- [ ] Transition actions: set_field (with "now"), webhook, create_record/send_event stubs
- [ ] Wire into write pipeline (after rules, before SQL)

## Phase 3: Workflows
- [ ] Workflow, WorkflowStep, StepGoto metadata types
- [ ] Loader + registry integration
- [ ] Admin API for workflow CRUD (`/_admin/workflows`)
- [ ] Workflow engine (TriggerWorkflowsAsync, AdvanceAsync, ExecuteStepAsync)
- [ ] Step types: action, condition, approval
- [ ] Action types: set_field (UPDATE), webhook (HTTP), stubs
- [ ] Workflow instance management (create, update, query pending)
- [ ] Runtime endpoints (pending, detail, approve, reject)
- [ ] Background timeout scheduler (IHostedService, PeriodicTimer 60s)
- [ ] Post-commit trigger hook on state field changes

## Phase 4: Auth & Permissions
- [ ] JWT helpers (HS256, System.IdentityModel.Tokens.Jwt, 15min access, 7-day refresh)
- [ ] BCrypt password hashing (cost 12)
- [ ] Seed admin user on first boot
- [ ] AuthService (login, refresh with rotation, logout)
- [ ] AuthEndpoints (/auth/login, /auth/refresh, /auth/logout)
- [ ] AuthMiddleware (JWT extraction + validation, UserContext in HttpContext.Items)
- [ ] Admin-only filter (check "admin" role for /_admin/*)
- [ ] Permission metadata types + loader + registry
- [ ] PermissionEngine (CheckPermission, GetReadFilters, admin bypass)
- [ ] Permission checks in all 5 CRUD handlers
- [ ] Row-level read filtering (conditions → WHERE clauses)
- [ ] Write permission conditions (fetch record, check conditions)
- [ ] User admin CRUD (`/_admin/users`)
- [ ] Permission admin CRUD (`/_admin/permissions`)
- [ ] User invites (create, list, delete, bulk, accept-invite)

## Phase 5: Webhooks
- [ ] Webhook metadata types + loader + registry
- [ ] Admin API for webhook CRUD (`/_admin/webhooks`)
- [ ] Admin API for webhook logs + manual retry
- [ ] Webhook dispatch engine (payload, conditions, headers, HttpClient)
- [ ] Async webhooks (after_write/after_delete — Task.Run + retry)
- [ ] Sync webhooks (before_write/before_delete — non-2xx rolls back)
- [ ] Header template resolution (`{{env.VAR}}`)
- [ ] Background retry scheduler (IHostedService, 30s, exponential backoff)
- [ ] Wire into write + delete pipelines

## Phase 6: Multi-App (Database-per-App)
- [ ] Config: platform_jwt_secret, app_pool_size
- [ ] Management DB bootstrap (_apps, _platform_users, _platform_refresh_tokens)
- [ ] Seed platform admin (platform@localhost / changeme)
- [ ] Store: CreateDatabaseAsync, DropDatabaseAsync, per-app NpgsqlDataSource
- [ ] AppContext (Store, Registry, Migrator, all handlers)
- [ ] AppManager (LoadAllAsync, CreateAppAsync, DeleteAppAsync, GetContext)
- [ ] PlatformEndpoints (_platform/auth/*, _platform/apps/*)
- [ ] AppResolverMiddleware (extract :app, lookup AppContext)
- [ ] DualAuthMiddleware (app JWT → platform JWT fallback)
- [ ] Multi-app scheduler (IHostedService — timeouts, retries, event cleanup)

## Phase 7: File Uploads
- [ ] Config: storage driver, local_path, max_file_size
- [ ] IFileStorage interface + LocalFileStorage implementation
- [ ] FileEndpoints (upload via IFormFile, serve via Results.File, delete, list)
- [ ] `file` field type → JSONB mapping
- [ ] Write pipeline: UUID → JSONB metadata resolution

## Schema Export/Import
- [ ] Export all metadata as JSON (strip IDs/timestamps)
- [ ] Import with dependency-ordered insert + idempotent dedup
- [ ] Sample data support

## UI Configs
- [ ] `_ui_configs` system table + bootstrap
- [ ] Admin CRUD endpoints (`/_admin/ui-configs`)
- [ ] Public read endpoints (`/_ui/configs`, `/_ui/config/:entity`)

## Phase 8: Instrumentation & Events
- [ ] _events system table + indexes
- [ ] Instrumenter + Span lifecycle
- [ ] Trace ID propagation (AsyncLocal<TraceContext>, X-Trace-ID header)
- [ ] EventBuffer (Channel<T> based async batch writer)
- [ ] Auto-instrumented system events (HTTP, auth, DB, write, webhooks, workflows, files)
- [ ] Business event API (emit, query, trace waterfall, stats)
- [ ] Config (enabled, retention_days, sampling_rate)
- [ ] Background retention cleanup (IHostedService)
