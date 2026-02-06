import type { Request } from "express";
import type { Entity, Field } from "../metadata/types.js";
import type { Registry } from "../metadata/registry.js";
import { getField, hasField, fieldNames } from "../metadata/types.js";
import { AppError } from "./errors.js";

export interface WhereClause {
  field: string;
  operator: string;
  value: any;
}

export interface OrderClause {
  field: string;
  dir: string; // ASC or DESC
}

export interface QueryPlan {
  entity: Entity;
  filters: WhereClause[];
  sorts: OrderClause[];
  page: number;
  perPage: number;
  includes: string[];
}

export interface QueryResult {
  sql: string;
  params: any[];
}

export class ParamBuilder {
  params: any[] = [];
  private n = 0;

  add(v: any): string {
    this.n++;
    this.params.push(v);
    return `$${this.n}`;
  }
}

export function parseQueryParams(
  req: Request,
  entity: Entity,
  registry: Registry,
): QueryPlan {
  const plan: QueryPlan = {
    entity,
    filters: [],
    sorts: [],
    page: 1,
    perPage: 25,
    includes: [],
  };

  // Parse filters: filter[field]=val or filter[field.op]=val
  const filterObj = (req.query.filter ?? {}) as Record<string, string>;
  if (typeof filterObj === "object" && filterObj !== null) {
    for (const [key, val] of Object.entries(filterObj)) {
      const [field, op] = parseFilterKey(key);

      if (!hasField(entity, field)) {
        throw new AppError(
          "UNKNOWN_FIELD",
          400,
          `Unknown filter field: ${field}`,
        );
      }

      const coerced = coerceValue(getField(entity, field)!, String(val), op);
      plan.filters.push({ field, operator: op, value: coerced });
    }
  }

  // Parse sort: sort=-created_at,name
  const sortParam = req.query.sort as string | undefined;
  if (sortParam) {
    const parts = sortParam.split(",");
    for (let part of parts) {
      part = part.trim();
      let dir = "ASC";
      let field = part;
      if (part.startsWith("-")) {
        dir = "DESC";
        field = part.slice(1);
      }
      if (!hasField(entity, field)) {
        throw new AppError(
          "UNKNOWN_FIELD",
          400,
          `Unknown sort field: ${field}`,
        );
      }
      plan.sorts.push({ field, dir });
    }
  }

  // Parse pagination
  const page = parseInt(req.query.page as string, 10);
  if (!isNaN(page) && page > 0) {
    plan.page = page;
  }
  const perPage = parseInt(req.query.per_page as string, 10);
  if (!isNaN(perPage) && perPage > 0) {
    plan.perPage = Math.min(perPage, 100);
  }

  // Parse includes: include=items,customer
  const inc = req.query.include as string | undefined;
  if (inc) {
    const parts = inc.split(",");
    for (let name of parts) {
      name = name.trim();
      const rel = registry.findRelationForEntity(name, entity.name);
      if (!rel) {
        throw new AppError("UNKNOWN_FIELD", 400, `Unknown include: ${name}`);
      }
      plan.includes.push(name);
    }
  }

  return plan;
}

export function buildSelectSQL(plan: QueryPlan): QueryResult {
  const pb = new ParamBuilder();
  const entity = plan.entity;

  let columns = fieldNames(entity).join(", ");
  if (entity.soft_delete && !getField(entity, "deleted_at")) {
    columns += ", deleted_at";
  }

  const where: string[] = [];

  if (entity.soft_delete) {
    where.push("deleted_at IS NULL");
  }

  for (const f of plan.filters) {
    where.push(buildWhereClause(f, pb));
  }

  let sql = `SELECT ${columns} FROM ${entity.table}`;
  if (where.length > 0) {
    sql += " WHERE " + where.join(" AND ");
  }

  if (plan.sorts.length > 0) {
    const orderParts = plan.sorts.map((s) => `${s.field} ${s.dir}`);
    sql += " ORDER BY " + orderParts.join(", ");
  }

  const limit = pb.add(plan.perPage);
  const offset = pb.add((plan.page - 1) * plan.perPage);
  sql += ` LIMIT ${limit} OFFSET ${offset}`;

  return { sql, params: pb.params };
}

export function buildCountSQL(plan: QueryPlan): QueryResult {
  const pb = new ParamBuilder();
  const entity = plan.entity;

  const where: string[] = [];
  if (entity.soft_delete) {
    where.push("deleted_at IS NULL");
  }
  for (const f of plan.filters) {
    where.push(buildWhereClause(f, pb));
  }

  let sql = `SELECT COUNT(*) FROM ${entity.table}`;
  if (where.length > 0) {
    sql += " WHERE " + where.join(" AND ");
  }

  return { sql, params: pb.params };
}

function buildWhereClause(f: WhereClause, pb: ParamBuilder): string {
  switch (f.operator) {
    case "eq":
    case "":
      return `${f.field} = ${pb.add(f.value)}`;
    case "neq":
      return `${f.field} != ${pb.add(f.value)}`;
    case "gt":
      return `${f.field} > ${pb.add(f.value)}`;
    case "gte":
      return `${f.field} >= ${pb.add(f.value)}`;
    case "lt":
      return `${f.field} < ${pb.add(f.value)}`;
    case "lte":
      return `${f.field} <= ${pb.add(f.value)}`;
    case "in":
      return `${f.field} = ANY(${pb.add(f.value)})`;
    case "not_in":
      return `${f.field} != ALL(${pb.add(f.value)})`;
    case "like":
      return `${f.field} LIKE ${pb.add(f.value)}`;
    default:
      return `${f.field} = ${pb.add(f.value)}`;
  }
}

function parseFilterKey(key: string): [string, string] {
  const dotIdx = key.indexOf(".");
  if (dotIdx !== -1) {
    return [key.slice(0, dotIdx), key.slice(dotIdx + 1)];
  }
  return [key, "eq"];
}

function coerceValue(field: Field, val: string, op: string): any {
  if (op === "in" || op === "not_in") {
    const parts = val.split(",");
    return parts.map((p) => coerceSingleValue(field, p.trim()));
  }
  return coerceSingleValue(field, val);
}

function coerceSingleValue(field: Field, val: string): any {
  switch (field.type) {
    case "int":
      return parseInt(val, 10);
    case "bigint":
      return parseInt(val, 10);
    case "decimal":
      return parseFloat(val);
    case "boolean":
      return val === "true" || val === "1";
    default:
      return val;
  }
}
