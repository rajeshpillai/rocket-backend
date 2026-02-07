import type { Store } from "../store/postgres.js";
import { queryRow, queryRows, exec } from "../store/postgres.js";
import type { Registry } from "../metadata/registry.js";
import type {
  Workflow,
  WorkflowStep,
  WorkflowAction,
  WorkflowInstance,
  WorkflowHistoryEntry,
} from "../metadata/workflow.js";
import { findStep } from "../metadata/workflow.js";

/**
 * TriggerWorkflows checks if any active workflows should be started based on
 * a state transition. Called after a successful write commit.
 */
export async function triggerWorkflows(
  store: Store,
  registry: Registry,
  entity: string,
  field: string,
  toState: string,
  record: Record<string, any>,
  recordID: any,
): Promise<void> {
  const workflows = registry.getWorkflowsForTrigger(entity, field, toState);
  if (workflows.length === 0) return;

  for (const wf of workflows) {
    try {
      await createWorkflowInstance(store, registry, wf, record, recordID);
    } catch (err) {
      console.error(`ERROR: failed to create workflow instance for ${wf.name}:`, err);
    }
  }
}

/**
 * Creates a workflow instance, builds initial context, and starts executing steps.
 */
async function createWorkflowInstance(
  store: Store,
  registry: Registry,
  wf: Workflow,
  record: Record<string, any>,
  recordID: any,
): Promise<void> {
  const wfCtx = buildWorkflowContext(wf.context, record, recordID);

  if (wf.steps.length === 0) {
    throw new Error(`workflow ${wf.name} has no steps`);
  }

  const firstStepID = wf.steps[0].id;

  const row = await queryRow(
    store.pool,
    `INSERT INTO _workflow_instances (workflow_id, workflow_name, status, current_step, context, history)
     VALUES ($1, $2, 'running', $3, $4, $5)
     RETURNING id`,
    [wf.id, wf.name, firstStepID, JSON.stringify(wfCtx), JSON.stringify([])],
  );

  const instance: WorkflowInstance = {
    id: String(row.id),
    workflow_id: wf.id,
    workflow_name: wf.name,
    status: "running",
    current_step: firstStepID,
    context: wfCtx,
    history: [],
  };

  console.log(`Created workflow instance ${instance.id} for workflow ${wf.name}`);

  await advanceWorkflow(store, registry, instance, wf);
}

/**
 * Advances a workflow through steps until it pauses (approval) or ends.
 */
async function advanceWorkflow(
  store: Store,
  registry: Registry,
  instance: WorkflowInstance,
  wf: Workflow,
): Promise<void> {
  while (instance.status === "running") {
    const step = findStep(wf, instance.current_step);
    if (!step) {
      instance.status = "failed";
      await persistInstance(store, instance);
      return;
    }

    const { paused, nextGoto } = await executeStep(store, registry, instance, wf, step);

    if (paused) {
      await persistInstance(store, instance);
      return;
    }

    if (!nextGoto || nextGoto === "end") {
      instance.status = "completed";
      instance.current_step = "";
      await persistInstance(store, instance);
      return;
    }

    instance.current_step = nextGoto;
  }
}

interface StepResult {
  paused: boolean;
  nextGoto: string;
}

/**
 * Executes a single workflow step.
 */
async function executeStep(
  store: Store,
  registry: Registry,
  instance: WorkflowInstance,
  wf: Workflow,
  step: WorkflowStep,
): Promise<StepResult> {
  switch (step.type) {
    case "action":
      return executeActionStep(store, registry, instance, step);
    case "condition":
      return executeConditionStep(instance, step);
    case "approval":
      return executeApprovalStep(instance, step);
    default:
      throw new Error(`unknown step type: ${step.type}`);
  }
}

async function executeActionStep(
  store: Store,
  registry: Registry,
  instance: WorkflowInstance,
  step: WorkflowStep,
): Promise<StepResult> {
  for (const action of step.actions ?? []) {
    await executeWorkflowAction(store, registry, instance, action);
  }

  instance.history.push({
    step: step.id,
    status: "completed",
    at: new Date().toISOString(),
  });

  const next = step.then?.goto ?? "";
  return { paused: false, nextGoto: next };
}

