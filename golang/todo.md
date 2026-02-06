# Rocket Backend — Go (Fiber) Implementation

## Phase 0: Foundation [DONE]
- [x] Scaffolding (go.mod, app.yaml, config loader)
- [x] Metadata types (field, entity, relation, registry)
- [x] Database layer (postgres store, bootstrap, migrator, loader)
- [x] Query builder (filters, sorting, pagination, soft-delete)
- [x] Writer + nested writes (diff/replace/append modes)
- [x] HTTP handlers (CRUD, admin API, dynamic routing, includes)
- [x] Entry point (main.go)

## Phase 1: Validation Rules
- [ ] Field-level rules (min, max, pattern, custom messages)
- [ ] Expression rules (expr-lang/expr integration)
- [ ] Rule evaluation in write pipeline

## Phase 2: State Machines
- [ ] State machine metadata schema
- [ ] Transition validation and guards
- [ ] State change actions/side-effects

## Phase 3: Workflows
- [ ] Workflow engine (approval steps, conditions, timeouts)
- [ ] _workflow_instances table and scheduler
- [ ] Approval endpoints

## Phase 4: Auth & Permissions
- [ ] JWT login/refresh flow
- [ ] Auth middleware
- [ ] Permission policies with row-level filtering

## Phase 5: Webhooks
- [ ] Webhook registration and dispatch
- [ ] Retry logic with backoff

## Known Issues
- Unique constraint violations return 500 instead of 409 CONFLICT
