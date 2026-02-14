import fs from "node:fs";
import path from "node:path";
import type { Dialect, InExprResult, IntervalResult } from "./dialect.js";

export class SQLiteDialect implements Dialect {
  name(): string {
    return "sqlite";
  }

  placeholder(n: number): string {
    return `?${n}`;
  }

  nowExpr(): string {
    return "datetime('now')";
  }

  systemTablesSQL(): string {
    return sqliteSystemTablesSQL;
  }

  platformTablesSQL(): string {
    return sqlitePlatformTablesSQL;
  }

  columnType(fieldType: string, _precision?: number): string {
    switch (fieldType) {
      case "string":
      case "text":
      case "uuid":
      case "timestamp":
      case "date":
      case "json":
      case "file":
        return "TEXT";
      case "int":
      case "integer":
      case "bigint":
      case "boolean":
        return "INTEGER";
      case "float":
      case "decimal":
        return "REAL";
      default:
        return "TEXT";
    }
  }

  async tableExists(q: any, tableName: string): Promise<boolean> {
    const result = q.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
      [tableName],
    );
    return result.rows.length > 0;
  }

  async getColumns(q: any, tableName: string): Promise<Map<string, string>> {
    const result = q.query(`PRAGMA table_info(${tableName})`);
    const cols = new Map<string, string>();
    for (const row of result.rows) {
      cols.set(row.name, row.type);
    }
    return cols;
  }

  async createDatabase(_q: any, dbName: string, dataDir?: string): Promise<void> {
    const dir = dataDir ?? "./data";
    fs.mkdirSync(dir, { recursive: true });
    const dbPath = path.join(dir, `${dbName}.db`);
    // Touch the file to create it — actual init happens when we connect
    fs.closeSync(fs.openSync(dbPath, "a"));
  }

  async dropDatabase(_q: any, dbName: string, dataDir?: string): Promise<void> {
    const dir = dataDir ?? "./data";
    for (const ext of [".db", ".db-wal", ".db-shm"]) {
      const filePath = path.join(dir, `${dbName}${ext}`);
      try {
        fs.unlinkSync(filePath);
      } catch {
        // ignore if file doesn't exist
      }
    }
  }

  inExpr(field: string, values: any[], offset: number): InExprResult {
    if (values.length === 0) {
      return { sql: "1=0", params: [], nextOffset: offset };
    }
    const placeholders: string[] = [];
    const params: any[] = [];
    for (let i = 0; i < values.length; i++) {
      placeholders.push(`$${offset + i + 1}`);
      params.push(values[i]);
    }
    return {
      sql: `${field} IN (${placeholders.join(", ")})`,
      params,
      nextOffset: offset + values.length,
    };
  }

  notInExpr(field: string, values: any[], offset: number): InExprResult {
    if (values.length === 0) {
      return { sql: "1=1", params: [], nextOffset: offset };
    }
    const placeholders: string[] = [];
    const params: any[] = [];
    for (let i = 0; i < values.length; i++) {
      placeholders.push(`$${offset + i + 1}`);
      params.push(values[i]);
    }
    return {
      sql: `${field} NOT IN (${placeholders.join(", ")})`,
      params,
      nextOffset: offset + values.length,
    };
  }

  arrayParam(vals: any[]): any {
    return JSON.stringify(vals);
  }

  scanArray(raw: any): any[] {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  needsBoolFix(): boolean {
    return true;
  }

  supportsPercentile(): boolean {
    return false;
  }

  filterCountExpr(condition: string): string {
    return `SUM(CASE WHEN ${condition} THEN 1 ELSE 0 END)`;
  }

  syncCommitOff(): string | null {
    return null;
  }

  intervalDeleteExpr(col: string, offset: number): IntervalResult {
    return {
      sql: `${col} < datetime('now', '-' || $${offset + 1} || ' days')`,
      nextOffset: offset + 1,
    };
  }

  uuidDefault(): string {
    return "";
  }
}

