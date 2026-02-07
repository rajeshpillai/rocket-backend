import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import express, { type Request, type Response, type NextFunction } from "express";
import { Store, exec } from "../store/postgres.js";
import { bootstrap } from "../store/bootstrap.js";
import { Migrator } from "../store/migrator.js";
import { Registry } from "../metadata/registry.js";
import { loadAll, reload } from "../metadata/loader.js";
import { Handler } from "./handler.js";
import { registerDynamicRoutes } from "./router.js";
import { AdminHandler, registerAdminRoutes } from "../admin/handler.js";
import { WorkflowHandler, registerWorkflowRoutes } from "./workflow-handler.js";
import { AuthHandler, registerAuthRoutes } from "../auth/handler.js";
import { authMiddleware, requireAdmin } from "../auth/middleware.js";
import { errorHandler } from "../middleware/error-handler.js";

const ENTITY_NAME = "_test_unique_users";
const TEST_JWT_SECRET = "test-secret-for-integration-tests";

/** Builds app WITHOUT auth middleware — injects fake admin user for existing tests */
function buildApp(store: Store, registry: Registry): express.Express {
  const app = express();
  app.use(express.json());

  // Inject fake admin user so permission checks pass
  app.use((_req: Request, _res: Response, next: NextFunction) => {
    _req.user = { id: "test-admin", roles: ["admin"] };
    next();
  });

  const migrator = new Migrator(store);
  const adminHandler = new AdminHandler(store, registry, migrator);
  registerAdminRoutes(app, adminHandler);

  const workflowHandler = new WorkflowHandler(store, registry);
  registerWorkflowRoutes(app, workflowHandler);

  const engineHandler = new Handler(store, registry);
  registerDynamicRoutes(app, engineHandler);

  app.use(errorHandler);
  return app;
}

/** Builds app WITH real auth middleware — mirrors index.ts wiring */
function buildAppWithAuth(store: Store, registry: Registry): express.Express {
  const app = express();
  app.use(express.json());

  // Auth routes (no middleware)
  const authHandler = new AuthHandler(store, TEST_JWT_SECRET);
  registerAuthRoutes(app, authHandler);

  const authMW = authMiddleware(TEST_JWT_SECRET);
  const adminMW = requireAdmin();

  const migrator = new Migrator(store);
  const adminHandler = new AdminHandler(store, registry, migrator);
  registerAdminRoutes(app, adminHandler, authMW, adminMW);

  const workflowHandler = new WorkflowHandler(store, registry);
  registerWorkflowRoutes(app, workflowHandler, authMW);

  const engineHandler = new Handler(store, registry);
  registerDynamicRoutes(app, engineHandler, authMW);

  app.use(errorHandler);
  return app;
}

async function request(
  app: express.Express,
  method: string,
  path: string,
  body?: any,
  extraHeaders?: Record<string, string>,
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
          ...(extraHeaders ?? {}),
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

describe("state machine enforcement", () => {
  let store: Store;
  let registry: Registry;
  let app: express.Express;
  const entityName = "_test_sm_entity";

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

    // Create entity with status and total fields
    const resp = await request(app, "POST", "/api/_admin/entities", {
      name: entityName,
      table: entityName,
      primary_key: { field: "id", type: "uuid", generated: true },
      fields: [
        { name: "id", type: "uuid" },
        { name: "status", type: "string" },
        { name: "total", type: "decimal", precision: 2 },
        { name: "sent_at", type: "string" },
        { name: "name", type: "string", required: true },
      ],
    });
    assert.equal(resp.status, 201, `create entity failed: ${JSON.stringify(resp.body)}`);

    // Create state machine: draft → sent (guard: total > 0, action: set sent_at = now), sent → paid
    const smResp = await request(app, "POST", "/api/_admin/state-machines", {
      entity: entityName,
      field: "status",
      definition: {
        initial: "draft",
        transitions: [
          {
            from: "draft",
            to: "sent",
            guard: "record.total > 0",
            actions: [{ type: "set_field", field: "sent_at", value: "now" }],
          },
          { from: "sent", to: "paid" },
        ],
      },
      active: true,
    });
    assert.equal(smResp.status, 201, `create state machine failed: ${JSON.stringify(smResp.body)}`);
  });

  after(async () => {
    await exec(store.pool, `DELETE FROM _state_machines WHERE entity = $1`, [entityName]);
    await exec(store.pool, `DROP TABLE IF EXISTS ${entityName}`);
    await exec(store.pool, "DELETE FROM _entities WHERE name = $1", [entityName]);
    await reload(store.pool, registry);
    await store.close();
  });

  it("allows creating record with valid initial state", async () => {
    const resp = await request(app, "POST", `/api/${entityName}`, {
      status: "draft",
      total: 100,
      name: "Invoice 1",
    });
    assert.equal(resp.status, 201, `expected 201, got ${resp.status}: ${JSON.stringify(resp.body)}`);
  });

  it("rejects creating record with invalid initial state", async () => {
    const resp = await request(app, "POST", `/api/${entityName}`, {
      status: "sent",
      total: 50,
      name: "Invoice Bad",
    });
    assert.equal(resp.status, 422, `expected 422, got ${resp.status}: ${JSON.stringify(resp.body)}`);
  });

  it("allows valid transition with guard passing and executes actions", async () => {
    // Create record
    const createResp = await request(app, "POST", `/api/${entityName}`, {
      status: "draft",
      total: 100,
      name: "Invoice 2",
    });
    assert.equal(createResp.status, 201);
    const id = createResp.body.data.id;

    // Transition draft → sent (total=100 > 0, guard passes)
    const updateResp = await request(app, "PUT", `/api/${entityName}/${id}`, {
      status: "sent",
      total: 100,
    });
    assert.equal(updateResp.status, 200, `expected 200, got ${updateResp.status}: ${JSON.stringify(updateResp.body)}`);

    // sent_at should be populated by set_field action
    assert.ok(updateResp.body.data.sent_at, "expected sent_at to be set by action");
  });

  it("rejects transition when guard fails", async () => {
    // Create record with total=0
    const createResp = await request(app, "POST", `/api/${entityName}`, {
      status: "draft",
      total: 0,
      name: "Invoice 3",
    });
    assert.equal(createResp.status, 201);
    const id = createResp.body.data.id;

    // Transition draft → sent (total=0, guard fails)
    const updateResp = await request(app, "PUT", `/api/${entityName}/${id}`, {
      status: "sent",
      total: 0,
    });
    assert.equal(updateResp.status, 422, `expected 422, got ${updateResp.status}: ${JSON.stringify(updateResp.body)}`);
    assert.equal(updateResp.body.error.code, "VALIDATION_FAILED");
  });

  it("rejects invalid transition", async () => {
    // Create record
    const createResp = await request(app, "POST", `/api/${entityName}`, {
      status: "draft",
      total: 50,
      name: "Invoice 4",
    });
    assert.equal(createResp.status, 201);
    const id = createResp.body.data.id;

    // Attempt direct draft → paid (not allowed)
    const updateResp = await request(app, "PUT", `/api/${entityName}/${id}`, {
      status: "paid",
    });
    assert.equal(updateResp.status, 422, `expected 422, got ${updateResp.status}: ${JSON.stringify(updateResp.body)}`);
    assert.equal(updateResp.body.error.code, "VALIDATION_FAILED");
  });
});

