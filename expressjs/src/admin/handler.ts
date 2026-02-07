import { Router, type Express, type Request, type Response, type NextFunction, type RequestHandler } from "express";
import type { Store } from "../store/postgres.js";
import { queryRows, queryRow, exec } from "../store/postgres.js";
import type { Registry } from "../metadata/registry.js";
import type { Migrator } from "../store/migrator.js";
import type { Entity, Relation } from "../metadata/types.js";
import { hasField, isManyToMany } from "../metadata/types.js";
import type { Rule } from "../metadata/rule.js";
import type { StateMachine } from "../metadata/state-machine.js";
import { normalizeDefinition } from "../metadata/state-machine.js";
import type { Workflow } from "../metadata/workflow.js";
import { normalizeWorkflowSteps } from "../metadata/workflow.js";
import type { Permission } from "../metadata/permission.js";
import type { Webhook } from "../metadata/webhook.js";
import { reload } from "../metadata/loader.js";
import { AppError } from "../engine/errors.js";
import { hashPassword } from "../auth/auth.js";

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export class AdminHandler {
  private store: Store;
  private registry: Registry;
  private migrator: Migrator;

  constructor(store: Store, registry: Registry, migrator: Migrator) {
    this.store = store;
    this.registry = registry;
    this.migrator = migrator;
  }

  // --- Entity Endpoints ---

  listEntities = asyncHandler(async (_req: Request, res: Response) => {
    const rows = await queryRows(
      this.store.pool,
      "SELECT name, table_name, definition, created_at, updated_at FROM _entities ORDER BY name",
    );
    res.json({ data: rows ?? [] });
  });

  getEntity = asyncHandler(async (req: Request, res: Response) => {
    const name = req.params.name;
    let row: Record<string, any>;
    try {
      row = await queryRow(
        this.store.pool,
        "SELECT name, table_name, definition, created_at, updated_at FROM _entities WHERE name = $1",
        [name],
      );
    } catch {
      throw new AppError("NOT_FOUND", 404, `Entity not found: ${name}`);
    }
    res.json({ data: row });
  });

  createEntity = asyncHandler(async (req: Request, res: Response) => {
    const entity = req.body as Entity;
    if (!entity || typeof entity !== "object") {
      throw new AppError("INVALID_PAYLOAD", 400, "Invalid JSON body");
    }

    const err = validateEntity(entity);
    if (err) {
      throw new AppError("VALIDATION_FAILED", 422, err);
    }

    // Check for duplicate
    if (this.registry.getEntity(entity.name)) {
      throw new AppError("CONFLICT", 409, `Entity already exists: ${entity.name}`);
    }

    await exec(
      this.store.pool,
      "INSERT INTO _entities (name, table_name, definition) VALUES ($1, $2, $3)",
      [entity.name, entity.table, JSON.stringify(entity)],
    );

    // Auto-migrate
    await this.migrator.migrate(entity);

    // Reload registry
    await reload(this.store.pool, this.registry);

    res.status(201).json({ data: entity });
  });

  updateEntity = asyncHandler(async (req: Request, res: Response) => {
    const name = req.params.name;
    if (!this.registry.getEntity(name)) {
      throw new AppError("NOT_FOUND", 404, `Entity not found: ${name}`);
    }

    const entity = req.body as Entity;
    if (!entity || typeof entity !== "object") {
      throw new AppError("INVALID_PAYLOAD", 400, "Invalid JSON body");
    }
    entity.name = name;

    const err = validateEntity(entity);
    if (err) {
      throw new AppError("VALIDATION_FAILED", 422, err);
    }

    await exec(
      this.store.pool,
      "UPDATE _entities SET table_name = $1, definition = $2, updated_at = NOW() WHERE name = $3",
      [entity.table, JSON.stringify(entity), name],
    );

    await this.migrator.migrate(entity);
    await reload(this.store.pool, this.registry);

    res.json({ data: entity });
  });

  deleteEntity = asyncHandler(async (req: Request, res: Response) => {
    const name = req.params.name;
    if (!this.registry.getEntity(name)) {
      throw new AppError("NOT_FOUND", 404, `Entity not found: ${name}`);
    }

    // Delete relations first
    await exec(
      this.store.pool,
      "DELETE FROM _relations WHERE source = $1 OR target = $1",
      [name],
    );

    await exec(this.store.pool, "DELETE FROM _entities WHERE name = $1", [
      name,
    ]);

    await reload(this.store.pool, this.registry);

    res.json({ data: { name, deleted: true } });
  });

  // --- Relation Endpoints ---

  listRelations = asyncHandler(async (_req: Request, res: Response) => {
    const rows = await queryRows(
      this.store.pool,
      "SELECT name, source, target, definition, created_at, updated_at FROM _relations ORDER BY name",
    );
    res.json({ data: rows ?? [] });
  });

  getRelation = asyncHandler(async (req: Request, res: Response) => {
    const name = req.params.name;
    let row: Record<string, any>;
    try {
      row = await queryRow(
        this.store.pool,
        "SELECT name, source, target, definition, created_at, updated_at FROM _relations WHERE name = $1",
        [name],
      );
    } catch {
      throw new AppError("NOT_FOUND", 404, `Relation not found: ${name}`);
    }
    res.json({ data: row });
  });

  createRelation = asyncHandler(async (req: Request, res: Response) => {
    const rel = req.body as Relation;
    if (!rel || typeof rel !== "object") {
      throw new AppError("INVALID_PAYLOAD", 400, "Invalid JSON body");
    }

    const err = validateRelation(rel, this.registry);
    if (err) {
      throw new AppError("VALIDATION_FAILED", 422, err);
    }

    if (this.registry.getRelation(rel.name)) {
      throw new AppError("CONFLICT", 409, `Relation already exists: ${rel.name}`);
    }

    await exec(
      this.store.pool,
      "INSERT INTO _relations (name, source, target, definition) VALUES ($1, $2, $3, $4)",
      [rel.name, rel.source, rel.target, JSON.stringify(rel)],
    );

    // Create join table for many-to-many
    if (isManyToMany(rel)) {
      const sourceEntity = this.registry.getEntity(rel.source);
      const targetEntity = this.registry.getEntity(rel.target);
      if (sourceEntity && targetEntity) {
        await this.migrator.migrateJoinTable(rel, sourceEntity, targetEntity);
      }
    }

    await reload(this.store.pool, this.registry);

    res.status(201).json({ data: rel });
  });

  updateRelation = asyncHandler(async (req: Request, res: Response) => {
    const name = req.params.name;
    if (!this.registry.getRelation(name)) {
      throw new AppError("NOT_FOUND", 404, `Relation not found: ${name}`);
    }

    const rel = req.body as Relation;
    if (!rel || typeof rel !== "object") {
      throw new AppError("INVALID_PAYLOAD", 400, "Invalid JSON body");
    }
    rel.name = name;

    const err = validateRelation(rel, this.registry);
    if (err) {
      throw new AppError("VALIDATION_FAILED", 422, err);
    }

    await exec(
      this.store.pool,
      "UPDATE _relations SET source = $1, target = $2, definition = $3, updated_at = NOW() WHERE name = $4",
      [rel.source, rel.target, JSON.stringify(rel), name],
    );

    await reload(this.store.pool, this.registry);

    res.json({ data: rel });
  });

  deleteRelation = asyncHandler(async (req: Request, res: Response) => {
    const name = req.params.name;
    if (!this.registry.getRelation(name)) {
      throw new AppError("NOT_FOUND", 404, `Relation not found: ${name}`);
    }

    await exec(this.store.pool, "DELETE FROM _relations WHERE name = $1", [
      name,
    ]);

    await reload(this.store.pool, this.registry);

    res.json({ data: { name, deleted: true } });
  });

  // --- Rule Endpoints ---

  listRules = asyncHandler(async (_req: Request, res: Response) => {
    const rows = await queryRows(
      this.store.pool,
      "SELECT id, entity, hook, type, definition, priority, active, created_at, updated_at FROM _rules ORDER BY entity, priority",
    );
    res.json({ data: rows ?? [] });
  });

  getRule = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;
    let row: Record<string, any>;
    try {
      row = await queryRow(
        this.store.pool,
        "SELECT id, entity, hook, type, definition, priority, active, created_at, updated_at FROM _rules WHERE id = $1",
        [id],
      );
    } catch {
      throw new AppError("NOT_FOUND", 404, `Rule not found: ${id}`);
    }
    res.json({ data: row });
  });

  createRule = asyncHandler(async (req: Request, res: Response) => {
    const rule = req.body as Rule;
    if (!rule || typeof rule !== "object") {
      throw new AppError("INVALID_PAYLOAD", 400, "Invalid JSON body");
    }

    const err = validateRule(rule, this.registry);
    if (err) {
      throw new AppError("VALIDATION_FAILED", 422, err);
    }

    const row = await queryRow(
      this.store.pool,
      "INSERT INTO _rules (entity, hook, type, definition, priority, active) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
      [
        rule.entity,
        rule.hook,
        rule.type,
        JSON.stringify(rule.definition),
        rule.priority ?? 0,
        rule.active ?? true,
      ],
    );
    rule.id = row.id;

    await reload(this.store.pool, this.registry);

    res.status(201).json({ data: rule });
  });

  updateRule = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;
    try {
      await queryRow(this.store.pool, "SELECT id FROM _rules WHERE id = $1", [
        id,
      ]);
    } catch {
      throw new AppError("NOT_FOUND", 404, `Rule not found: ${id}`);
    }

    const rule = req.body as Rule;
    if (!rule || typeof rule !== "object") {
      throw new AppError("INVALID_PAYLOAD", 400, "Invalid JSON body");
    }
    rule.id = id;

    const err = validateRule(rule, this.registry);
    if (err) {
      throw new AppError("VALIDATION_FAILED", 422, err);
    }

    await exec(
      this.store.pool,
      "UPDATE _rules SET entity = $1, hook = $2, type = $3, definition = $4, priority = $5, active = $6, updated_at = NOW() WHERE id = $7",
      [
        rule.entity,
        rule.hook,
        rule.type,
        JSON.stringify(rule.definition),
        rule.priority ?? 0,
        rule.active ?? true,
        id,
      ],
    );

    await reload(this.store.pool, this.registry);

    res.json({ data: rule });
  });

  deleteRule = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;
    try {
      await queryRow(this.store.pool, "SELECT id FROM _rules WHERE id = $1", [
        id,
      ]);
    } catch {
      throw new AppError("NOT_FOUND", 404, `Rule not found: ${id}`);
    }

    await exec(this.store.pool, "DELETE FROM _rules WHERE id = $1", [id]);

    await reload(this.store.pool, this.registry);

    res.json({ data: { id, deleted: true } });
  });

  // --- State Machine Endpoints ---

  listStateMachines = asyncHandler(async (_req: Request, res: Response) => {
    const rows = await queryRows(
      this.store.pool,
      "SELECT id, entity, field, definition, active, created_at, updated_at FROM _state_machines ORDER BY entity",
    );
    res.json({ data: rows ?? [] });
  });

  getStateMachine = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;
    let row: Record<string, any>;
    try {
      row = await queryRow(
        this.store.pool,
        "SELECT id, entity, field, definition, active, created_at, updated_at FROM _state_machines WHERE id = $1",
        [id],
      );
    } catch {
      throw new AppError("NOT_FOUND", 404, `State machine not found: ${id}`);
    }
    res.json({ data: row });
  });

  createStateMachine = asyncHandler(async (req: Request, res: Response) => {
    const sm = req.body as StateMachine;
    if (!sm || typeof sm !== "object") {
      throw new AppError("INVALID_PAYLOAD", 400, "Invalid JSON body");
    }

    const err = validateStateMachine(sm, this.registry);
    if (err) {
      throw new AppError("VALIDATION_FAILED", 422, err);
    }

    sm.definition = normalizeDefinition(sm.definition);

    const row = await queryRow(
      this.store.pool,
      "INSERT INTO _state_machines (entity, field, definition, active) VALUES ($1, $2, $3, $4) RETURNING id",
      [sm.entity, sm.field, JSON.stringify(sm.definition), sm.active ?? true],
    );
    sm.id = row.id;

    await reload(this.store.pool, this.registry);

    res.status(201).json({ data: sm });
  });

  updateStateMachine = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;
    try {
      await queryRow(
        this.store.pool,
        "SELECT id FROM _state_machines WHERE id = $1",
        [id],
      );
    } catch {
      throw new AppError("NOT_FOUND", 404, `State machine not found: ${id}`);
    }

    const sm = req.body as StateMachine;
    if (!sm || typeof sm !== "object") {
      throw new AppError("INVALID_PAYLOAD", 400, "Invalid JSON body");
    }
    sm.id = id;

    const err = validateStateMachine(sm, this.registry);
    if (err) {
      throw new AppError("VALIDATION_FAILED", 422, err);
    }

    sm.definition = normalizeDefinition(sm.definition);

    await exec(
      this.store.pool,
      "UPDATE _state_machines SET entity = $1, field = $2, definition = $3, active = $4, updated_at = NOW() WHERE id = $5",
      [sm.entity, sm.field, JSON.stringify(sm.definition), sm.active ?? true, id],
    );

    await reload(this.store.pool, this.registry);

    res.json({ data: sm });
  });

  deleteStateMachine = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;
    try {
      await queryRow(
        this.store.pool,
        "SELECT id FROM _state_machines WHERE id = $1",
        [id],
      );
    } catch {
      throw new AppError("NOT_FOUND", 404, `State machine not found: ${id}`);
    }

    await exec(this.store.pool, "DELETE FROM _state_machines WHERE id = $1", [
      id,
    ]);

    await reload(this.store.pool, this.registry);

    res.json({ data: { id, deleted: true } });
  });

  // --- Workflow Endpoints ---

  listWorkflows = asyncHandler(async (_req: Request, res: Response) => {
    const rows = await queryRows(
      this.store.pool,
      "SELECT id, name, trigger, context, steps, active, created_at, updated_at FROM _workflows ORDER BY name",
    );
    res.json({ data: rows ?? [] });
  });

  getWorkflow = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;
    let row: Record<string, any>;
    try {
      row = await queryRow(
        this.store.pool,
        "SELECT id, name, trigger, context, steps, active, created_at, updated_at FROM _workflows WHERE id = $1",
        [id],
      );
    } catch {
      throw new AppError("NOT_FOUND", 404, `Workflow not found: ${id}`);
    }
    res.json({ data: row });
  });

  createWorkflow = asyncHandler(async (req: Request, res: Response) => {
    const wf = req.body as Workflow;
    if (!wf || typeof wf !== "object") {
      throw new AppError("INVALID_PAYLOAD", 400, "Invalid JSON body");
    }

    const err = validateWorkflow(wf);
    if (err) {
      throw new AppError("VALIDATION_FAILED", 422, err);
    }

    wf.steps = normalizeWorkflowSteps(wf.steps);

    const row = await queryRow(
      this.store.pool,
      `INSERT INTO _workflows (name, trigger, context, steps, active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        wf.name,
        JSON.stringify(wf.trigger),
        JSON.stringify(wf.context ?? {}),
        JSON.stringify(wf.steps),
        wf.active ?? true,
      ],
    );
    wf.id = row.id;

    await reload(this.store.pool, this.registry);

    res.status(201).json({ data: wf });
  });

  updateWorkflow = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;
    try {
      await queryRow(
        this.store.pool,
        "SELECT id FROM _workflows WHERE id = $1",
        [id],
      );
    } catch {
      throw new AppError("NOT_FOUND", 404, `Workflow not found: ${id}`);
    }

    const wf = req.body as Workflow;
    if (!wf || typeof wf !== "object") {
      throw new AppError("INVALID_PAYLOAD", 400, "Invalid JSON body");
    }
    wf.id = id;

    const err = validateWorkflow(wf);
    if (err) {
      throw new AppError("VALIDATION_FAILED", 422, err);
    }

    wf.steps = normalizeWorkflowSteps(wf.steps);

    await exec(
      this.store.pool,
      `UPDATE _workflows SET name = $1, trigger = $2, context = $3, steps = $4, active = $5, updated_at = NOW() WHERE id = $6`,
      [
        wf.name,
        JSON.stringify(wf.trigger),
        JSON.stringify(wf.context ?? {}),
        JSON.stringify(wf.steps),
        wf.active ?? true,
        id,
      ],
    );

    await reload(this.store.pool, this.registry);

    res.json({ data: wf });
  });

  deleteWorkflow = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;
    try {
      await queryRow(
        this.store.pool,
        "SELECT id FROM _workflows WHERE id = $1",
        [id],
      );
    } catch {
      throw new AppError("NOT_FOUND", 404, `Workflow not found: ${id}`);
    }

    await exec(this.store.pool, "DELETE FROM _workflows WHERE id = $1", [id]);

    await reload(this.store.pool, this.registry);

    res.json({ data: { id, deleted: true } });
  });

  // --- User Endpoints ---

  listUsers = asyncHandler(async (_req: Request, res: Response) => {
    const rows = await queryRows(
      this.store.pool,
      "SELECT id, email, roles, active, created_at, updated_at FROM _users ORDER BY email",
    );
    res.json({ data: rows ?? [] });
  });

  getUser = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;
    let row: Record<string, any>;
    try {
      row = await queryRow(
        this.store.pool,
        "SELECT id, email, roles, active, created_at, updated_at FROM _users WHERE id = $1",
        [id],
      );
    } catch {
      throw new AppError("NOT_FOUND", 404, `User not found: ${id}`);
    }
    res.json({ data: row });
  });

  createUser = asyncHandler(async (req: Request, res: Response) => {
    const { email, password, roles, active } = req.body ?? {};
    if (!email) {
      throw new AppError("VALIDATION_FAILED", 422, "email is required");
    }
    if (!password) {
      throw new AppError("VALIDATION_FAILED", 422, "password is required");
    }

    const hash = await hashPassword(password);
    const userActive = active !== undefined ? active : true;
    const userRoles = roles ?? [];

    const row = await queryRow(
      this.store.pool,
      "INSERT INTO _users (email, password_hash, roles, active) VALUES ($1, $2, $3, $4) RETURNING id, email, roles, active, created_at, updated_at",
      [email, hash, userRoles, userActive],
    );

    res.status(201).json({ data: row });
  });

  updateUser = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;
    try {
      await queryRow(this.store.pool, "SELECT id FROM _users WHERE id = $1", [id]);
    } catch {
      throw new AppError("NOT_FOUND", 404, `User not found: ${id}`);
    }

    const { email, password, roles, active } = req.body ?? {};
    if (!email) {
      throw new AppError("VALIDATION_FAILED", 422, "email is required");
    }

    const userRoles = roles ?? [];

    if (password) {
      const hash = await hashPassword(password);
      await exec(
        this.store.pool,
        "UPDATE _users SET email = $1, password_hash = $2, roles = $3, active = $4, updated_at = NOW() WHERE id = $5",
        [email, hash, userRoles, active, id],
      );
    } else {
      await exec(
        this.store.pool,
        "UPDATE _users SET email = $1, roles = $2, active = $3, updated_at = NOW() WHERE id = $4",
        [email, userRoles, active, id],
      );
    }

    const row = await queryRow(
      this.store.pool,
      "SELECT id, email, roles, active, created_at, updated_at FROM _users WHERE id = $1",
      [id],
    );

    res.json({ data: row });
  });

  deleteUser = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;
    try {
      await queryRow(this.store.pool, "SELECT id FROM _users WHERE id = $1", [id]);
    } catch {
      throw new AppError("NOT_FOUND", 404, `User not found: ${id}`);
    }

    await exec(this.store.pool, "DELETE FROM _users WHERE id = $1", [id]);

    res.json({ data: { id, deleted: true } });
  });

  // --- Permission Endpoints ---

  listPermissions = asyncHandler(async (_req: Request, res: Response) => {
    const rows = await queryRows(
      this.store.pool,
      "SELECT id, entity, action, roles, conditions, created_at, updated_at FROM _permissions ORDER BY entity, action",
    );
    res.json({ data: rows ?? [] });
  });

  getPermission = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;
    let row: Record<string, any>;
    try {
      row = await queryRow(
        this.store.pool,
        "SELECT id, entity, action, roles, conditions, created_at, updated_at FROM _permissions WHERE id = $1",
        [id],
      );
    } catch {
      throw new AppError("NOT_FOUND", 404, `Permission not found: ${id}`);
    }
    res.json({ data: row });
  });

  createPermission = asyncHandler(async (req: Request, res: Response) => {
    const perm = req.body as Permission;
    if (!perm || typeof perm !== "object") {
      throw new AppError("INVALID_PAYLOAD", 400, "Invalid JSON body");
    }
    if (!perm.entity) {
      throw new AppError("VALIDATION_FAILED", 422, "entity is required");
    }
    if (!perm.action) {
      throw new AppError("VALIDATION_FAILED", 422, "action is required");
    }
    const validActions = ["read", "create", "update", "delete"];
    if (!validActions.includes(perm.action)) {
      throw new AppError("VALIDATION_FAILED", 422, "action must be read, create, update, or delete");
    }
    if (!perm.roles) {
      perm.roles = [];
    }

    const row = await queryRow(
      this.store.pool,
      "INSERT INTO _permissions (entity, action, roles, conditions) VALUES ($1, $2, $3, $4) RETURNING id",
      [perm.entity, perm.action, perm.roles, JSON.stringify(perm.conditions ?? [])],
    );
    perm.id = row.id;

    await reload(this.store.pool, this.registry);

    res.status(201).json({ data: perm });
  });

  updatePermission = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;
    try {
      await queryRow(this.store.pool, "SELECT id FROM _permissions WHERE id = $1", [id]);
    } catch {
      throw new AppError("NOT_FOUND", 404, `Permission not found: ${id}`);
    }

    const perm = req.body as Permission;
    if (!perm || typeof perm !== "object") {
      throw new AppError("INVALID_PAYLOAD", 400, "Invalid JSON body");
    }
    perm.id = id;

    if (!perm.entity) {
      throw new AppError("VALIDATION_FAILED", 422, "entity is required");
    }
    if (!perm.action) {
      throw new AppError("VALIDATION_FAILED", 422, "action is required");
    }
    if (!perm.roles) {
      perm.roles = [];
    }

    await exec(
      this.store.pool,
      "UPDATE _permissions SET entity = $1, action = $2, roles = $3, conditions = $4, updated_at = NOW() WHERE id = $5",
      [perm.entity, perm.action, perm.roles, JSON.stringify(perm.conditions ?? []), id],
    );

    await reload(this.store.pool, this.registry);

    res.json({ data: perm });
  });

  deletePermission = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;
    try {
      await queryRow(this.store.pool, "SELECT id FROM _permissions WHERE id = $1", [id]);
    } catch {
      throw new AppError("NOT_FOUND", 404, `Permission not found: ${id}`);
    }

    await exec(this.store.pool, "DELETE FROM _permissions WHERE id = $1", [id]);

    await reload(this.store.pool, this.registry);

    res.json({ data: { id, deleted: true } });
  });

  // --- Webhook Endpoints ---

  listWebhooks = asyncHandler(async (_req: Request, res: Response) => {
    const rows = await queryRows(
      this.store.pool,
      "SELECT id, entity, hook, url, method, headers, condition, async, retry, active, created_at, updated_at FROM _webhooks ORDER BY entity, hook",
    );
    res.json({ data: rows ?? [] });
  });

  getWebhook = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;
    let row: Record<string, any>;
    try {
      row = await queryRow(
        this.store.pool,
        "SELECT id, entity, hook, url, method, headers, condition, async, retry, active, created_at, updated_at FROM _webhooks WHERE id = $1",
        [id],
      );
    } catch {
      throw new AppError("NOT_FOUND", 404, `Webhook not found: ${id}`);
    }
    res.json({ data: row });
  });

  createWebhook = asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as Record<string, any>;
    if (!body || typeof body !== "object") {
      throw new AppError("INVALID_PAYLOAD", 400, "Invalid JSON body");
    }

    const err = validateWebhook(body);
    if (err) {
      throw new AppError("VALIDATION_FAILED", 422, err);
    }

    // Defaults
    const hook = body.hook ?? "after_write";
    const method = body.method ?? "POST";
    const isAsync = body.async ?? true;
    const active = body.active ?? true;
    const headers = body.headers ?? {};
    const condition = body.condition ?? "";
    const retry = body.retry ?? { max_attempts: 3, backoff: "exponential" };

    const row = await queryRow(
      this.store.pool,
      `INSERT INTO _webhooks (entity, hook, url, method, headers, condition, async, retry, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, entity, hook, url, method, headers, condition, async, retry, active, created_at, updated_at`,
      [body.entity, hook, body.url, method, JSON.stringify(headers), condition, isAsync, JSON.stringify(retry), active],
    );

    await reload(this.store.pool, this.registry);

    res.status(201).json({ data: row });
  });

  updateWebhook = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;
    try {
      await queryRow(this.store.pool, "SELECT id FROM _webhooks WHERE id = $1", [id]);
    } catch {
      throw new AppError("NOT_FOUND", 404, `Webhook not found: ${id}`);
    }

    const body = req.body as Record<string, any>;
    if (!body || typeof body !== "object") {
      throw new AppError("INVALID_PAYLOAD", 400, "Invalid JSON body");
    }

    const err = validateWebhook(body);
    if (err) {
      throw new AppError("VALIDATION_FAILED", 422, err);
    }

    await exec(
      this.store.pool,
      `UPDATE _webhooks SET entity = $1, hook = $2, url = $3, method = $4, headers = $5,
       condition = $6, async = $7, retry = $8, active = $9, updated_at = NOW() WHERE id = $10`,
      [body.entity, body.hook, body.url, body.method, JSON.stringify(body.headers ?? {}),
       body.condition ?? "", body.async, JSON.stringify(body.retry ?? {}), body.active, id],
    );

    await reload(this.store.pool, this.registry);

    const row = await queryRow(
      this.store.pool,
      "SELECT id, entity, hook, url, method, headers, condition, async, retry, active, created_at, updated_at FROM _webhooks WHERE id = $1",
      [id],
    );
    res.json({ data: row });
  });

  deleteWebhook = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;
    try {
      await queryRow(this.store.pool, "SELECT id FROM _webhooks WHERE id = $1", [id]);
    } catch {
      throw new AppError("NOT_FOUND", 404, `Webhook not found: ${id}`);
    }

    await exec(this.store.pool, "DELETE FROM _webhooks WHERE id = $1", [id]);

    await reload(this.store.pool, this.registry);

    res.json({ data: { id, deleted: true } });
  });

  // --- Webhook Log Endpoints ---

  listWebhookLogs = asyncHandler(async (req: Request, res: Response) => {
    let query = "SELECT id, webhook_id, entity, hook, url, method, request_headers, request_body, response_status, response_body, status, attempt, max_attempts, next_retry_at, error, idempotency_key, created_at, updated_at FROM _webhook_logs";
    const conditions: string[] = [];
    const args: any[] = [];
    let argIdx = 1;

    if (req.query.webhook_id) {
      conditions.push(`webhook_id = $${argIdx++}`);
      args.push(req.query.webhook_id);
    }
    if (req.query.status) {
      conditions.push(`status = $${argIdx++}`);
      args.push(req.query.status);
    }
    if (req.query.entity) {
      conditions.push(`entity = $${argIdx++}`);
      args.push(req.query.entity);
    }

    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }
    query += " ORDER BY created_at DESC LIMIT 200";

    const rows = await queryRows(this.store.pool, query, args);
    res.json({ data: rows ?? [] });
  });

  getWebhookLog = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;
    let row: Record<string, any>;
    try {
      row = await queryRow(
        this.store.pool,
        "SELECT id, webhook_id, entity, hook, url, method, request_headers, request_body, response_status, response_body, status, attempt, max_attempts, next_retry_at, error, idempotency_key, created_at, updated_at FROM _webhook_logs WHERE id = $1",
        [id],
      );
    } catch {
      throw new AppError("NOT_FOUND", 404, `Webhook log not found: ${id}`);
    }
    res.json({ data: row });
  });

  retryWebhookLog = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;
    let row: Record<string, any>;
    try {
      row = await queryRow(
        this.store.pool,
        "SELECT id, status, attempt, max_attempts FROM _webhook_logs WHERE id = $1",
        [id],
      );
    } catch {
      throw new AppError("NOT_FOUND", 404, `Webhook log not found: ${id}`);
    }

    if (row.status !== "failed" && row.status !== "retrying") {
      throw new AppError("VALIDATION_FAILED", 422, "Can only retry failed or retrying webhook logs");
    }

    await exec(
      this.store.pool,
      "UPDATE _webhook_logs SET status = 'retrying', next_retry_at = NOW(), updated_at = NOW() WHERE id = $1",
      [id],
    );

    const updated = await queryRow(
      this.store.pool,
      "SELECT id, webhook_id, entity, hook, url, method, status, attempt, max_attempts, next_retry_at, updated_at FROM _webhook_logs WHERE id = $1",
      [id],
    );
    res.json({ data: updated });
  });

  // --- Export / Import ---

  export = asyncHandler(async (_req: Request, res: Response) => {
    // Helper to parse JSONB that may come as string or object
    const parseJSON = (val: any): any => {
      if (val == null) return val;
      if (typeof val === "string") {
        try { return JSON.parse(val); } catch { return val; }
      }
      return val;
    };

    // Entities — definition column IS the full entity object
    const entityRows = await queryRows(
      this.store.pool,
      "SELECT definition FROM _entities ORDER BY name",
    );
    const entities = (entityRows ?? []).map((r: any) => parseJSON(r.definition));

    // Relations — definition column IS the full relation object
    const relationRows = await queryRows(
      this.store.pool,
      "SELECT definition FROM _relations ORDER BY name",
    );
    const relations = (relationRows ?? []).map((r: any) => parseJSON(r.definition));

    // Rules
    const ruleRows = await queryRows(
      this.store.pool,
      "SELECT entity, hook, type, definition, priority, active FROM _rules ORDER BY entity, priority",
    );
    const rules = (ruleRows ?? []).map((r: any) => ({
      entity: r.entity,
      hook: r.hook,
      type: r.type,
      definition: parseJSON(r.definition),
      priority: r.priority,
      active: r.active,
    }));

    // State machines
    const smRows = await queryRows(
      this.store.pool,
      "SELECT entity, field, definition, active FROM _state_machines ORDER BY entity",
    );
    const stateMachines = (smRows ?? []).map((r: any) => ({
      entity: r.entity,
      field: r.field,
      definition: parseJSON(r.definition),
      active: r.active,
    }));

    // Workflows
    const wfRows = await queryRows(
      this.store.pool,
      "SELECT name, trigger, context, steps, active FROM _workflows ORDER BY name",
    );
    const workflows = (wfRows ?? []).map((r: any) => ({
      name: r.name,
      trigger: parseJSON(r.trigger),
      context: parseJSON(r.context),
      steps: parseJSON(r.steps),
      active: r.active,
    }));

    // Permissions
    const permRows = await queryRows(
      this.store.pool,
      "SELECT entity, action, roles, conditions FROM _permissions ORDER BY entity, action",
    );
    const permissions = (permRows ?? []).map((r: any) => ({
      entity: r.entity,
      action: r.action,
      roles: parseJSON(r.roles),
      conditions: parseJSON(r.conditions),
    }));

    // Webhooks
    const whRows = await queryRows(
      this.store.pool,
      "SELECT entity, hook, url, method, headers, condition, async, retry, active FROM _webhooks ORDER BY entity, hook",
    );
    const webhooks = (whRows ?? []).map((r: any) => ({
      entity: r.entity,
      hook: r.hook,
      url: r.url,
      method: r.method,
      headers: parseJSON(r.headers),
      condition: r.condition,
      async: r.async,
      retry: parseJSON(r.retry),
      active: r.active,
    }));

    res.json({
      data: {
        version: 1,
        exported_at: new Date().toISOString(),
        entities,
        relations,
        rules,
        state_machines: stateMachines,
        workflows,
        permissions,
        webhooks,
      },
    });
  });

  import = asyncHandler(async (req: Request, res: Response) => {
    const body = req.body;
    if (!body || typeof body !== "object") {
      throw new AppError("INVALID_PAYLOAD", 400, "Invalid JSON body");
    }
    if (body.version !== 1) {
      throw new AppError("VALIDATION_FAILED", 422, `Unsupported schema version: ${body.version}`);
    }

    const summary: Record<string, number> = {};
    const errors: string[] = [];

    // Helper to parse JSONB
    const parseJSON = (val: any): any => {
      if (val == null) return val;
      if (typeof val === "string") {
        try { return JSON.parse(val); } catch { return val; }
      }
      return val;
    };

    // 1. Entities
    const entities = body.entities ?? [];
    let entityCount = 0;
    for (const ent of entities) {
      try {
        if (this.registry.getEntity(ent.name)) continue; // skip existing
        await exec(
          this.store.pool,
          "INSERT INTO _entities (name, table_name, definition) VALUES ($1, $2, $3)",
          [ent.name, ent.table, JSON.stringify(ent)],
        );
        await this.migrator.migrate(ent);
        entityCount++;
      } catch (e: any) {
        errors.push(`entity ${ent.name}: ${e.message}`);
      }
    }
    summary.entities = entityCount;

    // Reload registry after entities so relations can reference them
    await reload(this.store.pool, this.registry);

    // 2. Relations
    const relations = body.relations ?? [];
    let relationCount = 0;
    for (const rel of relations) {
      try {
        if (this.registry.getRelation(rel.name)) continue; // skip existing
        await exec(
          this.store.pool,
          "INSERT INTO _relations (name, source, target, definition) VALUES ($1, $2, $3, $4)",
          [rel.name, rel.source, rel.target, JSON.stringify(rel)],
        );
        if (isManyToMany(rel)) {
          const sourceEntity = this.registry.getEntity(rel.source);
          const targetEntity = this.registry.getEntity(rel.target);
          if (sourceEntity && targetEntity) {
            await this.migrator.migrateJoinTable(rel, sourceEntity, targetEntity);
          }
        }
        relationCount++;
      } catch (e: any) {
        errors.push(`relation ${rel.name}: ${e.message}`);
      }
    }
    summary.relations = relationCount;

    // 3. Rules — dedup by entity+hook+type+definition
    const ruleRows = body.rules ?? [];
    let ruleCount = 0;
    const existingRules = await queryRows(
      this.store.pool,
      "SELECT entity, hook, type, definition FROM _rules",
    );
    const ruleSet = new Set(
      (existingRules ?? []).map((r: any) =>
        `${r.entity}|${r.hook}|${r.type}|${JSON.stringify(parseJSON(r.definition))}`,
      ),
    );
    for (const rule of ruleRows) {
      try {
        const key = `${rule.entity}|${rule.hook}|${rule.type}|${JSON.stringify(rule.definition)}`;
        if (ruleSet.has(key)) continue;
        await exec(
          this.store.pool,
          "INSERT INTO _rules (entity, hook, type, definition, priority, active) VALUES ($1, $2, $3, $4, $5, $6)",
          [rule.entity, rule.hook, rule.type, JSON.stringify(rule.definition), rule.priority ?? 0, rule.active ?? true],
        );
        ruleSet.add(key);
        ruleCount++;
      } catch (e: any) {
        errors.push(`rule ${rule.entity}/${rule.type}: ${e.message}`);
      }
    }
    summary.rules = ruleCount;

    // 4. State machines — dedup by entity+field
    const smRows = body.state_machines ?? [];
    let smCount = 0;
    const existingSMs = await queryRows(
      this.store.pool,
      "SELECT entity, field FROM _state_machines",
    );
    const smSet = new Set(
      (existingSMs ?? []).map((r: any) => `${r.entity}|${r.field}`),
    );
    for (const sm of smRows) {
      try {
        const key = `${sm.entity}|${sm.field}`;
        if (smSet.has(key)) continue;
        await exec(
          this.store.pool,
          "INSERT INTO _state_machines (entity, field, definition, active) VALUES ($1, $2, $3, $4)",
          [sm.entity, sm.field, JSON.stringify(sm.definition), sm.active ?? true],
        );
        smSet.add(key);
        smCount++;
      } catch (e: any) {
        errors.push(`state_machine ${sm.entity}/${sm.field}: ${e.message}`);
      }
    }
    summary.state_machines = smCount;

    // 5. Workflows — dedup by name
    const wfRows = body.workflows ?? [];
    let wfCount = 0;
    const existingWFs = await queryRows(
      this.store.pool,
      "SELECT name FROM _workflows",
    );
    const wfSet = new Set(
      (existingWFs ?? []).map((r: any) => r.name as string),
    );
    for (const wf of wfRows) {
      try {
        if (wfSet.has(wf.name)) continue;
        await exec(
          this.store.pool,
          "INSERT INTO _workflows (name, trigger, context, steps, active) VALUES ($1, $2, $3, $4, $5)",
          [wf.name, JSON.stringify(wf.trigger), JSON.stringify(wf.context ?? {}), JSON.stringify(wf.steps), wf.active ?? true],
        );
        wfSet.add(wf.name);
        wfCount++;
      } catch (e: any) {
        errors.push(`workflow ${wf.name}: ${e.message}`);
      }
    }
    summary.workflows = wfCount;

    // 6. Permissions — dedup by entity+action
    const permRows = body.permissions ?? [];
    let permCount = 0;
    const existingPerms = await queryRows(
      this.store.pool,
      "SELECT entity, action FROM _permissions",
    );
    const permSet = new Set(
      (existingPerms ?? []).map((r: any) => `${r.entity}|${r.action}`),
    );
    for (const perm of permRows) {
      try {
        const key = `${perm.entity}|${perm.action}`;
        if (permSet.has(key)) continue;
        await exec(
          this.store.pool,
          "INSERT INTO _permissions (entity, action, roles, conditions) VALUES ($1, $2, $3, $4)",
          [perm.entity, perm.action, perm.roles ?? [], JSON.stringify(perm.conditions ?? [])],
        );
        permSet.add(key);
        permCount++;
      } catch (e: any) {
        errors.push(`permission ${perm.entity}/${perm.action}: ${e.message}`);
      }
    }
    summary.permissions = permCount;

    // 7. Webhooks — dedup by entity+hook+url
    const whRows = body.webhooks ?? [];
    let whCount = 0;
    const existingWHs = await queryRows(
      this.store.pool,
      "SELECT entity, hook, url FROM _webhooks",
    );
    const whSet = new Set(
      (existingWHs ?? []).map((r: any) => `${r.entity}|${r.hook}|${r.url}`),
    );
    for (const wh of whRows) {
      try {
        const key = `${wh.entity}|${wh.hook}|${wh.url}`;
        if (whSet.has(key)) continue;
        await exec(
          this.store.pool,
          `INSERT INTO _webhooks (entity, hook, url, method, headers, condition, async, retry, active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            wh.entity, wh.hook ?? "after_write", wh.url, wh.method ?? "POST",
            JSON.stringify(wh.headers ?? {}), wh.condition ?? "", wh.async ?? true,
            JSON.stringify(wh.retry ?? { max_attempts: 3, backoff: "exponential" }), wh.active ?? true,
          ],
        );
        whSet.add(key);
        whCount++;
      } catch (e: any) {
        errors.push(`webhook ${wh.entity}/${wh.hook}/${wh.url}: ${e.message}`);
      }
    }
    summary.webhooks = whCount;

    // Final reload
    await reload(this.store.pool, this.registry);

    // Step 8: Sample data (insert records into business tables)
    const sampleData = body.sample_data ?? {};
    let recordCount = 0;

    // Process entity records in definition order
    for (const ent of entities) {
      const entity = this.registry.getEntity(ent.name);
      if (!entity) continue;
      const records = sampleData[ent.name];
      if (!Array.isArray(records) || records.length === 0) continue;

      const fieldSet = new Set(entity.fields.map((f) => f.name));
      for (const record of records) {
        const cols: string[] = [];
        const placeholders: string[] = [];
        const values: any[] = [];
        let idx = 1;
        for (const [key, val] of Object.entries(record)) {
          if (!fieldSet.has(key)) continue;
          cols.push(`"${key}"`);
          placeholders.push(`$${idx}`);
          values.push(val);
          idx++;
        }
        if (cols.length === 0) continue;
        try {
          await exec(
            this.store.pool,
            `INSERT INTO "${entity.table}" (${cols.join(", ")}) VALUES (${placeholders.join(", ")}) ON CONFLICT DO NOTHING`,
            values,
          );
          recordCount++;
        } catch (e: any) {
          errors.push(`record ${ent.name}: ${e.message}`);
        }
      }
    }

    // Process join table data (keys that don't match entity names)
    for (const key of Object.keys(sampleData)) {
      if (this.registry.getEntity(key)) continue;
      const records = sampleData[key];
      if (!Array.isArray(records) || records.length === 0) continue;

      let tableName = "";
      const validCols = new Set<string>();
      for (const rel of relations) {
        if (rel.join_table === key) {
          tableName = key;
          if (rel.source_join_key) validCols.add(rel.source_join_key);
          if (rel.target_join_key) validCols.add(rel.target_join_key);
          break;
        }
      }
      if (!tableName) continue;

      for (const record of records) {
        const cols: string[] = [];
        const placeholders: string[] = [];
        const values: any[] = [];
        let idx = 1;
        for (const [k, v] of Object.entries(record)) {
          if (!validCols.has(k)) continue;
          cols.push(`"${k}"`);
          placeholders.push(`$${idx}`);
          values.push(v);
          idx++;
        }
        if (cols.length === 0) continue;
        try {
          await exec(
            this.store.pool,
            `INSERT INTO "${tableName}" (${cols.join(", ")}) VALUES (${placeholders.join(", ")}) ON CONFLICT DO NOTHING`,
            values,
          );
          recordCount++;
        } catch (e: any) {
          errors.push(`record ${key}: ${e.message}`);
        }
      }
    }

    summary.records = recordCount;

    const result: Record<string, any> = {
      message: "Import completed",
      summary,
    };
    if (errors.length > 0) {
      result.errors = errors;
    }

    res.json({ data: result });
  });
}

