import pg from "pg";
import type { DatabaseConfig } from "../config/index.js";

const { Pool } = pg;
type Pool = pg.Pool;
type PoolClient = pg.PoolClient;

export type Queryable = Pool | PoolClient;

export class Store {
  pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  static async connect(cfg: DatabaseConfig): Promise<Store> {
    const pool = new Pool({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.name,
      max: cfg.pool_size,
    });
    await pool.query("SELECT 1");
    return new Store(pool);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async beginTx(): Promise<PoolClient> {
    const client = await this.pool.connect();
    await client.query("BEGIN");
    return client;
  }
}

export const ErrNotFound = new Error("not found");

export class UniqueViolationError extends Error {
  detail: string;
  constraint: string;

  constructor(message: string, detail: string, constraint: string) {
    super(message);
    this.detail = detail;
    this.constraint = constraint;
  }
}

export function mapPgError(err: any): any {
  if (!err) return err;
  if (err.code === "23505") {
    return new UniqueViolationError(
      err.message,
      err.detail ?? "",
      err.constraint ?? "",
    );
  }
  return err;
}

export async function queryRows(
  q: Queryable,
  sql: string,
  params: any[] = [],
): Promise<Record<string, any>[]> {
  try {
    const result = await q.query(sql, params);
    return result.rows;
  } catch (err) {
    throw mapPgError(err);
  }
}

export async function queryRow(
  q: Queryable,
  sql: string,
  params: any[] = [],
): Promise<Record<string, any>> {
  const rows = await queryRows(q, sql, params);
  if (rows.length === 0) {
    throw ErrNotFound;
  }
  return rows[0];
}

export async function exec(
  q: Queryable,
  sql: string,
  params: any[] = [],
): Promise<number> {
  try {
    const result = await q.query(sql, params);
    return result.rowCount ?? 0;
  } catch (err) {
    throw mapPgError(err);
  }
}
