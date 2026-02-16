import type { Request, Response, NextFunction } from "express";
import { parseAccessToken, type UserContext } from "./auth.js";
import { AppError } from "../engine/errors.js";
import { getInstrumenter } from "../instrument/instrument.js";

declare global {
  namespace Express {
    interface Request {
      user?: UserContext;
    }
  }
}

function unauthorizedError(msg: string): AppError {
  return new AppError("UNAUTHORIZED", 401, msg);
}

function forbiddenError(msg: string): AppError {
  return new AppError("FORBIDDEN", 403, msg);
}

export function authMiddleware(secret: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const span = getInstrumenter().startSpan("auth", "middleware", "auth.validate");
    const header = req.headers.authorization;
    if (!header) {
      span.setStatus("error");
      span.setMetadata("error", "Missing auth token");
      span.end();
      return next(unauthorizedError("Missing auth token"));
    }

    const parts = header.split(" ");
    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
      span.setStatus("error");
      span.setMetadata("error", "Invalid auth header format");
      span.end();
      return next(unauthorizedError("Invalid auth header format"));
    }

    try {
      const claims = parseAccessToken(parts[1], secret);
      req.user = {
        id: claims.sub,
        roles: claims.roles,
      };
      span.setStatus("ok");
      span.setMetadata("user_id", claims.sub);
      span.end();
      next();
    } catch {
      span.setStatus("error");
      span.setMetadata("error", "Invalid or expired token");
      span.end();
      next(unauthorizedError("Invalid or expired token"));
    }
  };
}

export function requireAdmin() {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(unauthorizedError("Missing auth token"));
    }
    if (!req.user.roles.includes("admin")) {
      return next(forbiddenError("Admin access required"));
    }
    next();
  };
}