export function registerAdminRoutes(
  app: Express,
  handler: AdminHandler,
  ...middleware: RequestHandler[]
): void {
  const admin = Router();

  admin.get("/entities", handler.listEntities);
  admin.get("/entities/:name", handler.getEntity);
  admin.post("/entities", handler.createEntity);
  admin.put("/entities/:name", handler.updateEntity);
  admin.delete("/entities/:name", handler.deleteEntity);

  admin.get("/relations", handler.listRelations);
  admin.get("/relations/:name", handler.getRelation);
  admin.post("/relations", handler.createRelation);
  admin.put("/relations/:name", handler.updateRelation);
  admin.delete("/relations/:name", handler.deleteRelation);

  admin.get("/rules", handler.listRules);
  admin.get("/rules/:id", handler.getRule);
  admin.post("/rules", handler.createRule);
  admin.put("/rules/:id", handler.updateRule);
  admin.delete("/rules/:id", handler.deleteRule);

  admin.get("/state-machines", handler.listStateMachines);
  admin.get("/state-machines/:id", handler.getStateMachine);
  admin.post("/state-machines", handler.createStateMachine);
  admin.put("/state-machines/:id", handler.updateStateMachine);
  admin.delete("/state-machines/:id", handler.deleteStateMachine);

  admin.get("/workflows", handler.listWorkflows);
  admin.get("/workflows/:id", handler.getWorkflow);
  admin.post("/workflows", handler.createWorkflow);
  admin.put("/workflows/:id", handler.updateWorkflow);
  admin.delete("/workflows/:id", handler.deleteWorkflow);

  admin.get("/users", handler.listUsers);
  admin.get("/users/:id", handler.getUser);
  admin.post("/users", handler.createUser);
  admin.put("/users/:id", handler.updateUser);
  admin.delete("/users/:id", handler.deleteUser);

  admin.get("/permissions", handler.listPermissions);
  admin.get("/permissions/:id", handler.getPermission);
  admin.post("/permissions", handler.createPermission);
  admin.put("/permissions/:id", handler.updatePermission);
  admin.delete("/permissions/:id", handler.deletePermission);

  admin.get("/webhooks", handler.listWebhooks);
  admin.get("/webhooks/:id", handler.getWebhook);
  admin.post("/webhooks", handler.createWebhook);
  admin.put("/webhooks/:id", handler.updateWebhook);
  admin.delete("/webhooks/:id", handler.deleteWebhook);

  admin.get("/webhook-logs", handler.listWebhookLogs);
  admin.get("/webhook-logs/:id", handler.getWebhookLog);
  admin.post("/webhook-logs/:id/retry", handler.retryWebhookLog);

  admin.get("/export", handler.export);
  admin.post("/import", handler.import);

  app.use("/api/_admin", ...middleware, admin);
}

