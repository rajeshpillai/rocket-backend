Actual Hours: 15 Hours (Don't change this)

## Estimated Man-Days (Traditional Development, Both Languages)

| Phase | Scope | Go | Express | Admin UI | Total |
|-------|-------|---:|--------:|---------:|------:|
| Phase 0: Foundation | Config, metadata types, DB layer, query builder, writer, nested writes (diff/replace/append), HTTP handlers, admin API, dynamic routing, includes, soft delete, cascade policies, validation, error format, auto-migration | 10 | 10 | — | 20 |
| Phase 1: Validation Rules | `_rules` table, rule types, admin CRUD, field rules engine (min/max/length/pattern), expression rules, computed fields, write pipeline integration | 4 | 4 | 1 | 9 |
| Phase 2: State Machines | `_state_machines` table, types with custom JSON marshal, admin CRUD, transition validation, guard expressions, transition actions (`set_field`, stubs), write pipeline integration | 4 | 4 | 1 | 9 |
| Phase 3: Workflows | `_workflows` + `_workflow_instances` tables, types, admin CRUD, execution engine (action/condition/approval steps), post-commit trigger, runtime endpoints (pending/approve/reject), timeout scheduler | 5 | 5 | 2 | 12 |
| Phase 4: Auth & Permissions | `_users`, `_refresh_tokens`, `_permissions` tables, JWT (HS256, access+refresh), bcrypt, auth middleware, admin-only middleware, permission engine (whitelist, admin bypass), row-level read filtering, write conditions, user + permission CRUD, seed admin | 5 | 5 | 2 | 12 |
| Phase 5: Webhooks | `_webhooks` + `_webhook_logs` tables, dispatch engine (payload, headers, conditions), async (fire-and-forget) + sync (rollback on failure), retry scheduler (exponential backoff), webhook log CRUD + manual retry, integration into write + delete flows | 4 | 4 | 2 | 10 |
| Phase 6: Multi-App | Management DB (`_apps`, `_platform_users`, `_platform_refresh_tokens`), platform bootstrap + auth, AppContext + AppManager, database-per-app provisioning, app resolver middleware, dual-auth (app JWT + platform JWT fallback), URL prefix routing, multi-app scheduler | 6 | 6 | 3 | 15 |
| Phase 7: File Uploads | Storage interface + local-disk implementation, `_files` table, file handler (upload/serve/delete/list), `file` field type (JSONB), UUID resolution in write pipeline, route registration, multer integration | 3 | 3 | 1 | 7 |
| Schema Export/Import | Export all 7 metadata tables as JSON, dependency-ordered import with idempotent dedup, migrator integration, Admin UI export/import buttons with results display | 2 | 2 | 0.5 | 4.5 |
| Documentation | Detailed examples & cookbook — entities, relations, rules, state machines, workflows, webhooks, permissions, nested writes, files, export/import with curl examples and complete scenario | 1 | — | — | 1 |
| Public Pages UI | Extended UI config schema with `pages` section, public layout, post card grid, article detail page, tag pills, author display, comment section with submission form, public routes | — | — | 2 | 2 |
| **Total** | | **44** | **43** | **14.5** | **101.5** |

### Summary

- **Estimated effort (traditional):** 101.5 man-days (~4.8 months for a solo developer)
- **Actual time with AI assistance:** 15 hours
- **Speedup factor:** ~81x
