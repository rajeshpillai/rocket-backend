import type { Store } from "../store/postgres.js";
import { queryRows, queryRow, exec } from "../store/postgres.js";
import type { Registry } from "../metadata/registry.js";
import { findStep } from "../metadata/workflow.js";
import type { WorkflowInstance, WorkflowHistoryEntry } from "../metadata/workflow.js";
import { resolveWorkflowAction, loadWorkflowInstance } from "./workflow.js";

export class WorkflowScheduler {
  private store: Store;
  private registry: Registry;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(store: Store, registry: Registry) {
    this.store = store;
    this.registry = registry;
  }

  start(): void {
    console.log("Workflow scheduler started (60s interval)");
    this.timer = setInterval(() => {
      this.processTimeouts().catch((err) => {
        console.error("ERROR: workflow scheduler:", err);
      });
    }, 60_000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log("Workflow scheduler stopped");
    }
  }

  async processTimeouts(): Promise<void> {
    const rows = await queryRows(
      this.store.pool,
      `SELECT id, workflow_id, workflow_name, status, current_step, current_step_deadline, context, history, created_at, updated_at
       FROM _workflow_instances
       WHERE status = 'running' AND current_step_deadline IS NOT NULL AND current_step_deadline < NOW()`,
    );

    if (!rows || rows.length === 0) return;

    for (const row of rows) {
      const instance = parseInstance(row);
      try {
        await this.handleTimeout(instance);
      } catch (err) {
        console.error(`ERROR: processing timeout for instance ${instance.id}:`, err);
      }
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
    } else {
      instance.current_step = nextGoto;
    }

    await exec(
      this.store.pool,
      `UPDATE _workflow_instances
       SET status = $1, current_step = $2, current_step_deadline = $3, context = $4, history = $5, updated_at = NOW()
       WHERE id = $6`,
      [
        instance.status,
        instance.current_step || null,
        null,
        JSON.stringify(instance.context),
        JSON.stringify(instance.history),
        instance.id,
      ],
    );
  }
}

function parseInstance(row: Record<string, any>): WorkflowInstance {
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
