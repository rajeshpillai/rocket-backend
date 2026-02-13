export interface WebhookRetry {
  max_attempts: number;
  backoff: string; // "exponential" or "linear"
}

export interface Webhook {
  id: string;
  entity: string;
  hook: string; // after_write, before_write, after_delete, before_delete
  url: string;
  method: string; // POST, PUT, PATCH, GET, DELETE
  headers: Record<string, string>;
  condition: string; // expression; empty = always fire
  async: boolean;
  retry: WebhookRetry;
  active: boolean;

  /** Cached compiled condition function (lazy-initialized). */
  compiledCondition?: (env: Record<string, any>) => boolean;
}
