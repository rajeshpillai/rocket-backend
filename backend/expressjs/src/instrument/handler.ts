import type { Request, Response, NextFunction } from "express";
import type pg from "pg";
import { queryRows, queryRow, getDialect, SQLiteDatabase } from "../store/postgres.js";
import { AppError } from "../engine/errors.js";
import { getInstrumenter } from "./instrument.js";

type Pool = pg.Pool;

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

function computeP95(values: number[]): number | null {
  if (!values || values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export class EventHandler {
  private pool: Pool | SQLiteDatabase;

  constructor(pool: Pool | SQLiteDatabase) {
    this.pool = pool;
  }

  // POST /_events — emit a custom business event (any authenticated user)
  emit = asyncHandler(async (req: Request, res: Response) => {
    const body = req.body;
    if (!body || typeof body !== "object") {
      throw new AppError("INVALID_PAYLOAD", 400, "Invalid JSON body");
    }

    const { action, entity, record_id, metadata } = body;
    if (!action) {
      throw new AppError("VALIDATION_FAILED", 422, "action is required");
    }

    getInstrumenter().emitBusinessEvent(
      action,
      entity ?? "",
      record_id ?? "",
      metadata ?? undefined,
    );

    res.json({ data: { status: "ok" } });
  });

  // GET /_events — list events with filters (admin only)
  list = asyncHandler(async (req: Request, res: Response) => {
    const conditions: string[] = [];
    const args: any[] = [];
    let argIdx = 1;

    if (req.query.source) {
      conditions.push(`source = $${argIdx++}`);
      args.push(req.query.source);
    }
    if (req.query.component) {
      conditions.push(`component = $${argIdx++}`);
      args.push(req.query.component);
    }
    if (req.query.action) {
      conditions.push(`action = $${argIdx++}`);
      args.push(req.query.action);
    }
    if (req.query.entity) {
      conditions.push(`entity = $${argIdx++}`);
      args.push(req.query.entity);
    }
    if (req.query.event_type) {
      conditions.push(`event_type = $${argIdx++}`);
      args.push(req.query.event_type);
    }
    if (req.query.trace_id) {
      conditions.push(`trace_id = $${argIdx++}`);
      args.push(req.query.trace_id);
    }
    if (req.query.user_id) {
      conditions.push(`user_id = $${argIdx++}`);
      args.push(req.query.user_id);
    }
    if (req.query.status) {
      conditions.push(`status = $${argIdx++}`);
      args.push(req.query.status);
    }
    if (req.query.from) {
      conditions.push(`created_at >= $${argIdx++}`);
      args.push(req.query.from);
    }
    if (req.query.to) {
      conditions.push(`created_at <= $${argIdx++}`);
      args.push(req.query.to);
    }

    // Pagination
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    let perPage = parseInt(req.query.per_page as string, 10) || 50;
    if (perPage > 100) perPage = 100;
    if (perPage < 1) perPage = 50;
    const offset = (page - 1) * perPage;

    // Sort
    const sortParam = (req.query.sort as string) || "-created_at";
    let orderBy = "created_at DESC";
    if (sortParam === "created_at") {
      orderBy = "created_at ASC";
    } else if (sortParam === "-created_at") {
      orderBy = "created_at DESC";
    }

    const whereClause = conditions.length > 0 ? " WHERE " + conditions.join(" AND ") : "";

    // Count query
    const countSQL = `SELECT COUNT(*) as count FROM _events${whereClause}`;
    const countRow = await queryRow(this.pool, countSQL, args);
    const total = parseInt(String(countRow.count), 10);

    // Data query
    const dataSQL = `SELECT id, trace_id, span_id, parent_span_id, event_type, source, component, action, entity, record_id, user_id, duration_ms, status, metadata, created_at FROM _events${whereClause} ORDER BY ${orderBy} LIMIT $${argIdx++} OFFSET $${argIdx++}`;
    const dataArgs = [...args, perPage, offset];
    const rows = await queryRows(this.pool, dataSQL, dataArgs);

    res.json({
      data: rows ?? [],
      pagination: {
        page,
        per_page: perPage,
        total,
      },
    });
  });

  // GET /_events/trace/:traceId — get full trace waterfall (admin only)
  getTrace = asyncHandler(async (req: Request, res: Response) => {
    const traceId = req.params.traceId;
    if (!traceId) {
      throw new AppError("VALIDATION_FAILED", 422, "trace_id is required");
    }

    const rows = await queryRows(
      this.pool,
      "SELECT id, trace_id, span_id, parent_span_id, event_type, source, component, action, entity, record_id, user_id, duration_ms, status, metadata, created_at FROM _events WHERE trace_id = $1 ORDER BY created_at ASC",
      [traceId],
    );

    if (!rows || rows.length === 0) {
      throw new AppError("NOT_FOUND", 404, `Trace not found: ${traceId}`);
    }

    // Build tree structure from spans
    const spanMap = new Map<string, any>();
    let rootSpan: any = null;
    let totalDurationMs: number | null = null;

    for (const row of rows) {
      const span = {
        ...row,
        children: [] as any[],
      };
      spanMap.set(row.span_id, span);
    }

    // Link children to parents
    for (const span of spanMap.values()) {
      if (span.parent_span_id && spanMap.has(span.parent_span_id)) {
        spanMap.get(span.parent_span_id).children.push(span);
      } else if (!span.parent_span_id) {
        rootSpan = span;
      }
    }

    // If no explicit root (no null parent_span_id), use the first span
    if (!rootSpan && rows.length > 0) {
      rootSpan = spanMap.get(rows[0].span_id);
    }

    // Calculate total duration from root span
    if (rootSpan && rootSpan.duration_ms != null) {
      totalDurationMs = rootSpan.duration_ms;
    }

    res.json({
      data: {
        trace_id: traceId,
        root_span: rootSpan,
        spans: rows,
        total_duration_ms: totalDurationMs,
      },
    });
  });

  // GET /_events/stats — aggregate stats (admin only)
  getStats = asyncHandler(async (req: Request, res: Response) => {
    const conditions: string[] = ["duration_ms IS NOT NULL"];
    const args: any[] = [];
    let argIdx = 1;

    if (req.query.from) {
      conditions.push(`created_at >= $${argIdx++}`);
      args.push(req.query.from);
    }
    if (req.query.to) {
      conditions.push(`created_at <= $${argIdx++}`);
      args.push(req.query.to);
    }
    if (req.query.entity) {
      conditions.push(`entity = $${argIdx++}`);
      args.push(req.query.entity);
    }

    const whereClause = " WHERE " + conditions.join(" AND ");

    // By-source stats
    const d = getDialect();
    const errorCountExpr = d.filterCountExpr("status = 'error'");
    const p95SourceCol = d.supportsPercentile()
      ? "percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95_duration_ms,"
      : "";
    const bySourceSQL = `SELECT source, COUNT(*) as count, AVG(duration_ms) as avg_duration_ms, ${p95SourceCol} ${errorCountExpr} as error_count FROM _events${whereClause} GROUP BY source ORDER BY count DESC`;
    const bySourceRows = await queryRows(this.pool, bySourceSQL, args);

    // If percentile not supported, compute p95 per source in JS
    if (!d.supportsPercentile() && bySourceRows) {
      for (const row of bySourceRows) {
        const durSQL = `SELECT duration_ms FROM _events${whereClause} AND source = $${argIdx} AND duration_ms IS NOT NULL ORDER BY duration_ms`;
        const durRows = await queryRows(this.pool, durSQL, [...args, row.source]);
        row.p95_duration_ms = computeP95(durRows.map((r: any) => r.duration_ms));
      }
    }

    // Overall stats (separate query, uses all events not just those with duration_ms)
    const overallConditions: string[] = [];
    const overallArgs: any[] = [];
    let overallIdx = 1;

    if (req.query.from) {
      overallConditions.push(`created_at >= $${overallIdx++}`);
      overallArgs.push(req.query.from);
    }
    if (req.query.to) {
      overallConditions.push(`created_at <= $${overallIdx++}`);
      overallArgs.push(req.query.to);
    }
    if (req.query.entity) {
      overallConditions.push(`entity = $${overallIdx++}`);
      overallArgs.push(req.query.entity);
    }

    const overallWhere = overallConditions.length > 0 ? " WHERE " + overallConditions.join(" AND ") : "";

    const overallErrorCountExpr = d.filterCountExpr("status = 'error'");
    const p95OverallCol = d.supportsPercentile()
      ? "percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95_latency_ms,"
      : "";
    const totalSQL = `SELECT COUNT(*) as total_events, AVG(duration_ms) as avg_latency_ms, ${p95OverallCol} ${overallErrorCountExpr} as error_count FROM _events${overallWhere}`;

    let totalEvents = 0;
    let avgLatencyMs: number | null = null;
    let p95LatencyMs: number | null = null;
    let errorRate = 0;

    try {
      const totalRow = await queryRow(this.pool, totalSQL, overallArgs);
      totalEvents = parseInt(String(totalRow.total_events), 10) || 0;
      avgLatencyMs = totalRow.avg_latency_ms != null ? parseFloat(String(totalRow.avg_latency_ms)) : null;
      if (d.supportsPercentile()) {
        p95LatencyMs = totalRow.p95_latency_ms != null ? parseFloat(String(totalRow.p95_latency_ms)) : null;
      } else {
        // Compute p95 in JS for SQLite
        const durSQL = `SELECT duration_ms FROM _events${overallWhere.length > 0 ? overallWhere + " AND" : " WHERE"} duration_ms IS NOT NULL ORDER BY duration_ms`;
        try {
          const durRows = await queryRows(this.pool, durSQL, overallArgs);
          p95LatencyMs = computeP95(durRows.map((r: any) => r.duration_ms));
        } catch {
          p95LatencyMs = null;
        }
      }
      const errorCount = parseInt(String(totalRow.error_count), 10) || 0;
      errorRate = totalEvents > 0 ? errorCount / totalEvents : 0;
    } catch {
      // If _events table is empty, queryRow throws ErrNotFound
    }

    const bySource = (bySourceRows ?? []).map((row: any) => ({
      source: row.source,
      count: parseInt(String(row.count), 10),
      avg_duration_ms: row.avg_duration_ms != null ? parseFloat(String(row.avg_duration_ms)) : null,
      p95_duration_ms: row.p95_duration_ms != null ? parseFloat(String(row.p95_duration_ms)) : null,
      error_count: parseInt(String(row.error_count), 10),
    }));

    res.json({
      data: {
        total_events: totalEvents,
        avg_latency_ms: avgLatencyMs,
        p95_latency_ms: p95LatencyMs,
        error_rate: errorRate,
        by_source: bySource,
      },
    });
  });
}
