export interface WebhookRetry {
  max_attempts: number;
  backoff: string;
}

export interface WebhookRow {
  id: string;
  entity: string;
  hook: string;
  url: string;
  method: string;
  headers: Record<string, string> | string;
  condition: string;
  async: boolean;
  retry: WebhookRetry | string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WebhookPayload {
  id?: string;
  entity: string;
  hook: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  condition: string;
  async: boolean;
  retry: WebhookRetry;
  active: boolean;
}

export interface WebhookLogRow {
  id: string;
  webhook_id: string;
  entity: string;
  hook: string;
  url: string;
  method: string;
  request_headers: Record<string, string> | string;
  request_body: Record<string, any> | string;
  response_status: number;
  response_body: string;
  status: string;
  attempt: number;
  max_attempts: number;
  next_retry_at: string | null;
  error: string;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export function parseHeaders(row: WebhookRow): Record<string, string> {
  if (typeof row.headers === "string") {
    try {
      return JSON.parse(row.headers);
    } catch {
      return {};
    }
  }
  return row.headers ?? {};
}

export function parseRetry(row: WebhookRow): WebhookRetry {
  if (typeof row.retry === "string") {
    try {
      return JSON.parse(row.retry);
    } catch {
      return { max_attempts: 3, backoff: "exponential" };
    }
  }
  return row.retry ?? { max_attempts: 3, backoff: "exponential" };
}

export function emptyWebhook(): WebhookPayload {
  return {
    entity: "",
    hook: "after_write",
    url: "",
    method: "POST",
    headers: {},
    condition: "",
    async: true,
    retry: { max_attempts: 3, backoff: "exponential" },
    active: true,
  };
}
