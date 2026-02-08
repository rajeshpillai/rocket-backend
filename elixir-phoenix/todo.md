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
