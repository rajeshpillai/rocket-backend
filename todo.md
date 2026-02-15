# Rocket Backend — Feature Roadmap

This is the canonical feature roadmap for the Rocket metadata-driven backend engine. Backend-specific `todo.md` files (`golang/todo.md`, `expressjs/todo.md`, `elixir-phoenix/todo.md`) track per-language implementation status.

---

## Phase 0: Foundation ✅
- [x] Metadata-driven entity/relation schema with JSONB definitions
- [x] Dynamic REST API — 5 CRUD endpoints per entity (list, get, create, update, delete)
- [x] Auto-migration (CREATE TABLE / ALTER TABLE ADD COLUMN on entity create/update)
- [x] Query builder: filters (`eq/neq/gt/gte/lt/lte/in/not_in/like`), sorting, pagination
- [x] Nested writes with diff/replace/append child modes
- [x] Soft delete with cascade policies (cascade/set_null/restrict/detach)
- [x] Includes via separate queries (no JOINs, avoids cartesian explosions)
- [x] Admin API for entity + relation CRUD
- [x] Standard error format with codes and field-level details

## Phase 1: Validation Rules ✅
- [x] `_rules` system table with per-entity rules
- [x] Field rules: min, max, min_length, max_length, pattern, required, enum
- [x] Expression rules: boolean expressions evaluated against record context
- [x] Computed fields: auto-calculated values from expressions before write
- [x] Stop-on-fail support per rule
- [x] Wired into write pipeline (`before_write` hook)

## Phase 2: State Machines ✅
- [x] `_state_machines` system table with transitions, guards, and actions
- [x] Transition validation with array `from` support
- [x] Guard expressions (boolean, true = allowed)
- [x] Transition actions: `set_field` (with `"now"` → timestamp), `webhook` (live), `create_record` (stub), `send_event` (stub)
- [x] Wired into write pipeline (after rules, before SQL)

## Phase 3: Workflows ✅
- [x] `_workflows` + `_workflow_instances` system tables
- [x] Step types: `action`, `condition`, `approval`
- [x] Action types: `set_field` (live), `webhook` (live), `create_record` (stub), `send_event` (stub)
- [x] Condition branching with expressions (`on_true`/`on_false`)
- [x] Approval with timeout and deadline scheduling (`on_approve`/`on_reject`/`on_timeout`)
- [x] Post-commit trigger on state field changes
- [x] Runtime endpoints: pending list, instance detail, approve, reject
- [x] Background timeout scheduler

## Phase 4: Auth & Permissions ✅
- [x] JWT authentication (HS256, 15min access, 7-day refresh with rotation)
- [x] bcrypt password hashing, seed admin user on first boot
- [x] Auth middleware on all routes (except auth + health)
- [x] Whitelist permission model with admin bypass
- [x] Row-level read filters (conditions → WHERE clauses)
- [x] Write permission conditions (current record checked before update/delete)
- [x] User + permission admin CRUD

## Phase 5: Webhooks ✅
- [x] `_webhooks` + `_webhook_logs` system tables
- [x] Four hook types: `after_write`, `before_write`, `after_delete`, `before_delete`
- [x] Async webhooks: fire after commit, retry with exponential backoff
- [x] Sync webhooks: fire inside transaction, non-2xx rolls back
- [x] Condition expressions, header templates (`{{env.VAR}}`)
- [x] Background retry scheduler (30s interval, exponential backoff)
- [x] Admin API for webhook + log CRUD, manual retry

## Phase 6: Multi-App ✅
- [x] Database-per-app isolation with management database (`rocket`)
- [x] Platform auth (separate from per-app auth)
- [x] App lifecycle: create → provision DB → bootstrap → seed admin
- [x] Dual-auth middleware (app JWT first, platform JWT fallback)
- [x] URL prefix routing: `/api/_platform/*` + `/api/:app/*`
- [x] Per-app JWT secrets, AppContext with pre-built handlers
- [x] Multi-app schedulers (workflow timeouts + webhook retries)

## Phase 7: File Uploads ✅
- [x] `file` field type → JSONB in PostgreSQL (`{id, filename, size, mime_type}`)
- [x] File upload (multipart/form-data), serve (streaming), delete, list endpoints
- [x] Storage interface with local-disk implementation (S3-ready)
- [x] Per-app file isolation, `_files` system table
- [x] Write pipeline resolves UUID → full JSONB metadata

