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
