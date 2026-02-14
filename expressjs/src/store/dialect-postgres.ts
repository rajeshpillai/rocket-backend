import type { Dialect, InExprResult, IntervalResult } from "./dialect.js";

const validDBNameRegex = /^[a-z0-9_]+$/;

export class PostgresDialect implements Dialect {
  name(): string {
    return "postgres";
  }

  placeholder(n: number): string {
    return `$${n}`;
  }

  nowExpr(): string {
    return "NOW()";
  }

  systemTablesSQL(): string {
    return pgSystemTablesSQL;
  }

  platformTablesSQL(): string {
    return pgPlatformTablesSQL;
  }

  columnType(fieldType: string, precision?: number): string {
    switch (fieldType) {
      case "string":
      case "text":
        return "TEXT";
      case "int":
      case "integer":
        return "INTEGER";
      case "bigint":
        return "BIGINT";
      case "float":
        return "DOUBLE PRECISION";
      case "decimal":
        if (precision && precision > 0) {
          return `NUMERIC(18,${precision})`;
        }
        return "NUMERIC";
      case "boolean":
        return "BOOLEAN";
      case "uuid":
        return "UUID";
      case "timestamp":
        return "TIMESTAMPTZ";
      case "date":
        return "DATE";
      case "json":
      case "file":
        return "JSONB";
      default:
        return "TEXT";
    }
  }

  async tableExists(q: any, tableName: string): Promise<boolean> {
    const result = await q.query(
      `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = $1 AND table_schema = 'public')`,
      [tableName],
    );
    return result.rows[0].exists;
  }

  async getColumns(q: any, tableName: string): Promise<Map<string, string>> {
    const result = await q.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'`,
      [tableName],
    );
    const cols = new Map<string, string>();
    for (const row of result.rows) {
      cols.set(row.column_name, row.data_type);
    }
    return cols;
  }

  async createDatabase(q: any, dbName: string): Promise<void> {
    if (!validDBNameRegex.test(dbName) || dbName.length > 63) {
      throw new Error(`Invalid database name: ${dbName}`);
    }
    await q.query(`CREATE DATABASE ${dbName}`);
  }

  async dropDatabase(q: any, dbName: string): Promise<void> {
    if (!validDBNameRegex.test(dbName) || dbName.length > 63) {
      throw new Error(`Invalid database name: ${dbName}`);
    }
    await q.query(`DROP DATABASE IF EXISTS ${dbName}`);
  }

  inExpr(field: string, values: any[], offset: number): InExprResult {
    return {
      sql: `${field} = ANY($${offset + 1})`,
      params: [values],
      nextOffset: offset + 1,
    };
  }

  notInExpr(field: string, values: any[], offset: number): InExprResult {
    return {
      sql: `${field} != ALL($${offset + 1})`,
      params: [values],
      nextOffset: offset + 1,
    };
  }

  arrayParam(vals: any[]): any {
    return vals;
  }

  scanArray(raw: any): any[] {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
      // PostgreSQL text array format: {a,b,c}
      if (raw.startsWith("{") && raw.endsWith("}")) {
        return raw.slice(1, -1).split(",").filter((s: string) => s !== "");
      }
      try {
        return JSON.parse(raw);
      } catch {
        return [];
      }
    }
    return [];
  }

  needsBoolFix(): boolean {
    return false;
  }

  supportsPercentile(): boolean {
    return true;
  }

  filterCountExpr(condition: string): string {
    return `COUNT(*) FILTER (WHERE ${condition})`;
  }

  syncCommitOff(): string | null {
    return "SET LOCAL synchronous_commit = off";
  }

  intervalDeleteExpr(col: string, offset: number): IntervalResult {
    return {
      sql: `${col} < now() - ($${offset + 1} || ' days')::interval`,
      nextOffset: offset + 1,
    };
  }

  uuidDefault(): string {
    return "DEFAULT gen_random_uuid()";
  }
}

