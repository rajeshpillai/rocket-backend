import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import type { InstrumentationConfig } from "../config/index.js";
import {
  InstrumenterImpl,
  runWithTraceContext,
  type TraceContext,
} from "./instrument.js";

export function instrumentationMiddleware(config: InstrumentationConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip if disabled
    if (!config.enabled) return next();

    // Extract buffer from multi-app context
    const buffer = req.appCtx?.eventBuffer;
    if (!buffer) return next();

    // Sampling
    if (config.sampling_rate < 1.0 && Math.random() > config.sampling_rate) {
      return next();
    }

    const traceId =
      (req.headers["x-trace-id"] as string) || randomUUID();
    const userId = req.user?.id ?? null;

    const instrumenter = new InstrumenterImpl(buffer);
    const ctx: TraceContext = {
      traceId,
      parentSpanId: null,
      userId,
      buffer,
      instrumenter,
    };

    // Set trace ID response header
    res.setHeader("X-Trace-ID", traceId);

    runWithTraceContext(ctx, () => {
      // Create root HTTP span
      const span = instrumenter.startSpan("http", "handler", "request.start");
      span.setMetadata("method", req.method);
      span.setMetadata(
        "path",
        req.originalUrl?.split("?")[0] || req.path,
      );

      // On response finish, end the span
      const onFinish = () => {
        span.setMetadata("status_code", res.statusCode);
        span.setStatus(res.statusCode >= 400 ? "error" : "ok");
        span.end();
        res.removeListener("finish", onFinish);
      };
      res.on("finish", onFinish);

      next();
    });
  };
}
