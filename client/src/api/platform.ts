import { getToken, clearPlatformAuth } from "../stores/auth";
import type { AppInfo } from "../types/app";
import type { ApiResponse, ApiListResponse } from "../types/api";

const BASE = "/api/_platform";

async function platformRequest<T>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${BASE}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401 && !path.startsWith("/auth/")) {
    clearPlatformAuth();
    window.location.hash = "#/login";
    throw new Error("Platform session expired");
  }

  const json = await res.json();

  if (!res.ok) {
    throw json;
  }

  return json as T;
}

export async function platformLogin(
  email: string,
  password: string
): Promise<{ access_token: string; refresh_token: string }> {
  const res = await platformRequest<
    ApiResponse<{ access_token: string; refresh_token: string }>
  >("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  return res.data;
}

export async function platformRefresh(
  refreshToken: string
): Promise<{ access_token: string; refresh_token: string }> {
  const res = await platformRequest<
    ApiResponse<{ access_token: string; refresh_token: string }>
  >("/auth/refresh", {
    method: "POST",
    body: { refresh_token: refreshToken },
  });
  return res.data;
}

export async function platformLogout(refreshToken: string): Promise<void> {
  await platformRequest("/auth/logout", {
    method: "POST",
    body: { refresh_token: refreshToken },
  });
}

export async function listApps(): Promise<AppInfo[]> {
  const res = await platformRequest<ApiListResponse<AppInfo>>("/apps");
  return res.data;
}

export async function getApp(name: string): Promise<AppInfo> {
  const res = await platformRequest<ApiResponse<AppInfo>>(`/apps/${name}`);
  return res.data;
}
