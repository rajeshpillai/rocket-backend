import { get, post, put, del } from "./client";
import type { ApiResponse } from "../types/api";
import type { EntityRow, EntityDefinition } from "../types/entity";

export function listEntities(): Promise<ApiResponse<EntityRow[]>> {
  return get<ApiResponse<EntityRow[]>>("/_admin/entities");
}

export function getEntity(name: string): Promise<ApiResponse<EntityRow>> {
  return get<ApiResponse<EntityRow>>(`/_admin/entities/${name}`);
}

export function createEntity(
  def: EntityDefinition,
): Promise<ApiResponse<EntityDefinition>> {
  return post<ApiResponse<EntityDefinition>>("/_admin/entities", def);
}

export function updateEntity(
  name: string,
  def: EntityDefinition,
): Promise<ApiResponse<EntityDefinition>> {
  return put<ApiResponse<EntityDefinition>>(`/_admin/entities/${name}`, def);
}

export function deleteEntity(
  name: string,
): Promise<ApiResponse<{ name: string; deleted: boolean }>> {
  return del<ApiResponse<{ name: string; deleted: boolean }>>(
    `/_admin/entities/${name}`,
  );
}