describe("state machine CRUD", () => {
  let store: Store;
  let registry: Registry;
  let app: express.Express;
  const entityName = "_test_sm_crud_entity";
  let smID: string;

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
        { name: "status", type: "string" },
        { name: "name", type: "string", required: true },
      ],
    });
    assert.equal(resp.status, 201, `create entity failed: ${JSON.stringify(resp.body)}`);
  });

  after(async () => {
    await exec(store.pool, `DELETE FROM _state_machines WHERE entity = $1`, [entityName]);
    await exec(store.pool, `DROP TABLE IF EXISTS ${entityName}`);
    await exec(store.pool, "DELETE FROM _entities WHERE name = $1", [entityName]);
    await reload(store.pool, registry);
    await store.close();
  });

  it("creates a state machine", async () => {
    const resp = await request(app, "POST", "/api/_admin/state-machines", {
      entity: entityName,
      field: "status",
      definition: {
        initial: "new",
        transitions: [{ from: "new", to: "active" }],
      },
      active: true,
    });
    assert.equal(resp.status, 201, `create sm failed: ${JSON.stringify(resp.body)}`);
    smID = resp.body.data.id;
    assert.ok(smID, "expected state machine ID");
  });

  it("lists state machines", async () => {
    const resp = await request(app, "GET", "/api/_admin/state-machines");
    assert.equal(resp.status, 200);
  });

  it("gets state machine by ID", async () => {
    const resp = await request(app, "GET", `/api/_admin/state-machines/${smID}`);
    assert.equal(resp.status, 200);
  });

  it("updates a state machine", async () => {
    const resp = await request(app, "PUT", `/api/_admin/state-machines/${smID}`, {
      entity: entityName,
      field: "status",
      definition: {
        initial: "new",
        transitions: [
          { from: "new", to: "active" },
          { from: "active", to: "closed" },
        ],
      },
      active: true,
    });
    assert.equal(resp.status, 200, `update sm failed: ${JSON.stringify(resp.body)}`);
  });

  it("deletes a state machine", async () => {
    const resp = await request(app, "DELETE", `/api/_admin/state-machines/${smID}`);
    assert.equal(resp.status, 200);
  });

  it("returns 404 for deleted state machine", async () => {
    const resp = await request(app, "GET", `/api/_admin/state-machines/${smID}`);
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

// --- Workflow Tests ---

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("workflow CRUD", () => {
  let store: Store;
  let registry: Registry;
  let app: express.Express;
  let workflowID: string;

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
  });

  after(async () => {
    if (workflowID) {
      await exec(store.pool, "DELETE FROM _workflows WHERE id = $1", [workflowID]);
    }
    await reload(store.pool, registry);
    await store.close();
  });

  it("creates a workflow", async () => {
    const resp = await request(app, "POST", "/api/_admin/workflows", {
      name: "_test_wf_crud",
      trigger: { type: "state_change", entity: "orders", field: "status", to: "approved" },
      context: { record_id: "trigger.record_id" },
      steps: [
        { id: "step1", type: "action", actions: [], then: "end" },
      ],
      active: true,
    });
    assert.equal(resp.status, 201, `create workflow failed: ${JSON.stringify(resp.body)}`);
    workflowID = resp.body.data.id;
    assert.ok(workflowID, "expected workflow ID");
  });

  it("lists workflows", async () => {
    const resp = await request(app, "GET", "/api/_admin/workflows");
    assert.equal(resp.status, 200);
    assert.ok(resp.body.data.length > 0, "expected at least one workflow");
  });

  it("gets workflow by ID", async () => {
    const resp = await request(app, "GET", `/api/_admin/workflows/${workflowID}`);
    assert.equal(resp.status, 200);
    assert.equal(resp.body.data.name, "_test_wf_crud");
  });

  it("updates a workflow", async () => {
    const resp = await request(app, "PUT", `/api/_admin/workflows/${workflowID}`, {
      name: "_test_wf_crud_updated",
      trigger: { type: "state_change", entity: "orders", field: "status", to: "shipped" },
      context: {},
      steps: [
        { id: "step1", type: "action", actions: [], then: "end" },
        { id: "step2", type: "condition", expression: "true", on_true: "end", on_false: "end" },
      ],
      active: true,
    });
    assert.equal(resp.status, 200, `update workflow failed: ${JSON.stringify(resp.body)}`);
  });

  it("deletes a workflow", async () => {
    const resp = await request(app, "DELETE", `/api/_admin/workflows/${workflowID}`);
    assert.equal(resp.status, 200);
    workflowID = ""; // prevent double delete in after()
  });

  it("returns 404 for deleted workflow", async () => {
    const resp = await request(app, "GET", "/api/_admin/workflows/00000000-0000-0000-0000-000000000000");
    assert.equal(resp.status, 404);
  });
});

