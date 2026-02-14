import { Router, type Express, type Request, type Response, type NextFunction } from "express";
import type { Store } from "../store/postgres.js";
import { queryRow, exec, getDialect } from "../store/postgres.js";
import { AppError } from "../engine/errors.js";
import {
  checkPassword,
  generateAccessToken,
  generateRefreshToken,
  REFRESH_TOKEN_TTL,
} from "./auth.js";

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

function unauthorizedError(msg: string): AppError {
  return new AppError("UNAUTHORIZED", 401, msg);
}

export class AuthHandler {
  private store: Store;
  private jwtSecret: string;

  constructor(store: Store, jwtSecret: string) {
    this.store = store;
    this.jwtSecret = jwtSecret;
  }

  login = asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      throw unauthorizedError("Email and password are required");
    }

    // Look up user by email
    let user: Record<string, any>;
    try {
      user = await queryRow(
        this.store.pool,
        "SELECT id, email, password_hash, roles, active FROM _users WHERE email = $1",
        [email],
      );
    } catch {
      throw unauthorizedError("Invalid email or password");
    }

    // Check if user is active
    if (!user.active) {
      throw unauthorizedError("Account is disabled");
    }

    // Verify password
    const valid = await checkPassword(password, user.password_hash);
    if (!valid) {
      throw unauthorizedError("Invalid email or password");
    }

    // Extract user info
    const userID = user.id;
    const roles = extractRoles(user.roles);

    // Generate tokens
    const pair = await this.generateTokenPair(userID, roles);
    res.json({ data: pair });
  });

  refresh = asyncHandler(async (req: Request, res: Response) => {
    const { refresh_token } = req.body ?? {};
    if (!refresh_token) {
      throw unauthorizedError("Refresh token is required");
    }

    // Look up refresh token
    let row: Record<string, any>;
    try {
      row = await queryRow(
        this.store.pool,
        `SELECT rt.id, rt.user_id, rt.expires_at, u.roles, u.active
         FROM _refresh_tokens rt
         JOIN _users u ON u.id = rt.user_id
         WHERE rt.token = $1`,
        [refresh_token],
      );
    } catch {
      throw unauthorizedError("Invalid refresh token");
    }

    // Check expiration
    const expiresAt = new Date(row.expires_at);
    if (new Date() > expiresAt) {
      await exec(
        this.store.pool,
        "DELETE FROM _refresh_tokens WHERE token = $1",
        [refresh_token],
      );
      throw unauthorizedError("Refresh token expired");
    }

    // Check user is active
    if (!row.active) {
      throw unauthorizedError("Account is disabled");
    }

    // Delete the used refresh token (rotation)
    await exec(
      this.store.pool,
      "DELETE FROM _refresh_tokens WHERE id = $1",
      [row.id],
    );

    // Generate new token pair
    const roles = extractRoles(row.roles);
    const pair = await this.generateTokenPair(row.user_id, roles);
    res.json({ data: pair });
  });

  logout = asyncHandler(async (req: Request, res: Response) => {
    const { refresh_token } = req.body ?? {};
    if (!refresh_token) {
      throw unauthorizedError("Refresh token is required");
    }

    await exec(
      this.store.pool,
      "DELETE FROM _refresh_tokens WHERE token = $1",
      [refresh_token],
    );

    res.json({ message: "Logged out" });
  });

  private async generateTokenPair(userID: string, roles: string[]) {
    const accessToken = generateAccessToken(userID, roles, this.jwtSecret);
    const refreshToken = generateRefreshToken();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL * 1000);

    await exec(
      this.store.pool,
      "INSERT INTO _refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)",
      [userID, refreshToken, expiresAt],
    );

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }
}

function extractRoles(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") return getDialect().scanArray(v);
  return [];
}

export function registerAuthRoutes(app: Express, handler: AuthHandler): void {
  const router = Router();
  router.post("/login", handler.login);
  router.post("/refresh", handler.refresh);
  router.post("/logout", handler.logout);
  app.use("/api/auth", router);
}
