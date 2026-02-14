import type { Store } from "../store/postgres.js";
import type { Queryable } from "../store/postgres.js";
import type { Registry } from "../metadata/registry.js";
import type {
  Workflow,
  WorkflowStep,
  WorkflowInstance,
} from "../metadata/workflow.js";
import { findStep } from "../metadata/workflow.js";
import { dispatchWebhookDirect } from "./webhook.js";
import type { WorkflowStore } from "./workflow-store.js";
import { PostgresWorkflowStore } from "./workflow-store.js";
import type { StepExecutor, StepResult, StepExecutorContext } from "./workflow-step-executors.js";
import { createDefaultStepExecutors } from "./workflow-step-executors.js";
import type { ActionExecutor } from "./workflow-action-executors.js";
import { createDefaultActionExecutors } from "./workflow-action-executors.js";
import type { ExpressionEvaluator } from "./workflow-expression.js";
import { FunctionExpressionEvaluator } from "./workflow-expression.js";

/**
 * WorkflowEngine orchestrates workflow lifecycle: triggering, step advancement,
 * approval resolution, and timeout handling. All dependencies are injected.
 */
export class WorkflowEngine {
  private wfStore: WorkflowStore;
  private registry: Registry;
  private pool: Queryable;
  private stepExecutors: Map<string, StepExecutor>;
  private actionExecutors: Map<string, ActionExecutor>;
  private evaluator: ExpressionEvaluator;

  constructor(
    pool: Queryable,
    registry: Registry,
    wfStore: WorkflowStore,
    stepExecutors: Map<string, StepExecutor>,
    actionExecutors: Map<string, ActionExecutor>,
    evaluator: ExpressionEvaluator,
  ) {
    this.pool = pool;
    this.registry = registry;
    this.wfStore = wfStore;
    this.stepExecutors = stepExecutors;
    this.actionExecutors = actionExecutors;
    this.evaluator = evaluator;
  }

  /**
   * Creates a WorkflowEngine with default executors and Postgres store.
   */
  static createDefault(store: Store, registry: Registry): WorkflowEngine {
    const wfStore = new PostgresWorkflowStore();
    const stepExecutors = createDefaultStepExecutors();
    const actionExecutors = createDefaultActionExecutors(registry, dispatchWebhookDirect);
    const evaluator = new FunctionExpressionEvaluator();
    return new WorkflowEngine(store.pool, registry, wfStore, stepExecutors, actionExecutors, evaluator);
  }

  /**
   * Checks if any active workflows match the state transition and starts them.
   */
  async triggerWorkflows(
    entity: string,
    field: string,
    toState: string,
    record: Record<string, any>,
    recordID: any,
  ): Promise<void> {
    const workflows = this.registry.getWorkflowsForTrigger(entity, field, toState);
    if (workflows.length === 0) return;

    for (const wf of workflows) {
      try {
        await this.createInstance(wf, record, recordID);
      } catch (err) {
        console.error(`ERROR: failed to create workflow instance for ${wf.name}:`, err);
      }
    }
  }

  /**
   * Handles approve/reject on a paused workflow instance.
   */
  async resolveWorkflowAction(
    instanceID: string,
    action: string,
    userID: string,
  ): Promise<WorkflowInstance> {
    const instance = await this.wfStore.loadInstance(this.pool, instanceID);

    if (instance.status !== "running") {
      throw new Error(`workflow instance is not running (status: ${instance.status})`);
    }

    const wf = this.registry.getWorkflow(instance.workflow_name);
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
      await this.wfStore.persistInstance(this.pool, instance);
      return instance;
    }

    instance.current_step = nextGoto;
    await this.advanceWorkflow(instance, wf);

