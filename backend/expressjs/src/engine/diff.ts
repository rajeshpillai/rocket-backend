import type { Queryable } from "../store/postgres.js";
import { queryRows, exec } from "../store/postgres.js";
import type { Entity, Relation } from "../metadata/types.js";
import type { Registry } from "../metadata/registry.js";
import { fieldNames } from "../metadata/types.js";
import type { RelationWrite } from "./writer.js";
import {
  buildInsertSQL,
  buildUpdateSQL,
  buildSoftDeleteSQL,
  buildHardDeleteSQL,
} from "./writer.js";

export async function executeChildWrite(
  q: Queryable,
  registry: Registry,
  parentID: any,
  rw: RelationWrite,
): Promise<void> {
  if (rw.relation.type === "many_to_many") {
    await executeManyToManyWrite(q, registry, parentID, rw);
  } else {
    await executeOneToManyWrite(q, registry, parentID, rw);
  }
}

async function executeOneToManyWrite(
  q: Queryable,
  registry: Registry,
  parentID: any,
  rw: RelationWrite,
): Promise<void> {
  const rel = rw.relation;
  const targetEntity = registry.getEntity(rel.target);
  if (!targetEntity) {
    throw new Error(`Unknown target entity: ${rel.target}`);
  }

  switch (rw.writeMode) {
    case "diff":
      await executeDiffWrite(q, targetEntity, rel, parentID, rw.data);
      break;
    case "replace":
      await executeReplaceWrite(q, targetEntity, rel, parentID, rw.data);
      break;
    case "append":
      await executeAppendWrite(q, targetEntity, rel, parentID, rw.data);
      break;
    default:
      await executeDiffWrite(q, targetEntity, rel, parentID, rw.data);
  }
}

async function executeDiffWrite(
  q: Queryable,
  targetEntity: Entity,
  rel: Relation,
  parentID: any,
  data: Record<string, any>[],
): Promise<void> {
  const pkField = targetEntity.primary_key.field;
  const existing = await fetchCurrentChildren(q, targetEntity, rel, parentID);
  const existingByPK = indexByPK(existing, pkField);

  for (const row of data) {
    if (row._delete === true) {
      const pk = row[pkField];
      if (pk != null) {
        await softDeleteChild(q, targetEntity, pk);
      }
      continue;
    }

    const pk = row[pkField];
    if (pk != null) {
      if (existingByPK.has(String(pk))) {
        await updateChild(q, targetEntity, pk, row);
      }
      // PK provided but not in current children — skip in diff mode
    } else {
      row[rel.target_key!] = parentID;
      await insertChild(q, targetEntity, row);
    }
  }
}

async function executeReplaceWrite(
  q: Queryable,
  targetEntity: Entity,
  rel: Relation,
  parentID: any,
  data: Record<string, any>[],
): Promise<void> {
  const pkField = targetEntity.primary_key.field;
  const existing = await fetchCurrentChildren(q, targetEntity, rel, parentID);
  const existingByPK = indexByPK(existing, pkField);
  const seen = new Set<string>();

  for (const row of data) {
    const pk = row[pkField];
    if (pk != null) {
      const pkStr = String(pk);
      if (existingByPK.has(pkStr)) {
        seen.add(pkStr);
        await updateChild(q, targetEntity, pk, row);
      }
    } else {
      row[rel.target_key!] = parentID;
      await insertChild(q, targetEntity, row);
    }
  }

  // Soft-delete existing rows not in incoming
  for (const [pkStr, row] of existingByPK) {
    if (!seen.has(pkStr)) {
      await softDeleteChild(q, targetEntity, row[pkField]);
    }
  }
}

async function executeAppendWrite(
  q: Queryable,
  targetEntity: Entity,
  rel: Relation,
  parentID: any,
  data: Record<string, any>[],
): Promise<void> {
  const pkField = targetEntity.primary_key.field;

  for (const row of data) {
    if (row[pkField] != null) continue;
    row[rel.target_key!] = parentID;
    await insertChild(q, targetEntity, row);
  }
}

