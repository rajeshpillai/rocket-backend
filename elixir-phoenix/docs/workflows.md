# Workflows — Elixir/Phoenix Implementation

## Overview

Workflows are multi-step, long-running processes triggered by state machine transitions. They support action steps (execute operations), condition steps (branch on expressions), and approval steps (pause for human decisions).

## System Tables

- `_workflows` — workflow definitions (trigger, context mappings, steps)
- `_workflow_instances` — running/completed instances (status, current step, context, history)

## Architecture

The workflow engine is built around pluggable abstractions with behaviours and dependency injection via context maps:

```
WorkflowEngine (facade — orchestrates everything)
├── WorkflowStore behaviour (persistence — all _workflow_instances SQL)
├── StepExecutors (registry: action / condition / approval)
│   └── ActionExecutors (registry: set_field / webhook / create_record / send_event)
└── WorkflowExpression behaviour (condition evaluation via Rocket.Engine.Expression)
```

### Trigger Flow

```
State Machine Transition (post-commit)
  → WorkflowEngine.trigger_workflows(conn, registry, entity, field, to_state, record, record_id)
    → Registry lookup by "entity:field:to_state" key
      → store.create_instance() for each matching workflow
        → advance_workflow() loop
```

### Step Types

| Type | Executor Module | Behavior | Navigation |
|------|----------------|----------|------------|
| `action` | `StepExecutors.Action` | Runs actions via ActionExecutor registry, follows `then` | `then.goto` or "end" |
| `condition` | `StepExecutors.Condition` | Evaluates expression via WorkflowExpression, branches | `on_true.goto` / `on_false.goto` |
| `approval` | `StepExecutors.Approval` | Pauses workflow, sets deadline from timeout | Resumes via approve/reject API |

New step types can be added by implementing the `StepExecutor` behaviour and registering in the step executor map.

### Action Types

| Action | Executor Module | Status |
|--------|----------------|--------|
| `set_field` | `ActionExecutors.SetField` | Implemented — UPDATE on target entity via registry resolution |
| `webhook` | `ActionExecutors.Webhook` | Implemented — dispatches HTTP request |
| `create_record` | `ActionExecutors.CreateRecord` | Stub (logs) |
| `send_event` | `ActionExecutors.SendEvent` | Stub (logs) |

New action types can be added by implementing the `ActionExecutor` behaviour and registering in the action executor map.

### Context Resolution

Workflow context is built from dot-path mappings against the trigger record:

```json
{
  "context": {
    "record_id": "trigger.record_id",
    "amount": "trigger.record.amount"
  }
}
```

Actions reference context via paths like `"context.record_id"`.

### Abstractions

#### WorkflowStore (Behaviour)

Behaviour for all `_workflow_instances` persistence. Single implementation: `PostgresWorkflowStore`.

```elixir
@callback create_instance(conn, data) :: {:ok, String.t()} | {:error, term()}
@callback load_instance(conn, id) :: {:ok, map()} | {:error, term()}
@callback persist_instance(conn, instance) :: :ok | {:error, term()}
@callback list_pending(conn) :: {:ok, list(map())} | {:error, term()}
@callback find_timed_out(conn) :: {:ok, list(map())} | {:error, term()}
```

#### StepExecutor (Behaviour)

Behaviour for step type handlers. Each step type has its own module.

```elixir
@callback execute(conn, ctx, instance, step) ::
  {:paused, map()} | {:next, String.t(), map()} | {:error, term(), map()}
```

#### ActionExecutor (Behaviour)

Behaviour for action type handlers. Each action type has its own module.

```elixir
@callback execute(conn, ctx, instance, action) :: :ok | {:error, term()}
```

#### WorkflowExpression (Behaviour)

Behaviour for condition expression evaluation. Wraps `Rocket.Engine.Expression`.

```elixir
@callback evaluate_bool(expression :: String.t(), env :: map()) ::
  {:ok, boolean()} | {:error, term()}
```

### Dependency Injection

Dependencies are assembled in a context map by `default_context/2`:

```elixir
%{
  conn: conn,
  registry: registry,
  store: PostgresWorkflowStore,
  step_executors: StepExecutors.default(),
  action_executors: ActionExecutors.default(),
  evaluator: DefaultWorkflowExpression
}
```

## Key Files

| File | Purpose |
|------|---------|
| `lib/rocket/engine/workflow_engine.ex` | Facade module + public API functions |
| `lib/rocket/engine/workflow_store.ex` | `WorkflowStore` behaviour + `PostgresWorkflowStore` |
| `lib/rocket/engine/workflow_step_executors.ex` | `StepExecutor` behaviour + Action/Condition/Approval modules |
| `lib/rocket/engine/workflow_action_executors.ex` | `ActionExecutor` behaviour + SetField/Webhook/CreateRecord/SendEvent modules |
| `lib/rocket/engine/workflow_expression.ex` | `WorkflowExpression` behaviour + `DefaultWorkflowExpression` |
| `lib/rocket_web/controllers/workflow_controller.ex` | Runtime HTTP endpoints (approve/reject/pending/get) |
| `lib/rocket/engine/workflow_scheduler.ex` | GenServer timeout processing — delegates to WorkflowEngine |
| `lib/rocket/metadata/registry.ex` | Registry with workflow lookup maps |
| `lib/rocket/metadata/loader.ex` | loadWorkflows from _workflows table |

## API Endpoints

### Admin (CRUD)
```
GET/POST       /api/_admin/workflows
GET/PUT/DELETE /api/_admin/workflows/:id
```

### Runtime
```
GET  /api/_workflows/pending      # List paused instances
GET  /api/_workflows/:id          # Get instance details
POST /api/_workflows/:id/approve  # Approve current step
POST /api/_workflows/:id/reject   # Reject current step
```

## Extending

### Adding a new step type

1. Create a module implementing the `StepExecutor` behaviour
2. Register it in `StepExecutors.default/0` with the type name key
3. The engine will automatically dispatch to it based on the step type

### Adding a new action type

1. Create a module implementing the `ActionExecutor` behaviour
2. Register it in `ActionExecutors.default/0` with the type name key
3. Action steps will automatically dispatch to it based on the action type