// --- Validation ---

function validateEntity(e: Entity): string | null {
  if (!e.name) return "entity name is required";
  if (!e.table) return "table name is required";
  if (!e.fields || e.fields.length === 0)
    return "entity must have at least one field";
  if (!e.primary_key?.field) return "primary key field is required";
  if (!hasField(e, e.primary_key.field))
    return `primary key field ${e.primary_key.field} not found in fields`;
  return null;
}

function validateRule(r: Rule, registry: Registry): string | null {
  if (!r.entity) return "entity is required";
  if (!registry.getEntity(r.entity))
    return `entity not found: ${r.entity}`;
  if (!["before_write", "before_delete"].includes(r.hook))
    return `invalid hook: ${r.hook} (must be before_write or before_delete)`;
  if (!["field", "expression", "computed"].includes(r.type))
    return `invalid rule type: ${r.type} (must be field, expression, or computed)`;
  return null;
}

function validateStateMachine(
  sm: StateMachine,
  registry: Registry,
): string | null {
  if (!sm.entity) return "entity is required";
  if (!registry.getEntity(sm.entity))
    return `entity not found: ${sm.entity}`;
  if (!sm.field) return "field is required";
  if (
    !sm.definition?.transitions ||
    sm.definition.transitions.length === 0
  )
    return "at least one transition is required";
  return null;
}

