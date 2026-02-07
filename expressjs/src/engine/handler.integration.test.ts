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

describe("field rule enforcement", () => {
  let store: Store;
  let registry: Registry;
  let app: express.Express;
  const entityName = "_test_field_rule_entity";

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

    // Create test entity
    const resp = await request(app, "POST", "/api/_admin/entities", {
      name: entityName,
      table: entityName,
      primary_key: { field: "id", type: "uuid", generated: true },
      fields: [
        { name: "id", type: "uuid" },
        { name: "total", type: "decimal", precision: 2 },
        { name: "name", type: "string", required: true },
      ],
    });
    assert.equal(resp.status, 201, `create entity failed: ${JSON.stringify(resp.body)}`);

    // Add field rule: total >= 0
    const ruleResp = await request(app, "POST", "/api/_admin/rules", {
      entity: entityName,
      hook: "before_write",
      type: "field",
      definition: {
        field: "total",
        operator: "min",
        value: 0,
        message: "Total must be non-negative",
      },
      priority: 10,
      active: true,
    });
    assert.equal(ruleResp.status, 201, `create rule failed: ${JSON.stringify(ruleResp.body)}`);
  });

  after(async () => {
    await exec(store.pool, `DELETE FROM _rules WHERE entity = $1`, [entityName]);
    await exec(store.pool, `DROP TABLE IF EXISTS ${entityName}`);
    await exec(store.pool, "DELETE FROM _entities WHERE name = $1", [entityName]);
    await reload(store.pool, registry);
    await store.close();
  });

  it("rejects record violating field rule with 422", async () => {
    const resp = await request(app, "POST", `/api/${entityName}`, {
      total: -1,
      name: "Bad Record",
    });
    assert.equal(resp.status, 422, `expected 422, got ${resp.status}: ${JSON.stringify(resp.body)}`);
    assert.equal(resp.body.error.code, "VALIDATION_FAILED");
    assert.ok(resp.body.error.details.length > 0, "expected error details");
    assert.equal(resp.body.error.details[0].field, "total");
  });

  it("accepts record passing field rule with 201", async () => {
    const resp = await request(app, "POST", `/api/${entityName}`, {
      total: 100,
      name: "Good Record",
    });
    assert.equal(resp.status, 201, `expected 201, got ${resp.status}: ${JSON.stringify(resp.body)}`);
  });
});

describe("computed field enforcement", () => {
  let store: Store;
  let registry: Registry;
  let app: express.Express;
  const entityName = "_test_computed_entity";

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

    // Create entity with subtotal, tax_rate, total
    const resp = await request(app, "POST", "/api/_admin/entities", {
      name: entityName,
      table: entityName,
      primary_key: { field: "id", type: "uuid", generated: true },
      fields: [
        { name: "id", type: "uuid" },
        { name: "subtotal", type: "decimal", precision: 2 },
        { name: "tax_rate", type: "decimal", precision: 4 },
        { name: "total", type: "decimal", precision: 2 },
        { name: "name", type: "string", required: true },
      ],
    });
    assert.equal(resp.status, 201, `create entity failed: ${JSON.stringify(resp.body)}`);

    // Add computed rule: total = subtotal * (1 + tax_rate)
    const ruleResp = await request(app, "POST", "/api/_admin/rules", {
      entity: entityName,
      hook: "before_write",
      type: "computed",
      definition: {
        field: "total",
        expression: "record.subtotal * (1 + record.tax_rate)",
      },
      priority: 100,
      active: true,
    });
    assert.equal(ruleResp.status, 201, `create rule failed: ${JSON.stringify(ruleResp.body)}`);
  });

  after(async () => {
    await exec(store.pool, `DELETE FROM _rules WHERE entity = $1`, [entityName]);
    await exec(store.pool, `DROP TABLE IF EXISTS ${entityName}`);
    await exec(store.pool, "DELETE FROM _entities WHERE name = $1", [entityName]);
    await reload(store.pool, registry);
    await store.close();
  });

  it("computes field value from expression", async () => {
    const resp = await request(app, "POST", `/api/${entityName}`, {
      subtotal: 100,
      tax_rate: 0.1,
      name: "Computed Test",
    });
    assert.equal(resp.status, 201, `expected 201, got ${resp.status}: ${JSON.stringify(resp.body)}`);
    assert.ok(resp.body.data.total !== null && resp.body.data.total !== undefined, "expected total to be computed");
  });
});

describe("rules CRUD", () => {
  let store: Store;
  let registry: Registry;
  let app: express.Express;
  const entityName = "_test_rules_entity";
  let ruleID: string;

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

    // Create test entity
    const resp = await request(app, "POST", "/api/_admin/entities", {
      name: entityName,
      table: entityName,
      primary_key: { field: "id", type: "uuid", generated: true },
      fields: [
        { name: "id", type: "uuid" },
        { name: "total", type: "decimal", precision: 2 },
        { name: "name", type: "string", required: true },
      ],
    });
    assert.equal(resp.status, 201, `create entity failed: ${JSON.stringify(resp.body)}`);
  });

  after(async () => {
    await exec(store.pool, `DELETE FROM _rules WHERE entity = $1`, [entityName]);
    await exec(store.pool, `DROP TABLE IF EXISTS ${entityName}`);
    await exec(store.pool, "DELETE FROM _entities WHERE name = $1", [entityName]);
    await reload(store.pool, registry);
    await store.close();
  });

  it("creates a rule", async () => {
    const resp = await request(app, "POST", "/api/_admin/rules", {
      entity: entityName,
      hook: "before_write",
      type: "field",
      definition: { field: "total", operator: "min", value: 0, message: "Total must be non-negative" },
      priority: 10,
    });
    assert.equal(resp.status, 201, `create rule failed: ${JSON.stringify(resp.body)}`);
    ruleID = resp.body.data.id;
    assert.ok(ruleID, "expected rule ID");
  });

  it("lists rules", async () => {
    const resp = await request(app, "GET", "/api/_admin/rules");
    assert.equal(resp.status, 200);
  });

  it("gets rule by ID", async () => {
    const resp = await request(app, "GET", `/api/_admin/rules/${ruleID}`);
    assert.equal(resp.status, 200);
  });

  it("updates a rule", async () => {
    const resp = await request(app, "PUT", `/api/_admin/rules/${ruleID}`, {
      entity: entityName,
      hook: "before_write",
      type: "field",
      definition: { field: "total", operator: "min", value: -100, message: "Total must be at least -100" },
      priority: 20,
    });
    assert.equal(resp.status, 200, `update rule failed: ${JSON.stringify(resp.body)}`);
  });

  it("deletes a rule", async () => {
    const resp = await request(app, "DELETE", `/api/_admin/rules/${ruleID}`);
    assert.equal(resp.status, 200);
  });

  it("returns 404 for deleted rule", async () => {
    const resp = await request(app, "GET", `/api/_admin/rules/${ruleID}`);
    assert.equal(resp.status, 404);
  });
});

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