describe("workflow trigger and execution", () => {
  let store: Store;
  let registry: Registry;
  let app: express.Express;
  const entityName = "_test_wf_trigger_entity";

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

    // Create entity
    const entityResp = await request(app, "POST", "/api/_admin/entities", {
      name: entityName,
      table: entityName,
      primary_key: { field: "id", type: "uuid", generated: true },
      fields: [
        { name: "id", type: "uuid" },
        { name: "status", type: "string" },
        { name: "amount", type: "decimal", precision: 2 },
        { name: "approved_at", type: "string" },
        { name: "name", type: "string", required: true },
      ],
    });
    assert.equal(entityResp.status, 201, `create entity failed: ${JSON.stringify(entityResp.body)}`);

    // Create state machine
    const smResp = await request(app, "POST", "/api/_admin/state-machines", {
      entity: entityName,
      field: "status",
      definition: {
        initial: "draft",
        transitions: [
          { from: "draft", to: "approved" },
          { from: "approved", to: "completed" },
        ],
      },
      active: true,
    });
    assert.equal(smResp.status, 201, `create SM failed: ${JSON.stringify(smResp.body)}`);

    // Create workflow triggered by status → approved
    const wfResp = await request(app, "POST", "/api/_admin/workflows", {
      name: "_test_wf_trigger",
      trigger: { type: "state_change", entity: entityName, field: "status", to: "approved" },
      context: { record_id: "trigger.record_id", amount: "trigger.record.amount" },
      steps: [
        {
          id: "set_approved_at",
          type: "action",
          actions: [
            { type: "set_field", entity: entityName, record_id: "context.record_id", field: "approved_at", value: "now" },
          ],
          then: "end",
        },
      ],
      active: true,
    });
    assert.equal(wfResp.status, 201, `create workflow failed: ${JSON.stringify(wfResp.body)}`);
  });

  after(async () => {
    await exec(store.pool, `DELETE FROM _workflow_instances WHERE workflow_name = '_test_wf_trigger'`);
    await exec(store.pool, `DELETE FROM _workflows WHERE name = '_test_wf_trigger'`);
    await exec(store.pool, `DELETE FROM _state_machines WHERE entity = $1`, [entityName]);
    await exec(store.pool, `DROP TABLE IF EXISTS ${entityName}`);
    await exec(store.pool, "DELETE FROM _entities WHERE name = $1", [entityName]);
    await reload(store.pool, registry);
    await store.close();
  });

  it("triggers workflow on state transition and executes action", async () => {
    // Create record
    const createResp = await request(app, "POST", `/api/${entityName}`, {
      status: "draft",
      amount: 500,
      name: "Test Order",
    });
    assert.equal(createResp.status, 201, `create record failed: ${JSON.stringify(createResp.body)}`);
    const id = createResp.body.data.id;

    // Transition draft → approved (triggers workflow)
    const updateResp = await request(app, "PUT", `/api/${entityName}/${id}`, {
      status: "approved",
    });
    assert.equal(updateResp.status, 200, `update record failed: ${JSON.stringify(updateResp.body)}`);

    // Wait briefly for async workflow to complete
    await sleep(200);

    // Verify approved_at was set by workflow action
    const getResp = await request(app, "GET", `/api/${entityName}/${id}`);
    assert.equal(getResp.status, 200);
    assert.ok(getResp.body.data.approved_at, "expected approved_at to be set by workflow");
  });
});

describe("workflow approval flow", () => {
  let store: Store;
  let registry: Registry;
  let app: express.Express;
  const entityName = "_test_wf_approval_entity";

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

    // Create entity
    const entityResp = await request(app, "POST", "/api/_admin/entities", {
      name: entityName,
      table: entityName,
      primary_key: { field: "id", type: "uuid", generated: true },
      fields: [
        { name: "id", type: "uuid" },
        { name: "status", type: "string" },
        { name: "amount", type: "decimal", precision: 2 },
        { name: "approved_at", type: "string" },
        { name: "name", type: "string", required: true },
      ],
    });
    assert.equal(entityResp.status, 201);

    // Create state machine
    const smResp = await request(app, "POST", "/api/_admin/state-machines", {
      entity: entityName,
      field: "status",
      definition: {
        initial: "draft",
        transitions: [
          { from: "draft", to: "submitted" },
          { from: "submitted", to: "completed" },
        ],
      },
      active: true,
    });
    assert.equal(smResp.status, 201);

    // Create workflow: submitted → approval step → action step
    const wfResp = await request(app, "POST", "/api/_admin/workflows", {
      name: "_test_wf_approval",
      trigger: { type: "state_change", entity: entityName, field: "status", to: "submitted" },
      context: { record_id: "trigger.record_id" },
      steps: [
        {
          id: "approval",
          type: "approval",
          assignee: { type: "role", role: "manager" },
          timeout: "72h",
          on_approve: { goto: "mark_approved" },
          on_reject: "end",
        },
        {
          id: "mark_approved",
          type: "action",
          actions: [
            { type: "set_field", entity: entityName, record_id: "context.record_id", field: "approved_at", value: "now" },
          ],
          then: "end",
        },
      ],
      active: true,
    });
    assert.equal(wfResp.status, 201, `create workflow failed: ${JSON.stringify(wfResp.body)}`);
  });

  after(async () => {
    await exec(store.pool, `DELETE FROM _workflow_instances WHERE workflow_name = '_test_wf_approval'`);
    await exec(store.pool, `DELETE FROM _workflows WHERE name = '_test_wf_approval'`);
    await exec(store.pool, `DELETE FROM _state_machines WHERE entity = $1`, [entityName]);
    await exec(store.pool, `DROP TABLE IF EXISTS ${entityName}`);
    await exec(store.pool, "DELETE FROM _entities WHERE name = $1", [entityName]);
    await reload(store.pool, registry);
    await store.close();
  });

  it("pauses at approval step and resumes on approve", async () => {
    // Create + transition to submitted
    const createResp = await request(app, "POST", `/api/${entityName}`, {
      status: "draft",
      amount: 1000,
      name: "Approval Test",
    });
    assert.equal(createResp.status, 201);
    const recordID = createResp.body.data.id;

    const updateResp = await request(app, "PUT", `/api/${entityName}/${recordID}`, {
      status: "submitted",
    });
    assert.equal(updateResp.status, 200);

    await sleep(200);

    // Check pending instances
    const pendingResp = await request(app, "GET", "/api/_workflows/pending");
    assert.equal(pendingResp.status, 200);
    const pending = pendingResp.body.data.filter((i: any) => i.workflow_name === "_test_wf_approval");
    assert.ok(pending.length > 0, "expected pending workflow instance");
    const instanceID = pending[0].id;

    // Approve
    const approveResp = await request(app, "POST", `/api/_workflows/${instanceID}/approve`, undefined, {
      "X-User-ID": "manager1",
    });
    assert.equal(approveResp.status, 200, `approve failed: ${JSON.stringify(approveResp.body)}`);
    assert.equal(approveResp.body.data.status, "completed");

    // Verify approved_at was set
    const getResp = await request(app, "GET", `/api/${entityName}/${recordID}`);
    assert.equal(getResp.status, 200);
    assert.ok(getResp.body.data.approved_at, "expected approved_at to be set after approval");
  });
});