function validateWorkflow(wf: Workflow): string | null {
  if (!wf.name) return "workflow name is required";
  if (!wf.trigger?.type) return "trigger type is required";
  if (wf.trigger.type !== "state_change") return `unsupported trigger type: ${wf.trigger.type}`;
  if (!wf.trigger.entity) return "trigger entity is required";
  if (!wf.steps || wf.steps.length === 0) return "at least one step is required";

  // Validate step IDs are unique
  const stepIDs = new Set<string>();
  for (const step of wf.steps) {
    if (!step.id) return "step id is required";
    if (stepIDs.has(step.id)) return `duplicate step id: ${step.id}`;
    stepIDs.add(step.id);
  }

  // Validate step types and goto targets
  const validTypes = new Set(["action", "condition", "approval"]);
  for (const step of wf.steps) {
    if (!validTypes.has(step.type)) return `invalid step type: ${step.type}`;

    // Check goto targets reference valid step IDs or "end"
    const gotos: any[] = [step.then, step.on_true, step.on_false, step.on_approve, step.on_reject, step.on_timeout];
    for (const g of gotos) {
      if (g == null) continue;
      const target = typeof g === "string" ? g : g.goto;
      if (target && target !== "end" && !stepIDs.has(target)) {
        return `goto target '${target}' references unknown step`;
      }
    }
  }

  return null;
}

