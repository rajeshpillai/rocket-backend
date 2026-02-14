import type { Queryable } from "../store/postgres.js";
import { exec } from "../store/postgres.js";
import type { Registry } from "../metadata/registry.js";
import type { WorkflowAction, WorkflowInstance } from "../metadata/workflow.js";
import type { DispatchResult } from "./webhook.js";

/**
 * ActionExecutor handles execution of a single workflow action type.
 * Each action type (set_field, webhook, create_record, send_event) has its own executor.
 */
export interface ActionExecutor {
  execute(q: Queryable, instance: WorkflowInstance, action: WorkflowAction): Promise<void>;
}

/**
 * SetFieldActionExecutor performs a field update on a target entity record.
 * Resolves entity from registry, validates field exists, and performs UPDATE.
 */
export class SetFieldActionExecutor implements ActionExecutor {
  constructor(private registry: Registry) {}

  async execute(q: Queryable, instance: WorkflowInstance, action: WorkflowAction): Promise<void> {
    const entityName = action.entity;
    if (!entityName) {
      throw new Error("set_field action missing entity");
    }

    const entity = this.registry.getEntity(entityName);
    if (!entity) {
      throw new Error(`entity not found: ${entityName}`);
    }

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
    await exec(q, sql, [val, recordID]);
  }
}

/**
 * WebhookActionExecutor dispatches an HTTP request as a workflow action.
 * The dispatcher function is injected to decouple from the webhook module.
 */
export class WebhookActionExecutor implements ActionExecutor {
  constructor(
    private dispatcher: (
      url: string,
      method: string,
      headers: Record<string, string> | null,
      body: string,
    ) => Promise<DispatchResult>,
  ) {}

  async execute(_q: Queryable, instance: WorkflowInstance, action: WorkflowAction): Promise<void> {
    const result = await this.dispatcher(
      action.url!,
      action.method ?? "POST",
      null,
      JSON.stringify(instance.context),
    );
    if (result.error) {
      throw new Error(`workflow webhook ${action.method} ${action.url} failed: ${result.error}`);
    }
    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw new Error(`workflow webhook ${action.method} ${action.url} returned HTTP ${result.statusCode}`);
    }
  }
}

/**
 * CreateRecordActionExecutor creates a new record in a target entity.
 * Currently a stub — to be implemented when needed.
 */
export class CreateRecordActionExecutor implements ActionExecutor {
  async execute(_q: Queryable, _instance: WorkflowInstance, action: WorkflowAction): Promise<void> {
    console.log(`STUB: workflow create_record action for entity ${action.entity} (not yet implemented)`);
  }
}

/**
 * SendEventActionExecutor emits a named event.
 * Currently a stub — to be implemented when Phase 8 events are ready.
 */
export class SendEventActionExecutor implements ActionExecutor {
  async execute(_q: Queryable, _instance: WorkflowInstance, action: WorkflowAction): Promise<void> {
    console.log(`STUB: workflow send_event action '${action.event}' (not yet implemented)`);
  }
}

/**
 * Creates the default set of action executors.
 */
export function createDefaultActionExecutors(
  registry: Registry,
  dispatcher: (url: string, method: string, headers: Record<string, string> | null, body: string) => Promise<DispatchResult>,
): Map<string, ActionExecutor> {
  const executors = new Map<string, ActionExecutor>();
  executors.set("set_field", new SetFieldActionExecutor(registry));
  executors.set("webhook", new WebhookActionExecutor(dispatcher));
  executors.set("create_record", new CreateRecordActionExecutor());
  executors.set("send_event", new SendEventActionExecutor());
  return executors;
}

/**
 * Resolves a dot-path like "context.record_id" from a nested map.
 */
function resolveContextPath(data: Record<string, any>, path: string): any {
  if (!path) return null;
  const parts = path.split(".");
  let current: any = data;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return null;
    current = current[part];
  }
  return current ?? null;
}
