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

/** Raw response envelope used by API Playground. */
export interface RawResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  durationMs: number;
}

/**
 * Execute a raw HTTP request returning the full response envelope.
 * Does NOT throw on non-2xx or redirect on 401 — used by API Playground.
 */
export async function rawRequest(
  path: string,
  method: string,
  body?: unknown,
): Promise<RawResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const url = `${getBase()}${path}`;
  const start = performance.now();

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const durationMs = Math.round(performance.now() - start);

  const respHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    respHeaders[key] = value;
  });

  let respBody: unknown;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      respBody = await res.json();
    } catch {
      respBody = await res.text();
    }
  } else {
    respBody = await res.text();
  }

  return {
    status: res.status,
    statusText: res.statusText,
    headers: respHeaders,
    body: respBody,
    durationMs,
  };
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
