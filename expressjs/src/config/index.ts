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

export interface Config {
  server: ServerConfig;
  database: DatabaseConfig;
  jwt_secret: string;
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

  return {
    server: {
      port: server.port ?? 8080,
    },
    jwt_secret: (raw.jwt_secret as string) ?? "changeme-secret",
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
