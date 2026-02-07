import type { Request, Response, NextFunction } from "express";
import type { Store } from "../store/postgres.js";
import { queryRows, queryRow, exec, ErrNotFound } from "../store/postgres.js";
import type { Registry } from "../metadata/registry.js";
import { AppError, notFoundError, unknownEntityError } from "./errors.js";
import { parseQueryParams, buildSelectSQL, buildCountSQL } from "./query.js";
import { buildSoftDeleteSQL, buildHardDeleteSQL } from "./writer.js";
import { planWrite, executeWritePlan, fetchRecord } from "./nested-write.js";
import { loadIncludes } from "./includes.js";
import { handleCascadeDelete } from "./soft-delete.js";
import { checkPermission, getReadFilters } from "../auth/permissions.js";

type AsyncHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void>;

function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export class Handler {
  private store: Store;
  private registry: Registry;

  constructor(store: Store, registry: Registry) {
    this.store = store;
    this.registry = registry;
  }

  list = asyncHandler(async (req: Request, res: Response) => {
    const entity = this.resolveEntity(req);

    checkPermission(req.user, entity.name, "read", this.registry, null);

    const plan = parseQueryParams(req, entity, this.registry);

    // Inject row-level security filters
    const filters = getReadFilters(req.user, entity.name, this.registry);
    plan.filters.push(...filters);

    // Execute data query
    const qr = buildSelectSQL(plan);
    let rows = await queryRows(this.store.pool, qr.sql, qr.params);

    // Execute count query
    const cr = buildCountSQL(plan);
    const countRow = await queryRow(this.store.pool, cr.sql, cr.params);
    const total = parseInt(String(countRow.count), 10);

    // Load includes
    if (plan.includes.length > 0) {
      await loadIncludes(
        this.store.pool,
        this.registry,
        entity,
        rows,
        plan.includes,
      );
    }

    if (!rows) rows = [];

    res.json({
      data: rows,
      meta: {
        page: plan.page,
        per_page: plan.perPage,
        total,
      },
    });
  });

  getById = asyncHandler(async (req: Request, res: Response) => {
    const entity = this.resolveEntity(req);

    checkPermission(req.user, entity.name, "read", this.registry, null);

    const id = req.params.id;

    let row: Record<string, any>;
    try {
      row = await fetchRecord(this.store.pool, entity, id);
    } catch (err) {
      if (err === ErrNotFound) {
        throw notFoundError(entity.name, id);
      }
      throw err;
    }

    // Load includes
    const includes = parseIncludesParam(req);
    if (includes.length > 0) {
      const rows = [row];
      await loadIncludes(
        this.store.pool,
        this.registry,
        entity,
        rows,
        includes,
      );
      row = rows[0];
    }

    res.json({ data: row });
  });

  create = asyncHandler(async (req: Request, res: Response) => {
    const entity = this.resolveEntity(req);

    checkPermission(req.user, entity.name, "create", this.registry, null);

    const body = req.body;

    if (!body || typeof body !== "object") {
      throw new AppError("INVALID_PAYLOAD", 400, "Invalid JSON body");
    }

    const plan = planWrite(entity, this.registry, body, null);
    const record = await executeWritePlan(this.store, this.registry, plan);

    res.status(201).json({ data: record });
  });

  update = asyncHandler(async (req: Request, res: Response) => {
    const entity = this.resolveEntity(req);
    const id = req.params.id;

    // Verify record exists and check permissions against current state
    let currentRecord: Record<string, any>;
    try {
      currentRecord = await fetchRecord(this.store.pool, entity, id);
    } catch (err) {
      if (err === ErrNotFound) {
        throw notFoundError(entity.name, id);
      }
      throw err;
    }

    checkPermission(req.user, entity.name, "update", this.registry, currentRecord);

    const body = req.body;
    if (!body || typeof body !== "object") {
      throw new AppError("INVALID_PAYLOAD", 400, "Invalid JSON body");
    }

    const plan = planWrite(entity, this.registry, body, id);
    const record = await executeWritePlan(this.store, this.registry, plan);

    res.json({ data: record });
  });

  delete = asyncHandler(async (req: Request, res: Response) => {
    const entity = this.resolveEntity(req);
    const id = req.params.id;

    // Check permissions against current record
    let currentRecord: Record<string, any>;
    try {
      currentRecord = await fetchRecord(this.store.pool, entity, id);
    } catch (err) {
      if (err === ErrNotFound) {
        throw notFoundError(entity.name, id);
      }
      throw err;
    }

    checkPermission(req.user, entity.name, "delete", this.registry, currentRecord);

    const client = await this.store.beginTx();
    try {
      // Handle cascades
      await handleCascadeDelete(client, this.registry, entity, id);

      // Delete the record
      let sql: string;
      let params: any[];
      if (entity.soft_delete) {
        [sql, params] = buildSoftDeleteSQL(entity, id);
      } else {
        [sql, params] = buildHardDeleteSQL(entity, id);
      }

      const affected = await exec(client, sql, params);
      if (affected === 0) {
        throw notFoundError(entity.name, id);
      }

      await client.query("COMMIT");
      res.json({ data: { id } });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

  private resolveEntity(req: Request) {
    const name = req.params.entity;
    const entity = this.registry.getEntity(name);
    if (!entity) {
      throw unknownEntityError(name);
    }
    return entity;
  }
}

function parseIncludesParam(req: Request): string[] {
  const inc = req.query.include as string | undefined;
  if (!inc) return [];
  return inc
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
