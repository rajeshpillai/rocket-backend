# Workflows — Express.js Implementation

## Overview

Workflows are multi-step, long-running processes triggered by state machine transitions. They support action steps (execute operations), condition steps (branch on expressions), and approval steps (pause for human decisions).

## System Tables

- `_workflows` — workflow definitions (trigger, context mappings, steps)
- `_workflow_instances` — running/completed instances (status, current step, context, history)

## Architecture

### Trigger Flow

```
State Machine Transition (post-commit in nested-write.ts)
  → triggerWorkflows(entity, field, toState, record, recordID)
    → Registry lookup by "entity:field:toState" key
      → createWorkflowInstance() for each matching workflow
        → advanceWorkflow() loop
```

### Step Types

| Type | Behavior | Navigation |
|------|----------|------------|
| `action` | Executes actions (set_field, webhook, etc.), follows `then` | `then.goto` or "end" |
| `condition` | Evaluates expression via `new Function` + `with(env)`, branches | `on_true.goto` / `on_false.goto` |
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
| `src/metadata/workflow.ts` | Types + helpers (parseStepGoto, normalizeWorkflowSteps) |
| `src/metadata/registry.ts` | Registry maps (workflowsByTrigger, workflowsByName) |
| `src/metadata/loader.ts` | loadWorkflows() from _workflows table |
| `src/admin/handler.ts` | CRUD endpoints + validateWorkflow() |
| `src/engine/workflow.ts` | Execution engine (trigger, advance, execute steps) |
| `src/engine/workflow-handler.ts` | Runtime HTTP endpoints (approve/reject/pending/get) |
| `src/engine/workflow-scheduler.ts` | setInterval timeout processing (60s interval) |
| `src/engine/nested-write.ts` | Post-commit workflow trigger hook |

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

- **Integration tests**: CRUD (6), trigger+execution, approval flow, rejection, condition branching (2)
- Total: 32 tests (25 existing + 7 new workflow tests)