## Schema Export/Import ✅
- [x] Export all metadata (entities, relations, rules, state machines, workflows, permissions, webhooks) as JSON
- [x] Import with dependency-ordered insert and idempotent dedup
- [x] Sample data support in import

## User Invites ✅
- [x] `_invites` system table
- [x] Admin endpoints: create, list, delete invites
- [x] Bulk invite endpoint (`POST /_admin/invites/bulk`) — shared roles, skip & report
- [x] Public accept-invite endpoint (token + password → user creation + auto-login)
- [x] Validation: duplicate email, pending invite, expired token, already accepted

---

## Phase 8: Instrumentation & Events
- [ ] `_events` system table (trace_id, span_id, parent_span_id, event_type, source, component, action, entity, record_id, user_id, duration_ms, status, metadata)
- [ ] Instrumenter interface with span lifecycle (start, finish, set_status, set_metadata)
- [ ] Trace ID propagation (generate per request or accept `X-Trace-ID` header)
- [ ] Auto-instrumented system events:
  - [ ] HTTP request lifecycle (method, path, status, latency)
  - [ ] Auth + permission checks
  - [ ] DB query execution (SQL fingerprint, duration, rows)
  - [ ] Write pipeline stages (validate, rules, state_machine, insert/update/delete)
  - [ ] Nested writes (plan, child operations)
  - [ ] Webhook dispatch (match, dispatch, success, fail)
  - [ ] Workflow engine (trigger, advance, approve, reject, timeout)
  - [ ] File storage (upload, serve, delete)
- [ ] Fire-and-forget event writes via async buffer (batch flush)
- [ ] Business event API:
  - [ ] `POST /_events` — emit custom events
  - [ ] `GET /_events` — query events (filters: source, entity, trace_id, user_id, status, date range)
  - [ ] `GET /_events/trace/:trace_id` — full trace waterfall
  - [ ] `GET /_events/stats` — aggregate stats (count, avg latency, error rate)
- [ ] Config: `instrumentation.enabled`, `instrumentation.retention_days`, `instrumentation.sampling_rate`
- [ ] Background retention cleanup job
- [ ] Admin UI: Event stream, trace waterfall, stats dashboard

## Phase 9: Audit Log
- [ ] `_audit_logs` system table (entity, record_id, action, old_data, new_data, changed_fields, user_id, user_email, ip_address, timestamp)
- [ ] Audit capture in write pipeline (create, update, delete — before/after snapshots)
- [ ] Automatic diff computation (changed fields, old vs new values)
- [ ] User context (who, from where) attached to every entry
- [ ] Query API with filters (?entity, ?record_id, ?user_id, ?action, ?from, ?to)
- [ ] Record history endpoint (`GET /:entity/:id/history`)
- [ ] Configurable per-entity (opt-in/opt-out)
- [ ] Sensitive field masking (passwords, PII)
- [ ] Admin UI: Audit log viewer with filters and record timeline

## Phase 10: Email Providers & Templates (see [docs/email-providers.md](docs/email-providers.md))
- [ ] `_email_providers` system table (provider, config JSONB, priority, active)
- [ ] `_email_templates` system table (key, subject, body_html, body_text, active)
- [ ] `_email_logs` system table (provider_id, template_key, to_email, subject, status, error, attempt)
- [ ] Provider adapters: SendGrid, Postmark, SMTP, Resend, Mailgun
- [ ] Template engine: `{{variable}}` substitution (reuse webhook `{{env.VAR}}` pattern)
- [ ] Built-in default templates: invite, welcome, password_reset
- [ ] Async email dispatch (fire-and-forget, same pattern as async webhooks)
- [ ] Provider fallback: try providers in priority order, log failures
- [ ] Secrets via `{{env.VAR}}` references (never stored in plaintext)
- [ ] App settings: `invite_accept_url` template for accept links
- [ ] Integration: invite creation → auto-send invite email
- [ ] Integration: accept-invite → auto-send welcome email
- [ ] Admin API: provider CRUD + test, template CRUD + preview, email logs, ad-hoc send
- [ ] Admin UI: Email Providers, Templates, and Logs pages

