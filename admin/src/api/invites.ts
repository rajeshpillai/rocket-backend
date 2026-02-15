import { get, post, del } from "./client";
import type { ApiResponse } from "../types/api";
import type { InviteRow, InvitePayload, BulkInvitePayload, BulkInviteResult } from "../types/invite";

export function listInvites(): Promise<ApiResponse<InviteRow[]>> {
  return get<ApiResponse<InviteRow[]>>("/_admin/invites");
}

export function createInvite(data: InvitePayload): Promise<ApiResponse<InviteRow>> {
  return post<ApiResponse<InviteRow>>("/_admin/invites", data);
}

export function bulkCreateInvites(data: BulkInvitePayload): Promise<ApiResponse<BulkInviteResult>> {
  return post<ApiResponse<BulkInviteResult>>("/_admin/invites/bulk", data);
}

export function deleteInvite(
  id: string,
): Promise<ApiResponse<{ id: string; deleted: boolean }>> {
  return del<ApiResponse<{ id: string; deleted: boolean }>>(
    `/_admin/invites/${id}`,
  );
}
