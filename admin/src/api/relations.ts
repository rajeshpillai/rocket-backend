import { get, post, put, del } from "./client";
import type { ApiResponse } from "../types/api";
import type { RelationRow, RelationDefinition } from "../types/relation";

export function listRelations(): Promise<ApiResponse<RelationRow[]>> {
  return get<ApiResponse<RelationRow[]>>("/_admin/relations");
}

export function getRelation(name: string): Promise<ApiResponse<RelationRow>> {
  return get<ApiResponse<RelationRow>>(`/_admin/relations/${name}`);
}

export function createRelation(
  def: RelationDefinition,
): Promise<ApiResponse<RelationDefinition>> {
  return post<ApiResponse<RelationDefinition>>("/_admin/relations", def);
}

export function updateRelation(
  name: string,
  def: RelationDefinition,
): Promise<ApiResponse<RelationDefinition>> {
  return put<ApiResponse<RelationDefinition>>(
    `/_admin/relations/${name}`,
    def,
  );
}

export function deleteRelation(
  name: string,
): Promise<ApiResponse<{ name: string; deleted: boolean }>> {
  return del<ApiResponse<{ name: string; deleted: boolean }>>(
    `/_admin/relations/${name}`,
  );
}
