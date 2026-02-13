import { get, post, put, del, upload } from "./client";
import type { ApiResponse, ApiListResponse } from "../types/api";
import type { EntityRow, RelationRow } from "../types/entity";
import type { UIConfigRow } from "../types/ui-config";

// ── Entity metadata ──

export async function listEntities(): Promise<EntityRow[]> {
  const res = await get<ApiListResponse<EntityRow>>("/_admin/entities");
  return res.data;
}

export async function getEntity(name: string): Promise<EntityRow> {
  const res = await get<ApiResponse<EntityRow>>(`/_admin/entities/${name}`);
  return res.data;
}

export async function listRelations(): Promise<RelationRow[]> {
  const res = await get<ApiListResponse<RelationRow>>("/_admin/relations");
  return res.data;
}

// ── Dynamic CRUD ──

export interface ListParams {
  page?: number;
  per_page?: number;
  sort?: string;
  include?: string;
  filters?: Record<string, string>;
}

export async function listRecords(
  entity: string,
  params: ListParams = {}
): Promise<ApiListResponse<Record<string, unknown>>> {
  const query = new URLSearchParams();

  if (params.page) query.set("page", String(params.page));
  if (params.per_page) query.set("per_page", String(params.per_page));
  if (params.sort) query.set("sort", params.sort);
  if (params.include) query.set("include", params.include);

  if (params.filters) {
    for (const [key, value] of Object.entries(params.filters)) {
      query.set(key, value);
    }
  }

  const qs = query.toString();
  const path = `/${entity}${qs ? `?${qs}` : ""}`;
  return get<ApiListResponse<Record<string, unknown>>>(path);
}

export async function getRecord(
  entity: string,
  id: string,
  include?: string
): Promise<Record<string, unknown>> {
  const qs = include ? `?include=${include}` : "";
  const res = await get<ApiResponse<Record<string, unknown>>>(
    `/${entity}/${id}${qs}`
  );
  return res.data;
}

export async function createRecord(
  entity: string,
  data: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await post<ApiResponse<Record<string, unknown>>>(
    `/${entity}`,
    data
  );
  return res.data;
}

export async function updateRecord(
  entity: string,
  id: string,
  data: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await put<ApiResponse<Record<string, unknown>>>(
    `/${entity}/${id}`,
    data
  );
  return res.data;
}

export async function deleteRecord(
  entity: string,
  id: string
): Promise<void> {
  await del(`/${entity}/${id}`);
}

// ── App auth ──

export async function appLogin(
  email: string,
  password: string
): Promise<{ access_token: string; refresh_token: string }> {
  const res = await post<
    ApiResponse<{ access_token: string; refresh_token: string }>
  >("/auth/login", { email, password });
  return res.data;
}

export async function appRefresh(
  refreshToken: string
): Promise<{ access_token: string; refresh_token: string }> {
  const res = await post<
    ApiResponse<{ access_token: string; refresh_token: string }>
  >("/auth/refresh", { refresh_token: refreshToken });
  return res.data;
}

export async function appLogout(refreshToken: string): Promise<void> {
  await post("/auth/logout", { refresh_token: refreshToken });
}

// ── File upload ──

export interface FileMetadata {
  id: string;
  filename: string;
  size: number;
  mime_type: string;
}

export async function uploadFile(file: File): Promise<FileMetadata> {
  const res = await upload<ApiResponse<FileMetadata>>("/_files/upload", file);
  return res.data;
}

export function fileUrl(app: string, fileId: string): string {
  return `/api/${app}/_files/${fileId}`;
}

// ── UI Configs ──

export async function listUIConfigs(): Promise<UIConfigRow[]> {
  const res = await get<ApiListResponse<UIConfigRow>>("/_ui/configs");
  return res.data;
}

export async function getUIConfig(
  entity: string
): Promise<UIConfigRow | null> {
  const res = await get<ApiResponse<UIConfigRow | null>>(
    `/_ui/config/${entity}`
  );
  return res.data;
}
