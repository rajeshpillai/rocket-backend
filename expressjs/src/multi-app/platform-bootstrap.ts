import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { getDialect, SQLiteDatabase } from "../store/postgres.js";
import type { Queryable } from "../store/postgres.js";

export async function platformBootstrap(pool: Queryable): Promise<void> {
  const ddl = getDialect().platformTablesSQL();

  if (pool instanceof SQLiteDatabase) {
    pool.execMulti(ddl);
  } else {
    await (pool as any).query(ddl);
  }

  await migratePlatformTables(pool);
  await seedPlatformAdmin(pool);
}

async function migratePlatformTables(pool: Queryable): Promise<void> {
  const dialect = getDialect();

  if (dialect.name() === "sqlite") {
    const cols = await dialect.getColumns(pool, "_apps");
    if (!cols.has("db_driver")) {
      (pool as SQLiteDatabase).query(
        `ALTER TABLE _apps ADD COLUMN db_driver TEXT NOT NULL DEFAULT 'sqlite'`,
      );
      console.log("Migrated _apps: added db_driver column");
    }
  } else {
    // PostgreSQL: use information_schema
    const result = await (pool as any).query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = '_apps' AND column_name = 'db_driver'`,
    );
    if (result.rows.length === 0) {
      await (pool as any).query(
        `ALTER TABLE _apps ADD COLUMN db_driver TEXT NOT NULL DEFAULT 'postgres'`,
      );
      console.log("Migrated _apps: added db_driver column");
    }
  }
}

async function seedPlatformAdmin(pool: Queryable): Promise<void> {
  const result = pool instanceof SQLiteDatabase
    ? pool.query("SELECT COUNT(*) AS count FROM _platform_users")
    : await (pool as any).query("SELECT COUNT(*) FROM _platform_users");
  const count = parseInt(result.rows[0].count, 10);
  if (count > 0) return;

  const hash = await bcrypt.hash("changeme", 10);
  const dialect = getDialect();

  if (dialect.name() === "sqlite") {
    const id = crypto.randomUUID();
    (pool as SQLiteDatabase).query(
      "INSERT INTO _platform_users (id, email, password_hash, roles) VALUES ($1, $2, $3, $4)",
      [id, "platform@localhost", hash, dialect.arrayParam(["platform_admin"])],
    );
  } else {
    await (pool as any).query(
      "INSERT INTO _platform_users (email, password_hash, roles) VALUES ($1, $2, $3)",
      ["platform@localhost", hash, ["platform_admin"]],
    );
  }

  console.log(
    "WARNING: Default platform admin created (platform@localhost / changeme) — change the password immediately.",
  );
}
