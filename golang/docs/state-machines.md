# State Machines — Go Implementation

## Overview

State machines enforce valid state transitions on entity fields (e.g., `status`). They run after validation rules but before the SQL write, blocking invalid transitions and executing side-effect actions.

## Architecture

### Types (`internal/metadata/state_machine.go`)

- **StateMachine** — top-level struct with `id`, `entity`, `field`, `definition`, `active`
- **StateMachineDefinition** — `initial` state + array of `Transition`
- **Transition** — `from` (TransitionFrom), `to`, `roles`, `guard`, `actions`, `compiledGuard`
- **TransitionAction** — `type` (set_field, webhook, create_record, send_event) + type-specific fields
- **TransitionFrom** — custom `[]string` type with JSON marshal/unmarshal that accepts both `"draft"` and `["draft", "sent"]`

### Evaluation Engine (`internal/engine/state_machine.go`)

**Pipeline position:** Rules → **State Machines** → SQL Write

**Functions:**

| Function | Purpose |
|---|---|
| `EvaluateStateMachines()` | Entry point — iterates all active state machines for entity |
| `evaluateStateMachine()` | Single state machine — checks initial state (create) or transition (update) |
| `FindTransition()` | Finds matching transition by old/new state, supports array `from` |
| `EvaluateGuard()` | Compiles + runs guard expression via expr-lang. Returns `(blocked, error)` |
| `ExecuteActions()` | Runs transition actions, mutating fields map for `set_field` |

**Guard semantics:** Expression evaluates to `true` = transition allowed, `false` = blocked. This is the inverse of expression rules (where `true` = violated).

**Compiled guard caching:** Guards are compiled once via `expr.Compile()` and cached on `transition.CompiledGuard` to avoid recompilation on subsequent evaluations.

### Action Types

| Type | Behavior |
|---|---|
| `set_field` | Sets `fields[action.Field] = action.Value`. If value is `"now"`, uses `time.Now().UTC().Format(time.RFC3339)` |
| `webhook` | Log stub — not yet implemented |
| `create_record` | Log stub — not yet implemented |
| `send_event` | Log stub — not yet implemented |

### Admin API (`internal/admin/handler.go`)

| Method | Path | Description |
|---|---|---|
| GET | `/api/_admin/state-machines` | List all |
| GET | `/api/_admin/state-machines/:id` | Get by ID |
| POST | `/api/_admin/state-machines` | Create |
| PUT | `/api/_admin/state-machines/:id` | Update |
| DELETE | `/api/_admin/state-machines/:id` | Delete |

**Validation:** Entity must exist, field must be non-empty, at least one transition required.

### Database Schema

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

- **Unit tests** (`internal/engine/state_machine_test.go`): 10 tests covering FindTransition, EvaluateGuard, ExecuteActions, and full evaluateStateMachine scenarios
- **Unit tests** (`internal/metadata/state_machine_test.go`): 5 tests covering JSON parsing, TransitionFrom marshal/unmarshal, registry integration
- **Integration tests** (`internal/engine/handler_integration_test.go`): TestStateMachineEnforcement (9 assertions) + TestStateMachineCRUD (6 operations)

## Key Design Decisions

1. **TransitionFrom as custom type** — Allows JSON `"from": "draft"` (string) and `"from": ["draft", "sent"]` (array) via custom UnmarshalJSON. Single values marshal back as strings for cleaner output.
2. **Guard = allowed, not violated** — Unlike expression rules where `true` = violated, guard `true` = transition is allowed. This follows the natural reading of guard conditions.
3. **Actions mutate fields before write** — `set_field` actions modify the fields map directly, so the SQL INSERT/UPDATE includes the action-set values.
4. **Stubs for future actions** — webhook, create_record, send_event log warnings and are no-ops until their respective phases are implemented.
