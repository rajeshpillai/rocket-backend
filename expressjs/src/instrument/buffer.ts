import type { Pool } from "pg";
import type { EventRecord } from "./types.js";

export class EventBuffer {
  private events: EventRecord[] = [];
  private pool: Pool;
  private maxSize: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(pool: Pool, maxSize = 500, flushIntervalMs = 100) {
    this.pool = pool;
    this.maxSize = maxSize;
    this.timer = setInterval(() => this.flush(), flushIntervalMs);
  }

  enqueue(event: EventRecord): void {
    this.events.push(event);
    if (this.events.length >= this.maxSize) {
      this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.events.length === 0) return;
    const batch = this.events.splice(0);
    try {
      const cols = [
        "trace_id",
        "span_id",
        "parent_span_id",
        "event_type",
        "source",
        "component",
        "action",
        "entity",
        "record_id",
        "user_id",
        "duration_ms",
        "status",
        "metadata",
      ];
      const values: any[] = [];
      const placeholders: string[] = [];
      for (let i = 0; i < batch.length; i++) {
        const e = batch[i];
        const offset = i * cols.length;
        placeholders.push(
          `(${cols.map((_, j) => `$${offset + j + 1}`).join(",")})`,
        );
        values.push(
          e.trace_id,
          e.span_id,
          e.parent_span_id,
          e.event_type,
          e.source,
          e.component,
          e.action,
          e.entity,
          e.record_id,
          e.user_id,
          e.duration_ms,
          e.status,
          e.metadata ? JSON.stringify(e.metadata) : null,
        );
      }
      const sql = `INSERT INTO _events (${cols.join(",")}) VALUES ${placeholders.join(",")}`;
      const client = await this.pool.connect();
      try {
        await client.query("SET LOCAL synchronous_commit = off");
        await client.query(sql, values);
      } finally {
        client.release();
      }
    } catch (err) {
      console.error("ERROR: event buffer flush failed:", err);
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Final flush
    this.flush().catch(() => {});
  }
}
