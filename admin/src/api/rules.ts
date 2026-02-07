import { get, post, put, del } from "./client";
import type { ApiResponse } from "../types/api";
import type { RuleRow, RulePayload } from "../types/rule";

export function listRules(): Promise<ApiResponse<RuleRow[]>> {
  return get<ApiResponse<RuleRow[]>>("/_admin/rules");
}

export function getRule(id: string): Promise<ApiResponse<RuleRow>> {
  return get<ApiResponse<RuleRow>>(`/_admin/rules/${id}`);
}

export function createRule(
  rule: RulePayload,
): Promise<ApiResponse<RulePayload>> {
  return post<ApiResponse<RulePayload>>("/_admin/rules", rule);
}

export function updateRule(
  id: string,
  rule: RulePayload,
): Promise<ApiResponse<RulePayload>> {
  return put<ApiResponse<RulePayload>>(`/_admin/rules/${id}`, rule);
}

export function deleteRule(
  id: string,
): Promise<ApiResponse<{ id: string; deleted: boolean }>> {
  return del<ApiResponse<{ id: string; deleted: boolean }>>(
    `/_admin/rules/${id}`,
  );
}