describe("workflow rejection", () => {
  let store: Store;
  let registry: Registry;
  let app: express.Express;
  const entityName = "_test_wf_reject_entity";

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

    const entityResp = await request(app, "POST", "/api/_admin/entities", {
      name: entityName,
      table: entityName,
      primary_key: { field: "id", type: "uuid", generated: true },
      fields: [
        { name: "id", type: "uuid" },
        { name: "status", type: "string" },
        { name: "amount", type: "decimal", precision: 2 },
        { name: "name", type: "string", required: true },
      ],
    });
    assert.equal(entityResp.status, 201);

    const smResp = await request(app, "POST", "/api/_admin/state-machines", {
      entity: entityName,
      field: "status",
      definition: {
        initial: "draft",
        transitions: [{ from: "draft", to: "submitted" }],
      },
      active: true,
    });
    assert.equal(smResp.status, 201);

    const wfResp = await request(app, "POST", "/api/_admin/workflows", {
      name: "_test_wf_reject",
      trigger: { type: "state_change", entity: entityName, field: "status", to: "submitted" },
      context: { record_id: "trigger.record_id" },
      steps: [
        {
          id: "approval",
          type: "approval",
          on_approve: "end",
          on_reject: "end",
        },
      ],
      active: true,
    });
    assert.equal(wfResp.status, 201);
  });

  after(async () => {
    await exec(store.pool, `DELETE FROM _workflow_instances WHERE workflow_name = '_test_wf_reject'`);
    await exec(store.pool, `DELETE FROM _workflows WHERE name = '_test_wf_reject'`);
    await exec(store.pool, `DELETE FROM _state_machines WHERE entity = $1`, [entityName]);
    await exec(store.pool, `DROP TABLE IF EXISTS ${entityName}`);
    await exec(store.pool, "DELETE FROM _entities WHERE name = $1", [entityName]);
    await reload(store.pool, registry);
    await store.close();
  });

  it("completes workflow on rejection via on_reject path", async () => {
    const createResp = await request(app, "POST", `/api/${entityName}`, {
      status: "draft",
      amount: 100,
      name: "Reject Test",
    });
    assert.equal(createResp.status, 201);
    const recordID = createResp.body.data.id;

    await request(app, "PUT", `/api/${entityName}/${recordID}`, { status: "submitted" });
    await sleep(200);

    const pendingResp = await request(app, "GET", "/api/_workflows/pending");
    const pending = pendingResp.body.data.filter((i: any) => i.workflow_name === "_test_wf_reject");
    assert.ok(pending.length > 0, "expected pending instance");
    const instanceID = pending[0].id;

    const rejectResp = await request(app, "POST", `/api/_workflows/${instanceID}/reject`, undefined, {
      "X-User-ID": "admin1",
    });
    assert.equal(rejectResp.status, 200);
    assert.equal(rejectResp.body.data.status, "completed");

    // Check history includes rejection
    const getResp = await request(app, "GET", `/api/_workflows/${instanceID}`);
    assert.equal(getResp.status, 200);
    const history = getResp.body.data.history;
    assert.ok(history.some((h: any) => h.status === "rejected"), "expected rejected entry in history");
  });
});

