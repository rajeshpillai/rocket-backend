import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";

export interface UserContext {
  id: string;
  roles: string[];
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
}

export interface Claims {
  sub: string;
  roles: string[];
  iat: number;
  exp: number;
}

export const ACCESS_TOKEN_TTL = 15 * 60; // 15 minutes in seconds
export const REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

export function generateAccessToken(
  userID: string,
  roles: string[],
  secret: string,
): string {
  return jwt.sign({ roles }, secret, {
    subject: userID,
    expiresIn: ACCESS_TOKEN_TTL,
  });
}

export function parseAccessToken(
  token: string,
  secret: string,
): Claims {
  const decoded = jwt.verify(token, secret) as jwt.JwtPayload;
  return {
    sub: decoded.sub!,
    roles: (decoded.roles as string[]) ?? [],
    iat: decoded.iat!,
    exp: decoded.exp!,
  };
}

export function generateRefreshToken(): string {
  return randomUUID();
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function checkPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
