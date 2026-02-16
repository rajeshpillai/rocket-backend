import path from "node:path";
import pg from "pg";
import Database from "better-sqlite3";
import type { DatabaseConfig } from "../config/index.js";
import type { Dialect } from "./dialect.js";

const { Pool } = pg;
type Pool = pg.Pool;
type PoolClient = pg.PoolClient;

// ── Global dialect accessor ──

let _dialect: Dialect | null = null;

export function setDialect(d: Dialect): void {
  _dialect = d;
}

export function getDialect(): Dialect {
  if (!_dialect) throw new Error("Dialect not initialized — call setDialect() first");
  return _dialect;
}

// ── SQLite wrapper ──

function adaptSQLForSQLite(sql: string): string {
  // Replace $N positional params with ? (better-sqlite3 uses anonymous ?)
  const adapted = sql.replace(/\$\d+/g, "?");
  // Replace NOW() with datetime('now')
  return adapted.replace(/NOW\(\)/gi, "datetime('now')");
}

function encodeSQLiteParams(params: any[]): any[] {
  return params.map((p) => {
    if (p === null || p === undefined) return null;
    if (typeof p === "boolean") return p ? 1 : 0;
    if (Array.isArray(p)) return JSON.stringify(p);
    if (p instanceof Date) return p.toISOString();
    if (typeof p === "object") return JSON.stringify(p);
    return p;
  });
}

export class SQLiteDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
  }

  query(sql: string, params?: any[]): { rows: any[]; rowCount: number } {
    const adaptedSQL = adaptSQLForSQLite(sql);
    const encodedParams = params ? encodeSQLiteParams(params) : [];

    // Determine if this is a read query or has RETURNING
    const trimmed = adaptedSQL.trimStart().toUpperCase();
    const isRead = trimmed.startsWith("SELECT") || trimmed.startsWith("PRAGMA");
    const hasReturning = /\bRETURNING\b/i.test(adaptedSQL);

    if (isRead || hasReturning) {
      const stmt = this.db.prepare(adaptedSQL);
      const rows = stmt.all(...encodedParams);
      return { rows, rowCount: rows.length };
    }

    const stmt = this.db.prepare(adaptedSQL);
    const info = stmt.run(...encodedParams);
    return { rows: [], rowCount: info.changes };
  }

  execMulti(sql: string): void {
    this.db.exec(sql);
  }

  close(): void {
    this.db.close();
  }
}

export class SQLiteTxClient {
  private db: SQLiteDatabase;

  constructor(db: SQLiteDatabase) {
    this.db = db;
  }

  query(sql: string, params?: any[]): { rows: any[]; rowCount: number } {
    return this.db.query(sql, params);
  }

  release(): void {
    // no-op for SQLite — connection is shared
  }
}

// ── Queryable type ──

export type Queryable = Pool | PoolClient | SQLiteDatabase | SQLiteTxClient;

function isSQLiteQueryable(q: Queryable): q is SQLiteDatabase | SQLiteTxClient {
  return q instanceof SQLiteDatabase || q instanceof SQLiteTxClient;
}

// ── Store class ──

export class Store {
  pool: Pool | SQLiteDatabase;
  private _isSQLite: boolean;

  constructor(pool: Pool | SQLiteDatabase, isSQLite: boolean = false) {
    this.pool = pool;
    this._isSQLite = isSQLite;
  }

  get isSQLite(): boolean {
    return this._isSQLite;
  }

  static async connect(cfg: DatabaseConfig): Promise<Store> {
    if (cfg.driver === "sqlite") {
      const dir = cfg.data_dir || "./data";
      const { mkdirSync } = await import("node:fs");
      mkdirSync(dir, { recursive: true });
      const dbPath = path.join(dir, `${cfg.name}.db`);
      const db = new SQLiteDatabase(dbPath);
      return new Store(db, true);
    }

    const pool = new Pool({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.name,
      max: cfg.pool_size,
    });
    await pool.query("SELECT 1");
    return new Store(pool, false);
  }

  static async connectWithPoolSize(cfg: DatabaseConfig, poolSize: number): Promise<Store> {
    const override = { ...cfg, pool_size: poolSize };
    return Store.connect(override);
  }

  static async connectToDB(cfg: DatabaseConfig, dbName: string, poolSize: number): Promise<Store> {
    if (cfg.driver === "sqlite") {
      const dir = cfg.data_dir || "./data";
      const dbPath = path.join(dir, `${dbName}.db`);
      const db = new SQLiteDatabase(dbPath);
      return new Store(db, true);
    }

    const override = { ...cfg, name: dbName, pool_size: poolSize };
    return Store.connect(override);
  }

  async close(): Promise<void> {
    if (this._isSQLite) {
      (this.pool as SQLiteDatabase).close();
    } else {
      await (this.pool as Pool).end();
    }
  }

  async beginTx(): Promise<PoolClient | SQLiteTxClient> {
    if (this._isSQLite) {
      const db = this.pool as SQLiteDatabase;
      db.query("BEGIN");
      return new SQLiteTxClient(db);
    }

    const pool = this.pool as Pool;
    const client = await pool.connect();
    await client.query("BEGIN");
    return client;
  }
}

// ── Error handling ──

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
  // PostgreSQL unique violation
  if (err.code === "23505") {
    return new UniqueViolationError(
      err.message,
      err.detail ?? "",
      err.constraint ?? "",
    );
  }
  // SQLite unique violation
  if (err.message && typeof err.message === "string" &&
      err.message.includes("UNIQUE constraint failed")) {
    return new UniqueViolationError(
      err.message,
      err.message,
      "",
    );
  }
  return err;
}

// ── Query functions ──

function fixBooleans(rows: Record<string, any>[]): Record<string, any>[] {
  if (!_dialect || !_dialect.needsBoolFix()) return rows;
  for (const row of rows) {
    for (const [key, val] of Object.entries(row)) {
      if ((val === 0 || val === 1) && (key === "active" || key === "async")) {
        row[key] = val === 1;
      }
    }
  }
  return rows;
}

export async function queryRows(
  q: Queryable,
  sql: string,
  params: any[] = [],
): Promise<Record<string, any>[]> {
  try {
    if (isSQLiteQueryable(q)) {
      const result = q.query(sql, params);
      return fixBooleans(result.rows);
    }
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
    if (isSQLiteQueryable(q)) {
      const result = q.query(sql, params);
      return result.rowCount ?? 0;
    }
    const result = await q.query(sql, params);
    return result.rowCount ?? 0;
  } catch (err) {
    throw mapPgError(err);
  }
}

// ── Database operations (delegate to dialect) ──

const validDBNameRegex = /^[a-z0-9_]+$/;

export async function createDatabase(q: Queryable, dbName: string): Promise<void> {
  if (!validDBNameRegex.test(dbName) || dbName.length > 63) {
    throw new Error(`Invalid database name: ${dbName}`);
  }
  await getDialect().createDatabase(q, dbName);
}

export async function dropDatabase(q: Queryable, dbName: string): Promise<void> {
  if (!validDBNameRegex.test(dbName) || dbName.length > 63) {
    throw new Error(`Invalid database name: ${dbName}`);
  }
  await getDialect().dropDatabase(q, dbName);
}