describe("workflow condition branching", () => {
  let store: Store;
  let registry: Registry;
  let app: express.Express;
  const entityName = "_test_wf_condition_entity";

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

    const entityResp = await request(app, "POST", "/api/_admin/entities", {
      name: entityName,
      table: entityName,
      primary_key: { field: "id", type: "uuid", generated: true },
      fields: [
        { name: "id", type: "uuid" },
        { name: "status", type: "string" },
        { name: "amount", type: "decimal", precision: 2 },
        { name: "approved_at", type: "string" },
        { name: "name", type: "string", required: true },
      ],
    });
    assert.equal(entityResp.status, 201);

    const smResp = await request(app, "POST", "/api/_admin/state-machines", {
      entity: entityName,
      field: "status",
      definition: {
        initial: "draft",
        transitions: [{ from: "draft", to: "submitted" }],
      },
      active: true,
    });
    assert.equal(smResp.status, 201);

    // Workflow: condition checks amount < 1000 → auto-approve, else → manual approval
    const wfResp = await request(app, "POST", "/api/_admin/workflows", {
      name: "_test_wf_condition",
      trigger: { type: "state_change", entity: entityName, field: "status", to: "submitted" },
      context: { record_id: "trigger.record_id", amount: "trigger.record.amount" },
      steps: [
        {
          id: "check_amount",
          type: "condition",
          expression: "context.amount < 1000",
          on_true: { goto: "auto_approve" },
          on_false: { goto: "manual_approval" },
        },
        {
          id: "auto_approve",
          type: "action",
          actions: [
            { type: "set_field", entity: entityName, record_id: "context.record_id", field: "approved_at", value: "now" },
          ],
          then: "end",
        },
        {
          id: "manual_approval",
          type: "approval",
          on_approve: "end",
          on_reject: "end",
        },
      ],
      active: true,
    });
    assert.equal(wfResp.status, 201, `create workflow failed: ${JSON.stringify(wfResp.body)}`);
  });

  after(async () => {
    await exec(store.pool, `DELETE FROM _workflow_instances WHERE workflow_name = '_test_wf_condition'`);
    await exec(store.pool, `DELETE FROM _workflows WHERE name = '_test_wf_condition'`);
    await exec(store.pool, `DELETE FROM _state_machines WHERE entity = $1`, [entityName]);
    await exec(store.pool, `DROP TABLE IF EXISTS ${entityName}`);
    await exec(store.pool, "DELETE FROM _entities WHERE name = $1", [entityName]);
    await reload(store.pool, registry);
    await store.close();
  });

  it("auto-approves small amounts via condition branch", async () => {
    const createResp = await request(app, "POST", `/api/${entityName}`, {
      status: "draft",
      amount: 500,
      name: "Small Order",
    });
    assert.equal(createResp.status, 201);
    const id = createResp.body.data.id;

    await request(app, "PUT", `/api/${entityName}/${id}`, { status: "submitted" });
    await sleep(200);

    // Verify auto-approved (approved_at set, no pending instance)
    const getResp = await request(app, "GET", `/api/${entityName}/${id}`);
    assert.equal(getResp.status, 200);
    assert.ok(getResp.body.data.approved_at, "expected approved_at to be set for small amount");
  });

  it("requires manual approval for large amounts via condition branch", async () => {
    const createResp = await request(app, "POST", `/api/${entityName}`, {
      status: "draft",
      amount: 5000,
      name: "Large Order",
    });
    assert.equal(createResp.status, 201);
    const id = createResp.body.data.id;

    await request(app, "PUT", `/api/${entityName}/${id}`, { status: "submitted" });
    await sleep(200);

    // Should be paused at manual_approval step
    const pendingResp = await request(app, "GET", "/api/_workflows/pending");
    const pending = pendingResp.body.data.filter(
      (i: any) => i.workflow_name === "_test_wf_condition" && i.current_step === "manual_approval",
    );
    assert.ok(pending.length > 0, "expected pending approval for large amount");
  });
});

// --- Auth Test Helpers ---

async function authRequest(
  app: express.Express,
  method: string,
  path: string,
  token?: string,
  body?: any,
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return request(app, method, path, body, headers);
}

async function loginAs(
  app: express.Express,
  email: string,
  password: string,
): Promise<string> {
  const resp = await request(app, "POST", "/api/auth/login", { email, password });
  if (resp.status !== 200) {
    throw new Error(`login failed (${resp.status}): ${JSON.stringify(resp.body)}`);
  }
  return resp.body.data.access_token;
}

async function loginAsWithRefresh(
  app: express.Express,
  email: string,
  password: string,
): Promise<{ access_token: string; refresh_token: string }> {
  const resp = await request(app, "POST", "/api/auth/login", { email, password });
  if (resp.status !== 200) {
    throw new Error(`login failed (${resp.status}): ${JSON.stringify(resp.body)}`);
  }
  return resp.body.data;
}

async function createTestUser(
  app: express.Express,
  adminToken: string,
  email: string,
  password: string,
  roles: string[],
): Promise<string> {
  const resp = await authRequest(app, "POST", "/api/_admin/users", adminToken, {
    email,
    password,
    roles,
    active: true,
  });
  if (resp.status !== 201) {
    throw new Error(`create user failed (${resp.status}): ${JSON.stringify(resp.body)}`);
  }
  return resp.body.data.id;
}

// --- Auth Integration Tests ---

describe("auth login/refresh/logout flow", () => {
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
    app = buildAppWithAuth(store, registry);
  });

  after(async () => {
    await store.close();
  });

  it("login with seed admin, refresh, and logout", async () => {
    // Login
    const tokens = await loginAsWithRefresh(app, "admin@localhost", "changeme");
    assert.ok(tokens.access_token, "expected access token");
    assert.ok(tokens.refresh_token, "expected refresh token");

    // Refresh
    const refreshResp = await request(app, "POST", "/api/auth/refresh", {
      refresh_token: tokens.refresh_token,
    });
    assert.equal(refreshResp.status, 200, `refresh failed: ${JSON.stringify(refreshResp.body)}`);
    const newTokens = refreshResp.body.data;
    assert.ok(newTokens.access_token, "expected new access token");
    assert.ok(newTokens.refresh_token, "expected new refresh token");

    // Old refresh token should be invalid (rotation)
    const oldRefreshResp = await request(app, "POST", "/api/auth/refresh", {
      refresh_token: tokens.refresh_token,
    });
    assert.equal(oldRefreshResp.status, 401, "old refresh token should be rejected");

    // Logout
    const logoutResp = await request(app, "POST", "/api/auth/logout", {
      refresh_token: newTokens.refresh_token,
    });
    assert.equal(logoutResp.status, 200);

    // Refresh after logout should fail
    const postLogoutResp = await request(app, "POST", "/api/auth/refresh", {
      refresh_token: newTokens.refresh_token,
    });
    assert.equal(postLogoutResp.status, 401);
  });
});

describe("auth login invalid credentials", () => {
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
    app = buildAppWithAuth(store, registry);
  });

  after(async () => {
    await store.close();
  });

  it("rejects wrong password", async () => {
    const resp = await request(app, "POST", "/api/auth/login", {
      email: "admin@localhost",
      password: "wrongpassword",
    });
    assert.equal(resp.status, 401);
  });

  it("rejects non-existent email", async () => {
    const resp = await request(app, "POST", "/api/auth/login", {
      email: "nobody@example.com",
      password: "anything",
    });
    assert.equal(resp.status, 401);
  });

  it("rejects missing fields", async () => {
    const resp1 = await request(app, "POST", "/api/auth/login", { email: "admin@localhost" });
    assert.equal(resp1.status, 401);

    const resp2 = await request(app, "POST", "/api/auth/login", { password: "changeme" });
    assert.equal(resp2.status, 401);
  });
});