async function executeManyToManyWrite(
  q: Queryable,
  registry: Registry,
  parentID: any,
  rw: RelationWrite,
): Promise<void> {
  const rel = rw.relation;
  const targetEntity = registry.getEntity(rel.target);
  if (!targetEntity) {
    throw new Error(`Unknown target entity: ${rel.target}`);
  }
  const targetPKField = targetEntity.primary_key.field;

  switch (rw.writeMode) {
    case "replace": {
      const delSQL = `DELETE FROM ${rel.join_table} WHERE ${rel.source_join_key} = $1`;
      await exec(q, delSQL, [parentID]);
      for (const row of rw.data) {
        const targetID = row[targetPKField] ?? row["id"];
        if (targetID == null) continue;
        await insertJoinRow(q, rel, parentID, targetID);
      }
      break;
    }

    case "append": {
      for (const row of rw.data) {
        const targetID = row[targetPKField] ?? row["id"];
        if (targetID == null) continue;
        const sql = `INSERT INTO ${rel.join_table} (${rel.source_join_key}, ${rel.target_join_key}) VALUES ($1, $2) ON CONFLICT DO NOTHING`;
        await exec(q, sql, [parentID, targetID]);
      }
      break;
    }

    default: {
      // diff mode
      const currentSQL = `SELECT ${rel.target_join_key} FROM ${rel.join_table} WHERE ${rel.source_join_key} = $1`;
      const currentRows = await queryRows(q, currentSQL, [parentID]);
      const currentTargets = new Set<string>();
      for (const r of currentRows) {
        if (r[rel.target_join_key!] != null) {
          currentTargets.add(String(r[rel.target_join_key!]));
        }
      }

      for (const row of rw.data) {
        const targetID = row[targetPKField] ?? row["id"];
        if (targetID == null) continue;

        if (row._delete === true) {
          const delSQL = `DELETE FROM ${rel.join_table} WHERE ${rel.source_join_key} = $1 AND ${rel.target_join_key} = $2`;
          await exec(q, delSQL, [parentID, targetID]);
          continue;
        }

        if (!currentTargets.has(String(targetID))) {
          await insertJoinRow(q, rel, parentID, targetID);
        }
      }
    }
  }
}

// Helper functions

async function fetchCurrentChildren(
  q: Queryable,
  entity: Entity,
  rel: Relation,
  parentID: any,
): Promise<Record<string, any>[]> {
  const columns = fieldNames(entity).join(", ");
  let sql = `SELECT ${columns} FROM ${entity.table} WHERE ${rel.target_key} = $1`;
  if (entity.soft_delete) {
    sql += " AND deleted_at IS NULL";
  }
  return queryRows(q, sql, [parentID]);
}

function indexByPK(
  rows: Record<string, any>[],
  pkField: string,
): Map<string, Record<string, any>> {
  const m = new Map<string, Record<string, any>>();
  for (const row of rows) {
    if (row[pkField] != null) {
      m.set(String(row[pkField]), row);
    }
  }
  return m;
}

async function insertChild(
  q: Queryable,
  entity: Entity,
  fields: Record<string, any>,
): Promise<void> {
  const [sql, params] = buildInsertSQL(entity, fields);
  await queryRows(q, sql, params);
}

async function updateChild(
  q: Queryable,
  entity: Entity,
  id: any,
  fields: Record<string, any>,
): Promise<void> {
  const [sql, params] = buildUpdateSQL(entity, id, fields);
  if (!sql) return;
  await exec(q, sql, params!);
}

async function softDeleteChild(
  q: Queryable,
  entity: Entity,
  id: any,
): Promise<void> {
  if (entity.soft_delete) {
    const [sql, params] = buildSoftDeleteSQL(entity, id);
    await exec(q, sql, params);
  } else {
    const [sql, params] = buildHardDeleteSQL(entity, id);
    await exec(q, sql, params);
  }
}

async function insertJoinRow(
  q: Queryable,
  rel: Relation,
  sourceID: any,
  targetID: any,
): Promise<void> {
  const sql = `INSERT INTO ${rel.join_table} (${rel.source_join_key}, ${rel.target_join_key}) VALUES ($1, $2)`;
  await exec(q, sql, [sourceID, targetID]);
}