function validateWebhook(body: Record<string, any>): string | null {
  if (!body.entity) return "entity is required";

  if (body.hook) {
    const validHooks = ["after_write", "before_write", "after_delete", "before_delete"];
    if (!validHooks.includes(body.hook)) {
      return "hook must be after_write, before_write, after_delete, or before_delete";
    }
  }

  if (!body.url) return "url is required";
  if (!body.url.startsWith("http://") && !body.url.startsWith("https://")) {
    return "url must start with http:// or https://";
  }

  if (body.method) {
    const validMethods = ["POST", "PUT", "PATCH", "GET", "DELETE"];
    if (!validMethods.includes(body.method)) {
      return "method must be POST, PUT, PATCH, GET, or DELETE";
    }
  }

  return null;
}

function validateRelation(r: Relation, registry: Registry): string | null {
  if (!r.name) return "relation name is required";
  if (!r.source || !r.target) return "source and target are required";
  if (!registry.getEntity(r.source))
    return `source entity not found: ${r.source}`;
  if (!registry.getEntity(r.target))
    return `target entity not found: ${r.target}`;
  if (!["one_to_one", "one_to_many", "many_to_many"].includes(r.type))
    return `invalid relation type: ${r.type}`;
  if (r.type === "many_to_many" && !r.join_table)
    return "join_table is required for many_to_many relations";
  return null;
}
