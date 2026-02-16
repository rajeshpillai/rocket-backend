import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { getDialect, SQLiteDatabase } from "./postgres.js";
import type { Queryable } from "./postgres.js";

export async function bootstrap(pool: Queryable): Promise<void> {
  const ddl = getDialect().systemTablesSQL();

  if (pool instanceof SQLiteDatabase) {
    pool.execMulti(ddl);
  } else {
    await (pool as any).query(ddl);
  }

  await seedAdminUser(pool);
}

async function seedAdminUser(pool: Queryable): Promise<void> {
  const result = pool instanceof SQLiteDatabase
    ? pool.query("SELECT COUNT(*) AS count FROM _users")
    : await (pool as any).query("SELECT COUNT(*) FROM _users");
  const count = parseInt(result.rows[0].count, 10);
  if (count > 0) return;

  const hash = await bcrypt.hash("changeme", 10);
  const dialect = getDialect();

  if (dialect.name() === "sqlite") {
    const id = crypto.randomUUID();
    (pool as SQLiteDatabase).query(
      "INSERT INTO _users (id, email, password_hash, roles) VALUES ($1, $2, $3, $4)",
      [id, "admin@localhost", hash, dialect.arrayParam(["admin"])],
    );
  } else {
    await (pool as any).query(
      "INSERT INTO _users (email, password_hash, roles) VALUES ($1, $2, $3)",
      ["admin@localhost", hash, ["admin"]],
    );
  }

  console.log(
    "WARNING: Default admin user created (admin@localhost / changeme) — change the password immediately.",
  );
}
