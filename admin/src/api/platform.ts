import { getToken, clearAuth } from "../stores/auth";
import type { AppInfo, CreateAppRequest } from "../types/app";
import type { ApiListResponse, ApiResponse } from "../types/api";

const BASE = "/api/_platform";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };

  const token = getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401 && !path.startsWith("/auth/")) {
    clearAuth();
    window.location.href = "/admin/login";
    throw new Error("Session expired");
  }

  const body = await res.json();

  if (!res.ok) {
    throw body;
  }

  return body as T;
}

// Platform auth
export function platformLogin(email: string, password: string) {
  return request<ApiResponse<{ access_token: string; refresh_token: string }>>(
    "/auth/login",
    {
      method: "POST",
      body: JSON.stringify({ email, password }),
    },
  );
}

export function platformRefresh(refreshToken: string) {
  return request<ApiResponse<{ access_token: string; refresh_token: string }>>(
    "/auth/refresh",
    {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
    },
  );
}

export function platformLogout(refreshToken: string) {
  return request<ApiResponse<{ message: string }>>("/auth/logout", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
}

// App CRUD
export function listApps() {
  return request<ApiListResponse<AppInfo>>("/apps");
}

export function getApp(name: string) {
  return request<ApiResponse<AppInfo>>(`/apps/${name}`);
}

export function createApp(data: CreateAppRequest) {
  return request<ApiResponse<AppInfo>>("/apps", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function deleteApp(name: string) {
  return request<ApiResponse<{ message: string }>>(`/apps/${name}`, {
    method: "DELETE",
  });
}
