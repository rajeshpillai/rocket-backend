import type { Queryable, Store } from "../store/postgres.js";
import { queryRow, exec } from "../store/postgres.js";
import type { Entity } from "../metadata/types.js";
import type { Registry } from "../metadata/registry.js";
import { getField, fieldNames } from "../metadata/types.js";
import type { ErrorDetail } from "./errors.js";
import { validationError } from "./errors.js";
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

export interface WritePlan {
  isCreate: boolean;
  entity: Entity;
  fields: Record<string, any>;
  id: any;
  childOps: RelationWrite[];
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
  };

  return plan;
}

export async function executeWritePlan(
  store: Store,
  registry: Registry,
  plan: WritePlan,
): Promise<Record<string, any>> {
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

    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
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
