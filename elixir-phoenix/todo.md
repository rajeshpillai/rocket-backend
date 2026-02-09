# Elixir/Phoenix Implementation — Phase Tracking

## Phase 0: Foundation ✅
- [x] Scaffold Phoenix project (API-only, no HTML/LiveView)
- [x] Dependencies: phoenix, bandit, jason, ecto_sql, postgrex, joken, bcrypt_elixir, yaml_elixir, req, mime
- [x] Store layer: postgres.ex (query_rows/query_row/exec), bootstrap.ex (14 system tables), migrator.ex (CREATE/ALTER TABLE), schema.ex (type mapping)
- [x] Metadata types: Entity, Field, PrimaryKey, Relation structs in types.ex
- [x] Registry GenServer: in-memory metadata cache with all lookup functions
- [x] Loader: read from DB, parse JSONB, populate registry
- [x] Query builder: parse_query_params, build_select_sql, build_count_sql with $N placeholders
- [x] Writer: build_insert_sql, build_update_sql, validate_fields, separate_fields_and_relations
- [x] Nested writes: WritePlan, plan_write, execute_write_plan with diff/replace/append child modes
- [x] Includes: separate queries, batch by parent IDs
- [x] Soft delete: cascade policies (cascade/set_null/restrict/detach)
- [x] Errors: AppError exception with code/status/message/details
- [x] EngineController: 5 CRUD endpoints (list/get/create/update/delete)
- [x] AdminController: entity + relation + rules + state machines + workflows + users + permissions + webhooks CRUD, export/import
- [x] Router: admin routes before dynamic /:entity routes
- [x] Application: supervisor starts Repo → bootstrap → Registry → Endpoint

## Phase 1: Validation Rules ✅
- [x] Expression interpreter: tokenizer → parser → AST evaluator (property access, comparisons, logical ops, arithmetic, string functions)
- [x] Rules engine: field rules (min/max/min_length/max_length/pattern), expression rules, computed fields
- [x] Stop-on-fail support per rule
- [x] Wired into write pipeline (before SQL execution)

## Phase 2: State Machines ✅
- [x] StateMachine/Transition structs with from as list
- [x] Transition validation, guard expressions (reuse expression.ex)
- [x] Transition actions: set_field (with "now" → ISO timestamp), webhook, create_record stub
- [x] Wired into write pipeline (after rules, before SQL)

## Phase 3: Workflows ✅
- [x] Workflow/WorkflowStep structs
- [x] Execution engine: trigger → start instance → execute steps (action/condition/approval)
- [x] Runtime controller: pending/get/approve/reject endpoints
- [x] Background timeout scheduler (GenServer, 60s tick)
- [x] Post-commit trigger hook in nested_write.ex (fires on state field changes)

## Phase 4: Auth & Permissions ✅
- [x] JWT module (Joken HS256, 15min access, 7-day refresh tokens)
- [x] Password module (bcrypt_elixir)
- [x] Auth controller (login/refresh with rotation/logout)
- [x] Auth plug (JWT validation → conn.assigns.current_user)
- [x] Admin-only plug
- [x] Permission engine (whitelist model, admin bypass, row-level read filters, write conditions)
- [x] Permission checks wired into all 5 CRUD handlers

## Phase 5: Webhooks ✅
- [x] Webhook dispatch engine: payload builder, condition evaluator, header template resolver ({{env.VAR}})
- [x] Async webhooks: fire after commit via Task.start, log to _webhook_logs
- [x] Sync webhooks: fire inside transaction before commit, non-2xx causes rollback
- [x] Delivery logging to _webhook_logs with status tracking
- [x] Background retry scheduler (GenServer, 30s tick, exponential backoff: 30s × 2^attempt)
- [x] State machine + workflow webhook stubs replaced with real dispatch

