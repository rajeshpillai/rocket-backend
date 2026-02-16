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

    // Auto-generate slug if configured
    await autoGenerateSlug(client, plan.entity, plan.fields, plan.isCreate, old, plan.id);

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
  idOrSlug: any,
): Promise<Record<string, any>> {
  const columns = fieldNames(entity);
  if (entity.soft_delete && !getField(entity, "deleted_at")) {
    columns.push("deleted_at");
  }

  const softDeleteClause = entity.soft_delete ? " AND deleted_at IS NULL" : "";

  // If entity has a slug config and the param doesn't look like the PK type, try slug first
  if (entity.slug && typeof idOrSlug === "string" && !looksLikePK(entity, idOrSlug)) {
    const slugSql = `SELECT ${columns.join(", ")} FROM ${entity.table} WHERE ${entity.slug.field} = $1${softDeleteClause}`;
    try {
      return await queryRow(q, slugSql, [idOrSlug]);
    } catch {
      // slug lookup failed, fall through to PK lookup
    }
  }

  // Default: look up by primary key
  const sql = `SELECT ${columns.join(", ")} FROM ${entity.table} WHERE ${entity.primary_key.field} = $1${softDeleteClause}`;
  return queryRow(q, sql, [idOrSlug]);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INT_RE = /^\d+$/;

function looksLikePK(entity: Entity, value: string): boolean {
  const pkType = entity.primary_key.type;
  if (pkType === "uuid") return UUID_RE.test(value);
  if (pkType === "int" || pkType === "integer" || pkType === "bigint") return INT_RE.test(value);
  return false; // string PKs — can't distinguish, always try slug first
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")     // non-alphanumeric → hyphen
    .replace(/^-+|-+$/g, "")         // trim leading/trailing hyphens
    .replace(/-{2,}/g, "-");          // collapse multiple hyphens
}

export async function generateUniqueSlug(
  q: Queryable,
  entity: Entity,
  baseSlug: string,
  excludeId?: any,
): Promise<string> {
  const slugField = entity.slug!.field;
  const softDeleteClause = entity.soft_delete ? " AND deleted_at IS NULL" : "";
  const excludeClause = excludeId != null ? ` AND ${entity.primary_key.field} != $2` : "";
  const params: any[] = [baseSlug];
  if (excludeId != null) params.push(excludeId);

  const checkSql = `SELECT 1 FROM ${entity.table} WHERE ${slugField} = $1${softDeleteClause}${excludeClause} LIMIT 1`;
  const rows = await queryRows(q, checkSql, params);
  if (rows.length === 0) return baseSlug;

  // Append incrementing suffix
  for (let i = 2; i <= 100; i++) {
    const candidate = `${baseSlug}-${i}`;
    params[0] = candidate;
    const dupeRows = await queryRows(q, checkSql, params);
    if (dupeRows.length === 0) return candidate;
  }

  // Fallback: append random suffix
  const suffix = Math.random().toString(36).substring(2, 8);
  return `${baseSlug}-${suffix}`;
}

async function autoGenerateSlug(
  q: Queryable,
  entity: Entity,
  fields: Record<string, any>,
  isCreate: boolean,
  old: Record<string, any>,
  existingId: any,
): Promise<void> {
  const slugCfg = entity.slug;
  if (!slugCfg || !slugCfg.source) return;

  const slugField = slugCfg.field;
  const sourceField = slugCfg.source;

  // If slug is explicitly provided in the payload, skip auto-generation
  if (fields[slugField] != null && fields[slugField] !== "") return;

  if (isCreate) {
    // On create: generate from source field
    const sourceValue = fields[sourceField];
    if (sourceValue == null || sourceValue === "") return;
    fields[slugField] = await generateUniqueSlug(q, entity, slugify(String(sourceValue)));
  } else if (slugCfg.regenerate_on_update) {
    // On update: regenerate only if source field changed
    const sourceValue = fields[sourceField];
    if (sourceValue == null || sourceValue === "") return;
    if (sourceValue === old[sourceField]) return; // source didn't change
    fields[slugField] = await generateUniqueSlug(q, entity, slugify(String(sourceValue)), existingId);
  }
}

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
