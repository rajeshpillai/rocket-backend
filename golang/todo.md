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
- [x] Runtime HTTP endpoints (`/api/_workflows/pending`, `/:id`, `/:id/approve`, `/:id/reject`, `DELETE /:id`)
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

## Schema Export/Import [DONE]
- [x] `Export` method in admin handler — queries all 7 metadata tables, returns clean JSON (no IDs/timestamps)
- [x] `Import` method in admin handler — dependency-ordered import with idempotent dedup per table
- [x] Routes wired in both standalone (`admin/handler.go`) and multiapp (`app_routes.go`)

---

## Phase 8: Instrumentation & Events [DONE]
- [x] `_events` system table (id UUID, trace_id UUID, span_id UUID, parent_span_id UUID, event_type TEXT, source TEXT, component TEXT, action TEXT, entity TEXT, record_id TEXT, user_id UUID, duration_ms DOUBLE PRECISION, status TEXT, metadata JSONB, created_at TIMESTAMPTZ)
- [x] Indexes: trace_id, entity+created_at DESC, created_at DESC, event_type+source
- [x] Instrumenter interface: `StartSpan(ctx, source, component, action) → (ctx, Span)`, `EmitBusinessEvent(ctx, action, entity, recordID, metadata)`
- [x] Span type: `End()`, `SetStatus()`, `SetMetadata()`, `TraceID()`, `SpanID()`
- [x] Trace ID propagation via `context.Context` — generate UUID per request or accept `X-Trace-ID` header
- [x] Auto-instrumented system events:
  - [x] HTTP middleware: request.start, request.end (method, path, status, latency)
  - [x] Auth middleware: auth.validate, auth.login, auth.denied
  - [x] Permission engine: permission.check, permission.denied
  - [x] DB query wrapper: query.execute (SQL fingerprint, duration, rows affected)
  - [x] Write pipeline stages: write.validate, write.rules, write.state_machine, write.insert, write.update, write.delete
  - [x] Nested writes: nested_write.plan, nested_write.child (per child op)
  - [x] Webhook dispatch: webhook.match, webhook.dispatch, webhook.success, webhook.fail, webhook.circuit_open
  - [x] Workflow engine: workflow.trigger, workflow.advance, workflow.approve, workflow.reject, workflow.timeout
  - [x] File storage: file.upload, file.serve, file.delete
- [x] Fire-and-forget event writes via async write buffer (batch flush, `synchronous_commit = off`)
- [x] Business event API:
  - [x] `POST /api/:app/_events` — emit custom business events (entity, action, metadata)
  - [x] `GET /api/:app/_events` — query events (?source, ?entity, ?trace_id, ?user_id, ?status, ?from, ?to, page, per_page)
  - [x] `GET /api/:app/_events/trace/:trace_id` — full trace waterfall (all spans for a trace)
  - [x] `GET /api/:app/_events/stats` — aggregate stats (count, avg latency by source/entity/action, error rate)
- [x] Config in app.yaml: `instrumentation.enabled` (default true), `instrumentation.retention_days` (default 7), `instrumentation.sampling_rate` (default 1.0)
- [x] Background retention cleanup job (delete events older than retention period)
- [x] Multi-app support: events scoped per-app database, scheduler iterates all apps for cleanup
- [x] Admin UI: Event stream page (filterable table, color-coded by source)
- [x] Admin UI: Trace waterfall view (nested span timeline for a single trace_id)
- [x] Admin UI: Stats overview dashboard (request count, avg latency, error rate, slowest traces)

## Phase 9: Audit Log
- [ ] `_audit_logs` system table (id, entity, record_id, action, old_data JSONB, new_data JSONB, changed_fields TEXT[], user_id, user_email, ip_address, timestamp)
- [ ] Audit log capture in write pipeline (create, update, delete — record before/after snapshots)
- [ ] Automatic diff computation (which fields changed, old vs new values)
- [ ] User context (who, from where) attached to every audit entry
- [ ] Query API (`GET /api/:app/_admin/audit-logs`) with filters (?entity, ?record_id, ?user_id, ?action, ?from, ?to)
- [ ] Pagination + sorting on audit log queries
- [ ] Record history endpoint (`GET /api/:app/:entity/:id/history`) — all changes for a single record
- [ ] Configurable per-entity (opt-in/opt-out via entity definition)
- [ ] Sensitive field masking (password fields, PII) in audit entries
- [ ] Admin UI: Audit log viewer page with filters and record timeline view

