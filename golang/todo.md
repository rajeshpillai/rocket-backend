# Rocket Backend — Go (Fiber) Implementation

## Phase 0: Foundation [DONE]
- [x] Scaffolding (go.mod, app.yaml, config loader)
- [x] Metadata types (field, entity, relation, registry)
- [x] Database layer (postgres store, bootstrap, migrator, loader)
- [x] Query builder (filters, sorting, pagination, soft-delete)
- [x] Writer + nested writes (diff/replace/append modes)
- [x] HTTP handlers (CRUD, admin API, dynamic routing, includes)
- [x] Entry point (main.go)

## Phase 1: Validation Rules [DONE]
- [x] `_rules` system table + bootstrap DDL
- [x] Rule metadata types + loader into registry
- [x] Admin API for rule CRUD (`/api/_admin/rules`)
- [x] Field rules engine (min, max, min_length, max_length, pattern)
- [x] Expression rules engine (expr-lang/expr compilation + evaluation)
- [x] Computed fields (expression that sets a value before write)
- [x] Rule evaluation wired into write pipeline (`before_write` hook)
- [x] Unique constraint violations return 409 CONFLICT

## Phase 2: State Machines [DONE]
- [x] `_state_machines` system table + bootstrap DDL
- [x] State machine metadata types (StateMachine, Transition, TransitionAction, TransitionFrom)
- [x] Custom JSON marshal/unmarshal for `from` field (string or array)
- [x] Loader + registry integration (GetStateMachinesForEntity, LoadStateMachines)
- [x] Admin API for state machine CRUD (`/api/_admin/state-machines`)
- [x] Transition validation (from/to state matching, array `from` support)
- [x] Guard expressions (expr-lang/expr, true = allowed, false = blocked)
- [x] Transition actions: `set_field` (with `"now"` = timestamp), webhook/create_record/send_event (stubs)
- [x] Roles array stored but not enforced (until Auth phase)
- [x] State machine evaluation wired into write pipeline (after rules, before SQL)
- [x] Unit tests (10) + integration tests (enforcement + CRUD)

## Phase 3: Workflows [DONE]
- [x] `_workflows` + `_workflow_instances` system tables + bootstrap DDL
- [x] Workflow metadata types (Workflow, WorkflowStep, StepGoto with custom JSON marshal)
- [x] Registry integration (workflowsByTrigger, workflowsByName, GetWorkflowsForTrigger, GetWorkflow)
- [x] Loader (loadWorkflows from _workflows table)
- [x] Admin API for workflow CRUD (`/api/_admin/workflows`) with validation
- [x] Workflow execution engine (TriggerWorkflows, advanceWorkflow, executeStep)
- [x] Step types: action (set_field UPDATE), condition (expr-lang/expr), approval (pause + deadline)
- [x] Post-commit workflow trigger hook in nested_write.go
- [x] Runtime HTTP endpoints (`/api/_workflows/pending`, `/:id`, `/:id/approve`, `/:id/reject`)
- [x] Background timeout scheduler (60s goroutine ticker)
- [x] Unit tests (8 metadata + engine tests) + integration tests (11 tests: CRUD, trigger, approval, rejection, condition branching)

## Phase 4: Auth & Permissions [DONE]
- [x] `_users`, `_refresh_tokens`, `_permissions` system tables + bootstrap DDL
- [x] JWT secret in config (`jwt_secret` field in app.yaml)
- [x] Auth types (UserContext in metadata package to avoid import cycle)
- [x] JWT helpers (HS256 access tokens, opaque UUID refresh tokens, bcrypt password hashing)
- [x] Seed admin user on first boot (`admin@localhost` / `changeme` with `["admin"]` role)
- [x] Auth handler (login, refresh with rotation, logout) at `/api/auth/*`
- [x] Auth middleware (JWT validation, sets `c.Locals("user")`)
- [x] Admin-only middleware (checks `user.Roles` contains `"admin"`)
- [x] Permission types (Permission, PermissionCondition) + registry + loader
- [x] Permission engine (CheckPermission, GetReadFilters) — whitelist model, admin bypass
- [x] Permission checks in all 5 CRUD handlers (list, getById, create, update, delete)
- [x] Row-level read filtering (permission conditions injected as WHERE clauses)
- [x] Write permission conditions (fetch current record, check against conditions)
- [x] User admin CRUD (`/api/_admin/users`) — password hashed, never returned
- [x] Permission admin CRUD (`/api/_admin/permissions`)
- [x] Auth routes wired before middleware in main.go
- [x] Integration tests (11 new: login/refresh/logout, invalid credentials, middleware rejection, admin bypass, permission grants/denies, row-level filtering, write conditions, user CRUD, permission CRUD, disabled user)

