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

    // Fetch and return the full record
    return fetchRecord(store.pool, plan.entity, parentID);
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
