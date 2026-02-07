import { get, post, put, del } from "./client";
import type { ApiResponse } from "../types/api";
import type { WebhookRow, WebhookPayload, WebhookLogRow } from "../types/webhook";

export function listWebhooks(): Promise<ApiResponse<WebhookRow[]>> {
  return get<ApiResponse<WebhookRow[]>>("/_admin/webhooks");
}

export function getWebhook(id: string): Promise<ApiResponse<WebhookRow>> {
  return get<ApiResponse<WebhookRow>>(`/_admin/webhooks/${id}`);
}

export function createWebhook(
  data: WebhookPayload,
): Promise<ApiResponse<WebhookRow>> {
  return post<ApiResponse<WebhookRow>>("/_admin/webhooks", data);
}

export function updateWebhook(
  id: string,
  data: WebhookPayload,
): Promise<ApiResponse<WebhookRow>> {
  return put<ApiResponse<WebhookRow>>(`/_admin/webhooks/${id}`, data);
}

export function deleteWebhook(
  id: string,
): Promise<ApiResponse<{ id: string; deleted: boolean }>> {
  return del<ApiResponse<{ id: string; deleted: boolean }>>(
    `/_admin/webhooks/${id}`,
  );
}

export function listWebhookLogs(params?: {
  webhook_id?: string;
  status?: string;
  entity?: string;
}): Promise<ApiResponse<WebhookLogRow[]>> {
  const query = new URLSearchParams();
  if (params?.webhook_id) query.set("webhook_id", params.webhook_id);
  if (params?.status) query.set("status", params.status);
  if (params?.entity) query.set("entity", params.entity);
  const qs = query.toString();
  return get<ApiResponse<WebhookLogRow[]>>(
    `/_admin/webhook-logs${qs ? `?${qs}` : ""}`,
  );
}

export function retryWebhookLog(
  id: string,
): Promise<ApiResponse<WebhookLogRow>> {
  return post<ApiResponse<WebhookLogRow>>(
    `/_admin/webhook-logs/${id}/retry`,
    {},
  );
}
