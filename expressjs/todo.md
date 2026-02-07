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
