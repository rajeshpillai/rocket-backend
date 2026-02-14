import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

export interface ServerConfig {
  port: number;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  name: string;
  pool_size: number;
}

export interface StorageConfig {
  driver: string;
  local_path: string;
  max_file_size: number;
}

export interface InstrumentationConfig {
  enabled: boolean;
  retention_days: number;
  sampling_rate: number;
  buffer_size: number;
  flush_interval_ms: number;
}

export interface Config {
  server: ServerConfig;
  database: DatabaseConfig;
  storage: StorageConfig;
  instrumentation: InstrumentationConfig;
  jwt_secret: string;
  platform_jwt_secret: string;
  app_pool_size: number;
}

export function connString(db: DatabaseConfig): string {
  return `postgres://${db.user}:${db.password}@${db.host}:${db.port}/${db.name}?sslmode=disable`;
}

export function loadConfig(): Config {
  const candidates = [
    path.resolve("app.yaml"),
    path.resolve("../../app.yaml"),
  ];

  let raw: Record<string, any> = {};
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      raw = yaml.load(fs.readFileSync(p, "utf-8")) as Record<string, any>;
      break;
    }
  }

  const server = raw.server ?? {};
  const database = raw.database ?? {};
  const storage = raw.storage ?? {};
  const instrumentation = raw.instrumentation ?? {};

  return {
    server: {
      port: server.port ?? 8080,
    },
    jwt_secret: (raw.jwt_secret as string) ?? "changeme-secret",
    platform_jwt_secret: (raw.platform_jwt_secret as string) ?? "changeme-platform-secret",
    app_pool_size: (raw.app_pool_size as number) ?? 5,
    storage: {
      driver: storage.driver ?? "local",
      local_path: storage.local_path ?? "./uploads",
      max_file_size: storage.max_file_size ?? 10485760,
    },
    instrumentation: {
      enabled: instrumentation.enabled ?? true,
      retention_days: instrumentation.retention_days ?? 7,
      sampling_rate: instrumentation.sampling_rate ?? 1.0,
      buffer_size: instrumentation.buffer_size ?? 500,
      flush_interval_ms: instrumentation.flush_interval_ms ?? 100,
    },
    database: {
      host: database.host ?? "localhost",
      port: database.port ?? 5432,
      user: database.user ?? "rocket",
      password: database.password ?? "rocket",
      name: database.name ?? "rocket",
      pool_size: database.pool_size ?? 10,
    },
  };
}
