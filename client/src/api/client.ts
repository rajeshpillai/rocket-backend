import { getAppToken, clearAppAuth } from "../stores/app-auth";
import { getSelectedApp } from "../stores/app";

function getBase(): string {
  const app = getSelectedApp();
  return app ? `/api/${app}` : "/api";
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  rawBody?: FormData;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = `${getBase()}${path}`;
  const headers: Record<string, string> = { ...options.headers };
  const token = getAppToken();

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let body: string | FormData | undefined;
  if (options.rawBody) {
    body = options.rawBody;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const res = await fetch(url, {
    method: options.method || "GET",
    headers,
    body,
  });

  if (res.status === 401 && !path.startsWith("/auth/")) {
    clearAppAuth();
    window.location.hash = "#/app-login";
    throw new Error("Session expired");
  }

  const json = await res.json();

  if (!res.ok) {
    throw json;
  }

  return json as T;
}

export function get<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function post<T>(path: string, data?: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: data });
}

export function put<T>(path: string, data?: unknown): Promise<T> {
  return request<T>(path, { method: "PUT", body: data });
}

export function del<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}

export function upload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  return request<T>(path, { method: "POST", rawBody: form });
}