## Phase 10: Email Providers & Templates (see [docs/email-providers.md](../docs/email-providers.md))
- [ ] `_email_providers` system table (id, name UNIQUE, provider, config JSONB, priority, active, created_at, updated_at)
- [ ] `_email_templates` system table (id, key UNIQUE, subject, body_html, body_text, active, created_at, updated_at)
- [ ] `_email_logs` system table (id, provider_id FK, template_key, to_email, subject, status, provider_response JSONB, error, attempt, created_at)
- [ ] Provider adapters: SendGrid, Postmark, SMTP, Resend, Mailgun
- [ ] Template engine: `{{variable}}` substitution (reuse webhook `{{env.VAR}}` pattern)
- [ ] Built-in default templates: invite, welcome, password_reset
- [ ] Async email dispatch (fire-and-forget after API response, same pattern as async webhooks)
- [ ] Provider fallback: try providers in priority order, log failures
- [ ] Secrets via `{{env.VAR}}` references in provider config (never stored in plaintext)
- [ ] App settings: `invite_accept_url` template for generating clickable links
- [ ] Integration: invite creation → auto-send invite email (if provider configured)
- [ ] Integration: accept-invite → auto-send welcome email (if provider configured)
- [ ] Admin API: provider CRUD + test endpoint (`POST /_admin/email/providers/:id/test`)
- [ ] Admin API: template CRUD + preview endpoint (`POST /_admin/email/templates/:id/preview`)
- [ ] Admin API: email log query (`GET /_admin/email/logs`)
- [ ] Admin API: ad-hoc send (`POST /_admin/email/send`)
- [ ] Admin UI: Email Providers page (add/edit/test, priority ordering)
- [ ] Admin UI: Email Templates page (edit subject/body, variable reference, preview)
- [ ] Admin UI: Email Logs page (delivery status, filters)

## Phase 11: API Connectors & Workflow Actions (see [docs/api-connectors.md](../docs/api-connectors.md))
- [ ] `_api_connectors` system table (name, base_url, auth_type, auth_config JSONB, default_headers JSONB, timeout_ms, retry JSONB, active)
- [ ] Auth types: `none`, `bearer`, `basic`, `api_key`, `custom_header` with `{{env.VAR}}` secret resolution
- [ ] Connector CRUD admin API (`/api/_admin/api-connectors`) + test endpoint
- [ ] New workflow action: `http_request` — call external API via connector, map response into context
- [ ] New workflow action: `send_email` — send email via provider + template
- [ ] New workflow action: `update_record`, `delete_record`, `transform`, `delay`
- [ ] Implement stubs: `create_record`, `send_event`
- [ ] New workflow step type: `http_request` — call API and branch on success/error
- [ ] New state machine transition actions: `http_request`, `send_email`
- [ ] New rule type: `http_validate` — validate against external API before write
- [ ] Response mapping (dot-path extraction from JSON response into workflow context)
- [ ] Admin UI: API Connectors settings page

## Phase 12: Comments & Activity Stream
- [ ] `_comments` system table (id, entity, record_id, user_id, user_email, body, parent_id, created_at, updated_at)
- [ ] `_activity` system table (id, entity, record_id, type [comment/state_change/workflow/field_update], summary, user_id, metadata JSONB, created_at)
- [ ] Comment CRUD endpoints (`POST/GET/PUT/DELETE /api/:app/:entity/:id/comments`)
- [ ] Threaded comments (parent_id for replies)
- [ ] Auto-generated activity entries (state machine transitions, workflow step changes, field updates)
- [ ] Activity stream endpoint (`GET /api/:app/:entity/:id/activity`) — merged timeline of comments + system events
- [ ] Mention support (@user references in comment body)
- [ ] Permission-aware (comment visibility respects entity read permissions)
- [ ] Admin UI: Activity/comment panel on data record detail view

## Phase 13: Parallel & Advanced Workflows
- [ ] Parallel approval gates: AND (all must approve), OR (any one approves), N-of-M (quorum)
- [ ] Multi-approver step type (roles/users list, approval threshold)
- [ ] Delegation: user A delegates approval authority to user B (time-bounded)
- [ ] Escalation rules: if no response within deadline, escalate to next role/user
- [ ] Workflow step forms: per-step field definitions (collect rejection reason, approval notes, extra data)
- [ ] Workflow variables: step outputs feed into subsequent step inputs
- [ ] Sub-workflows: a step can trigger another workflow and wait for completion
- [ ] Cancel/abort workflow instance endpoint
- [ ] Reassign approval step to different user
- [ ] Admin UI: Enhanced workflow builder with parallel gates, delegation config, step forms

## Phase 14: Field-Level Permissions & Conditional Visibility
- [ ] Field-level permission rules in `_permissions` (fields array: include/exclude per role+action)
- [ ] Read filtering: strip restricted fields from API responses based on user role
- [ ] Write filtering: reject writes to restricted fields with field-level error details
- [ ] Conditional field visibility rules (show/hide based on record state, role, or expression)
- [ ] Field masking (partial display: last 4 digits of SSN, masked email)
- [ ] Admin UI: Field permission matrix editor (role × field × action grid)

