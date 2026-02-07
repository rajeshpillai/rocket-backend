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
import { WorkflowHandler, registerWorkflowRoutes } from "./workflow-handler.js";
import { errorHandler } from "../middleware/error-handler.js";

const ENTITY_NAME = "_test_unique_users";

function buildApp(store: Store, registry: Registry): express.Express {
  const app = express();
  app.use(express.json());

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