const sqliteSystemTablesSQL = `
CREATE TABLE IF NOT EXISTS _entities (
    name        TEXT PRIMARY KEY,
    table_name  TEXT NOT NULL UNIQUE,
    definition  TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS _relations (
    name        TEXT PRIMARY KEY,
    source      TEXT NOT NULL REFERENCES _entities(name) ON DELETE CASCADE,
    target      TEXT NOT NULL REFERENCES _entities(name) ON DELETE CASCADE,
    definition  TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS _rules (
    id          TEXT PRIMARY KEY,
    entity      TEXT NOT NULL REFERENCES _entities(name) ON DELETE CASCADE,
    hook        TEXT NOT NULL DEFAULT 'before_write',
    type        TEXT NOT NULL,
    definition  TEXT NOT NULL,
    priority    INTEGER NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS _state_machines (
    id          TEXT PRIMARY KEY,
    entity      TEXT NOT NULL REFERENCES _entities(name) ON DELETE CASCADE,
    field       TEXT NOT NULL,
    definition  TEXT NOT NULL,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS _workflows (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    trigger     TEXT NOT NULL,
    context     TEXT NOT NULL DEFAULT '{}',
    steps       TEXT NOT NULL DEFAULT '[]',
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS _workflow_instances (
    id                    TEXT PRIMARY KEY,
    workflow_id           TEXT NOT NULL REFERENCES _workflows(id) ON DELETE CASCADE,
    workflow_name         TEXT NOT NULL,
    status                TEXT NOT NULL DEFAULT 'running',
    current_step          TEXT,
    current_step_deadline TEXT,
    context               TEXT NOT NULL DEFAULT '{}',
    history               TEXT NOT NULL DEFAULT '[]',
    created_at            TEXT DEFAULT (datetime('now')),
    updated_at            TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS _users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    roles         TEXT DEFAULT '[]',
    active        INTEGER DEFAULT 1,
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS _refresh_tokens (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES _users(id) ON DELETE CASCADE,
    token      TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON _refresh_tokens(token);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON _refresh_tokens(expires_at);

CREATE TABLE IF NOT EXISTS _permissions (
    id         TEXT PRIMARY KEY,
    entity     TEXT NOT NULL,
    action     TEXT NOT NULL,
    roles      TEXT NOT NULL DEFAULT '[]',
    conditions TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS _webhooks (
    id         TEXT PRIMARY KEY,
    entity     TEXT NOT NULL,
    hook       TEXT NOT NULL DEFAULT 'after_write',
    url        TEXT NOT NULL,
    method     TEXT NOT NULL DEFAULT 'POST',
    headers    TEXT DEFAULT '{}',
    condition  TEXT DEFAULT '',
    async      INTEGER NOT NULL DEFAULT 1,
    retry      TEXT DEFAULT '{"max_attempts": 3, "backoff": "exponential"}',
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS _webhook_logs (
    id              TEXT PRIMARY KEY,
    webhook_id      TEXT NOT NULL REFERENCES _webhooks(id) ON DELETE CASCADE,
    entity          TEXT NOT NULL,
    hook            TEXT NOT NULL,
    url             TEXT NOT NULL,
    method          TEXT NOT NULL,
    request_headers TEXT DEFAULT '{}',
    request_body    TEXT DEFAULT '{}',
    response_status INTEGER,
    response_body   TEXT DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'pending',
    attempt         INTEGER NOT NULL DEFAULT 0,
    max_attempts    INTEGER NOT NULL DEFAULT 3,
    next_retry_at   TEXT,
    error           TEXT DEFAULT '',
    idempotency_key TEXT NOT NULL,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_status ON _webhook_logs(status);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_retry ON _webhook_logs(next_retry_at) WHERE status = 'retrying';

CREATE TABLE IF NOT EXISTS _files (
    id            TEXT PRIMARY KEY,
    filename      TEXT NOT NULL,
    storage_path  TEXT NOT NULL,
    mime_type     TEXT NOT NULL DEFAULT 'application/octet-stream',
    size          INTEGER NOT NULL DEFAULT 0,
    uploaded_by   TEXT,
    created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS _ui_configs (
    id         TEXT PRIMARY KEY,
    entity     TEXT NOT NULL REFERENCES _entities(name) ON DELETE CASCADE,
    scope      TEXT NOT NULL DEFAULT 'default',
    config     TEXT NOT NULL DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(entity, scope)
);

CREATE TABLE IF NOT EXISTS _events (
    id              TEXT PRIMARY KEY,
    trace_id        TEXT NOT NULL,
    span_id         TEXT NOT NULL,
    parent_span_id  TEXT,
    event_type      TEXT NOT NULL,
    source          TEXT NOT NULL,
    component       TEXT NOT NULL,
    action          TEXT NOT NULL,
    entity          TEXT,
    record_id       TEXT,
    user_id         TEXT,
    duration_ms     REAL,
    status          TEXT,
    metadata        TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_trace ON _events (trace_id);
CREATE INDEX IF NOT EXISTS idx_events_entity_created ON _events (entity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_created ON _events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_type_source ON _events (event_type, source);
`;

const sqlitePlatformTablesSQL = `
CREATE TABLE IF NOT EXISTS _apps (
    name         TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    db_name      TEXT NOT NULL UNIQUE,
    db_driver    TEXT NOT NULL DEFAULT 'sqlite',
    jwt_secret   TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'active',
    created_at   TEXT DEFAULT (datetime('now')),
    updated_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS _platform_users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    roles         TEXT DEFAULT '["platform_admin"]',
    active        INTEGER DEFAULT 1,
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS _platform_refresh_tokens (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES _platform_users(id) ON DELETE CASCADE,
    token      TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_platform_refresh_tokens_token ON _platform_refresh_tokens(token);
CREATE INDEX IF NOT EXISTS idx_platform_refresh_tokens_expires ON _platform_refresh_tokens(expires_at);
`;