## Phase 15: SSO & External Auth
- [ ] OAuth 2.0 / OpenID Connect provider support (authorization code flow)
- [ ] SAML 2.0 SP implementation (for enterprise IdPs like Okta, Azure AD, OneLogin)
- [ ] LDAP/Active Directory bind authentication
- [ ] Configurable auth providers per app (in app settings or `_auth_providers` table)
- [ ] Auto-provisioning: create local user on first SSO login (JIT provisioning)
- [ ] Role mapping: map IdP groups/claims to Rocket roles
- [ ] Session management (SSO sessions, single logout)
- [ ] Admin UI: Auth provider configuration page

## Phase 16: Reporting & Dashboards
- [ ] Aggregate query endpoint (`GET /api/:app/:entity/_aggregate`) — count, sum, avg, min, max, group_by
- [ ] Workflow KPI queries: avg approval time, bottleneck steps, SLA breach counts, pending by approver
- [ ] Dashboard metadata (`_dashboards` table) — saved dashboard definitions with widget configs
- [ ] Widget types: counter, bar chart data, table, timeline
- [ ] Data export endpoint (CSV/JSON download for filtered queries)
- [ ] Scheduled reports (cron-based, email delivery via notification channels)
- [ ] Admin UI: Dashboard builder + KPI overview page

## Phase 17: Bulk Operations & API Hardening
- [ ] Bulk create endpoint (`POST /api/:app/:entity/_bulk` — array of records, transactional)
- [ ] Bulk update endpoint (`PUT /api/:app/:entity/_bulk` — array of {id, ...fields}, transactional)
- [ ] Bulk delete endpoint (`DELETE /api/:app/:entity/_bulk` — array of IDs)
- [ ] Bulk approve/reject for workflow instances
- [ ] API rate limiting (per-user, per-app, configurable in app.yaml)
- [ ] Request size limits + payload validation hardening
- [ ] API key authentication (alternative to JWT for service-to-service calls)
- [ ] Admin UI: Bulk import page (CSV/JSON upload with field mapping)

---

## Entity Slugs [DONE]
- [x] `SlugConfig` struct (Field, Source, RegenerateOnUpdate) + `Slug *SlugConfig` on Entity
- [x] `slugify()` utility + auto-generate slug from source field on create
- [x] Conflict handling: append `-2`, `-3`, etc. on unique violation
- [x] Slug-based record lookup in `FetchRecord`: if ID doesn't match PK type, try slug field first
- [x] Validation on entity save: slug field must exist, be unique, be string type; source field must exist
- [x] Workflow context shorthand aliases (`record.*` alongside `trigger.record.*`)

## User Invites (done)
- [x] `_invites` system table (DDL in both Postgres and SQLite dialects)
- [x] Admin endpoints: `POST /_admin/invites`, `GET /_admin/invites`, `DELETE /_admin/invites/:id`
- [x] Bulk invite endpoint: `POST /_admin/invites/bulk` (shared roles, skip & report)
- [x] Public endpoint: `POST /auth/accept-invite` (token + password → user creation + auto-login)
- [x] Validation: duplicate email, pending invite, expired token, already accepted
- [x] Transaction safety for user creation + invite acceptance
- [x] Route registration (multi-app + standalone)

## AI Schema Generator
- [ ] `AIConfig` struct (BaseURL, APIKey, Model) — config via env vars or app.yaml
- [ ] `AIProvider` — OpenAI-compatible chat completions client using `net/http`
- [ ] `BuildSystemPrompt()` — full Rocket schema spec (reuse same prompt as Express)
- [ ] `AIHandler` — `Status` (GET) and `Generate` (POST) handlers
- [ ] Wiring: AIConfig in config, aiHandler in AppContext, routes in app-routes, platform-level `/ai/status`

---

## Nice to Have
- [ ] **Role master table** (`_roles`): name (PK), display_name, description, created_at — enables role discovery, autocomplete in admin UI, typo prevention on role assignment, and bulk role rename/revoke across users
- [ ] **Per-entity query caching**: metadata-driven cache config in entity definition (`cache.enabled`, `cache.ttl`, `cache.max_size`, `cache.strategy`), auto-invalidate on write, skip for entities with row-level permissions, global config in app.yaml (`cache.driver: memory|redis`, `cache.default_ttl`), admin purge endpoint (`DELETE /_cache/:entity`)
- [ ] **Multi-RDBMS adapter support**: SQL dialect abstraction layer (placeholder style, type mapping, DDL generation, pagination syntax, JSON operations, upsert), driver interface (query/exec/beginTx/close), supported targets: SQLite (zero-infra single-binary deployment, file-per-app), MySQL, SQL Server, Oracle. Key refactors: replace `TEXT[]` with JSON for roles/arrays, generate UUIDs in app code not DDL defaults, abstract `JSONB` operations to dialect-specific `json_extract`/`JSON_VALUE`, feature-flag `percentile_cont` for DBs that lack it. Config: `database.driver: postgres|sqlite|mysql|mssql|oracle`
