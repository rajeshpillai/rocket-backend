# Workflows — Go Implementation

## Overview

Workflows are multi-step, long-running processes triggered by state machine transitions. They support action steps (execute operations), condition steps (branch on expressions), and approval steps (pause for human decisions).

## System Tables

- `_workflows` — workflow definitions (trigger, context mappings, steps)
- `_workflow_instances` — running/completed instances (status, current step, context, history)

## Architecture

### Trigger Flow

```
State Machine Transition (post-commit)
  → TriggerWorkflows(entity, field, toState, record, recordID)
    → Registry lookup by "entity:field:toState" key
      → createWorkflowInstance() for each matching workflow
        → advanceWorkflow() loop
```

### Step Types

| Type | Behavior | Navigation |
|------|----------|------------|
| `action` | Executes actions (set_field, webhook, etc.), follows `then` | `then.goto` or "end" |
| `condition` | Evaluates expression via `expr-lang/expr`, branches | `on_true.goto` / `on_false.goto` |
| `approval` | Pauses workflow, sets deadline from timeout | Resumes via approve/reject API |

### Action Types

| Action | Status |
|--------|--------|
| `set_field` | Implemented — standalone UPDATE on target entity |
| `webhook` | Stub (logs) |
| `create_record` | Stub (logs) |
| `send_event` | Stub (logs) |

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

## Key Files

| File | Purpose |
|------|---------|
| `internal/metadata/workflow.go` | Types (Workflow, WorkflowStep, StepGoto, etc.) |
| `internal/metadata/registry.go` | Registry maps (workflowsByTrigger, workflowsByName) |
| `internal/metadata/loader.go` | loadWorkflows() from _workflows table |
| `internal/admin/handler.go` | CRUD endpoints + validateWorkflow() |
| `internal/engine/workflow.go` | Execution engine (trigger, advance, execute steps) |
| `internal/engine/workflow_handler.go` | Runtime HTTP endpoints (approve/reject/pending/get) |
| `internal/engine/workflow_scheduler.go` | Background timeout processing (60s interval) |
| `internal/engine/nested_write.go` | Post-commit workflow trigger hook |

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

## Tests

- **Unit tests**: StepGoto marshal/unmarshal, workflow JSON parsing, FindStep, registry
- **Integration tests**: CRUD, trigger+execution, approval flow, rejection, condition branching, pending endpoint, get instance