const pgSystemTablesSQL = `
CREATE TABLE IF NOT EXISTS _entities (
    name        TEXT PRIMARY KEY,
    table_name  TEXT NOT NULL UNIQUE,
    definition  JSONB NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _relations (
    name        TEXT PRIMARY KEY,
    source      TEXT NOT NULL REFERENCES _entities(name) ON DELETE CASCADE,
    target      TEXT NOT NULL REFERENCES _entities(name) ON DELETE CASCADE,
    definition  JSONB NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _rules (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity      TEXT NOT NULL REFERENCES _entities(name) ON DELETE CASCADE,
    hook        TEXT NOT NULL DEFAULT 'before_write',
    type        TEXT NOT NULL,
    definition  JSONB NOT NULL,
    priority    INT NOT NULL DEFAULT 0,
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _state_machines (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity      TEXT NOT NULL REFERENCES _entities(name) ON DELETE CASCADE,
    field       TEXT NOT NULL,
    definition  JSONB NOT NULL,
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _workflows (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE,
    trigger     JSONB NOT NULL,
    context     JSONB NOT NULL DEFAULT '{}',
    steps       JSONB NOT NULL DEFAULT '[]',
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _workflow_instances (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id           UUID NOT NULL REFERENCES _workflows(id) ON DELETE CASCADE,
    workflow_name         TEXT NOT NULL,
    status                TEXT NOT NULL DEFAULT 'running',
    current_step          TEXT,
    current_step_deadline TIMESTAMPTZ,
    context               JSONB NOT NULL DEFAULT '{}',
    history               JSONB NOT NULL DEFAULT '[]',
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    roles         TEXT[] DEFAULT '{}',
    active        BOOLEAN DEFAULT true,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _refresh_tokens (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES _users(id) ON DELETE CASCADE,
    token      UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON _refresh_tokens(token);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON _refresh_tokens(expires_at);

CREATE TABLE IF NOT EXISTS _permissions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity     TEXT NOT NULL,
    action     TEXT NOT NULL,
    roles      TEXT[] NOT NULL DEFAULT '{}',
    conditions JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _webhooks (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity     TEXT NOT NULL,
    hook       TEXT NOT NULL DEFAULT 'after_write',
    url        TEXT NOT NULL,
    method     TEXT NOT NULL DEFAULT 'POST',
    headers    JSONB DEFAULT '{}',
    condition  TEXT DEFAULT '',
    async      BOOLEAN NOT NULL DEFAULT true,
    retry      JSONB DEFAULT '{"max_attempts": 3, "backoff": "exponential"}',
    active     BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _webhook_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id      UUID NOT NULL REFERENCES _webhooks(id) ON DELETE CASCADE,
    entity          TEXT NOT NULL,
    hook            TEXT NOT NULL,
    url             TEXT NOT NULL,
    method          TEXT NOT NULL,
    request_headers JSONB DEFAULT '{}',
    request_body    JSONB DEFAULT '{}',
    response_status INT,
    response_body   TEXT DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'pending',
    attempt         INT NOT NULL DEFAULT 0,
    max_attempts    INT NOT NULL DEFAULT 3,
    next_retry_at   TIMESTAMPTZ,
    error           TEXT DEFAULT '',
    idempotency_key TEXT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_status ON _webhook_logs(status);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_retry ON _webhook_logs(next_retry_at) WHERE status = 'retrying';

CREATE TABLE IF NOT EXISTS _files (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename      TEXT NOT NULL,
    storage_path  TEXT NOT NULL,
    mime_type     TEXT NOT NULL DEFAULT 'application/octet-stream',
    size          BIGINT NOT NULL DEFAULT 0,
    uploaded_by   UUID,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _ui_configs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity     TEXT NOT NULL REFERENCES _entities(name) ON DELETE CASCADE,
    scope      TEXT NOT NULL DEFAULT 'default',
    config     JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(entity, scope)
);

CREATE TABLE IF NOT EXISTS _events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trace_id        UUID NOT NULL,
    span_id         UUID NOT NULL,
    parent_span_id  UUID,
    event_type      TEXT NOT NULL,
    source          TEXT NOT NULL,
    component       TEXT NOT NULL,
    action          TEXT NOT NULL,
    entity          TEXT,
    record_id       TEXT,
    user_id         UUID,
    duration_ms     DOUBLE PRECISION,
    status          TEXT,
    metadata        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_trace ON _events (trace_id);
CREATE INDEX IF NOT EXISTS idx_events_entity_created ON _events (entity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_created ON _events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_type_source ON _events (event_type, source);
`;

const pgPlatformTablesSQL = `
CREATE TABLE IF NOT EXISTS _apps (
    name         TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    db_name      TEXT NOT NULL UNIQUE,
    jwt_secret   TEXT NOT NULL,
    db_driver    TEXT NOT NULL DEFAULT 'postgres',
    status       TEXT NOT NULL DEFAULT 'active',
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _platform_users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    roles         TEXT[] DEFAULT '{platform_admin}',
    active        BOOLEAN DEFAULT true,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _platform_refresh_tokens (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES _platform_users(id) ON DELETE CASCADE,
    token      UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_platform_refresh_tokens_token ON _platform_refresh_tokens(token);
CREATE INDEX IF NOT EXISTS idx_platform_refresh_tokens_expires ON _platform_refresh_tokens(expires_at);
`;