## Phase 5: Webhooks [DONE]
- [x] `_webhooks` + `_webhook_logs` system tables + bootstrap DDL
- [x] Webhook metadata types (Webhook, WebhookRetry)
- [x] Registry integration (webhooksByEntityHook, GetWebhooksForEntityHook, LoadWebhooks)
- [x] Loader (loadWebhooks from _webhooks table, JSONB headers/retry parsing)
- [x] Admin API for webhook CRUD (`/api/_admin/webhooks`) with validation
- [x] Admin API for webhook logs (`/api/_admin/webhook-logs`) with filters (?webhook_id, ?status, ?entity)
- [x] Manual retry endpoint (`POST /api/_admin/webhook-logs/:id/retry`)
- [x] Webhook dispatch engine (buildPayload, computeChanges, resolveHeaders, evaluateCondition, dispatch)
- [x] Async webhooks: fire after commit in goroutine, log to `_webhook_logs`, retry on failure
- [x] Sync webhooks: fire inside transaction before commit, non-2xx causes rollback
- [x] Header template resolution (`{{env.VAR_NAME}}` → os env values)
- [x] Condition expressions (expr-lang/expr, same env as rules: record, old, changes, action, entity, user)
- [x] Webhook payload (event, entity, action, record, old, changes, user, timestamp, idempotency_key)
- [x] Integration into write flow: `before_write` sync + `after_write` async in ExecuteWritePlan
- [x] Integration into delete flow: `before_delete` sync + `after_delete` async in Delete handler
- [x] User context passed through WritePlan for webhook payloads
- [x] Background retry scheduler (30s goroutine ticker, exponential backoff: 30s × 2^attempt)
- [x] State machine webhook stub replaced with real DispatchWebhookDirect (fire-and-forget)
- [x] Workflow webhook stub replaced with real DispatchWebhookDirect (synchronous, step waits)

## Phase 6: Multi-App (Database-per-App) [DONE]
- [x] Config: `platform_jwt_secret` and `app_pool_size` in config struct + app.yaml
- [x] Store: `NewWithPoolSize()`, `ConnStringForDB()`, `CreateDatabase()`, `DropDatabase()`, `isValidDBName()`
- [x] Platform bootstrap: `_apps`, `_platform_users`, `_platform_refresh_tokens` tables + seed platform admin
- [x] AppContext struct (Store, Registry, Migrator, EngineHandler, AdminHandler, AuthHandler, WorkflowHandler)
- [x] AppManager (Get/Create/Delete/List/LoadAll/AllContexts/Close) with lazy initialization
- [x] Platform handler (Login/Refresh/Logout against platform users, ListApps/GetApp/CreateApp/DeleteApp)
- [x] App resolver middleware (extracts `:app`, looks up AppContext)
- [x] App auth middleware (tries app JWT secret, falls back to platform JWT)
- [x] Platform auth middleware (platform JWT only)
- [x] App-scoped route registration (dispatch pattern delegates to per-app handlers)
- [x] Route restructure: management DB bootstrap → AppManager → platform routes → app-scoped routes
- [x] Multi-app scheduler (iterates all AppContexts for workflow timeouts + webhook retries)
- [x] Exported `ProcessWorkflowTimeouts()` and `ProcessWebhookRetries()` for multi-app scheduler

## Phase 7: File Uploads [DONE]
- [x] Config: `StorageConfig` struct (Driver, LocalPath, MaxFileSize) in config.go + app.yaml
- [x] Storage interface (`storage/storage.go`): `FileStorage` with Save/Open/Delete methods
- [x] Local storage implementation (`storage/local.go`): disk-based, `{basePath}/{appName}/{fileID}/{filename}`
- [x] `_files` system table added to bootstrap DDL
- [x] File handler (`engine/file_handler.go`): Upload, Serve, Delete, List endpoints
- [x] `file` field type maps to JSONB in `PostgresType()` (metadata/field.go)
- [x] Write pipeline: `resolveFileFields()` in nested_write.go — UUID → full JSONB metadata `{id, filename, size, mime_type}`
- [x] AppContext: added `FileHandler`, `fileStorage`, `maxFileSize`; FileHandler built in `BuildHandlers()`
- [x] AppManager: accepts `FileStorage` + `maxFileSize`, passes to AppContext construction
- [x] Route registration: file routes under `/_files` (upload, serve, delete, list) in app_routes.go
- [x] Entry point: `LocalStorage` created from config, passed to `NewAppManager`
