import { get, post } from "./client.js";
import type { EventRow, TraceResponse, EventStats } from "../types/event.js";

interface EventListResponse {
  data: EventRow[];
  pagination: { page: number; per_page: number; total: number };
}

export function listEvents(params: Record<string, string> = {}): Promise<EventListResponse> {
  const qs = new URLSearchParams(params).toString();
  return get<EventListResponse>(`/_events${qs ? `?${qs}` : ""}`);
}

export function getTrace(traceId: string): Promise<{ data: TraceResponse }> {
  return get<{ data: TraceResponse }>(`/_events/trace/${traceId}`);
}

export function getEventStats(params: Record<string, string> = {}): Promise<{ data: EventStats }> {
  const qs = new URLSearchParams(params).toString();
  return get<{ data: EventStats }>(`/_events/stats${qs ? `?${qs}` : ""}`);
}

export function emitEvent(data: { action: string; entity?: string; record_id?: string; metadata?: Record<string, any> }): Promise<{ data: { status: string } }> {
  return post<{ data: { status: string } }>("/_events", data);
}
