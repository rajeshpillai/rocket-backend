import type { Store } from "../store/postgres.js";
import { queryRows, exec } from "../store/postgres.js";
import { dispatchWebhook, resolveHeaders } from "./webhook.js";

export class WebhookScheduler {
  private store: Store;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(store: Store) {
    this.store = store;
  }

  start(): void {
    console.log("Webhook scheduler started (30s interval)");
    this.timer = setInterval(() => {
      this.processRetries().catch((err) => {
        console.error("ERROR: webhook scheduler:", err);
      });
    }, 30_000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log("Webhook scheduler stopped");
    }
  }

  async processRetries(): Promise<void> {
    const rows = await queryRows(
      this.store.pool,
      `SELECT id, webhook_id, entity, hook, url, method, request_headers, request_body,
              status, attempt, max_attempts, idempotency_key
       FROM _webhook_logs
       WHERE status = 'retrying' AND next_retry_at < NOW()
       ORDER BY next_retry_at ASC
       LIMIT 50`,
    );

    if (!rows || rows.length === 0) return;

    for (const row of rows) {
      try {
        await this.retryDelivery(row);
      } catch (err) {
        console.error(`ERROR: webhook retry for log ${row.id}:`, err);
      }
    }
  }

  private async retryDelivery(row: Record<string, any>): Promise<void> {
    const logID = String(row.id);
    const attempt = (Number(row.attempt) || 0) + 1;
    const maxAttempts = Number(row.max_attempts) || 3;
    const url = String(row.url);
    const method = String(row.method);

    // Parse request headers
    let headers: Record<string, string> = {};
    if (row.request_headers) {
      headers =
        typeof row.request_headers === "string"
          ? JSON.parse(row.request_headers)
          : row.request_headers;
    }

    // Parse request body
    let bodyJSON: string;
    if (typeof row.request_body === "string") {
      bodyJSON = row.request_body;
    } else {
      bodyJSON = JSON.stringify(row.request_body ?? {});
    }

    // Dispatch
    const resolved = resolveHeaders(headers);
    const result = await dispatchWebhook(url, method, resolved, bodyJSON);

    // Determine new status
    let newStatus = "delivered";
    let errMsg = result.error;
    if (errMsg || result.statusCode < 200 || result.statusCode >= 300) {
      if (!errMsg) {
        errMsg = `HTTP ${result.statusCode}`;
      }
      newStatus = attempt >= maxAttempts ? "failed" : "retrying";
    }

    // Compute next retry with exponential backoff: 30s × 2^attempt
    const nextRetry =
      newStatus === "retrying"
        ? new Date(Date.now() + Math.pow(2, attempt) * 30_000).toISOString()
        : null;

    await exec(
      this.store.pool,
      `UPDATE _webhook_logs
       SET status = $1, attempt = $2, response_status = $3, response_body = $4,
           error = $5, next_retry_at = $6, updated_at = NOW()
       WHERE id = $7`,
      [newStatus, attempt, result.statusCode, result.responseBody, errMsg, nextRetry, logID],
    );

    if (newStatus === "delivered") {
      console.log(`Webhook retry delivered: log=${logID} attempt=${attempt}`);
    } else if (newStatus === "failed") {
      console.log(`Webhook retry exhausted: log=${logID} attempt=${attempt}/${maxAttempts}`);
    }
  }
}
