import type { Request, Response, NextFunction } from "express";
import { parseAccessToken, type UserContext } from "../auth/auth.js";
import { AppError } from "../engine/errors.js";
import type { AppManager } from "./manager.js";
import type { AppContext } from "./context.js";

// Augment Express Request with appCtx
declare global {
  namespace Express {
    interface Request {
      appCtx?: AppContext;
    }
  }
}

function unauthorizedError(msg: string): AppError {
  return new AppError("UNAUTHORIZED", 401, msg);
}

// appResolverMiddleware extracts the :app parameter, looks up the AppContext,
// and attaches it to req.appCtx.
export function appResolverMiddleware(manager: AppManager) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const appName = req.params.app;
    if (!appName) {
      return next(new AppError("APP_NOT_FOUND", 404, "App name is required"));
    }

    try {
      const ac = await manager.get(appName);
      if (!ac) {
        return next(new AppError("APP_NOT_FOUND", 404, "App not found: " + appName));
      }
      req.appCtx = ac;
      next();
    } catch {
      next(new AppError("APP_NOT_FOUND", 404, "App not found: " + appName));
    }
  };
}

// appAuthMiddleware validates JWT tokens using the app's JWT secret first,
// then falls back to the platform JWT secret. Platform admin tokens get admin role.
export function appAuthMiddleware(platformJWTSecret: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header) {
      return next(unauthorizedError("Missing auth token"));
    }

    const parts = header.split(" ");
    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
      return next(unauthorizedError("Invalid auth header format"));
    }

    const token = parts[1];

    // Try app-scoped JWT secret first
    if (req.appCtx) {
      try {
        const claims = parseAccessToken(token, req.appCtx.jwtSecret);
        req.user = { id: claims.sub, roles: claims.roles };
        return next();
      } catch {
        // Fall through to platform secret
      }
    }

    // Fall back to platform JWT secret
    try {
      const claims = parseAccessToken(token, platformJWTSecret);
      // Platform admin gets admin role in any app
      req.user = { id: claims.sub, roles: [...claims.roles, "admin"] };
      next();
    } catch {
      next(unauthorizedError("Invalid or expired token"));
    }
  };
}

// platformAuthMiddleware validates JWT tokens using only the platform JWT secret.
export function platformAuthMiddleware(platformJWTSecret: string) {
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
      const claims = parseAccessToken(parts[1], platformJWTSecret);
      req.user = { id: claims.sub, roles: claims.roles };
      next();
    } catch {
      next(unauthorizedError("Invalid or expired token"));
    }
  };
}
