import { randomUUID } from "node:crypto";
import type { Entity, Relation } from "../metadata/types.js";
import type { Registry } from "../metadata/registry.js";
import {
  hasField,
  writableFields,
  updatableFields,
  defaultWriteMode,
} from "../metadata/types.js";
import { ParamBuilder } from "./query.js";
import type { ErrorDetail } from "./errors.js";
import { getDialect } from "../store/postgres.js";

export interface RelationWrite {
  relation: Relation;
  writeMode: string;
  data: Record<string, any>[];
}

export function buildInsertSQL(
  entity: Entity,
  fields: Record<string, any>,
): [string, any[]] {
  const pb = new ParamBuilder();
  const cols: string[] = [];
  const vals: string[] = [];

  const dialect = getDialect();
  const needsAppUUID =
    entity.primary_key.generated &&
    entity.primary_key.type === "uuid" &&
    dialect.name() === "sqlite";

  for (const f of entity.fields) {
    if (f.name === entity.primary_key.field && entity.primary_key.generated) {
      if (needsAppUUID) {
        // SQLite has no gen_random_uuid() default — generate in app code
        cols.push(f.name);
        vals.push(pb.add(randomUUID()));
      }
      continue;
    }
    if (f.auto === "create" || f.auto === "update") {
      continue;
    }
    if (f.name === "deleted_at") {
      continue;
    }

    let val = fields[f.name];
    if (val === undefined) {
      if (f.default != null) {
        val = f.default;
      } else if (!f.required) {
        continue;
      } else {
        continue;
      }
    }
    cols.push(f.name);
    vals.push(pb.add(val));
  }

  // Add auto-timestamp fields
  for (const f of entity.fields) {
    if (f.auto === "create" || f.auto === "update") {
      cols.push(f.name);
      vals.push("NOW()");
    }
  }

  const sql = `INSERT INTO ${entity.table} (${cols.join(", ")}) VALUES (${vals.join(", ")}) RETURNING ${entity.primary_key.field}`;
  return [sql, pb.params];
}

export function buildUpdateSQL(
  entity: Entity,
  id: any,
  fields: Record<string, any>,
): [string, any[]] | [string, null] {
  const pb = new ParamBuilder();
  const sets: string[] = [];

  for (const f of updatableFields(entity)) {
    const val = fields[f.name];
    if (val === undefined) continue;
    sets.push(`${f.name} = ${pb.add(val)}`);
  }

  // Auto-update timestamp
  for (const f of entity.fields) {
    if (f.auto === "update") {
      sets.push(`${f.name} = NOW()`);
    }
  }

  if (sets.length === 0) {
    return ["", null];
  }

  let where = `${entity.primary_key.field} = ${pb.add(id)}`;
  if (entity.soft_delete) {
    where += " AND deleted_at IS NULL";
  }

  const sql = `UPDATE ${entity.table} SET ${sets.join(", ")} WHERE ${where}`;
  return [sql, pb.params];
}

export function buildSoftDeleteSQL(
  entity: Entity,
  id: any,
): [string, any[]] {
  const sql = `UPDATE ${entity.table} SET deleted_at = NOW() WHERE ${entity.primary_key.field} = $1 AND deleted_at IS NULL`;
  return [sql, [id]];
}

export function buildHardDeleteSQL(
  entity: Entity,
  id: any,
): [string, any[]] {
  const sql = `DELETE FROM ${entity.table} WHERE ${entity.primary_key.field} = $1`;
  return [sql, [id]];
}

export function validateFields(
  entity: Entity,
  fields: Record<string, any>,
  isCreate: boolean,
): ErrorDetail[] {
  const errs: ErrorDetail[] = [];

  // Check for unknown fields
  for (const key of Object.keys(fields)) {
    if (!hasField(entity, key)) {
      errs.push({
        field: key,
        rule: "unknown",
        message: `Unknown field: ${key}`,
      });
    }
  }

  if (isCreate) {
    for (const f of writableFields(entity)) {
      if (f.required && !f.nullable) {
        const val = fields[f.name];
        if (val === undefined || val === null || val === "") {
          errs.push({
            field: f.name,
            rule: "required",
            message: `${f.name} is required`,
          });
        }
      }
    }
  }

  // Check enum constraints
  for (const f of entity.fields) {
    if (!f.enum || f.enum.length === 0) continue;
    const val = fields[f.name];
    if (val === undefined || val === null) continue;
    const strVal = String(val);
    if (!f.enum.includes(strVal)) {
      errs.push({
        field: f.name,
        rule: "enum",
        message: `${f.name} must be one of: ${f.enum.join(", ")}`,
      });
    }
  }

  return errs;
}

export function separateFieldsAndRelations(
  entity: Entity,
  registry: Registry,
  body: Record<string, any>,
): [Record<string, any>, Map<string, RelationWrite>, string[]] {
  const fields: Record<string, any> = {};
  const relWrites = new Map<string, RelationWrite>();
  const unknownKeys: string[] = [];

  for (const [key, val] of Object.entries(body)) {
    if (hasField(entity, key)) {
      fields[key] = val;
      continue;
    }

    const rel = registry.findRelationForEntity(key, entity.name);
    if (rel && rel.source === entity.name) {
      const rw = parseRelationWrite(rel, val);
      if (rw) {
        relWrites.set(key, rw);
        continue;
      }
    }

    unknownKeys.push(key);
  }

  return [fields, relWrites, unknownKeys];
}

function parseRelationWrite(
  rel: Relation,
  val: any,
): RelationWrite | null {
  if (typeof val !== "object" || val === null || Array.isArray(val)) {
    return null;
  }

  const rw: RelationWrite = {
    relation: rel,
    writeMode: defaultWriteMode(rel),
    data: [],
  };

  if (typeof val._write_mode === "string") {
    rw.writeMode = val._write_mode;
  }

  const data = val.data;
  if (!Array.isArray(data)) {
    return null;
  }

  for (const item of data) {
    if (typeof item === "object" && item !== null && !Array.isArray(item)) {
      rw.data.push(item);
    }
  }

  return rw;
}
