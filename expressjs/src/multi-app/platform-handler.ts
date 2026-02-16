import { Router, type Express, type Request, type Response, type NextFunction, type RequestHandler } from "express";
import type { Store } from "../store/postgres.js";
import { queryRows, queryRow, exec, getDialect } from "../store/postgres.js";
import { AppError } from "../engine/errors.js";
import {
  checkPassword,
  generateAccessToken,
  generateRefreshToken,
  REFRESH_TOKEN_TTL,
} from "../auth/auth.js";
import type { AIConfig } from "../config/index.js";
import type { AppManager } from "./manager.js";

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

function unauthorizedError(msg: string): AppError {
  return new AppError("UNAUTHORIZED", 401, msg);
}

const validAppNameRe = /^[a-z][a-z0-9_-]{0,62}$/;

export class PlatformHandler {
  private store: Store;
  private jwtSecret: string;
  private manager: AppManager;
  private aiConfig: AIConfig;

  constructor(store: Store, jwtSecret: string, manager: AppManager, aiConfig: AIConfig) {
    this.store = store;
    this.jwtSecret = jwtSecret;
    this.manager = manager;
    this.aiConfig = aiConfig;
  }

  // --- Auth endpoints (platform users) ---

  login = asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      throw unauthorizedError("Email and password are required");
    }

    let user: Record<string, any>;
    try {
      user = await queryRow(
        this.store.pool,
        "SELECT id, email, password_hash, roles, active FROM _platform_users WHERE email = $1",
        [email],
      );
    } catch {
      throw unauthorizedError("Invalid email or password");
    }

    if (!user.active) {
      throw unauthorizedError("Account is disabled");
    }

    const valid = await checkPassword(password, user.password_hash);
    if (!valid) {
      throw unauthorizedError("Invalid email or password");
    }

    const pair = await this.generateTokenPair(user.id, extractRoles(user.roles));
    res.json({ data: pair });
  });

  refresh = asyncHandler(async (req: Request, res: Response) => {
    const { refresh_token } = req.body ?? {};
    if (!refresh_token) {
      throw unauthorizedError("Refresh token is required");
    }

    let row: Record<string, any>;
    try {
      row = await queryRow(
        this.store.pool,
        `SELECT rt.id, rt.user_id, rt.expires_at, u.roles, u.active
         FROM _platform_refresh_tokens rt
         JOIN _platform_users u ON u.id = rt.user_id
         WHERE rt.token = $1`,
        [refresh_token],
      );
    } catch {
      throw unauthorizedError("Invalid refresh token");
    }

    const expiresAt = new Date(row.expires_at);
    if (new Date() > expiresAt) {
      await exec(this.store.pool, "DELETE FROM _platform_refresh_tokens WHERE token = $1", [refresh_token]);
      throw unauthorizedError("Refresh token expired");
    }

    if (!row.active) {
      throw unauthorizedError("Account is disabled");
    }

    await exec(this.store.pool, "DELETE FROM _platform_refresh_tokens WHERE id = $1", [row.id]);

    const pair = await this.generateTokenPair(row.user_id, extractRoles(row.roles));
    res.json({ data: pair });
  });

  logout = asyncHandler(async (req: Request, res: Response) => {
    const { refresh_token } = req.body ?? {};
    if (!refresh_token) {
      throw unauthorizedError("Refresh token is required");
    }

    await exec(this.store.pool, "DELETE FROM _platform_refresh_tokens WHERE token = $1", [refresh_token]);
    res.json({ message: "Logged out" });
  });

  // --- App CRUD ---

  listApps = asyncHandler(async (_req: Request, res: Response) => {
    const apps = await this.manager.list();
    res.json({ data: apps });
  });

  getApp = asyncHandler(async (req: Request, res: Response) => {
    const name = req.params.name;
    try {
      const info = await this.manager.getApp(name);
      res.json({ data: info });
    } catch {
      throw new AppError("NOT_FOUND", 404, "App not found");
    }
  });

  createApp = asyncHandler(async (req: Request, res: Response) => {
    const { name, display_name, db_driver } = req.body ?? {};

    if (!name) {
      throw new AppError("VALIDATION_FAILED", 422, "App name is required");
    }
    if (!validAppNameRe.test(name)) {
      throw new AppError("VALIDATION_FAILED", 422, "App name must be lowercase letters, numbers, hyphens, underscores (start with letter)");
    }

    const validDrivers = ["postgres", "sqlite"];
    const driver = db_driver || "postgres";
    if (!validDrivers.includes(driver)) {
      throw new AppError("VALIDATION_FAILED", 422, `Invalid db_driver: must be one of ${validDrivers.join(", ")}`);
    }

    const ac = await this.manager.create(name, display_name || name, driver);
    res.status(201).json({
      data: {
        name: ac.name,
        display_name: display_name || name,
        db_name: ac.dbName,
        db_driver: driver,
        status: "active",
      },
    });
  });

  deleteApp = asyncHandler(async (req: Request, res: Response) => {
    const name = req.params.name;
    try {
      await this.manager.delete(name);
      res.json({ message: "App deleted" });
    } catch (err: any) {
      throw new AppError("NOT_FOUND", 404, "App not found or failed to delete: " + err.message);
    }
  });

  // --- AI status (platform-level, no app needed) ---

  aiStatus = (_req: Request, res: Response) => {
    const configured = !!(this.aiConfig.baseUrl && this.aiConfig.apiKey);
    res.json({ data: { configured, model: configured ? this.aiConfig.model : "" } });
  };

  // --- helpers ---

  private async generateTokenPair(userID: string, roles: string[]) {
    const accessToken = generateAccessToken(userID, roles, this.jwtSecret);
    const refreshToken = generateRefreshToken();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL * 1000);

    await exec(
      this.store.pool,
      "INSERT INTO _platform_refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)",
      [userID, refreshToken, expiresAt],
    );

    return { access_token: accessToken, refresh_token: refreshToken };
  }
}

function extractRoles(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") return getDialect().scanArray(v);
  return [];
}

export function registerPlatformRoutes(
  app: Express,
  handler: PlatformHandler,
  platformAuthMW: RequestHandler,
): void {
  // Platform auth (no auth required)
  const authRouter = Router();
  authRouter.post("/login", handler.login);
  authRouter.post("/refresh", handler.refresh);
  authRouter.post("/logout", handler.logout);
  app.use("/api/_platform/auth", authRouter);

  // Platform admin (auth required)
  const adminRouter = Router();
  adminRouter.get("/apps", handler.listApps);
  adminRouter.post("/apps", handler.createApp);
  adminRouter.get("/apps/:name", handler.getApp);
  adminRouter.delete("/apps/:name", handler.deleteApp);
  adminRouter.get("/ai/status", handler.aiStatus);
  app.use("/api/_platform", platformAuthMW, adminRouter);
}
