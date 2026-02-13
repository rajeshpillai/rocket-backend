import { get, post, put, del } from "./client";
import type { ApiResponse } from "../types/api";
import type { UIConfigRow, UIConfigPayload } from "../types/ui-config";

export function listUIConfigs(): Promise<ApiResponse<UIConfigRow[]>> {
  return get<ApiResponse<UIConfigRow[]>>("/_admin/ui-configs");
}

export function getUIConfig(
  id: string,
): Promise<ApiResponse<UIConfigRow>> {
  return get<ApiResponse<UIConfigRow>>(`/_admin/ui-configs/${id}`);
}

export function createUIConfig(
  data: UIConfigPayload,
): Promise<ApiResponse<UIConfigRow>> {
  return post<ApiResponse<UIConfigRow>>("/_admin/ui-configs", data);
}

export function updateUIConfig(
  id: string,
  data: UIConfigPayload,
): Promise<ApiResponse<UIConfigRow>> {
  return put<ApiResponse<UIConfigRow>>(
    `/_admin/ui-configs/${id}`,
    data,
  );
}

export function deleteUIConfig(
  id: string,
): Promise<ApiResponse<{ id: string; deleted: boolean }>> {
  return del<ApiResponse<{ id: string; deleted: boolean }>>(
    `/_admin/ui-configs/${id}`,
  );
}
