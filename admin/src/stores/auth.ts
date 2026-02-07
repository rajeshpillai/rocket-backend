import { createSignal } from "solid-js";

export interface AuthUser {
  access_token: string;
  refresh_token: string;
}

const TOKEN_KEY = "rocket_access_token";
const REFRESH_KEY = "rocket_refresh_token";

const [token, setTokenSignal] = createSignal<string | null>(
  localStorage.getItem(TOKEN_KEY),
);

const [refreshToken, setRefreshTokenSignal] = createSignal<string | null>(
  localStorage.getItem(REFRESH_KEY),
);

export function getToken(): string | null {
  return token();
}

export function getRefreshToken(): string | null {
  return refreshToken();
}

export function isAuthenticated(): boolean {
  return token() !== null;
}

export function setTokens(access: string, refresh: string): void {
  localStorage.setItem(TOKEN_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
  setTokenSignal(access);
  setRefreshTokenSignal(refresh);
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  setTokenSignal(null);
  setRefreshTokenSignal(null);
}

/** Parse JWT payload (no verification — just for UI role display) */
export function parseTokenPayload(): { sub: string; roles: string[] } | null {
  const t = token();
  if (!t) return null;
  try {
    const parts = t.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return { sub: payload.sub ?? "", roles: payload.roles ?? [] };
  } catch {
    return null;
  }
}

export function isAdmin(): boolean {
  const payload = parseTokenPayload();
  if (!payload) return false;
  return payload.roles.includes("admin");
}

export { token };