## Phase 11: API Connectors & Workflow Actions (see [docs/api-connectors.md](docs/api-connectors.md))
- [ ] `_api_connectors` system table (name, base_url, auth_type, auth_config JSONB, default_headers JSONB, timeout_ms, retry JSONB, active)
- [ ] Auth types: `none`, `bearer`, `basic`, `api_key`, `custom_header`
- [ ] Secrets via `{{env.VAR}}` references in auth_config (never stored in plaintext)
- [ ] Connector resolution at request time (lookup by name, resolve env vars, inject auth)
- [ ] New workflow action: `http_request` — call external API via connector, map response into workflow context
- [ ] New workflow action: `send_email` — send email via configured provider and template
- [ ] New workflow action: `update_record` — update existing entity record (multi-field)
- [ ] New workflow action: `delete_record` — soft-delete entity record
- [ ] New workflow action: `transform` — compute values into workflow context without DB
- [ ] New workflow action: `delay` — pause workflow for specified duration
- [ ] Implement existing stubs: `create_record`, `send_event`
- [ ] New workflow step type: `http_request` — call API and branch on success/error
- [ ] New state machine transition action: `http_request` — call API on transition
- [ ] New state machine transition action: `send_email` — send email on transition
- [ ] New rule type: `http_validate` — validate against external API before write
- [ ] Response mapping: dot-path extraction from JSON response into workflow context
- [ ] Variable resolution: `{{context.record.field}}`, `{{record.field}}`, `{{env.VAR}}`, `{{response.field}}`
- [ ] Admin API: connector CRUD + test endpoint
- [ ] Admin UI: API Connectors settings page (add/edit/test)

## Phase 12: Comments & Activity Stream
- [ ] `_comments` system table (entity, record_id, user_id, user_email, body, parent_id)
- [ ] `_activity` system table (entity, record_id, type, summary, user_id, metadata JSONB)
- [ ] Comment CRUD endpoints (`POST/GET/PUT/DELETE /:entity/:id/comments`)
- [ ] Threaded comments (parent_id for replies)
- [ ] Auto-generated activity entries (state transitions, workflow steps, field updates)
- [ ] Activity stream endpoint (`GET /:entity/:id/activity`) — merged timeline
- [ ] Mention support (@user references)
- [ ] Permission-aware (comment visibility respects entity read permissions)
- [ ] Admin UI: Activity/comment panel on record detail view

## Phase 13: Parallel & Advanced Workflows
- [ ] Parallel approval gates: AND (all), OR (any), N-of-M (quorum)
- [ ] Multi-approver step type (roles/users list, approval threshold)
- [ ] Delegation: user A delegates to user B (time-bounded)
- [ ] Escalation rules: deadline-based escalation to next role/user
- [ ] Workflow step forms: per-step field definitions (rejection reason, approval notes)
- [ ] Workflow variables: step outputs feed into subsequent step inputs
- [ ] Sub-workflows: a step triggers another workflow and waits for completion
- [ ] Loop step type: iterate over collection in workflow context
- [ ] Parallel step type: execute multiple branches concurrently
- [ ] Cancel/abort workflow instance endpoint
- [ ] Reassign approval step to different user
- [ ] Admin UI: Enhanced workflow builder with parallel gates, delegation config, step forms

## Phase 14: Field-Level Permissions & Conditional Visibility
- [ ] Field-level permission rules in `_permissions` (fields array: include/exclude per role+action)
- [ ] Read filtering: strip restricted fields from API responses by role
- [ ] Write filtering: reject writes to restricted fields with field-level errors
- [ ] Conditional field visibility rules (show/hide based on record state, role, or expression)
- [ ] Field masking (partial display: last 4 digits of SSN, masked email)
- [ ] Admin UI: Field permission matrix editor (role x field x action grid)

## Phase 15: SSO & External Auth
- [ ] OAuth 2.0 / OpenID Connect provider support (authorization code flow)
- [ ] SAML 2.0 SP implementation (Okta, Azure AD, OneLogin)
- [ ] LDAP/Active Directory bind authentication
- [ ] Configurable auth providers per app (`_auth_providers` table)
- [ ] Auto-provisioning: create local user on first SSO login (JIT)
- [ ] Role mapping: map IdP groups/claims to Rocket roles
- [ ] Session management (SSO sessions, single logout)
- [ ] Admin UI: Auth provider configuration page

