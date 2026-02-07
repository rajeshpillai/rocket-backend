import { randomUUID } from "node:crypto";
import type { Store, Queryable } from "../store/postgres.js";
import { exec } from "../store/postgres.js";
import type { Registry } from "../metadata/registry.js";
import type { Webhook } from "../metadata/webhook.js";

export interface WebhookPayload {
  event: string;
  entity: string;
  action: string; // create, update, delete
  record: Record<string, any>;
  old?: Record<string, any>;
  changes?: Record<string, any>;
  user?: { id: string; roles: string[] };
  timestamp: string;
  idempotency_key: string;
}

export interface DispatchResult {
  statusCode: number;
  responseBody: string;
  error: string;
}

/**
 * Constructs the payload for a webhook delivery.
 */
export function buildWebhookPayload(
  hook: string,
  entity: string,
  action: string,
  record: Record<string, any>,
  old: Record<string, any> | null,
  user: { id: string; roles: string[] } | null,
): WebhookPayload {
  const payload: WebhookPayload = {
    event: hook,
    entity,
    action,
    record,
    timestamp: new Date().toISOString(),
    idempotency_key: "wh_" + randomUUID(),
  };
  if (old) {
    payload.old = old;
    payload.changes = computeChanges(record, old);
  }
  if (user) {
    payload.user = { id: user.id, roles: user.roles };
  }
  return payload;
}

/**
 * Returns a map of field -> {old, new} for changed fields.
 */
function computeChanges(
  record: Record<string, any>,
  old: Record<string, any>,
): Record<string, any> {
  const changes: Record<string, any> = {};
  for (const k of Object.keys(record)) {
    const oldVal = old[k];
    const newVal = record[k];
    if (String(oldVal) !== String(newVal)) {
      changes[k] = { old: oldVal, new: newVal };
    }
  }
  return changes;
}

/**
 * Replaces {{env.VAR_NAME}} in header values with process env values.
 */
export function resolveHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    resolved[k] = resolveEnvVars(v);
  }
  return resolved;
}

function resolveEnvVars(s: string): string {
  return s.replace(/\{\{env\.([^}]+)\}\}/g, (_match, varName) => {
    return process.env[varName] ?? "";
  });
}

/**
 * Evaluates a webhook condition expression.
 * Empty condition always returns true.
 */
export function evaluateWebhookCondition(
  condition: string,
  payload: WebhookPayload,
): boolean {
  if (!condition) return true;

  const env: Record<string, any> = {
    record: payload.record,
    old: payload.old ?? {},
    changes: payload.changes ?? {},
    action: payload.action,
    entity: payload.entity,
    event: payload.event,
    user: payload.user ?? {},
  };

  try {
    const fn = new Function(
      "env",
      `with (env) { return !!(${condition}); }`,
    ) as (env: Record<string, any>) => boolean;
    return fn(env);
  } catch (err) {
    throw new Error(
      `webhook condition evaluation failed: ${err instanceof Error ? err.message : err}`,
    );
  }
}

/**
 * Performs the HTTP call for a webhook. Returns the result.
 */
export async function dispatchWebhook(
  url: string,
  method: string,
  headers: Record<string, string>,
  bodyJSON: string,
  signal?: AbortSignal,
): Promise<DispatchResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const combinedSignal = signal ?? controller.signal;

    const resp = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: method !== "GET" ? bodyJSON : undefined,
      signal: combinedSignal,
    });

    clearTimeout(timeout);

    const respBody = await resp.text();
    return {
      statusCode: resp.status,
      responseBody: respBody.slice(0, 64 * 1024),
      error: "",
    };
  } catch (err) {
    return {
      statusCode: 0,
      responseBody: "",
      error: `http call: ${err instanceof Error ? err.message : err}`,
    };
  }
}

/**
 * Inserts a row into _webhook_logs.
 */