describe("middleware rejects missing/invalid token", () => {
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
    app = buildAppWithAuth(store, registry);
  });

  after(async () => {
    await store.close();
  });

  it("returns 401 for missing token on protected route", async () => {
    const resp = await request(app, "GET", "/api/_test_entity");
    assert.equal(resp.status, 401);
  });

  it("returns 401 for invalid token on protected route", async () => {
    const resp = await authRequest(app, "GET", "/api/_test_entity", "invalid-token");
    assert.equal(resp.status, 401);
  });

  it("auth routes are accessible without token", async () => {
    const resp = await request(app, "POST", "/api/auth/login", {
      email: "admin@localhost",
      password: "changeme",
    });
    assert.equal(resp.status, 200);
  });
});

describe("admin role bypass", () => {
  let store: Store;
  let registry: Registry;
  let app: express.Express;
  const entityName = "_test_auth_admin_bypass";

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
    app = buildAppWithAuth(store, registry);

    // Login as admin and create test entity
    const token = await loginAs(app, "admin@localhost", "changeme");
    const resp = await authRequest(app, "POST", "/api/_admin/entities", token, {
      name: entityName,
      table: entityName,
      primary_key: { field: "id", type: "uuid", generated: true },
      fields: [
        { name: "id", type: "uuid" },
        { name: "name", type: "string", required: true },
      ],
    });
    assert.equal(resp.status, 201, `create entity failed: ${JSON.stringify(resp.body)}`);
  });

  after(async () => {
    await exec(store.pool, `DROP TABLE IF EXISTS ${entityName}`);
    await exec(store.pool, "DELETE FROM _entities WHERE name = $1", [entityName]);
    await reload(store.pool, registry);
    await store.close();
  });

  it("admin can CRUD without any permission rows", async () => {
    const token = await loginAs(app, "admin@localhost", "changeme");

    // Create
    const createResp = await authRequest(app, "POST", `/api/${entityName}`, token, {
      name: "Admin Test",
    });
    assert.equal(createResp.status, 201, `create failed: ${JSON.stringify(createResp.body)}`);
    const id = createResp.body.data.id;

    // Read
    const getResp = await authRequest(app, "GET", `/api/${entityName}/${id}`, token);
    assert.equal(getResp.status, 200);

    // List
    const listResp = await authRequest(app, "GET", `/api/${entityName}`, token);
    assert.equal(listResp.status, 200);

    // Update
    const updateResp = await authRequest(app, "PUT", `/api/${entityName}/${id}`, token, {
      name: "Updated",
    });
    assert.equal(updateResp.status, 200);

    // Delete
    const deleteResp = await authRequest(app, "DELETE", `/api/${entityName}/${id}`, token);
    assert.equal(deleteResp.status, 200);
  });
});

describe("permission grants and denies access", () => {
  let store: Store;
  let registry: Registry;
  let app: express.Express;
  const entityName = "_test_auth_perms";

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
    app = buildAppWithAuth(store, registry);

    const adminToken = await loginAs(app, "admin@localhost", "changeme");

    // Create entity
    const entityResp = await authRequest(app, "POST", "/api/_admin/entities", adminToken, {
      name: entityName,
      table: entityName,
      primary_key: { field: "id", type: "uuid", generated: true },
      fields: [
        { name: "id", type: "uuid" },
        { name: "name", type: "string", required: true },
      ],
    });
    assert.equal(entityResp.status, 201);

    // Create viewer user
    await createTestUser(app, adminToken, "viewer@test.com", "viewerpass", ["viewer"]);

    // Grant viewer read + create on this entity
    await authRequest(app, "POST", "/api/_admin/permissions", adminToken, {
      entity: entityName,
      action: "read",
      roles: ["viewer"],
    });
    await authRequest(app, "POST", "/api/_admin/permissions", adminToken, {
      entity: entityName,
      action: "create",
      roles: ["viewer"],
    });
  });

  after(async () => {
    await exec(store.pool, `DELETE FROM _permissions WHERE entity = $1`, [entityName]);
    await exec(store.pool, "DELETE FROM _users WHERE email = 'viewer@test.com'");
    await exec(store.pool, `DROP TABLE IF EXISTS ${entityName}`);
    await exec(store.pool, "DELETE FROM _entities WHERE name = $1", [entityName]);
    await reload(store.pool, registry);
    await store.close();
  });

  it("viewer can read and create but not update or delete", async () => {
    const viewerToken = await loginAs(app, "viewer@test.com", "viewerpass");

    // Create (allowed)
    const createResp = await authRequest(app, "POST", `/api/${entityName}`, viewerToken, {
      name: "Viewer Created",
    });
    assert.equal(createResp.status, 201, `create should be allowed: ${JSON.stringify(createResp.body)}`);
    const id = createResp.body.data.id;

    // Read (allowed)
    const getResp = await authRequest(app, "GET", `/api/${entityName}/${id}`, viewerToken);
    assert.equal(getResp.status, 200);

    // List (allowed)
    const listResp = await authRequest(app, "GET", `/api/${entityName}`, viewerToken);
    assert.equal(listResp.status, 200);

    // Update (denied — no update permission)
    const updateResp = await authRequest(app, "PUT", `/api/${entityName}/${id}`, viewerToken, {
      name: "Modified",
    });
    assert.equal(updateResp.status, 403, `update should be denied: ${JSON.stringify(updateResp.body)}`);

    // Delete (denied — no delete permission)
    const deleteResp = await authRequest(app, "DELETE", `/api/${entityName}/${id}`, viewerToken);
    assert.equal(deleteResp.status, 403, `delete should be denied: ${JSON.stringify(deleteResp.body)}`);
  });

  it("non-admin cannot access admin routes", async () => {
    const viewerToken = await loginAs(app, "viewer@test.com", "viewerpass");

    const resp = await authRequest(app, "GET", "/api/_admin/entities", viewerToken);
    assert.equal(resp.status, 403, `non-admin should be denied admin routes: ${JSON.stringify(resp.body)}`);
  });
});

