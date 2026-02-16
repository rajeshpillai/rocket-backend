export interface EventRecord {
  id?: string;
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  event_type: "system" | "business";
  source: string;
  component: string;
  action: string;
  entity: string | null;
  record_id: string | null;
  user_id: string | null;
  duration_ms: number | null;
  status: string | null;
  metadata: Record<string, any> | null;
  created_at?: string;
}

export interface Span {
  end(): void;
  setStatus(status: string): void;
  setMetadata(key: string, value: any): void;
  setEntity(entity: string, recordId?: string): void;
  readonly traceId: string;
  readonly spanId: string;
}

export interface Instrumenter {
  startSpan(source: string, component: string, action: string): Span;
  emitBusinessEvent(
    action: string,
    entity: string,
    recordId: string,
    metadata?: Record<string, any>,
  ): void;
}
