# Workflows — Express.js Implementation

## Overview

Workflows are multi-step, long-running processes triggered by state machine transitions. They support action steps (execute operations), condition steps (branch on expressions), and approval steps (pause for human decisions).

## System Tables

- `_workflows` — workflow definitions (trigger, context mappings, steps)
- `_workflow_instances` — running/completed instances (status, current step, context, history)

## Architecture

The workflow engine is built around pluggable abstractions with dependency injection:

```
WorkflowEngine (facade — orchestrates everything)
├── WorkflowStore (persistence — all _workflow_instances SQL)
├── StepExecutors (registry: action / condition / approval)
│   └── ActionExecutors (registry: set_field / webhook / create_record / send_event)
└── ExpressionEvaluator (condition evaluation)
```

### Trigger Flow

```
State Machine Transition (post-commit in nested-write.ts)
  → triggerWorkflows(entity, field, toState, record, recordID)
    → WorkflowEngine.triggerWorkflows()
      → Registry lookup by "entity:field:toState" key
        → wfStore.createInstance() for each matching workflow
          → advanceWorkflow() loop
```

### Step Types

| Type | Executor Class | Behavior | Navigation |
|------|---------------|----------|------------|
| `action` | `ActionStepExecutor` | Runs actions via ActionExecutor registry, follows `then` | `then.goto` or "end" |
| `condition` | `ConditionStepExecutor` | Evaluates expression via ExpressionEvaluator, branches | `on_true.goto` / `on_false.goto` |
| `approval` | `ApprovalStepExecutor` | Pauses workflow, sets deadline from timeout | Resumes via approve/reject API |

New step types can be added by implementing the `StepExecutor` interface and registering in the step executor map.

### Action Types

| Action | Executor Class | Status |
|--------|---------------|--------|
| `set_field` | `SetFieldActionExecutor` | Implemented — UPDATE on target entity via registry resolution |
| `webhook` | `WebhookActionExecutor` | Implemented — dispatches HTTP request via injected dispatcher |
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

Interface for all `_workflow_instances` persistence. Single implementation: `PostgresWorkflowStore`.

```typescript
interface WorkflowStore {
  createInstance(q, data): Promise<string>;
  loadInstance(q, id): Promise<WorkflowInstance>;
  persistInstance(q, instance): Promise<void>;
  listPending(q): Promise<WorkflowInstance[]>;
  findTimedOut(q): Promise<WorkflowInstance[]>;
}
```

#### StepExecutor

Interface for step type handlers. Each step type has its own executor class.

```typescript
interface StepExecutor {
  execute(q, ctx, instance, step): Promise<StepResult>;
}
// StepResult: { paused: boolean; nextGoto: string }
```

#### ActionExecutor

Interface for action type handlers. Each action type has its own executor class.

```typescript
interface ActionExecutor {
  execute(q, instance, action): Promise<void>;
}
```

#### ExpressionEvaluator

Interface for condition expression evaluation. Wraps `new Function()` with caching.

```typescript
interface ExpressionEvaluator {
  evaluateBool(expression: string, env: Record<string, any>): boolean;
}
```

## Key Files

| File | Purpose |
|------|---------|
| `src/engine/workflow.ts` | `WorkflowEngine` class (facade) + backward-compat free functions |
| `src/engine/workflow-store.ts` | `WorkflowStore` interface + `PostgresWorkflowStore` |
| `src/engine/workflow-step-executors.ts` | `StepExecutor` interface + Action/Condition/Approval executors |
| `src/engine/workflow-action-executors.ts` | `ActionExecutor` interface + SetField/Webhook/CreateRecord/SendEvent executors |
| `src/engine/workflow-expression.ts` | `ExpressionEvaluator` interface + `FunctionExpressionEvaluator` |
| `src/engine/workflow-handler.ts` | Runtime HTTP endpoints (approve/reject/pending/get) |
| `src/engine/workflow-scheduler.ts` | `WorkflowScheduler` — delegates to `WorkflowEngine.processTimeouts()` |
| `src/metadata/workflow.ts` | Types + helpers (parseStepGoto, normalizeWorkflowSteps) |
| `src/metadata/registry.ts` | Registry maps (workflowsByTrigger, workflowsByName) |
| `src/metadata/loader.ts` | loadWorkflows() from _workflows table |
| `src/admin/handler.ts` | CRUD endpoints + validateWorkflow() |
| `src/engine/nested-write.ts` | Post-commit workflow trigger hook |

## Backward Compatibility

The refactored engine preserves all existing call signatures via free function wrappers:

```typescript
// These create a WorkflowEngine internally — no caller changes needed
export async function triggerWorkflows(store, registry, entity, field, toState, record, recordID)
export async function resolveWorkflowAction(store, registry, instanceID, action, userID)
export async function loadWorkflowInstance(store, id)
export async function listPendingInstances(store)
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

1. Create a class implementing `StepExecutor`
2. Register it in `createDefaultStepExecutors()` with the type name key
3. The engine will automatically dispatch to it based on `step.type`

### Adding a new action type

1. Create a class implementing `ActionExecutor`
2. Register it in `createDefaultActionExecutors()` with the type name key
3. Action steps will automatically dispatch to it based on `action.type`