## Phase 6: Multi-App ✅
- [x] Platform bootstrap (management DB tables + platform admin seed)
- [x] AppContext struct (holds Postgrex pool + Registry + jwt_secret per app)
- [x] AppManager GenServer (get/create/delete/list, lazy-init with per-app pools)
- [x] Platform controller (platform auth + app CRUD)
- [x] App resolver plug (:app param → AppContext in assigns, injects db_conn + registry + jwt_secret)
- [x] Dual-auth plug (tries app JWT first, falls back to platform JWT with admin elevation)
- [x] Router restructure: /api/_platform/* for management, /api/:app/* for app-scoped operations
- [x] Multi-app scheduler (iterates all app contexts for workflow timeouts + webhook retries)

## Phase 7: File Uploads ✅
- [x] FileStorage behaviour + Local disk implementation ({base}/{app}/{fileID}/{filename})
- [x] File controller: upload (multipart), serve (Content-Type streaming), delete, list
- [x] _files table tracking (id, filename, storage_path, mime_type, size, uploaded_by)
- [x] Write pipeline: resolve file UUID → JSONB metadata on file fields

## Schema Export/Import ✅
- [x] Export: query all metadata tables, return JSON (via AdminController)
- [x] Import: dependency-ordered insert with ON CONFLICT DO NOTHING, sample_data support (via AdminController)

---

## Phase 8: Instrumentation & Events
- [ ] `_events` system table (id UUID, trace_id UUID, span_id UUID, parent_span_id UUID, event_type TEXT, source TEXT, component TEXT, action TEXT, entity TEXT, record_id TEXT, user_id UUID, duration_ms DOUBLE PRECISION, status TEXT, metadata JSONB, created_at TIMESTAMPTZ)
- [ ] Indexes: trace_id, entity+created_at DESC, created_at DESC, event_type+source
- [ ] Instrumenter behaviour: `start_span(source, component, action) → Span`, `emit_business_event(action, entity, record_id, metadata)`
- [ ] Span struct: `finish()`, `set_status()`, `set_metadata()`, `trace_id`, `span_id`
- [ ] Trace ID propagation via `Logger.metadata` / process dictionary — generate UUID per request or accept `X-Trace-ID` header
- [ ] Auto-instrumented system events:
  - [ ] Plug pipeline: request.start, request.end (method, path, status, latency)
  - [ ] Auth plug: auth.validate, auth.login, auth.denied
  - [ ] Permission engine: permission.check, permission.denied
  - [ ] DB query wrapper: query.execute (SQL fingerprint, duration, rows affected)
  - [ ] Write pipeline stages: write.validate, write.rules, write.state_machine, write.insert, write.update, write.delete
  - [ ] Nested writes: nested_write.plan, nested_write.child (per child op)
  - [ ] Webhook dispatch: webhook.match, webhook.dispatch, webhook.success, webhook.fail, webhook.circuit_open
  - [ ] Workflow engine: workflow.trigger, workflow.advance, workflow.approve, workflow.reject, workflow.timeout
  - [ ] File storage: file.upload, file.serve, file.delete
- [ ] Fire-and-forget event writes via GenServer buffer (handle_cast + Process.send_after flush)
- [ ] Business event API:
  - [ ] `POST /api/:app/_events` — emit custom business events (entity, action, metadata)
  - [ ] `GET /api/:app/_events` — query events (?source, ?entity, ?trace_id, ?user_id, ?status, ?from, ?to, page, per_page)
  - [ ] `GET /api/:app/_events/trace/:trace_id` — full trace waterfall (all spans for a trace)
  - [ ] `GET /api/:app/_events/stats` — aggregate stats (count, avg latency by source/entity/action, error rate)
- [ ] Config in app.yaml: `instrumentation.enabled` (default true), `instrumentation.retention_days` (default 7), `instrumentation.sampling_rate` (default 1.0)
- [ ] Background retention cleanup job (delete events older than retention period)
- [ ] Multi-app support: events scoped per-app database, scheduler iterates all apps for cleanup
- [ ] Admin UI: Event stream page (filterable table, color-coded by source)
- [ ] Admin UI: Trace waterfall view (nested span timeline for a single trace_id)
- [ ] Admin UI: Stats overview dashboard (request count, avg latency, error rate, slowest traces)

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

## Phase 10: Notifications & Email
- [ ] `_notification_channels` system table (id, type [email/webhook/in_app], config JSONB, active)
- [ ] `_notifications` system table (id, channel_id, recipient, subject, body, status, metadata JSONB, created_at, sent_at)
- [ ] Notification engine (pluggable channels: email via SMTP, in-app, webhook)
- [ ] SMTP email provider (configurable in app.yaml: host, port, from address, credentials)
- [ ] Template system for notification bodies (entity fields, workflow context, approval links)
- [ ] Workflow integration: notify assigned approvers when approval step is reached
- [ ] Workflow integration: notify initiator on approval/rejection/completion
- [ ] Notification on workflow timeout/escalation
- [ ] Metadata-driven notification rules (entity + hook → send notification to channel)
- [ ] Admin API for notification channel CRUD
- [ ] Admin API for notification log/history query
- [ ] Admin UI: Notification channel management + notification log viewer

## Phase 11: Comments & Activity Stream
- [ ] `_comments` system table (id, entity, record_id, user_id, user_email, body, parent_id, created_at, updated_at)
- [ ] `_activity` system table (id, entity, record_id, type [comment/state_change/workflow/field_update], summary, user_id, metadata JSONB, created_at)
- [ ] Comment CRUD endpoints (`POST/GET/PUT/DELETE /api/:app/:entity/:id/comments`)
- [ ] Threaded comments (parent_id for replies)
- [ ] Auto-generated activity entries (state machine transitions, workflow step changes, field updates)
- [ ] Activity stream endpoint (`GET /api/:app/:entity/:id/activity`) — merged timeline of comments + system events
- [ ] Mention support (@user references in comment body)
- [ ] Permission-aware (comment visibility respects entity read permissions)
- [ ] Admin UI: Activity/comment panel on data record detail view

## Phase 12: Parallel & Advanced Workflows
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

## Phase 13: Field-Level Permissions & Conditional Visibility
- [ ] Field-level permission rules in `_permissions` (fields array: include/exclude per role+action)
- [ ] Read filtering: strip restricted fields from API responses based on user role
- [ ] Write filtering: reject writes to restricted fields with field-level error details
- [ ] Conditional field visibility rules (show/hide based on record state, role, or expression)
- [ ] Field masking (partial display: last 4 digits of SSN, masked email)
- [ ] Admin UI: Field permission matrix editor (role × field × action grid)

## Phase 14: SSO & External Auth
- [ ] OAuth 2.0 / OpenID Connect provider support (authorization code flow)
- [ ] SAML 2.0 SP implementation (for enterprise IdPs like Okta, Azure AD, OneLogin)
- [ ] LDAP/Active Directory bind authentication
- [ ] Configurable auth providers per app (in app settings or `_auth_providers` table)
- [ ] Auto-provisioning: create local user on first SSO login (JIT provisioning)
- [ ] Role mapping: map IdP groups/claims to Rocket roles
- [ ] Session management (SSO sessions, single logout)
- [ ] Admin UI: Auth provider configuration page

## Phase 15: Reporting & Dashboards
- [ ] Aggregate query endpoint (`GET /api/:app/:entity/_aggregate`) — count, sum, avg, min, max, group_by
- [ ] Workflow KPI queries: avg approval time, bottleneck steps, SLA breach counts, pending by approver
- [ ] Dashboard metadata (`_dashboards` table) — saved dashboard definitions with widget configs
- [ ] Widget types: counter, bar chart data, table, timeline
- [ ] Data export endpoint (CSV/JSON download for filtered queries)
- [ ] Scheduled reports (cron-based, email delivery via notification channels)
- [ ] Admin UI: Dashboard builder + KPI overview page

## Phase 16: Bulk Operations & API Hardening
- [ ] Bulk create endpoint (`POST /api/:app/:entity/_bulk` — array of records, transactional)
- [ ] Bulk update endpoint (`PUT /api/:app/:entity/_bulk` — array of {id, ...fields}, transactional)
- [ ] Bulk delete endpoint (`DELETE /api/:app/:entity/_bulk` — array of IDs)
- [ ] Bulk approve/reject for workflow instances
- [ ] API rate limiting (per-user, per-app, configurable in app.yaml)
- [ ] Request size limits + payload validation hardening
- [ ] API key authentication (alternative to JWT for service-to-service calls)
- [ ] Admin UI: Bulk import page (CSV/JSON upload with field mapping)
