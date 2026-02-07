# Rocket Backend — Express.js Implementation

## Phase 0: Foundation [DONE]
- [x] Scaffolding (package.json, tsconfig, app.yaml, config loader)
- [x] Metadata types (Field, Entity, Relation, PrimaryKey interfaces + utilities)
- [x] Registry (in-memory metadata cache)
- [x] Database layer (pg Pool, queryRows/queryRow/exec, bootstrap, migrator, loader)
- [x] Query builder (filters, sorting, pagination, soft-delete)
- [x] Writer + nested writes (diff/replace/append modes)
- [x] HTTP handlers (CRUD, admin API, dynamic routing, includes)
- [x] Entry point (index.ts)

## Phase 1: Validation Rules [DONE]
- [x] `_rules` system table + bootstrap DDL
- [x] Rule metadata types + loader into registry
- [x] Admin API for rule CRUD (`/api/_admin/rules`)
- [x] Field rules engine (min, max, min_length, max_length, pattern)
- [x] Expression rules engine (Function constructor with `with(env)` evaluation)
- [x] Computed fields (expression that sets a value before write)
- [x] Rule evaluation wired into write pipeline (`before_write` hook)
- [x] Unique constraint violations return 409 CONFLICT

## Phase 2: State Machines [DONE]
- [x] `_state_machines` system table + bootstrap DDL
- [x] State machine metadata types (StateMachine, Transition, TransitionAction)
- [x] `normalizeDefinition()` for `from` field (string or array → always array)
- [x] Loader + registry integration (getStateMachinesForEntity, loadStateMachines)
- [x] Admin API for state machine CRUD (`/api/_admin/state-machines`)
- [x] Transition validation (from/to state matching, array `from` support)
- [x] Guard expressions (Function constructor with `with(env)`, true = allowed, false = blocked)
- [x] Transition actions: `set_field` (with `"now"` = ISO timestamp), webhook/create_record/send_event (stubs)
- [x] Roles array stored but not enforced (until Auth phase)
- [x] State machine evaluation wired into write pipeline (after rules, before SQL)
- [x] Integration tests (5 enforcement + 6 CRUD)

## Phase 3: Workflows [DONE]
- [x] `_workflows` + `_workflow_instances` system tables + bootstrap DDL
- [x] Workflow metadata types (interfaces, parseStepGoto, normalizeWorkflowSteps)
- [x] Registry integration (workflowsByTrigger, workflowsByName, getWorkflowsForTrigger, getWorkflow)
- [x] Loader (loadWorkflows from _workflows table)
- [x] Admin API for workflow CRUD (`/api/_admin/workflows`) with validation
- [x] Workflow execution engine (triggerWorkflows, advanceWorkflow, executeStep)
- [x] Step types: action (set_field UPDATE), condition (Function + with(env)), approval (pause + deadline)
- [x] Post-commit workflow trigger hook in nested-write.ts
- [x] Runtime HTTP endpoints (`/api/_workflows/pending`, `/:id`, `/:id/approve`, `/:id/reject`)
- [x] Background timeout scheduler (60s setInterval)
- [x] Integration tests (7 new workflow tests: CRUD, trigger, approval, rejection, condition branching)

