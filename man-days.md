Actual Hours: 20 Hours (Don't change this)

## Estimated Man-Days (Traditional Development, All Implementations)

| Phase | Scope | Go | Express | Elixir | Admin UI | Total |
|-------|-------|---:|--------:|-------:|---------:|------:|
| Phase 0: Foundation | Config, metadata types, DB layer, query builder, writer, nested writes (diff/replace/append), HTTP handlers, admin API, dynamic routing, includes, soft delete, cascade policies, validation, error format, auto-migration | 10 | 10 | 10 | — | 30 |
| Phase 1: Validation Rules | `_rules` table, rule types, admin CRUD, field rules engine (min/max/length/pattern), expression rules, computed fields, write pipeline integration | 4 | 4 | 4 | 1 | 13 |
| Phase 2: State Machines | `_state_machines` table, types with custom JSON marshal, admin CRUD, transition validation, guard expressions, transition actions (`set_field`, stubs), write pipeline integration | 4 | 4 | 4 | 1 | 13 |
| Phase 3: Workflows | `_workflows` + `_workflow_instances` tables, types, admin CRUD, execution engine (action/condition/approval steps), post-commit trigger, runtime endpoints (pending/approve/reject), timeout scheduler | 5 | 5 | 5 | 2 | 17 |
| Phase 4: Auth & Permissions | `_users`, `_refresh_tokens`, `_permissions` tables, JWT (HS256, access+refresh), bcrypt, auth middleware, admin-only middleware, permission engine (whitelist, admin bypass), row-level read filtering, write conditions, user + permission CRUD, seed admin | 5 | 5 | 5 | 2 | 17 |
| Phase 5: Webhooks | `_webhooks` + `_webhook_logs` tables, dispatch engine (payload, headers, conditions), async (fire-and-forget) + sync (rollback on failure), retry scheduler (exponential backoff), webhook log CRUD + manual retry, integration into write + delete flows | 4 | 4 | 4 | 2 | 14 |
| Phase 6: Multi-App | Management DB (`_apps`, `_platform_users`, `_platform_refresh_tokens`), platform bootstrap + auth, AppContext + AppManager, database-per-app provisioning, app resolver middleware, dual-auth (app JWT + platform JWT fallback), URL prefix routing, multi-app scheduler | 6 | 6 | 6 | 3 | 21 |
| Phase 7: File Uploads | Storage interface + local-disk implementation, `_files` table, file handler (upload/serve/delete/list), `file` field type (JSONB), UUID resolution in write pipeline, route registration, multer integration | 3 | 3 | 3 | 1 | 10 |
| Phase 8: Instrumentation & Events | `_events` table, instrumenter with span lifecycle, trace ID propagation, auto-instrumented system events (HTTP, auth, permissions, DB, write pipeline, nested writes, webhooks, workflows, files), async event buffer, business event API (POST/GET/trace/stats), config (enabled, retention, sampling), background retention cleanup | 3 | 3 | 3 | 2 | 11 |
| Schema Export/Import | Export all metadata tables as JSON, dependency-ordered import with idempotent dedup, migrator integration, Admin UI export/import buttons with results display | 2 | 2 | 2 | 0.5 | 6.5 |
| Documentation | Detailed examples & cookbook — entities, relations, rules, state machines, workflows, webhooks, permissions, nested writes, files, export/import with curl examples and complete scenario | 1 | — | — | — | 1 |
| Public Pages UI | Extended UI config schema with `pages` section, public layout, post card grid, article detail page, tag pills, author display, comment section with submission form, public routes | — | — | — | 2 | 2 |
| Workflow Engine Refactoring | Extract WorkflowStore, StepExecutor registry, ActionExecutor registry, ExpressionEvaluator abstractions. Engine becomes composable facade. Scheduler simplified to delegate. Backward-compat free functions preserved. | 2 | 2 | 2 | — | 6 |
| User Invites | `_invites` table, admin invite CRUD (create/list/revoke/bulk), public accept-invite endpoint with token validation + user creation + auto-login, transaction safety, Admin UI invites page with token copy | 1 | 1 | 1 | 0.5 | 3.5 |
| SQLite Adapter | Multi-RDBMS dialect abstraction (placeholder style, type mapping, DDL, pagination, JSON ops, upsert), SQLite driver with per-app file-based storage, backward-compatible with Postgres, per-app driver selection | 3 | 3 | 3 | 0.5 | 9.5 |
| Scalability Quick Wins | File streaming (sendfile), expression AST caching (ETS-backed), connection pool tuning, query optimization | 1 | 1 | 1 | — | 3 |
| Entity Slugs | Optional slug config (field, source, regenerate_on_update), auto-generate from source field, conflict handling (append -2, -3), slug-based record lookup, validation, admin UI slug settings | 1 | 1 | 1 | 0.5 | 3.5 |
| Client App & UI Configs | `_ui_configs` system table, admin CRUD + non-admin read endpoints, config-driven list/detail/form views, sidebar config, public landing pages, config-driven dashboard with reserved `_app` config | 1 | 1 | 1 | 3 | 6 |
| AI Schema Generator | OpenAI-compatible AI client, config via env vars, system prompt with full Rocket schema spec, backend endpoints (GET status, POST generate), two-step UX (generate → apply), admin UI page with new/existing app modes, example prompt chips, tabbed preview with editable JSON | 2 | 2 | 2 | 2 | 8 |
| MCP Server Integration | Model Context Protocol server for Claude integration, schema queries, data operations, metadata access, shell scripts + setup docs | 0.5 | 0.5 | 0.5 | — | 1.5 |
| Visual Expression/Condition Builder | Interactive visual builders for expressions/conditions used in rules, workflows, state machines, webhooks — form-based UI for constructing boolean logic | — | — | — | 1.5 | 1.5 |
| CSV Import | Bulk record creation via CSV upload, field mapping, validation + error reporting, transactional import | — | — | — | 1 | 1 |
| Field Template Presets | Pre-configured field templates for common types (email, phone, address, currency), quick-add to entity editor | — | — | — | 1 | 1 |
| Nested Record Editing | Inline child record management in data browser detail view, add/edit/delete children without leaving parent, respects nested write modes | — | — | — | 1.5 | 1.5 |
| Onboarding Wizard | Guided setup flow for new apps with zero entities, step-by-step entity + field creation, AI generate option, completion checklist | — | — | — | 1.5 | 1.5 |
| Dashboard with Stats | App overview dashboard — entity count, record counts, health metrics, recent activity, error rate, workflow bottlenecks | — | — | — | 1 | 1 |
| API Playground | Interactive REST client for testing endpoints, request builder (method, URL, headers, body), response viewer with pretty-printing, auth integration | — | — | — | 1.5 | 1.5 |
| Bulk Operations | Select multiple records → bulk delete, bulk update, bulk export in data browser, transactional operations, progress + error reporting | — | — | — | 1 | 1 |
| Dark Mode | Three-state theme toggle (light/system/dark), persistent preference, CSS custom properties | — | — | — | 0.5 | 0.5 |
| Inline Record Editing | Edit record fields directly in data browser table cells, click-to-edit, inline validation, auto-save | — | — | — | 1 | 1 |
| ERD & Visual Editors | Entity Relationship Diagram (SVG-based), interactive visual editors for workflow steps and state machine transitions | — | — | — | 2 | 2 |
| Java Spring & .NET Plans | Design documentation, project scaffolding, roadmap planning for Java Spring and .NET backends | 0.5 | — | — | — | 0.5 |
| **Total** | | **59** | **57.5** | **57.5** | **36.5** | **210.5** |

### Summary

- **Estimated effort (traditional):** 210.5 man-days (~10 months for a solo developer)
- **Actual time with AI assistance:** 20 hours
- **Speedup factor:** ~168x
