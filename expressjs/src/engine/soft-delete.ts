import type { Queryable } from "../store/postgres.js";
import { exec, queryRows } from "../store/postgres.js";
import type { Entity } from "../metadata/types.js";
import type { Registry } from "../metadata/registry.js";
import { AppError } from "./errors.js";

export async function handleCascadeDelete(
  q: Queryable,
  registry: Registry,
  entity: Entity,
  recordID: any,
): Promise<void> {
  const relations = registry.getRelationsForSource(entity.name);
  for (const rel of relations) {
    await executeCascade(q, registry, rel, recordID);
  }
}

async function executeCascade(
  q: Queryable,
  registry: Registry,
  rel: { name: string; type: string; on_delete: string; target: string; target_key?: string; join_table?: string; source_join_key?: string },
  parentID: any,
): Promise<void> {
  switch (rel.on_delete) {
    case "cascade": {
      if (rel.type === "many_to_many") {
        const sql = `DELETE FROM ${rel.join_table} WHERE ${rel.source_join_key} = $1`;
        await exec(q, sql, [parentID]);
      } else {
        const targetEntity = registry.getEntity(rel.target);
        if (targetEntity && targetEntity.soft_delete) {
          const sql = `UPDATE ${targetEntity.table} SET deleted_at = NOW() WHERE ${rel.target_key} = $1 AND deleted_at IS NULL`;
          await exec(q, sql, [parentID]);
        } else if (targetEntity) {
          const sql = `DELETE FROM ${targetEntity.table} WHERE ${rel.target_key} = $1`;
          await exec(q, sql, [parentID]);
        }
      }
      break;
    }

    case "set_null": {
      const targetEntity = registry.getEntity(rel.target);
      if (targetEntity) {
        const sql = `UPDATE ${targetEntity.table} SET ${rel.target_key} = NULL WHERE ${rel.target_key} = $1`;
        await exec(q, sql, [parentID]);
      }
      break;
    }

    case "restrict": {
      const targetEntity = registry.getEntity(rel.target);
      if (targetEntity) {
        let countSQL = `SELECT COUNT(*) FROM ${targetEntity.table} WHERE ${rel.target_key} = $1`;
        if (targetEntity.soft_delete) {
          countSQL += " AND deleted_at IS NULL";
        }
        const rows = await queryRows(q, countSQL, [parentID]);
        if (rows.length > 0) {
          const count = parseInt(String(rows[0].count), 10);
          if (count > 0) {
            throw new AppError(
              "CONFLICT",
              409,
              `Cannot delete: ${count} related ${rel.target} records exist`,
            );
          }
        }
      }
      break;
    }

    case "detach": {
      if (rel.type === "many_to_many") {
        const sql = `DELETE FROM ${rel.join_table} WHERE ${rel.source_join_key} = $1`;
        await exec(q, sql, [parentID]);
      }
      break;
    }
  }
}
