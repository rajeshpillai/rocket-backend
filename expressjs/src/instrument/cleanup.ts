import type { Pool } from "pg";

export async function cleanupOldEvents(
  pool: Pool,
  retentionDays: number,
): Promise<number> {
  const result = await pool.query(
    `DELETE FROM _events WHERE created_at < now() - ($1 || ' days')::interval`,
    [String(retentionDays)],
  );
  return result.rowCount ?? 0;
}