describe("row-level filtering", () => {
  let store: Store;
  let registry: Registry;
  let app: express.Express;
  const entityName = "_test_auth_row_filter";

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
    app = buildAppWithAuth(store, registry);

    const adminToken = await loginAs(app, "admin@localhost", "changeme");

    // Create entity with department field
    await authRequest(app, "POST", "/api/_admin/entities", adminToken, {
      name: entityName,
      table: entityName,
      primary_key: { field: "id", type: "uuid", generated: true },
      fields: [
        { name: "id", type: "uuid" },
        { name: "name", type: "string", required: true },
        { name: "department", type: "string" },
      ],
    });

    // Create sales_rep user
    await createTestUser(app, adminToken, "salesrep@test.com", "salespass", ["sales_rep"]);

    // Grant sales_rep read on this entity with condition: department = 'sales'
    await authRequest(app, "POST", "/api/_admin/permissions", adminToken, {
      entity: entityName,
      action: "read",
      roles: ["sales_rep"],
      conditions: [{ field: "department", operator: "eq", value: "sales" }],
    });

    // Create records as admin
    await authRequest(app, "POST", `/api/${entityName}`, adminToken, {
      name: "Sales Deal",
      department: "sales",
    });
    await authRequest(app, "POST", `/api/${entityName}`, adminToken, {
      name: "Engineering Task",
      department: "engineering",
    });
    await authRequest(app, "POST", `/api/${entityName}`, adminToken, {
      name: "Another Sales Deal",
      department: "sales",
    });
  });

  after(async () => {
    await exec(store.pool, `DELETE FROM _permissions WHERE entity = $1`, [entityName]);
    await exec(store.pool, "DELETE FROM _users WHERE email = 'salesrep@test.com'");
    await exec(store.pool, `DROP TABLE IF EXISTS ${entityName}`);
    await exec(store.pool, "DELETE FROM _entities WHERE name = $1", [entityName]);
    await reload(store.pool, registry);
    await store.close();
  });

  it("sales_rep only sees sales department records", async () => {
    const salesToken = await loginAs(app, "salesrep@test.com", "salespass");

    const listResp = await authRequest(app, "GET", `/api/${entityName}`, salesToken);
    assert.equal(listResp.status, 200, `list failed: ${JSON.stringify(listResp.body)}`);

    const records = listResp.body.data;
    assert.ok(records.length >= 2, `expected at least 2 sales records, got ${records.length}`);

    // All returned records should be from sales department
    for (const r of records) {
      assert.equal(r.department, "sales", `expected sales department, got ${r.department}`);
    }
  });
});

describe("write permission with conditions", () => {
  let store: Store;
  let registry: Registry;
  let app: express.Express;
  const entityName = "_test_auth_write_cond";

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
    app = buildAppWithAuth(store, registry);

    const adminToken = await loginAs(app, "admin@localhost", "changeme");

    // Create entity with status field
    await authRequest(app, "POST", "/api/_admin/entities", adminToken, {
      name: entityName,
      table: entityName,
      primary_key: { field: "id", type: "uuid", generated: true },
      fields: [
        { name: "id", type: "uuid" },
        { name: "title", type: "string", required: true },
        { name: "status", type: "string" },
      ],
    });

    // Create editor user
    await createTestUser(app, adminToken, "editor@test.com", "editorpass", ["editor"]);

    // Grant editor read (unconditional)
    await authRequest(app, "POST", "/api/_admin/permissions", adminToken, {
      entity: entityName,
      action: "read",
      roles: ["editor"],
    });

    // Grant editor update only when status = 'draft'
    await authRequest(app, "POST", "/api/_admin/permissions", adminToken, {
      entity: entityName,
      action: "update",
      roles: ["editor"],
      conditions: [{ field: "status", operator: "eq", value: "draft" }],
    });

    // Create records as admin
    await authRequest(app, "POST", `/api/${entityName}`, adminToken, {
      title: "Draft Article",
      status: "draft",
    });
    await authRequest(app, "POST", `/api/${entityName}`, adminToken, {
      title: "Published Article",
      status: "published",
    });
  });

  after(async () => {
    await exec(store.pool, `DELETE FROM _permissions WHERE entity = $1`, [entityName]);
    await exec(store.pool, "DELETE FROM _users WHERE email = 'editor@test.com'");
    await exec(store.pool, `DROP TABLE IF EXISTS ${entityName}`);
    await exec(store.pool, "DELETE FROM _entities WHERE name = $1", [entityName]);
    await reload(store.pool, registry);
    await store.close();
  });

  it("editor can update draft but not published", async () => {
    const editorToken = await loginAs(app, "editor@test.com", "editorpass");

    // List all records to find IDs
    const listResp = await authRequest(app, "GET", `/api/${entityName}`, editorToken);
    assert.equal(listResp.status, 200);
    const records = listResp.body.data;

    const draftRecord = records.find((r: any) => r.status === "draft");
    const publishedRecord = records.find((r: any) => r.status === "published");
    assert.ok(draftRecord, "expected draft record");
    assert.ok(publishedRecord, "expected published record");

    // Update draft (allowed)
    const updateDraftResp = await authRequest(
      app, "PUT", `/api/${entityName}/${draftRecord.id}`, editorToken,
      { title: "Updated Draft" },
    );
    assert.equal(updateDraftResp.status, 200, `update draft should be allowed: ${JSON.stringify(updateDraftResp.body)}`);

    // Update published (denied)
    const updatePubResp = await authRequest(
      app, "PUT", `/api/${entityName}/${publishedRecord.id}`, editorToken,
      { title: "Updated Published" },
    );
    assert.equal(updatePubResp.status, 403, `update published should be denied: ${JSON.stringify(updatePubResp.body)}`);
  });
});

