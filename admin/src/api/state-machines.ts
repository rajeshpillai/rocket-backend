import { get, post, put, del } from "./client";
import type { ApiResponse } from "../types/api";
import type { StateMachineRow, StateMachinePayload } from "../types/state-machine";

export function listStateMachines(): Promise<ApiResponse<StateMachineRow[]>> {
  return get<ApiResponse<StateMachineRow[]>>("/_admin/state-machines");
}

export function getStateMachine(id: string): Promise<ApiResponse<StateMachineRow>> {
  return get<ApiResponse<StateMachineRow>>(`/_admin/state-machines/${id}`);
}

export function createStateMachine(
  sm: StateMachinePayload,
): Promise<ApiResponse<StateMachinePayload>> {
  return post<ApiResponse<StateMachinePayload>>("/_admin/state-machines", sm);
}

export function updateStateMachine(
  id: string,
  sm: StateMachinePayload,
): Promise<ApiResponse<StateMachinePayload>> {
  return put<ApiResponse<StateMachinePayload>>(`/_admin/state-machines/${id}`, sm);
}

export function deleteStateMachine(
  id: string,
): Promise<ApiResponse<{ id: string; deleted: boolean }>> {
  return del<ApiResponse<{ id: string; deleted: boolean }>>(
    `/_admin/state-machines/${id}`,
  );
}
