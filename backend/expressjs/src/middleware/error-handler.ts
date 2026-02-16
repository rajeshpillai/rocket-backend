import type { Request, Response, NextFunction } from "express";
import { AppError, conflictError } from "../engine/errors.js";
import { UniqueViolationError } from "../store/postgres.js";

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    const body: Record<string, any> = {
      error: {
        code: err.code,
        message: err.message,
      },
    };
    if (err.details && err.details.length > 0) {
      body.error.details = err.details;
    }
    res.status(err.status).json(body);
    return;
  }

  if (err instanceof UniqueViolationError) {
    const msg = err.detail || "A record with this value already exists";
    const appErr = conflictError(msg);
    res.status(appErr.status).json({ error: { code: appErr.code, message: appErr.message } });
    return;
  }

  console.error("ERROR:", err);
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    },
  });
}
