import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { EventBuffer } from "./buffer.js";
import type { EventRecord, Instrumenter, Span } from "./types.js";

export interface TraceContext {
  traceId: string;
  parentSpanId: string | null;
  userId: string | null;
  buffer: EventBuffer;
  instrumenter: InstrumenterImpl;
}

const traceStore = new AsyncLocalStorage<TraceContext>();

export function getTraceContext(): TraceContext | null {
  return traceStore.getStore() ?? null;
}

export function runWithTraceContext<T>(ctx: TraceContext, fn: () => T): T {
  return traceStore.run(ctx, fn);
}

class SpanImpl implements Span {
  private startTime: number;
  private entity_: string | null = null;
  private recordId_: string | null = null;
  private status_: string | null = null;
  private metadata_: Record<string, any> = {};
  private ended = false;

  constructor(
    public readonly traceId: string,
    public readonly spanId: string,
    private readonly parentSpanId: string | null,
    private readonly source: string,
    private readonly component: string,
    private readonly action: string,
    private readonly userId: string | null,
    private readonly buffer: EventBuffer,
  ) {
    this.startTime = performance.now();
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    const durationMs = performance.now() - this.startTime;
    const event: EventRecord = {
      trace_id: this.traceId,
      span_id: this.spanId,
      parent_span_id: this.parentSpanId,
      event_type: "system",
      source: this.source,
      component: this.component,
      action: this.action,
      entity: this.entity_,
      record_id: this.recordId_,
      user_id: this.userId,
      duration_ms: Math.round(durationMs * 100) / 100,
      status: this.status_,
      metadata: Object.keys(this.metadata_).length > 0 ? this.metadata_ : null,
    };
    this.buffer.enqueue(event);
  }

  setStatus(status: string): void {
    this.status_ = status;
  }

  setMetadata(key: string, value: any): void {
    this.metadata_[key] = value;
  }

  setEntity(entity: string, recordId?: string): void {
    this.entity_ = entity;
    if (recordId !== undefined) {
      this.recordId_ = recordId;
    }
  }
}

export class InstrumenterImpl implements Instrumenter {
  constructor(private readonly buffer: EventBuffer) {}

  startSpan(source: string, component: string, action: string): Span {
    const ctx = getTraceContext();
    const traceId = ctx?.traceId ?? randomUUID();
    const spanId = randomUUID();
    const parentSpanId = ctx?.parentSpanId ?? null;
    const userId = ctx?.userId ?? null;

    const span = new SpanImpl(
      traceId,
      spanId,
      parentSpanId,
      source,
      component,
      action,
      userId,
      this.buffer,
    );

    // Update the trace context so that subsequent spans created within
    // this context become children of this span.
    if (ctx) {
      ctx.parentSpanId = spanId;
    }

    return span;
  }

  emitBusinessEvent(
    action: string,
    entity: string,
    recordId: string,
    metadata?: Record<string, any>,
  ): void {
    const ctx = getTraceContext();
    const traceId = ctx?.traceId ?? randomUUID();
    const spanId = randomUUID();
    const parentSpanId = ctx?.parentSpanId ?? null;
    const userId = ctx?.userId ?? null;

    const event: EventRecord = {
      trace_id: traceId,
      span_id: spanId,
      parent_span_id: parentSpanId,
      event_type: "business",
      source: "app",
      component: "engine",
      action,
      entity,
      record_id: recordId,
      user_id: userId,
      duration_ms: null,
      status: null,
      metadata: metadata ?? null,
    };
    this.buffer.enqueue(event);
  }
}

class NoopSpan implements Span {
  get traceId(): string {
    return "";
  }
  get spanId(): string {
    return "";
  }
  end(): void {}
  setStatus(_status: string): void {}
  setMetadata(_key: string, _value: any): void {}
  setEntity(_entity: string, _recordId?: string): void {}
}

class NoopInstrumenter implements Instrumenter {
  startSpan(_source: string, _component: string, _action: string): Span {
    return new NoopSpan();
  }
  emitBusinessEvent(
    _action: string,
    _entity: string,
    _recordId: string,
    _metadata?: Record<string, any>,
  ): void {}
}

const noopInstrumenter = new NoopInstrumenter();

/**
 * Returns the Instrumenter from the current trace context, or a NoopInstrumenter
 * if instrumentation is not active for the current request.
 */
export function getInstrumenter(): Instrumenter {
  const ctx = getTraceContext();
  if (ctx) {
    return ctx.instrumenter;
  }
  return noopInstrumenter;
}

/**
 * Returns the current trace ID from the AsyncLocalStorage context, or null
 * if no trace context is active.
 */
export function getTraceId(): string | null {
  const ctx = getTraceContext();
  return ctx?.traceId ?? null;
}
