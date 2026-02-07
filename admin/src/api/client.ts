import { getToken, clearAuth } from "../stores/auth";
import { getSelectedApp } from "../stores/app";

function getBase(): string {
  const app = getSelectedApp();
  return app ? `/api/${app}` : "/api";
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };

  // Attach auth token if available
  const token = getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${getBase()}${path}`, {
    ...options,
    headers,
  });

  // On 401, clear auth state and redirect to login
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

export function get<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function post<T>(path: string, data: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function put<T>(path: string, data: unknown): Promise<T> {
  return request<T>(path, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function del<T>(path: string): Promise<T> {
  return request<T>(path, {
    method: "DELETE",
  });
}

/** Upload a file using multipart/form-data. Does NOT set Content-Type (browser sets boundary). */
export async function upload<T>(path: string, file: File): Promise<T> {
  const formData = new FormData();
  formData.append("file", file);

  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${getBase()}${path}`, {
    method: "POST",
    headers,
    body: formData,
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
