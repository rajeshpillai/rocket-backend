import { Router, type Express, type Request, type Response, type NextFunction } from "express";
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
import { reload } from "../metadata/loader.js";
import { AppError } from "../engine/errors.js";

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
}

export function registerAdminRoutes(
  app: Express,
  handler: AdminHandler,
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

  app.use("/api/_admin", admin);
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
