import type { Queryable } from "../store/postgres.js";
import type { WorkflowInstance, WorkflowStep } from "../metadata/workflow.js";
import type { ActionExecutor } from "./workflow-action-executors.js";
import type { ExpressionEvaluator } from "./workflow-expression.js";

/**
 * StepResult represents the outcome of executing a workflow step.
 */
export interface StepResult {
  paused: boolean;
  nextGoto: string;
}

/**
 * StepExecutorContext provides dependencies that step executors need.
 */
export interface StepExecutorContext {
  actionExecutors: Map<string, ActionExecutor>;
  evaluator: ExpressionEvaluator;
}

/**
 * StepExecutor handles execution of a single workflow step type.
 * Implementations exist for action, condition, and approval steps.
 */
export interface StepExecutor {
  execute(
    q: Queryable,
    ctx: StepExecutorContext,
    instance: WorkflowInstance,
    step: WorkflowStep,
  ): Promise<StepResult>;
}

/**
 * ActionStepExecutor runs all actions in an action step sequentially,
 * then advances to the next step.
 */
export class ActionStepExecutor implements StepExecutor {
  async execute(
    q: Queryable,
    ctx: StepExecutorContext,
    instance: WorkflowInstance,
    step: WorkflowStep,
  ): Promise<StepResult> {
    for (const action of step.actions ?? []) {
      const executor = ctx.actionExecutors.get(action.type);
      if (executor) {
        await executor.execute(q, instance, action);
      } else {
        console.warn(`WARN: unknown workflow action type: ${action.type}`);
      }
    }

    instance.history.push({
      step: step.id,
      status: "completed",
      at: new Date().toISOString(),
    });

    const next = step.then?.goto ?? "";
    return { paused: false, nextGoto: next };
  }
}

/**
 * ConditionStepExecutor evaluates a boolean expression and branches
 * to on_true or on_false paths.
 */
export class ConditionStepExecutor implements StepExecutor {
  async execute(
    _q: Queryable,
    ctx: StepExecutorContext,
    instance: WorkflowInstance,
    step: WorkflowStep,
  ): Promise<StepResult> {
    if (!step.expression) {
      throw new Error(`condition step ${step.id} has no expression`);
    }

    const env = { context: instance.context };
    let result: boolean;
    try {
      result = ctx.evaluator.evaluateBool(step.expression, env);
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
}

/**
 * ApprovalStepExecutor pauses the workflow and optionally sets a deadline
 * for timeout handling.
 */
export class ApprovalStepExecutor implements StepExecutor {
  async execute(
    _q: Queryable,
    _ctx: StepExecutorContext,
    instance: WorkflowInstance,
    step: WorkflowStep,
  ): Promise<StepResult> {
    if (step.timeout) {
      const ms = parseDuration(step.timeout);
      if (ms > 0) {
        const deadline = new Date(Date.now() + ms).toISOString();
        instance.current_step_deadline = deadline;
      }
    }

    return { paused: true, nextGoto: "" };
  }
}

/**
 * Creates the default set of step executors.
 */
export function createDefaultStepExecutors(): Map<string, StepExecutor> {
  const executors = new Map<string, StepExecutor>();
  executors.set("action", new ActionStepExecutor());
  executors.set("condition", new ConditionStepExecutor());
  executors.set("approval", new ApprovalStepExecutor());
  return executors;
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
