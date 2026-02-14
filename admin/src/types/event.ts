export interface EventRow {
  id: string;
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  event_type: string;
  source: string;
  component: string;
  action: string;
  entity: string | null;
  record_id: string | null;
  user_id: string | null;
  duration_ms: number | null;
  status: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
}

export interface TraceNode extends EventRow {
  children: TraceNode[];
}

export interface TraceResponse {
  trace_id: string;
  root_span: TraceNode | null;
  spans: EventRow[];
  total_duration_ms: number | null;
}

export interface EventStats {
  total_events: number;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  error_rate: number;
  by_source: SourceStats[];
}

export interface SourceStats {
  source: string;
  count: number;
  avg_duration_ms: number | null;
  p95_duration_ms: number | null;
  error_count: number;
}
