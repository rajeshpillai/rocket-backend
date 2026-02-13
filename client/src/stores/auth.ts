import { createSignal } from "solid-js";

const TOKEN_KEY = "rocket_client_platform_token";
const REFRESH_KEY = "rocket_client_platform_refresh";

const [token, setTokenSignal] = createSignal<string | null>(
  localStorage.getItem(TOKEN_KEY)
);

const [refreshToken, setRefreshTokenSignal] = createSignal<string | null>(
  localStorage.getItem(REFRESH_KEY)
);

export { token, refreshToken };

export function getToken(): string | null {
  return token();
}

export function getRefreshToken(): string | null {
  return refreshToken();
}

export function isPlatformAuthenticated(): boolean {
  return token() !== null;
}

export function setPlatformTokens(access: string, refresh: string): void {
  localStorage.setItem(TOKEN_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
  setTokenSignal(access);
  setRefreshTokenSignal(refresh);
}

export function clearPlatformAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  setTokenSignal(null);
  setRefreshTokenSignal(null);
}

export function parsePlatformTokenPayload(): {
  sub: string;
  roles: string[];
} | null {
  const t = token();
  if (!t) return null;
  try {
    const payload = JSON.parse(atob(t.split(".")[1]));
    return { sub: payload.sub || "", roles: payload.roles || [] };
  } catch {
    return null;
  }
}