export async function logWebhookDelivery(
  q: Queryable,
  wh: Webhook,
  payload: WebhookPayload,
  headers: Record<string, string>,
  bodyJSON: string,
  result: DispatchResult,
): Promise<void> {
  let status = "delivered";
  let errMsg = result.error;
  if (errMsg || result.statusCode < 200 || result.statusCode >= 300) {
    status = wh.retry.max_attempts > 1 ? "retrying" : "failed";
    if (!errMsg) {
      errMsg = `HTTP ${result.statusCode}`;
    }
  }

  const nextRetry =
    status === "retrying" ? new Date(Date.now() + 30_000).toISOString() : null;

  try {
    await exec(
      q,
      `INSERT INTO _webhook_logs (webhook_id, entity, hook, url, method, request_headers, request_body,
       response_status, response_body, status, attempt, max_attempts, next_retry_at, error, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        wh.id, wh.entity, wh.hook, wh.url, wh.method,
        JSON.stringify(headers), bodyJSON,
        result.statusCode, result.responseBody,
        status, 1, wh.retry.max_attempts, nextRetry, errMsg, payload.idempotency_key,
      ],
    );
  } catch (err) {
    console.error(`ERROR: failed to log webhook delivery for ${wh.id}:`, err);
  }
}

/**
 * Dispatches async webhooks for an entity hook after commit.
 * Runs in background (catch errors, don't block caller).
 */
export function fireAsyncWebhooks(
  store: Store,
  registry: Registry,
  hook: string,
  entity: string,
  action: string,
  record: Record<string, any>,
  old: Record<string, any> | null,
  user: { id: string; roles: string[] } | null,
): void {
  const webhooks = registry.getWebhooksForEntityHook(entity, hook);
  if (webhooks.length === 0) return;

  const payload = buildWebhookPayload(hook, entity, action, record, old, user);

  for (const wh of webhooks) {
    if (!wh.async) continue;

    let fire: boolean;
    try {
      fire = evaluateWebhookCondition(wh.condition, payload);
    } catch (err) {
      console.error(`ERROR: webhook ${wh.id} condition evaluation:`, err);
      continue;
    }
    if (!fire) continue;

    // Fire in background
    (async () => {
      try {
        const headers = resolveHeaders(wh.headers);
        const bodyJSON = JSON.stringify(payload);
        const result = await dispatchWebhook(wh.url, wh.method, headers, bodyJSON);
        await logWebhookDelivery(store.pool, wh, payload, headers, bodyJSON, result);
      } catch (err) {
        console.error(`ERROR: async webhook ${wh.id} dispatch:`, err);
      }
    })();
  }
}

/**
 * Dispatches sync webhooks inside a transaction.
 * Throws on failure (non-2xx or network error) to cause rollback.
 */
export async function fireSyncWebhooks(
  client: Queryable,
  registry: Registry,
  hook: string,
  entity: string,
  action: string,
  record: Record<string, any>,
  old: Record<string, any> | null,
  user: { id: string; roles: string[] } | null,
): Promise<void> {
  const webhooks = registry.getWebhooksForEntityHook(entity, hook);
  if (webhooks.length === 0) return;

  const payload = buildWebhookPayload(hook, entity, action, record, old, user);

  for (const wh of webhooks) {
    if (wh.async) continue; // skip async webhooks in sync path

    const fire = evaluateWebhookCondition(wh.condition, payload);
    if (!fire) continue;

    const headers = resolveHeaders(wh.headers);
    const bodyJSON = JSON.stringify(payload);
    const result = await dispatchWebhook(wh.url, wh.method, headers, bodyJSON);

    await logWebhookDelivery(client, wh, payload, headers, bodyJSON, result);

    if (result.error) {
      throw new Error(`webhook ${wh.id} failed: ${result.error}`);
    }
    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw new Error(`webhook ${wh.id} returned HTTP ${result.statusCode}: ${result.responseBody}`);
    }
  }
}

/**
 * Fires a single webhook directly (for state machine and workflow actions).
 * Returns the result without logging.
 */
export async function dispatchWebhookDirect(
  url: string,
  method: string,
  headers: Record<string, string> | null,
  body: string,
): Promise<DispatchResult> {
  const resolved = resolveHeaders(headers ?? {});
  return dispatchWebhook(url, method, resolved, body);
}
