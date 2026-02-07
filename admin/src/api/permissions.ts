import { get, post, put, del } from "./client";
import type { ApiResponse } from "../types/api";
import type { PermissionRow, PermissionPayload } from "../types/permission";

export function listPermissions(): Promise<ApiResponse<PermissionRow[]>> {
  return get<ApiResponse<PermissionRow[]>>("/_admin/permissions");
}

export function getPermission(
  id: string,
): Promise<ApiResponse<PermissionRow>> {
  return get<ApiResponse<PermissionRow>>(`/_admin/permissions/${id}`);
}

export function createPermission(
  data: PermissionPayload,
): Promise<ApiResponse<PermissionPayload>> {
  return post<ApiResponse<PermissionPayload>>("/_admin/permissions", data);
}

export function updatePermission(
  id: string,
  data: PermissionPayload,
): Promise<ApiResponse<PermissionPayload>> {
  return put<ApiResponse<PermissionPayload>>(
    `/_admin/permissions/${id}`,
    data,
  );
}

export function deletePermission(
  id: string,
): Promise<ApiResponse<{ id: string; deleted: boolean }>> {
  return del<ApiResponse<{ id: string; deleted: boolean }>>(
    `/_admin/permissions/${id}`,
  );
}
