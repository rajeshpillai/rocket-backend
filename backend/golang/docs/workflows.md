# Workflows — Go Implementation

## Overview

Workflows are multi-step, long-running processes triggered by state machine transitions. They support action steps (execute operations), condition steps (branch on expressions), and approval steps (pause for human decisions).

## System Tables

- `_workflows` — workflow definitions (trigger, context mappings, steps)
- `_workflow_instances` — running/completed instances (status, current step, context, history)

## Architecture

The workflow engine is built around pluggable abstractions with dependency injection:

```
WFEngine (facade — orchestrates everything)
├── WorkflowStore (persistence — all _workflow_instances SQL)
├── StepExecutors (registry: action / condition / approval)
│   └── ActionExecutors (registry: set_field / webhook / create_record / send_event)
└── ExpressionEvaluator (condition evaluation via expr-lang/expr)
```

### Trigger Flow

```
State Machine Transition (post-commit)
  → TriggerWorkflows(entity, field, toState, record, recordID)
    → WFEngine.TriggerWorkflows()
      → Registry lookup by "entity:field:toState" key
        → wfStore.CreateInstance() for each matching workflow
          → advanceWorkflow() loop
```

### Step Types

| Type | Executor Struct | Behavior | Navigation |
|------|----------------|----------|------------|
| `action` | `ActionStepExecutor` | Runs actions via ActionExecutor registry, follows `then` | `then.goto` or "end" |
| `condition` | `ConditionStepExecutor` | Evaluates expression via `expr-lang/expr`, branches | `on_true.goto` / `on_false.goto` |
| `approval` | `ApprovalStepExecutor` | Pauses workflow, sets deadline from timeout | Resumes via approve/reject API |

New step types can be added by implementing the `StepExecutor` interface and registering in the step executor map.

### Action Types

| Action | Executor Struct | Status |
|--------|----------------|--------|
| `set_field` | `SetFieldActionExecutor` | Implemented — UPDATE on target entity via registry resolution |
| `webhook` | `WebhookActionExecutor` | Implemented — dispatches HTTP request |
| `create_record` | `CreateRecordActionExecutor` | Stub (logs) |
| `send_event` | `SendEventActionExecutor` | Stub (logs) |

New action types can be added by implementing the `ActionExecutor` interface and registering in the action executor map.

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

#### WorkflowStore

Interface for all `_workflow_instances` persistence. Single implementation: `PgWorkflowStore`.

```go
type WorkflowStore interface {
    CreateInstance(ctx, q, data) (string, error)
    LoadInstance(ctx, q, id) (*WorkflowInstance, error)
    PersistInstance(ctx, q, instance) error
    ListPending(ctx, q) ([]*WorkflowInstance, error)
    FindTimedOut(ctx, q) ([]*WorkflowInstance, error)
}
```

#### StepExecutor

Interface for step type handlers. Each step type has its own executor struct.

```go
type StepExecutor interface {
    Execute(ctx, q, ectx, instance, step) (*StepResult, error)
}
// StepResult: { Paused bool; NextGoto string }
```

#### ActionExecutor

Interface for action type handlers. Each action type has its own executor struct.

```go
type ActionExecutor interface {
    Execute(ctx, q, registry, instance, action) error
}
```

#### ExpressionEvaluator

Interface for condition expression evaluation. Implementation wraps `expr-lang/expr` with program caching.

```go
type ExpressionEvaluator interface {
    EvaluateBool(expression string, env map[string]any) (bool, error)
}
```

## Key Files

| File | Purpose |
|------|---------|
| `internal/engine/workflow.go` | `WFEngine` struct (facade) + backward-compat free functions |
| `internal/engine/workflow_store.go` | `WorkflowStore` interface + `PgWorkflowStore` |
| `internal/engine/workflow_step_executors.go` | `StepExecutor` interface + Action/Condition/Approval executors |
| `internal/engine/workflow_action_executors.go` | `ActionExecutor` interface + SetField/Webhook/CreateRecord/SendEvent executors |
| `internal/engine/workflow_expression.go` | `ExpressionEvaluator` interface + `ExprLangEvaluator` |
| `internal/engine/workflow_handler.go` | Runtime HTTP endpoints (approve/reject/pending/get) |
| `internal/engine/workflow_scheduler.go` | `WorkflowScheduler` — delegates to `WFEngine.ProcessTimeouts()` |
| `internal/metadata/workflow.go` | Types (Workflow, WorkflowStep, StepGoto, etc.) |
| `internal/metadata/registry.go` | Registry maps (workflowsByTrigger, workflowsByName) |
| `internal/metadata/loader.go` | loadWorkflows() from _workflows table |
| `internal/admin/handler.go` | CRUD endpoints + validateWorkflow() |
| `internal/engine/nested_write.go` | Post-commit workflow trigger hook |

## Backward Compatibility

The refactored engine preserves all existing call signatures via free function wrappers:

```go
// These create a WFEngine internally — no caller changes needed
func TriggerWorkflows(ctx, s, reg, entity, field, toState, record, recordID)
func ResolveWorkflowAction(ctx, s, reg, instanceID, action, userID) (*WorkflowInstance, error)
func ListPendingInstances(ctx, s) ([]*WorkflowInstance, error)
```

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
POST /api/_workflows/:id/approve  # Approve current step (X-User-ID header)
POST /api/_workflows/:id/reject   # Reject current step (X-User-ID header)
```

## Extending

### Adding a new step type

1. Create a struct implementing `StepExecutor`
2. Register it in `DefaultStepExecutors()` with the type name key
3. The engine will automatically dispatch to it based on `step.Type`

### Adding a new action type

1. Create a struct implementing `ActionExecutor`
2. Register it in `DefaultActionExecutors()` with the type name key
3. Action steps will automatically dispatch to it based on `action.Type`
