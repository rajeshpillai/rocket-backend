import { get, post, put, del } from "./client";
import type { ApiResponse, ApiListResponse } from "../types/api";

export interface FilterParam {
  field: string;
  operator: string;
  value: string;
}

export interface DataQueryParams {
  filters?: FilterParam[];
  sort?: string;
  page?: number;
  perPage?: number;
}

function buildQueryString(params: DataQueryParams): string {
  const parts: string[] = [];

  if (params.filters) {
    for (const f of params.filters) {
      if (!f.field || !f.value) continue;
      if (f.operator === "eq") {
        parts.push(
          `filter[${encodeURIComponent(f.field)}]=${encodeURIComponent(f.value)}`,
        );
      } else {
        parts.push(
          `filter[${encodeURIComponent(f.field)}.${encodeURIComponent(f.operator)}]=${encodeURIComponent(f.value)}`,
        );
      }
    }
  }

  if (params.sort) {
    parts.push(`sort=${encodeURIComponent(params.sort)}`);
  }

  if (params.page) {
    parts.push(`page=${params.page}`);
  }

  if (params.perPage) {
    parts.push(`per_page=${params.perPage}`);
  }

  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

type Record_ = Record<string, unknown>;

export function listRecords(
  entity: string,
  params: DataQueryParams = {},
): Promise<ApiListResponse<Record_>> {
  const qs = buildQueryString(params);
  return get<ApiListResponse<Record_>>(`/${entity}${qs}`);
}

export function getRecord(
  entity: string,
  id: string,
): Promise<ApiResponse<Record_>> {
  return get<ApiResponse<Record_>>(`/${entity}/${id}`);
}

export function createRecord(
  entity: string,
  data: Record_,
): Promise<ApiResponse<Record_>> {
  return post<ApiResponse<Record_>>(`/${entity}`, data);
}

export function updateRecord(
  entity: string,
  id: string,
  data: Record_,
): Promise<ApiResponse<Record_>> {
  return put<ApiResponse<Record_>>(`/${entity}/${id}`, data);
}

export function deleteRecord(
  entity: string,
  id: string,
): Promise<ApiResponse<Record_>> {
  return del<ApiResponse<Record_>>(`/${entity}/${id}`);
}
