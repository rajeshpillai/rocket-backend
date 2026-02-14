import bcrypt from "bcryptjs";
import type { Queryable } from "../store/postgres.js";

const platformTablesSQL = `
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

export async function platformBootstrap(pool: Queryable): Promise<void> {
  await pool.query(platformTablesSQL);
  await migratePlatformTables(pool);
  await seedPlatformAdmin(pool);
}

async function migratePlatformTables(pool: Queryable): Promise<void> {
  // Add db_driver column if missing (for existing installations)
  const result = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = '_apps' AND column_name = 'db_driver'`,
  );
  if (result.rows.length === 0) {
    await pool.query(
      `ALTER TABLE _apps ADD COLUMN db_driver TEXT NOT NULL DEFAULT 'postgres'`,
    );
    console.log("Migrated _apps: added db_driver column");
  }
}

async function seedPlatformAdmin(pool: Queryable): Promise<void> {
  const result = await pool.query("SELECT COUNT(*) FROM _platform_users");
  const count = parseInt(result.rows[0].count, 10);
  if (count > 0) return;

  const hash = await bcrypt.hash("changeme", 10);
  await pool.query(
    "INSERT INTO _platform_users (email, password_hash, roles) VALUES ($1, $2, $3)",
    ["platform@localhost", hash, ["platform_admin"]],
  );
  console.log(
    "WARNING: Default platform admin created (platform@localhost / changeme) — change the password immediately.",
  );
}
