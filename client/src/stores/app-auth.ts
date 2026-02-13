import { createSignal } from "solid-js";

const TOKEN_KEY = "rocket_client_app_token";
const REFRESH_KEY = "rocket_client_app_refresh";

const [appToken, setAppTokenSignal] = createSignal<string | null>(
  localStorage.getItem(TOKEN_KEY)
);

const [appRefreshToken, setAppRefreshTokenSignal] = createSignal<string | null>(
  localStorage.getItem(REFRESH_KEY)
);

export { appToken, appRefreshToken };

export function getAppToken(): string | null {
  return appToken();
}

export function getAppRefreshToken(): string | null {
  return appRefreshToken();
}

export function isAppAuthenticated(): boolean {
  return appToken() !== null;
}

export function setAppTokens(access: string, refresh: string): void {
  localStorage.setItem(TOKEN_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
  setAppTokenSignal(access);
  setAppRefreshTokenSignal(refresh);
}

export function clearAppAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  setAppTokenSignal(null);
  setAppRefreshTokenSignal(null);
}

export function parseAppTokenPayload(): {
  sub: string;
  roles: string[];
} | null {
  const t = appToken();
  if (!t) return null;
  try {
    const payload = JSON.parse(atob(t.split(".")[1]));
    return { sub: payload.sub || "", roles: payload.roles || [] };
  } catch {
    return null;
  }
}

export function isAppAdmin(): boolean {
  const payload = parseAppTokenPayload();
  return payload !== null && payload.roles.includes("admin");
}
