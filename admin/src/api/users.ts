import { get, post, put, del } from "./client";
import type { ApiResponse } from "../types/api";
import type { UserRow, UserPayload } from "../types/user";

export function listUsers(): Promise<ApiResponse<UserRow[]>> {
  return get<ApiResponse<UserRow[]>>("/_admin/users");
}

export function getUser(id: string): Promise<ApiResponse<UserRow>> {
  return get<ApiResponse<UserRow>>(`/_admin/users/${id}`);
}

export function createUser(data: UserPayload): Promise<ApiResponse<UserRow>> {
  return post<ApiResponse<UserRow>>("/_admin/users", data);
}

export function updateUser(
  id: string,
  data: UserPayload,
): Promise<ApiResponse<UserRow>> {
  return put<ApiResponse<UserRow>>(`/_admin/users/${id}`, data);
}

export function deleteUser(
  id: string,
): Promise<ApiResponse<{ id: string; deleted: boolean }>> {
  return del<ApiResponse<{ id: string; deleted: boolean }>>(
    `/_admin/users/${id}`,
  );
}
