import { exec, getDialect } from "../store/postgres.js";
import type { Queryable } from "../store/postgres.js";

export async function cleanupOldEvents(
  pool: Queryable,
  retentionDays: number,
): Promise<number> {
  const d = getDialect();
  const { sql: intervalClause } = d.intervalDeleteExpr("created_at", 0);
  const sql = `DELETE FROM _events WHERE ${intervalClause}`;
  return exec(pool, sql, [String(retentionDays)]);
}