function executeConditionStep(
  instance: WorkflowInstance,
  step: WorkflowStep,
): StepResult {
  if (!step.expression) {
    throw new Error(`condition step ${step.id} has no expression`);
  }

  const env = { context: instance.context };
  let result: boolean;
  try {
    const fn = new Function("env", `with (env) { return !!(${step.expression}); }`);
    result = fn(env);
  } catch (err: any) {
    throw new Error(`evaluate condition: ${err.message ?? err}`);
  }

  let status: string;
  let next = "";
  if (result) {
    status = "on_true";
    next = step.on_true?.goto ?? "";
  } else {
    status = "on_false";
    next = step.on_false?.goto ?? "";
  }

  instance.history.push({
    step: step.id,
    status,
    at: new Date().toISOString(),
  });

  return { paused: false, nextGoto: next };
}

function executeApprovalStep(
  instance: WorkflowInstance,
  step: WorkflowStep,
): StepResult {
  if (step.timeout) {
    const ms = parseDuration(step.timeout);
    if (ms > 0) {
      const deadline = new Date(Date.now() + ms).toISOString();
      instance.current_step_deadline = deadline;
    }
  }

  return { paused: true, nextGoto: "" };
}

/**
 * Executes a single workflow action.
 */
async function executeWorkflowAction(
  store: Store,
  registry: Registry,
  instance: WorkflowInstance,
  action: WorkflowAction,
): Promise<void> {
  switch (action.type) {
    case "set_field":
      await executeSetFieldAction(store, registry, instance, action);
      break;
    case "webhook":
      console.log(`STUB: workflow webhook action ${action.method} ${action.url} (not yet implemented)`);
      break;
    case "create_record":
      console.log(`STUB: workflow create_record action for entity ${action.entity} (not yet implemented)`);
      break;
    case "send_event":
      console.log(`STUB: workflow send_event action '${action.event}' (not yet implemented)`);
      break;
    default:
      console.warn(`WARN: unknown workflow action type: ${action.type}`);
  }
}

/**
 * Performs a standalone UPDATE on the target entity/record.
 */
async function executeSetFieldAction(
  store: Store,
  registry: Registry,
  instance: WorkflowInstance,
  action: WorkflowAction,
): Promise<void> {
  const entityName = action.entity;
  if (!entityName) {
    throw new Error("set_field action missing entity");
  }

  const entity = registry.getEntity(entityName);
  if (!entity) {
    throw new Error(`entity not found: ${entityName}`);
  }

  // Resolve record_id from context path (wrap in envelope so "context.record_id" works)
  const env: Record<string, any> = { context: instance.context };
  const recordID = resolveContextPath(env, action.record_id ?? "");
  if (recordID == null) {
    throw new Error(`could not resolve record_id: ${action.record_id}`);
  }

  let val: any = action.value;
  if (val === "now") {
    val = new Date().toISOString();
  }

  const sql = `UPDATE ${entity.table} SET ${action.field} = $1 WHERE ${entity.primary_key.field} = $2`;
  await exec(store.pool, sql, [val, recordID]);
}

/**
 * Handles approve/reject on a paused workflow instance.
 */
export async function resolveWorkflowAction(
  store: Store,
  registry: Registry,
  instanceID: string,
  action: string,
  userID: string,
): Promise<WorkflowInstance> {
  const instance = await loadWorkflowInstance(store, instanceID);

  if (instance.status !== "running") {
    throw new Error(`workflow instance is not running (status: ${instance.status})`);
  }

  const wf = registry.getWorkflow(instance.workflow_name);
  if (!wf) {
    throw new Error(`workflow definition not found: ${instance.workflow_name}`);
  }

  const step = findStep(wf, instance.current_step);
  if (!step) {
    throw new Error(`current step not found: ${instance.current_step}`);
  }
  if (step.type !== "approval") {
    throw new Error("current step is not an approval step");
  }

  instance.history.push({
    step: step.id,
    status: action,
    by: userID,
    at: new Date().toISOString(),
  });
  instance.current_step_deadline = null;

  let nextGoto = "";
  switch (action) {
    case "approved":
      nextGoto = step.on_approve?.goto ?? "";
      break;
    case "rejected":
      nextGoto = step.on_reject?.goto ?? "";
      break;
    default:
      throw new Error(`invalid action: ${action}`);
  }

  if (!nextGoto || nextGoto === "end") {
    instance.status = "completed";
    instance.current_step = "";
    await persistInstance(store, instance);
    return instance;
  }

  instance.current_step = nextGoto;
  await advanceWorkflow(store, registry, instance, wf);

  return loadWorkflowInstance(store, instance.id);
}