describe("user CRUD", () => {
  let store: Store;
  let registry: Registry;
  let app: express.Express;
  let testUserID: string;

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
    app = buildAppWithAuth(store, registry);
  });

  after(async () => {
    await exec(store.pool, "DELETE FROM _users WHERE email IN ('newuser@test.com', 'updated@test.com')");
    await store.close();
  });

  it("creates, lists, gets, updates, and deletes a user", async () => {
    const adminToken = await loginAs(app, "admin@localhost", "changeme");

    // Create
    const createResp = await authRequest(app, "POST", "/api/_admin/users", adminToken, {
      email: "newuser@test.com",
      password: "newpass",
      roles: ["viewer"],
      active: true,
    });
    assert.equal(createResp.status, 201, `create user failed: ${JSON.stringify(createResp.body)}`);
    testUserID = createResp.body.data.id;
    assert.ok(testUserID, "expected user ID");

    // Password hash should never be returned
    assert.equal(createResp.body.data.password_hash, undefined, "password_hash should not be returned");

    // List
    const listResp = await authRequest(app, "GET", "/api/_admin/users", adminToken);
    assert.equal(listResp.status, 200);
    assert.ok(listResp.body.data.length >= 2, "expected at least 2 users");

    // Get
    const getResp = await authRequest(app, "GET", `/api/_admin/users/${testUserID}`, adminToken);
    assert.equal(getResp.status, 200);
    assert.equal(getResp.body.data.email, "newuser@test.com");
    assert.equal(getResp.body.data.password_hash, undefined, "password_hash should not be returned");

    // Login with new user
    const token = await loginAs(app, "newuser@test.com", "newpass");
    assert.ok(token, "expected token for new user");

    // Update email
    const updateResp = await authRequest(app, "PUT", `/api/_admin/users/${testUserID}`, adminToken, {
      email: "updated@test.com",
      roles: ["viewer", "editor"],
      active: true,
    });
    assert.equal(updateResp.status, 200, `update user failed: ${JSON.stringify(updateResp.body)}`);

    // Login with updated email (same password)
    const token2 = await loginAs(app, "updated@test.com", "newpass");
    assert.ok(token2, "expected token after email update");

    // Update password
    const passResp = await authRequest(app, "PUT", `/api/_admin/users/${testUserID}`, adminToken, {
      email: "updated@test.com",
      password: "brandnewpass",
      roles: ["viewer", "editor"],
      active: true,
    });
    assert.equal(passResp.status, 200, `update password failed: ${JSON.stringify(passResp.body)}`);

    // Login with new password
    const token3 = await loginAs(app, "updated@test.com", "brandnewpass");
    assert.ok(token3, "expected token after password update");

    // Delete
    const deleteResp = await authRequest(app, "DELETE", `/api/_admin/users/${testUserID}`, adminToken);
    assert.equal(deleteResp.status, 200);

    // Get deleted user — 404
    const getDeletedResp = await authRequest(app, "GET", `/api/_admin/users/${testUserID}`, adminToken);
    assert.equal(getDeletedResp.status, 404);
  });
});

describe("permission CRUD", () => {
  let store: Store;
  let registry: Registry;
  let app: express.Express;
  let permID: string;

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
    app = buildAppWithAuth(store, registry);
  });

  after(async () => {
    await exec(store.pool, "DELETE FROM _permissions WHERE entity = '_test_perm_crud_entity'");
    await store.close();
  });

  it("creates, lists, gets, updates, and deletes a permission", async () => {
    const adminToken = await loginAs(app, "admin@localhost", "changeme");

    // Create
    const createResp = await authRequest(app, "POST", "/api/_admin/permissions", adminToken, {
      entity: "_test_perm_crud_entity",
      action: "read",
      roles: ["viewer"],
      conditions: [{ field: "status", operator: "eq", value: "active" }],
    });
    assert.equal(createResp.status, 201, `create permission failed: ${JSON.stringify(createResp.body)}`);
    permID = createResp.body.data.id;
    assert.ok(permID, "expected permission ID");

    // List
    const listResp = await authRequest(app, "GET", "/api/_admin/permissions", adminToken);
    assert.equal(listResp.status, 200);

    // Get
    const getResp = await authRequest(app, "GET", `/api/_admin/permissions/${permID}`, adminToken);
    assert.equal(getResp.status, 200);

    // Update
    const updateResp = await authRequest(app, "PUT", `/api/_admin/permissions/${permID}`, adminToken, {
      entity: "_test_perm_crud_entity",
      action: "create",
      roles: ["viewer", "editor"],
    });
    assert.equal(updateResp.status, 200, `update permission failed: ${JSON.stringify(updateResp.body)}`);

    // Delete
    const deleteResp = await authRequest(app, "DELETE", `/api/_admin/permissions/${permID}`, adminToken);
    assert.equal(deleteResp.status, 200);

    // Get deleted — 404
    const getDeletedResp = await authRequest(app, "GET", `/api/_admin/permissions/${permID}`, adminToken);
    assert.equal(getDeletedResp.status, 404);
  });
});

describe("disabled user cannot login", () => {
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
    app = buildAppWithAuth(store, registry);

    const adminToken = await loginAs(app, "admin@localhost", "changeme");

    // Create user then disable
    const userID = await createTestUser(app, adminToken, "disabled@test.com", "disabledpass", ["viewer"]);
    await authRequest(app, "PUT", `/api/_admin/users/${userID}`, adminToken, {
      email: "disabled@test.com",
      roles: ["viewer"],
      active: false,
    });
  });

  after(async () => {
    await exec(store.pool, "DELETE FROM _users WHERE email = 'disabled@test.com'");
    await store.close();
  });

  it("returns 401 for disabled user", async () => {
    const resp = await request(app, "POST", "/api/auth/login", {
      email: "disabled@test.com",
      password: "disabledpass",
    });
    assert.equal(resp.status, 401, `expected 401 for disabled user, got ${resp.status}: ${JSON.stringify(resp.body)}`);
  });
});
