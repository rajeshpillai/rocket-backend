import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { Store, exec } from "../store/postgres.js";
import { bootstrap } from "../store/bootstrap.js";
import { Migrator } from "../store/migrator.js";
import { Registry } from "../metadata/registry.js";
import { loadAll, reload } from "../metadata/loader.js";
import { Handler } from "./handler.js";
import { registerDynamicRoutes } from "./router.js";
import { AdminHandler, registerAdminRoutes } from "../admin/handler.js";
import { errorHandler } from "../middleware/error-handler.js";

const ENTITY_NAME = "_test_unique_users";

function buildApp(store: Store, registry: Registry): express.Express {
  const app = express();
  app.use(express.json());

  const migrator = new Migrator(store);
  const adminHandler = new AdminHandler(store, registry, migrator);
  registerAdminRoutes(app, adminHandler);

  const engineHandler = new Handler(store, registry);
  registerDynamicRoutes(app, engineHandler);

  app.use(errorHandler);
  return app;
}

async function request(
  app: express.Express,
  method: string,
  path: string,
  body?: any,
): Promise<{ status: number; body: any }> {
  const { default: http } = await import("node:http");
  const server = http.createServer(app);

  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const addr = server.address() as { port: number };
      const payload = body ? JSON.stringify(body) : undefined;
      const options = {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      };

      const req = http.request(options, (res) => {
        let data = "";
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () => {
          server.close();
          try {
            resolve({ status: res.statusCode!, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode!, body: data });
          }
        });
      });

      req.on("error", (err) => {
        server.close();
        reject(err);
      });

      if (payload) req.write(payload);
      req.end();
    });
  });
}

describe("unique constraint → 409 CONFLICT", () => {
  let store: Store;
  let registry: Registry;
  let app: express.Express;

  before(async () => {
    store = await Store.connect({
      host: "localhost",
      port: 5433,
      user: "rocket",
      password: "rocket",
      name: "rocket",
      pool_size: 2,
    });
    await bootstrap(store.pool);
    registry = new Registry();
    await loadAll(store.pool, registry);
    app = buildApp(store, registry);

    // Create test entity with unique email field
    const resp = await request(app, "POST", "/api/_admin/entities", {
      name: ENTITY_NAME,
      table: ENTITY_NAME,
      primary_key: { field: "id", type: "uuid", generated: true },
      fields: [
        { name: "id", type: "uuid" },
        { name: "email", type: "string", required: true, unique: true },
        { name: "name", type: "string", required: true },
      ],
    });
    assert.equal(resp.status, 201, `create entity failed: ${JSON.stringify(resp.body)}`);
  });

  after(async () => {
    await exec(store.pool, `DROP TABLE IF EXISTS ${ENTITY_NAME}`);
    await exec(store.pool, "DELETE FROM _entities WHERE name = $1", [
      ENTITY_NAME,
    ]);
    await reload(store.pool, registry);
    await store.close();
  });

  it("returns 409 CONFLICT on duplicate unique field", async () => {
    // Insert first record
    const resp1 = await request(app, "POST", `/api/${ENTITY_NAME}`, {
      email: "dup@test.com",
      name: "Alice",
    });
    assert.equal(resp1.status, 201, `first insert failed: ${JSON.stringify(resp1.body)}`);

    // Insert duplicate — should return 409
    const resp2 = await request(app, "POST", `/api/${ENTITY_NAME}`, {
      email: "dup@test.com",
      name: "Bob",
    });
    assert.equal(resp2.status, 409, `expected 409, got ${resp2.status}: ${JSON.stringify(resp2.body)}`);
    assert.equal(resp2.body.error.code, "CONFLICT");
  });
});
