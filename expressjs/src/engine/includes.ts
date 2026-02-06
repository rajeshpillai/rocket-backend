import type { Queryable } from "../store/postgres.js";
import { queryRows } from "../store/postgres.js";
import type { Entity } from "../metadata/types.js";
import type { Registry } from "../metadata/registry.js";
import { fieldNames } from "../metadata/types.js";

export async function loadIncludes(
  q: Queryable,
  registry: Registry,
  entity: Entity,
  rows: Record<string, any>[],
  includes: string[],
): Promise<void> {
  if (rows.length === 0 || includes.length === 0) return;

  for (const incName of includes) {
    const rel = registry.findRelationForEntity(incName, entity.name);
    if (!rel) continue;

    if (rel.source === entity.name) {
      await loadForwardRelation(q, registry, entity, rel, rows, incName);
    } else if (rel.target === entity.name) {
      await loadReverseRelation(q, registry, entity, rel, rows, incName);
    }
  }
}

async function loadForwardRelation(
  q: Queryable,
  registry: Registry,
  parentEntity: Entity,
  rel: { type: string; target: string; target_key?: string; join_table?: string; source_join_key?: string; target_join_key?: string },
  rows: Record<string, any>[],
  incName: string,
): Promise<void> {
  const parentPKField = parentEntity.primary_key.field;
  const parentIDs = collectValues(rows, parentPKField);
  if (parentIDs.length === 0) return;

  if (rel.type === "many_to_many") {
    await loadManyToMany(q, registry, rel, rows, parentPKField, parentIDs, incName);
    return;
  }

  const targetEntity = registry.getEntity(rel.target);
  if (!targetEntity) return;

  const columns = fieldNames(targetEntity).join(", ");
  let sql = `SELECT ${columns} FROM ${targetEntity.table} WHERE ${rel.target_key} = ANY($1)`;
  if (targetEntity.soft_delete) {
    sql += " AND deleted_at IS NULL";
  }

  const childRows = await queryRows(q, sql, [parentIDs]);

  // Group by FK
  const grouped = new Map<string, Record<string, any>[]>();
  for (const child of childRows) {
    const fk = String(child[rel.target_key!]);
    const list = grouped.get(fk) ?? [];
    list.push(child);
    grouped.set(fk, list);
  }

  // Attach to parent rows
  for (const row of rows) {
    const pk = String(row[parentPKField]);
    if (rel.type === "one_to_one") {
      const children = grouped.get(pk);
      row[incName] = children && children.length > 0 ? children[0] : null;
    } else {
      row[incName] = grouped.get(pk) ?? [];
    }
  }
}

async function loadManyToMany(
  q: Queryable,
  registry: Registry,
  rel: { target: string; join_table?: string; source_join_key?: string; target_join_key?: string },
  rows: Record<string, any>[],
  parentPKField: string,
  parentIDs: any[],
  incName: string,
): Promise<void> {
  const targetEntity = registry.getEntity(rel.target);
  if (!targetEntity) return;

  // Query join table
  const joinSQL = `SELECT ${rel.source_join_key}, ${rel.target_join_key} FROM ${rel.join_table} WHERE ${rel.source_join_key} = ANY($1)`;
  const joinRows = await queryRows(q, joinSQL, [parentIDs]);

  if (joinRows.length === 0) {
    for (const row of rows) {
      row[incName] = [];
    }
    return;
  }

  // Collect unique target IDs
  const seen = new Set<string>();
  const targetIDs: any[] = [];
  for (const jr of joinRows) {
    const tid = String(jr[rel.target_join_key!]);
    if (!seen.has(tid)) {
      seen.add(tid);
      targetIDs.push(jr[rel.target_join_key!]);
    }
  }

  // Query target records
  const columns = fieldNames(targetEntity).join(", ");
  let targetSQL = `SELECT ${columns} FROM ${targetEntity.table} WHERE ${targetEntity.primary_key.field} = ANY($1)`;
  if (targetEntity.soft_delete) {
    targetSQL += " AND deleted_at IS NULL";
  }
  const targetRows = await queryRows(q, targetSQL, [targetIDs]);

  // Index targets by PK
  const targetByPK = new Map<string, Record<string, any>>();
  for (const tr of targetRows) {
    targetByPK.set(String(tr[targetEntity.primary_key.field]), tr);
  }

  // Build source -> []target mapping
  const sourceToTargets = new Map<string, Record<string, any>[]>();
  for (const jr of joinRows) {
    const sid = String(jr[rel.source_join_key!]);
    const tid = String(jr[rel.target_join_key!]);
    const target = targetByPK.get(tid);
    if (target) {
      const list = sourceToTargets.get(sid) ?? [];
      list.push(target);
      sourceToTargets.set(sid, list);
    }
  }

  // Attach
  for (const row of rows) {
    const pk = String(row[parentPKField]);
    row[incName] = sourceToTargets.get(pk) ?? [];
  }
}

async function loadReverseRelation(
  q: Queryable,
  registry: Registry,
  entity: Entity,
  rel: { source: string; source_key: string; target_key?: string },
  rows: Record<string, any>[],
  incName: string,
): Promise<void> {
  const sourceEntity = registry.getEntity(rel.source);
  if (!sourceEntity) return;

  const fkValues = collectValues(rows, rel.target_key!);
  if (fkValues.length === 0) return;

  const columns = fieldNames(sourceEntity).join(", ");
  let sql = `SELECT ${columns} FROM ${sourceEntity.table} WHERE ${rel.source_key} = ANY($1)`;
  if (sourceEntity.soft_delete) {
    sql += " AND deleted_at IS NULL";
  }

  const parentRows = await queryRows(q, sql, [fkValues]);

  // Index by PK
  const parentByPK = new Map<string, Record<string, any>>();
  for (const pr of parentRows) {
    parentByPK.set(String(pr[rel.source_key]), pr);
  }

  // Attach
  for (const row of rows) {
    const fk = String(row[rel.target_key!]);
    row[incName] = parentByPK.get(fk) ?? null;
  }
}

function collectValues(rows: Record<string, any>[], field: string): any[] {
  const seen = new Set<string>();
  const values: any[] = [];
  for (const row of rows) {
    const v = row[field];
    if (v == null) continue;
    const s = String(v);
    if (!seen.has(s)) {
      seen.add(s);
      values.push(v);
    }
  }
  return values;
}
