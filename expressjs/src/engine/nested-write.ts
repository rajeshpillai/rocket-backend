import type { Queryable, Store } from "../store/postgres.js";
import { queryRow, queryRows, exec } from "../store/postgres.js";
import type { Entity } from "../metadata/types.js";
import type { Registry } from "../metadata/registry.js";
import { getField, fieldNames } from "../metadata/types.js";
import type { ErrorDetail } from "./errors.js";
import { AppError, validationError } from "./errors.js";
import type { RelationWrite } from "./writer.js";
import {
  buildInsertSQL,
  buildUpdateSQL,
  validateFields,
  separateFieldsAndRelations,
} from "./writer.js";
import { executeChildWrite } from "./diff.js";
import { evaluateRules } from "./rules.js";
import { evaluateStateMachines } from "./state-machine.js";
import { triggerWorkflows } from "./workflow.js";
import { fireAsyncWebhooks, fireSyncWebhooks } from "./webhook.js";
import { getInstrumenter } from "../instrument/instrument.js";

export interface WritePlan {
  isCreate: boolean;
  entity: Entity;
  fields: Record<string, any>;
  id: any;
  childOps: RelationWrite[];
  user: { id: string; roles: string[] } | null;
}

export function planWrite(
  entity: Entity,
  registry: Registry,
  body: Record<string, any>,
  existingID: any | null,
): WritePlan {
  const [fields, relWrites, unknownKeys] = separateFieldsAndRelations(
    entity,
    registry,
    body,
  );

  // Reject unknown keys
  if (unknownKeys.length > 0) {
    const errs: ErrorDetail[] = unknownKeys.map((key) => ({
      field: key,
      rule: "unknown",
      message: `Unknown field or relation: ${key}`,
    }));
    throw validationError(errs);
  }

  const isCreate = existingID == null;

  const validationErrs = validateFields(entity, fields, isCreate);
  if (validationErrs.length > 0) {
    throw validationError(validationErrs);
  }

  const plan: WritePlan = {
    isCreate,
    entity,
    fields,
    id: existingID,
    childOps: Array.from(relWrites.values()),
    user: null,
  };

  return plan;
}

export async function executeWritePlan(
  store: Store,
  registry: Registry,
  plan: WritePlan,
): Promise<Record<string, any>> {
  const span = getInstrumenter().startSpan("engine", "writer", "nested_write.execute");
  span.setEntity(plan.entity.name, plan.id ?? undefined);
  span.setMetadata("operation", plan.isCreate ? "create" : "update");
  const client = await store.beginTx();
  try {
    // Evaluate rules (field → expression → computed)
    let old: Record<string, any> = {};
    if (!plan.isCreate) {
      try {
        old = await fetchRecord(client, plan.entity, plan.id);
      } catch {
        // ignore if old record not found
      }
    }

    const ruleErrs = evaluateRules(
      registry,
      plan.entity.name,
      "before_write",
      plan.fields,
      old,
      plan.isCreate,
    );
    if (ruleErrs.length > 0) {
      throw validationError(ruleErrs);
    }

    // Evaluate state machines (after rules, before SQL write)
    const smErrs = evaluateStateMachines(
      registry,
      plan.entity.name,
      plan.fields,
      old,
      plan.isCreate,
    );
    if (smErrs.length > 0) {
      throw validationError(smErrs);
    }

    // Resolve file fields: UUID string → JSONB metadata object
    await resolveFileFields(client, plan.entity, plan.fields);

    let parentID: any;

    if (plan.isCreate) {
      const [sql, params] = buildInsertSQL(plan.entity, plan.fields);
      const row = await queryRow(client, sql, params);
      parentID = row[plan.entity.primary_key.field];
    } else {
      parentID = plan.id;
      const [sql, params] = buildUpdateSQL(plan.entity, plan.id, plan.fields);
      if (sql) {
        await exec(client, sql, params!);
      }
    }

    for (const childOp of plan.childOps) {
      await executeChildWrite(client, registry, parentID, childOp);
    }

    // Pre-commit: fire sync (before_write) webhooks
    const action = plan.isCreate ? "create" : "update";
    await fireSyncWebhooks(client, registry, "before_write", plan.entity.name, action, plan.fields, old, plan.user);

    await client.query("COMMIT");

    // Fetch the full record
    const result = await fetchRecord(store.pool, plan.entity, parentID);

    // Post-commit: trigger workflows for state transitions
    const machines = registry.getStateMachinesForEntity(plan.entity.name);
    for (const sm of machines) {
      const oldState = old[sm.field] != null ? String(old[sm.field]) : "";
      const newState = result[sm.field] != null ? String(result[sm.field]) : "";
      if (oldState !== newState && newState !== "") {
        triggerWorkflows(store, registry, plan.entity.name, sm.field, newState, result, parentID).catch((err) => {
          console.error(`ERROR: triggering workflows for ${plan.entity.name}.${sm.field} -> ${newState}:`, err);
        });
      }
    }

    // Post-commit: fire async (after_write) webhooks
    fireAsyncWebhooks(store, registry, "after_write", plan.entity.name, action, result, old, plan.user);

    span.setStatus("ok");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    span.setStatus("error");
    span.setMetadata("error", (err as Error).message);
    throw err;
  } finally {
    client.release();
    span.end();
  }
}

export async function fetchRecord(
  q: Queryable,
  entity: Entity,
  id: any,
): Promise<Record<string, any>> {
  const columns = fieldNames(entity);
  if (entity.soft_delete && !getField(entity, "deleted_at")) {
    columns.push("deleted_at");
  }

  let sql = `SELECT ${columns.join(", ")} FROM ${entity.table} WHERE ${entity.primary_key.field} = $1`;
  if (entity.soft_delete) {
    sql += " AND deleted_at IS NULL";
  }

  return queryRow(q, sql, [id]);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * For each file-type field whose value is a UUID string, resolve it to
 * the full JSONB metadata object {id, filename, size, mime_type, url}.
 * If the value is already an object, pass through unchanged.
 */
async function resolveFileFields(
  q: Queryable,
  entity: Entity,
  fields: Record<string, any>,
): Promise<void> {
  for (const f of entity.fields) {
    if (f.type !== "file") continue;
    const val = fields[f.name];
    if (val === undefined || val === null) continue;
    // If already an object (full metadata), pass through
    if (typeof val === "object") continue;
    // If it's a UUID string, resolve from _files
    const strVal = String(val);
    if (!UUID_RE.test(strVal)) continue;

    const rows = await queryRows(
      q,
      "SELECT id, filename, size, mime_type FROM _files WHERE id = $1",
      [strVal],
    );
    if (rows.length === 0) {
      throw new AppError("NOT_FOUND", 404, `File ${strVal} not found`);
    }
    const fileRow = rows[0];
    fields[f.name] = {
      id: fileRow.id,
      filename: fileRow.filename,
      size: Number(fileRow.size),
      mime_type: fileRow.mime_type,
    };
  }
}
