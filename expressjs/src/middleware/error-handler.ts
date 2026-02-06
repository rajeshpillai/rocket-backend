import type { Request, Response, NextFunction } from "express";
import { AppError } from "../engine/errors.js";

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

  console.error("ERROR:", err);
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    },
  });
}
