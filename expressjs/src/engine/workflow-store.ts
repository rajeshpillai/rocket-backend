import type { Queryable } from "../store/postgres.js";
import { queryRow, queryRows, exec } from "../store/postgres.js";
import type { WorkflowInstance, WorkflowHistoryEntry } from "../metadata/workflow.js";

/**
 * WorkflowStore abstracts all persistence operations for workflow instances.
 * Implementations handle SQL queries, row parsing, and serialization.
 */
export interface WorkflowStore {
  createInstance(
    q: Queryable,
    data: {
      workflow_id: string;
      workflow_name: string;
      current_step: string;
      context: Record<string, any>;
    },
  ): Promise<string>;

  loadInstance(q: Queryable, id: string): Promise<WorkflowInstance>;
  persistInstance(q: Queryable, instance: WorkflowInstance): Promise<void>;
  listPending(q: Queryable): Promise<WorkflowInstance[]>;
  findTimedOut(q: Queryable): Promise<WorkflowInstance[]>;
}

/**
 * PostgresWorkflowStore implements WorkflowStore against _workflow_instances.
 */
export class PostgresWorkflowStore implements WorkflowStore {
  async createInstance(
    q: Queryable,
    data: {
      workflow_id: string;
      workflow_name: string;
      current_step: string;
      context: Record<string, any>;
    },
  ): Promise<string> {
    const row = await queryRow(
      q,
      `INSERT INTO _workflow_instances (workflow_id, workflow_name, status, current_step, context, history)
       VALUES ($1, $2, 'running', $3, $4, $5)
       RETURNING id`,
      [data.workflow_id, data.workflow_name, data.current_step, JSON.stringify(data.context), JSON.stringify([])],
    );
    return String(row.id);
  }

  async loadInstance(q: Queryable, id: string): Promise<WorkflowInstance> {
    const row = await queryRow(
      q,
      `SELECT id, workflow_id, workflow_name, status, current_step, current_step_deadline, context, history, created_at, updated_at
       FROM _workflow_instances WHERE id = $1`,
      [id],
    );
    return parseWorkflowInstanceRow(row);
  }

  async persistInstance(q: Queryable, instance: WorkflowInstance): Promise<void> {
    await exec(
      q,
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

  async listPending(q: Queryable): Promise<WorkflowInstance[]> {
    const rows = await queryRows(
      q,
      `SELECT id, workflow_id, workflow_name, status, current_step, current_step_deadline, context, history, created_at, updated_at
       FROM _workflow_instances WHERE status = 'running' AND current_step IS NOT NULL
       ORDER BY created_at DESC`,
    );
    return (rows ?? []).map(parseWorkflowInstanceRow);
  }

  async findTimedOut(q: Queryable): Promise<WorkflowInstance[]> {
    const rows = await queryRows(
      q,
      `SELECT id, workflow_id, workflow_name, status, current_step, current_step_deadline, context, history, created_at, updated_at
       FROM _workflow_instances
       WHERE status = 'running' AND current_step_deadline IS NOT NULL AND current_step_deadline < NOW()`,
    );
    return (rows ?? []).map(parseWorkflowInstanceRow);
  }
}

/**
 * Parses a raw database row into a WorkflowInstance.
 */
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
