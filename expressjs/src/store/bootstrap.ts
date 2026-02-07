import bcrypt from "bcryptjs";
import type { Queryable } from "./postgres.js";

const systemTablesSQL = `
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
`;

export async function bootstrap(pool: Queryable): Promise<void> {
  await pool.query(systemTablesSQL);
  await seedAdminUser(pool);
}

async function seedAdminUser(pool: Queryable): Promise<void> {
  const result = await pool.query("SELECT COUNT(*) FROM _users");
  const count = parseInt(result.rows[0].count, 10);
  if (count > 0) return;

  const hash = await bcrypt.hash("changeme", 10);
  await pool.query(
    "INSERT INTO _users (email, password_hash, roles) VALUES ($1, $2, $3)",
    ["admin@localhost", hash, ["admin"]],
  );
  console.log(
    "WARNING: Default admin user created (admin@localhost / changeme) — change the password immediately.",
  );
}
