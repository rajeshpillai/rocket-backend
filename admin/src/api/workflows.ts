import { get, post, put, del } from "./client";
import type { ApiResponse } from "../types/api";
import type { WorkflowRow, WorkflowPayload, WorkflowInstance } from "../types/workflow";

// --- Admin CRUD ---

export function listWorkflows(): Promise<ApiResponse<WorkflowRow[]>> {
  return get<ApiResponse<WorkflowRow[]>>("/_admin/workflows");
}

export function getWorkflow(id: string): Promise<ApiResponse<WorkflowRow>> {
  return get<ApiResponse<WorkflowRow>>(`/_admin/workflows/${id}`);
}

export function createWorkflow(wf: WorkflowPayload): Promise<ApiResponse<WorkflowPayload>> {
  return post<ApiResponse<WorkflowPayload>>("/_admin/workflows", wf);
}

export function updateWorkflow(id: string, wf: WorkflowPayload): Promise<ApiResponse<WorkflowPayload>> {
  return put<ApiResponse<WorkflowPayload>>(`/_admin/workflows/${id}`, wf);
}

export function deleteWorkflow(id: string): Promise<ApiResponse<{ id: string; deleted: boolean }>> {
  return del<ApiResponse<{ id: string; deleted: boolean }>>(`/_admin/workflows/${id}`);
}

// --- Runtime ---

export function listPendingInstances(): Promise<ApiResponse<WorkflowInstance[]>> {
  return get<ApiResponse<WorkflowInstance[]>>("/_workflows/pending");
}

export function getWorkflowInstance(id: string): Promise<ApiResponse<WorkflowInstance>> {
  return get<ApiResponse<WorkflowInstance>>(`/_workflows/${id}`);
}

export function approveInstance(id: string): Promise<ApiResponse<WorkflowInstance>> {
  return post<ApiResponse<WorkflowInstance>>(`/_workflows/${id}/approve`, {});
}

export function rejectInstance(id: string): Promise<ApiResponse<WorkflowInstance>> {
  return post<ApiResponse<WorkflowInstance>>(`/_workflows/${id}/reject`, {});
}

export function deleteInstance(id: string): Promise<ApiResponse<{ deleted: boolean }>> {
  return del<ApiResponse<{ deleted: boolean }>>(`/_workflows/${id}`);
}
