import type { Request, Response, NextFunction } from "express";
import { parseAccessToken, type UserContext } from "./auth.js";
import { AppError } from "../engine/errors.js";

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
    const header = req.headers.authorization;
    if (!header) {
      return next(unauthorizedError("Missing auth token"));
    }

    const parts = header.split(" ");
    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
      return next(unauthorizedError("Invalid auth header format"));
    }

    try {
      const claims = parseAccessToken(parts[1], secret);
      req.user = {
        id: claims.sub,
        roles: claims.roles,
      };
      next();
    } catch {
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