/**
 * Builds workflow context from trigger record using dot-path mappings.
 */
export function buildWorkflowContext(
  mappings: Record<string, string>,
  record: Record<string, any>,
  recordID: any,
): Record<string, any> {
  const ctx: Record<string, any> = {};
  const env: Record<string, any> = {
    trigger: {
      record_id: recordID,
      record,
    },
  };
  for (const [key, path] of Object.entries(mappings)) {
    ctx[key] = resolveContextPath(env, path);
  }
  return ctx;
}

/**
 * Resolves a dot-path like "trigger.record.amount" from a nested map.
 */
export function resolveContextPath(data: Record<string, any>, path: string): any {
  if (!path) return null;

  const parts = path.split(".");
  let current: any = data;

  for (const part of parts) {
    if (current == null || typeof current !== "object") return null;
    current = current[part];
  }

  return current ?? null;
}

/**
 * Updates the workflow instance in the database.
 */
async function persistInstance(store: Store, instance: WorkflowInstance): Promise<void> {
  await exec(
    store.pool,
    `UPDATE _workflow_instances
     SET status = $1, current_step = $2, current_step_deadline = $3, context = $4, history = $5, updated_at = NOW()
     WHERE id = $6`,
    [
      instance.status,
      instance.current_step || null,
      instance.current_step_deadline ?? null,
      JSON.stringify(instance.context),
      JSON.stringify(instance.history),
      instance.id,
    ],
  );
}

/**
 * Loads a single workflow instance by ID.
 */
export async function loadWorkflowInstance(store: Store, id: string): Promise<WorkflowInstance> {
  const row = await queryRow(
    store.pool,
    `SELECT id, workflow_id, workflow_name, status, current_step, current_step_deadline, context, history, created_at, updated_at
     FROM _workflow_instances WHERE id = $1`,
    [id],
  );
  return parseWorkflowInstanceRow(row);
}

/**
 * Lists workflow instances that are running (awaiting approval).
 */
export async function listPendingInstances(store: Store): Promise<WorkflowInstance[]> {
  const rows = await queryRows(
    store.pool,
    `SELECT id, workflow_id, workflow_name, status, current_step, current_step_deadline, context, history, created_at, updated_at
     FROM _workflow_instances WHERE status = 'running' AND current_step IS NOT NULL
     ORDER BY created_at DESC`,
  );
  return (rows ?? []).map(parseWorkflowInstanceRow);
}

function parseWorkflowInstanceRow(row: Record<string, any>): WorkflowInstance {
  let context: Record<string, any> = {};
  if (row.context != null) {
    context = typeof row.context === "string" ? JSON.parse(row.context) : row.context;
  }

  let history: WorkflowHistoryEntry[] = [];
  if (row.history != null) {
    history = typeof row.history === "string" ? JSON.parse(row.history) : row.history;
  }

  return {
    id: String(row.id),
    workflow_id: String(row.workflow_id),
    workflow_name: String(row.workflow_name),
    status: String(row.status),
    current_step: row.current_step ? String(row.current_step) : "",
    current_step_deadline: row.current_step_deadline ? String(row.current_step_deadline) : null,
    context,
    history,
    created_at: row.created_at ? String(row.created_at) : undefined,
    updated_at: row.updated_at ? String(row.updated_at) : undefined,
  };
}

/**
 * Parse duration strings like "72h", "48h", "30m" to milliseconds.
 */
function parseDuration(s: string): number {
  const match = s.match(/^(\d+)(h|m|s)$/);
  if (!match) return 0;
  const num = parseInt(match[1], 10);
  switch (match[2]) {
    case "h": return num * 60 * 60 * 1000;
    case "m": return num * 60 * 1000;
    case "s": return num * 1000;
    default: return 0;
  }
}