    return this.wfStore.loadInstance(this.pool, instance.id);
  }

  /**
   * Processes timed-out workflow instances. Called by the scheduler.
   */
  async processTimeouts(): Promise<void> {
    const instances = await this.wfStore.findTimedOut(this.pool);

    for (const instance of instances) {
      try {
        await this.handleTimeout(instance);
      } catch (err) {
        console.error(`ERROR: processing timeout for instance ${instance.id}:`, err);
      }
    }
  }

  /**
   * Loads a workflow instance by ID (delegated to store).
   */
  async loadInstance(id: string): Promise<WorkflowInstance> {
    return this.wfStore.loadInstance(this.pool, id);
  }

  /**
   * Lists pending (running) workflow instances (delegated to store).
   */
  async listPending(): Promise<WorkflowInstance[]> {
    return this.wfStore.listPending(this.pool);
  }

  // ── Internal ──

  private async createInstance(
    wf: Workflow,
    record: Record<string, any>,
    recordID: any,
  ): Promise<void> {
    const wfCtx = buildWorkflowContext(wf.context, record, recordID);

    if (wf.steps.length === 0) {
      throw new Error(`workflow ${wf.name} has no steps`);
    }

    const firstStepID = wf.steps[0].id;

    const instanceID = await this.wfStore.createInstance(this.pool, {
      workflow_id: wf.id,
      workflow_name: wf.name,
      current_step: firstStepID,
      context: wfCtx,
    });

    const instance: WorkflowInstance = {
      id: instanceID,
      workflow_id: wf.id,
      workflow_name: wf.name,
      status: "running",
      current_step: firstStepID,
      context: wfCtx,
      history: [],
    };

    console.log(`Created workflow instance ${instance.id} for workflow ${wf.name}`);

    await this.advanceWorkflow(instance, wf);
  }

  private async advanceWorkflow(instance: WorkflowInstance, wf: Workflow): Promise<void> {
    const stepCtx: StepExecutorContext = {
      actionExecutors: this.actionExecutors,
      evaluator: this.evaluator,
    };

    while (instance.status === "running") {
      const step = findStep(wf, instance.current_step);
      if (!step) {
        instance.status = "failed";
        await this.wfStore.persistInstance(this.pool, instance);
        return;
      }

      const executor = this.stepExecutors.get(step.type);
      if (!executor) {
        throw new Error(`unknown step type: ${step.type}`);
      }

      const { paused, nextGoto } = await executor.execute(this.pool, stepCtx, instance, step);

      if (paused) {
        await this.wfStore.persistInstance(this.pool, instance);
        return;
      }

      if (!nextGoto || nextGoto === "end") {
        instance.status = "completed";
        instance.current_step = "";
        await this.wfStore.persistInstance(this.pool, instance);
        return;
      }

      instance.current_step = nextGoto;
    }
  }

  private async handleTimeout(instance: WorkflowInstance): Promise<void> {
    const wf = this.registry.getWorkflow(instance.workflow_name);
    if (!wf) {
      console.error(`Workflow definition not found: ${instance.workflow_name}`);
      return;
    }

    const step = findStep(wf, instance.current_step);
    if (!step || step.type !== "approval") {
      return;
    }

    console.log(`Workflow instance ${instance.id} step ${step.id} timed out`);

    instance.history.push({
      step: step.id,
      status: "timed_out",
      at: new Date().toISOString(),
    });
    instance.current_step_deadline = null;

    const nextGoto = step.on_timeout?.goto ?? "";
    if (!nextGoto || nextGoto === "end") {
      instance.status = "failed";
      instance.current_step = "";
      await this.wfStore.persistInstance(this.pool, instance);
      return;
    }

    instance.current_step = nextGoto;
    await this.advanceWorkflow(instance, wf);
  }
}

// ── Backward-compatible free functions ──
// These preserve the existing call signatures used by nested-write.ts,
// workflow-handler.ts, and multi-app scheduler.

export async function triggerWorkflows(
  store: Store,
  registry: Registry,
  entity: string,
  field: string,
  toState: string,
  record: Record<string, any>,
  recordID: any,
): Promise<void> {
  const engine = WorkflowEngine.createDefault(store, registry);
  await engine.triggerWorkflows(entity, field, toState, record, recordID);
}

export async function resolveWorkflowAction(
  store: Store,
  registry: Registry,
  instanceID: string,
  action: string,
  userID: string,
): Promise<WorkflowInstance> {
  const engine = WorkflowEngine.createDefault(store, registry);
  return engine.resolveWorkflowAction(instanceID, action, userID);
}

export async function loadWorkflowInstance(store: Store, id: string): Promise<WorkflowInstance> {
  const wfStore = new PostgresWorkflowStore();
  return wfStore.loadInstance(store.pool, id);
}

export async function listPendingInstances(store: Store): Promise<WorkflowInstance[]> {
  const wfStore = new PostgresWorkflowStore();
  return wfStore.listPending(store.pool);
}

// ── Context helpers (still needed by external callers) ──

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
