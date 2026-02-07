# State Machines — Express.js Implementation

## Overview

State machines enforce valid state transitions on entity fields (e.g., `status`). They run after validation rules but before the SQL write, blocking invalid transitions and executing side-effect actions.

## Architecture

### Types (`src/metadata/state-machine.ts`)

- **StateMachine** — `id`, `entity`, `field`, `definition`, `active`
- **StateMachineDefinition** — `initial` state + `transitions` array
- **Transition** — `from` (string[]), `to`, `roles?`, `guard?`, `actions?`, `compiledGuard?`
- **TransitionAction** — `type` (set_field, webhook, create_record, send_event) + type-specific fields
- **normalizeDefinition()** — converts `from` from string to `string[]` on load for consistent handling

### Evaluation Engine (`src/engine/state-machine.ts`)

**Pipeline position:** Rules → **State Machines** → SQL Write

**Functions:**

| Function | Purpose |
|---|---|
| `evaluateStateMachines()` | Entry point — iterates all active state machines for entity |
| `evaluateStateMachine()` | Single state machine — checks initial state (create) or transition (update) |
| `findTransition()` | Finds matching transition by old/new state |
| `evaluateGuard()` | Compiles + runs guard via `new Function()`. Returns `[blocked, error]` |
| `executeActions()` | Runs transition actions, mutating fields for `set_field` |

**Guard semantics:** Expression evaluates to `true` = allowed, `false` = blocked. Uses `new Function("env", "with (env) { return !!(expr); }")` for compilation, same pattern as expression rules but with inverted semantics.

**Compiled guard caching:** Guards are compiled once and cached on `transition.compiledGuard` to avoid recompilation.

### Action Types

| Type | Behavior |
|---|---|
| `set_field` | Sets `fields[action.field] = action.value`. If value is `"now"`, uses `new Date().toISOString()` |
| `webhook` | Console.log stub — not yet implemented |
| `create_record` | Console.log stub — not yet implemented |
| `send_event` | Console.log stub — not yet implemented |

### Admin API (`src/admin/handler.ts`)

| Method | Path | Description |
|---|---|---|
| GET | `/api/_admin/state-machines` | List all |
| GET | `/api/_admin/state-machines/:id` | Get by ID |
| POST | `/api/_admin/state-machines` | Create |
| PUT | `/api/_admin/state-machines/:id` | Update |
| DELETE | `/api/_admin/state-machines/:id` | Delete |

**Validation:** Entity must exist, field must be non-empty, at least one transition required.

### Database Schema

Same `_state_machines` table as Go (shared PostgreSQL database):

```sql
CREATE TABLE IF NOT EXISTS _state_machines (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity      TEXT NOT NULL REFERENCES _entities(name) ON DELETE CASCADE,
    field       TEXT NOT NULL,
    definition  JSONB NOT NULL,
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

## Tests

- **Integration tests** (`src/engine/handler.integration.test.ts`):
  - State machine enforcement: 5 tests (valid initial, invalid initial, guard pass + action, guard fail, invalid transition)
  - State machine CRUD: 6 tests (create, list, get, update, delete, verify 404)

## Key Design Decisions

1. **normalizeDefinition()** — Called on load and create/update to ensure `from` is always `string[]`. Unlike Go's custom JSON type, Express normalizes on ingestion.
2. **Guard = allowed, not violated** — Consistent with Go: guard `true` = allowed. Uses the same `new Function` + `with(env)` pattern as expression rules but inverts the result.
3. **Actions mutate fields before write** — `set_field` actions modify the fields object directly before SQL execution.
4. **Stubs for future actions** — webhook, create_record, send_event log to console and are no-ops until their respective phases.