## Phase 4: Auth & Permissions [DONE]
- [x] `_users`, `_refresh_tokens`, `_permissions` system tables + bootstrap DDL
- [x] JWT secret in config (`jwt_secret` field in app.yaml)
- [x] Auth types (UserContext, TokenPair, Claims) + JWT helpers (jsonwebtoken) + bcrypt (bcryptjs)
- [x] Seed admin user on first boot (`admin@localhost` / `changeme` with `["admin"]` role)
- [x] Auth handler (login, refresh with rotation, logout) at `/api/auth/*`
- [x] Auth middleware (JWT validation, sets `req.user` via Express Request type augmentation)
- [x] Admin-only middleware (checks `req.user.roles` contains `"admin"`)
- [x] Permission types (Permission, PermissionCondition) + registry + loader
- [x] Permission engine (checkPermission, getReadFilters) — whitelist model, admin bypass
- [x] Permission checks in all 5 CRUD handlers (list, getById, create, update, delete)
- [x] Row-level read filtering (permission conditions injected as WHERE clauses)
- [x] Write permission conditions (fetch current record, check against conditions)
- [x] User admin CRUD (`/api/_admin/users`) — password hashed, never returned
- [x] Permission admin CRUD (`/api/_admin/permissions`)
- [x] Auth routes wired before middleware in index.ts
- [x] Route registration functions accept variadic middleware (`...middleware: RequestHandler[]`)
- [x] Integration tests (11 new: login/refresh/logout, invalid credentials, middleware rejection, admin bypass, permission grants/denies, row-level filtering, write conditions, user CRUD, permission CRUD, disabled user)

## Phase 5: Webhooks [DONE]
- [x] `_webhooks` + `_webhook_logs` system tables + bootstrap DDL
- [x] Webhook metadata types (Webhook, WebhookRetry interfaces)
- [x] Registry integration (webhooksByEntityHook, getWebhooksForEntityHook, loadWebhooks)
- [x] Loader (loadWebhooks from _webhooks table)
- [x] Admin API for webhook CRUD (`/api/_admin/webhooks`) with validation
- [x] Admin API for webhook logs (`/api/_admin/webhook-logs`) with filters (?webhook_id, ?status, ?entity)
- [x] Manual retry endpoint (`POST /api/_admin/webhook-logs/:id/retry`)
- [x] Webhook dispatch engine (buildPayload, computeChanges, resolveHeaders, evaluateCondition, dispatch)
- [x] Async webhooks: fire after commit in background, log to `_webhook_logs`, retry on failure
- [x] Sync webhooks: fire inside transaction before commit, non-2xx throws error for rollback
- [x] Header template resolution (`{{env.VAR_NAME}}` → process.env values)
- [x] Condition expressions (Function constructor with `with(env)`, same env as rules)
- [x] Webhook payload (event, entity, action, record, old, changes, user, timestamp, idempotency_key)
- [x] Integration into write flow: `before_write` sync + `after_write` async in executeWritePlan
- [x] Integration into delete flow: `before_delete` sync + `after_delete` async in delete handler
- [x] User context passed through WritePlan for webhook payloads
- [x] Background retry scheduler (30s setInterval, exponential backoff: 30s × 2^attempt)
- [x] State machine webhook stub replaced with real dispatchWebhookDirect (fire-and-forget)
- [x] Workflow webhook stub replaced with real dispatchWebhookDirect (synchronous, step waits)

## Phase 6: Multi-App (Database-per-App) [DONE]
- [x] Config: `platform_jwt_secret` and `app_pool_size` in Config interface + app.yaml
- [x] Store: `connectWithPoolSize()`, `connectToDB()`, `createDatabase()`, `dropDatabase()`
- [x] Platform bootstrap: `_apps`, `_platform_users`, `_platform_refresh_tokens` tables + seed platform admin
- [x] AppContext interface (store, registry, migrator, engineHandler, adminHandler, authHandler, workflowHandler)
- [x] AppManager class (get/create/delete/list/loadAll/allContexts/close) with Promise-based concurrency guard
- [x] Platform handler (login/refresh/logout against platform users, listApps/getApp/createApp/deleteApp)
- [x] App resolver middleware (extracts `:app`, looks up AppContext, sets `req.appCtx`)
- [x] App auth middleware (tries app JWT secret, falls back to platform JWT)
- [x] Platform auth middleware (platform JWT only)
- [x] App-scoped route registration (dispatch pattern delegates to per-app handlers, mergeParams routers)
- [x] Route restructure: management DB bootstrap → AppManager → platform routes → app-scoped routes
- [x] Multi-app scheduler (iterates all AppContexts for workflow timeouts + webhook retries)
- [x] Exported `processWorkflowTimeouts()` and `processWebhookRetries()` for multi-app scheduler
