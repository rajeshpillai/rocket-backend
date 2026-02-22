import type { McpConfig } from "./config.js";

interface TokenPair {
  access_token: string;
  refresh_token: string;
}

export class RocketClient {
  private config: McpConfig;
  private accessToken = "";
  private refreshToken = "";
  private tokenExpiresAt = 0;

  constructor(config: McpConfig) {
    this.config = config;
  }

  async login(): Promise<void> {
    const resp = await fetch(
      `${this.config.rocketUrl}/api/_platform/auth/login`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: this.config.email,
          password: this.config.password,
        }),
      }
    );

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Platform login failed (${resp.status}): ${text}`);
    }

    const body = (await resp.json()) as { data: TokenPair };
    this.setTokens(body.data);
  }

  async request(method: string, path: string, body?: unknown): Promise<unknown> {
    await this.ensureFreshToken();

    const resp = await this.doFetch(method, path, body);

    if (resp.status === 401) {
      await this.refresh();
      const retryResp = await this.doFetch(method, path, body);
      return this.handleResponse(retryResp);
    }

    return this.handleResponse(resp);
  }

  async get(path: string): Promise<unknown> {
    return this.request("GET", path);
  }

  async post(path: string, body?: unknown): Promise<unknown> {
    return this.request("POST", path, body);
  }

  async put(path: string, body?: unknown): Promise<unknown> {
    return this.request("PUT", path, body);
  }

  async delete(path: string): Promise<unknown> {
    return this.request("DELETE", path);
  }

  private async doFetch(
    method: string,
    path: string,
    body?: unknown
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
    };
    const opts: RequestInit = { method, headers };

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }

    return fetch(`${this.config.rocketUrl}${path}`, opts);
  }

  private async handleResponse(resp: Response): Promise<unknown> {
    const text = await resp.text();

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text);
    } catch {
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${text}`);
      }
      return text;
    }

    if (!resp.ok) {
      const err = json?.error as
        | { code: string; message: string; details?: unknown[] }
        | undefined;
      if (err?.message) {
        const details = err.details
          ? "\n" + JSON.stringify(err.details, null, 2)
          : "";
        throw new Error(`${err.code}: ${err.message}${details}`);
      }
      throw new Error(`HTTP ${resp.status}: ${text}`);
    }

    return json;
  }

  private async ensureFreshToken(): Promise<void> {
    if (Date.now() > this.tokenExpiresAt - 60_000) {
      await this.refresh();
    }
  }

  private async refresh(): Promise<void> {
    const resp = await fetch(
      `${this.config.rocketUrl}/api/_platform/auth/refresh`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: this.refreshToken }),
      }
    );

    if (!resp.ok) {
      console.error("Token refresh failed, attempting re-login...");
      await this.login();
      return;
    }

    const body = (await resp.json()) as { data: TokenPair };
    this.setTokens(body.data);
  }

  private setTokens(pair: TokenPair): void {
    this.accessToken = pair.access_token;
    this.refreshToken = pair.refresh_token;
    this.tokenExpiresAt = Date.now() + 14 * 60 * 1000;
  }
}