## Phase 16: Reporting & Dashboards
- [ ] Aggregate query endpoint (`GET /:entity/_aggregate`) — count, sum, avg, min, max, group_by
- [ ] Workflow KPI queries: avg approval time, bottleneck steps, SLA breach counts
- [ ] Dashboard metadata (`_dashboards` table) — saved dashboard definitions with widget configs
- [ ] Widget types: counter, bar chart data, table, timeline
- [ ] Data export endpoint (CSV/JSON download for filtered queries)
- [ ] Scheduled reports (cron-based, email delivery)
- [ ] Admin UI: Dashboard builder + KPI overview page

## Phase 17: Bulk Operations & API Hardening
- [ ] Bulk create endpoint (`POST /:entity/_bulk` — array of records, transactional)
- [ ] Bulk update endpoint (`PUT /:entity/_bulk` — array of {id, ...fields}, transactional)
- [ ] Bulk delete endpoint (`DELETE /:entity/_bulk` — array of IDs)
- [ ] Bulk approve/reject for workflow instances
- [ ] API rate limiting (per-user, per-app, configurable)
- [ ] Request size limits + payload validation hardening
- [ ] API key authentication (alternative to JWT for service-to-service)
- [ ] Admin UI: Bulk import page (CSV/JSON upload with field mapping)

---

## Nice to Have
- [ ] **Role master table** (`_roles`): name (PK), display_name, description — enables role discovery, autocomplete, typo prevention, bulk role rename/revoke
- [ ] **Per-entity query caching**: metadata-driven cache config (`cache.enabled`, `cache.ttl`, `cache.max_size`, `cache.strategy`), auto-invalidate on write, skip for row-level permissions, global config (`cache.driver: memory|redis`), admin purge endpoint
- [ ] **Multi-RDBMS adapter support**: SQL dialect abstraction (placeholder style, type mapping, DDL, pagination, JSON ops, upsert), supported targets: SQLite, MySQL, SQL Server, Oracle

---

## Quick Reference: All Supported Types

### Workflow Step Types

| Step Type | Status | Description |
|-----------|--------|-------------|
| `action` | Live | Executes a sequence of actions, then advances |
| `condition` | Live | Evaluates expression, branches `on_true`/`on_false` |
| `approval` | Live | Pauses for human approval, optional timeout |
| `http_request` | Planned (Phase 11) | Calls external API via connector, branches on success/error |
| `loop` | Planned (Phase 13) | Iterates over a collection in workflow context |
| `parallel` | Planned (Phase 13) | Executes multiple branches concurrently |

### Workflow Action Types

| Action Type | Status | Description |
|-------------|--------|-------------|
| `set_field` | Live | Updates a single field on an entity record |
| `webhook` | Live | Fires HTTP request (raw URL, fire-and-forget) |
| `create_record` | Stub | Creates a new entity record |
| `send_event` | Stub | Emits a business event (Phase 8 integration) |
| `http_request` | Planned (Phase 11) | Calls API via connector, maps response to context |
| `send_email` | Planned (Phase 11) | Sends email via configured provider + template |
| `update_record` | Planned (Phase 11) | Updates existing record (multi-field) |
| `delete_record` | Planned (Phase 11) | Soft-deletes a record |
| `transform` | Planned (Phase 11) | Computes values into workflow context (no DB) |
| `delay` | Planned (Phase 11) | Pauses workflow for specified duration |

### State Machine Transition Action Types

| Action Type | Status | Description |
|-------------|--------|-------------|
| `set_field` | Live | Sets field on transitioning record (`"now"` = timestamp) |
| `webhook` | Live | Fires HTTP request (async, fire-and-forget) |
| `create_record` | Stub | Creates a new entity record |
| `send_event` | Stub | Emits a business event |
| `http_request` | Planned (Phase 11) | Calls API via connector on transition |
| `send_email` | Planned (Phase 11) | Sends email on transition |

### Rule Types

| Rule Type | Status | Description |
|-----------|--------|-------------|
| `field` | Live | Validates field values (min, max, pattern, required, enum) |
| `expression` | Live | Validates against boolean expressions |
| `computed` | Live | Auto-calculates field from expression |
| `http_validate` | Planned (Phase 11) | Validates against external API before write |

### Webhook Hook Types

| Hook | Timing | Behavior |
|------|--------|----------|
| `after_write` | After commit | Async, fire-and-forget, retry on failure |
| `before_write` | Before commit | Sync, non-2xx rolls back transaction |
| `after_delete` | After commit | Async |
| `before_delete` | Before commit | Sync, non-2xx rolls back |
