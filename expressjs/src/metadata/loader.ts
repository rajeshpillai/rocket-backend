import type { Queryable } from "../store/postgres.js";
import type { Registry } from "./registry.js";
import type { Entity, Relation } from "./types.js";
import type { Rule, RuleDefinition } from "./rule.js";
import type { StateMachine, StateMachineDefinition } from "./state-machine.js";
import { normalizeDefinition } from "./state-machine.js";
import type { Workflow, WorkflowTrigger, WorkflowStep } from "./workflow.js";
import { normalizeWorkflowSteps } from "./workflow.js";
import type { Permission, PermissionCondition } from "./permission.js";
import type { Webhook, WebhookRetry } from "./webhook.js";

export async function loadAll(
  pool: Queryable,
  registry: Registry,
): Promise<void> {
  const entities = await loadEntities(pool);
  const relations = await loadRelations(pool);
  registry.load(entities, relations);

  const rules = await loadRules(pool);
  registry.loadRules(rules);

  const machines = await loadStateMachines(pool);
  registry.loadStateMachines(machines);

  const workflows = await loadWorkflows(pool);
  registry.loadWorkflows(workflows);

  const permissions = await loadPermissions(pool);
  registry.loadPermissions(permissions);

  const webhooks = await loadWebhooks(pool);
  registry.loadWebhooks(webhooks);

  console.log(
    `Loaded ${entities.length} entities, ${relations.length} relations, ${rules.length} rules, ${machines.length} state machines, ${workflows.length} workflows, ${permissions.length} permissions, ${webhooks.length} webhooks into registry`,
  );
}

export async function reload(
  pool: Queryable,
  registry: Registry,
): Promise<void> {
  return loadAll(pool, registry);
}

async function loadEntities(pool: Queryable): Promise<Entity[]> {
  const result = await pool.query(
    "SELECT name, definition FROM _entities ORDER BY name",
  );
  const entities: Entity[] = [];
  for (const row of result.rows) {
    try {
      const def =
        typeof row.definition === "string"
          ? JSON.parse(row.definition)
          : row.definition;
      entities.push(def as Entity);
    } catch (err) {
      console.warn(`WARN: skipping entity ${row.name} (invalid JSON):`, err);
    }
  }
  return entities;
}

async function loadRelations(pool: Queryable): Promise<Relation[]> {
  const result = await pool.query(
    "SELECT name, definition FROM _relations ORDER BY name",
  );
  const relations: Relation[] = [];
  for (const row of result.rows) {
    try {
      const def =
        typeof row.definition === "string"
          ? JSON.parse(row.definition)
          : row.definition;
      relations.push(def as Relation);
    } catch (err) {
      console.warn(
        `WARN: skipping relation ${row.name} (invalid JSON):`,
        err,
      );
    }
  }
  return relations;
}

async function loadRules(pool: Queryable): Promise<Rule[]> {
  const result = await pool.query(
    "SELECT id, entity, hook, type, definition, priority, active FROM _rules ORDER BY entity, priority",
  );
  const rules: Rule[] = [];
  for (const row of result.rows) {
    try {
      const def =
        typeof row.definition === "string"
          ? JSON.parse(row.definition)
          : row.definition;
      rules.push({
        id: row.id,
        entity: row.entity,
        hook: row.hook,
        type: row.type,
        definition: def as RuleDefinition,
        priority: row.priority,
        active: row.active,
      });
    } catch (err) {
      console.warn(`WARN: skipping rule ${row.id} (invalid JSON):`, err);
    }
  }
  return rules;
}

async function loadStateMachines(pool: Queryable): Promise<StateMachine[]> {
  const result = await pool.query(
    "SELECT id, entity, field, definition, active FROM _state_machines ORDER BY entity",
  );
  const machines: StateMachine[] = [];
  for (const row of result.rows) {
    try {
      const def =
        typeof row.definition === "string"
          ? JSON.parse(row.definition)
          : row.definition;
      machines.push({
        id: row.id,
        entity: row.entity,
        field: row.field,
        definition: normalizeDefinition(def as StateMachineDefinition),
        active: row.active,
      });
    } catch (err) {
      console.warn(
        `WARN: skipping state machine ${row.id} (invalid JSON):`,
        err,
      );
    }
  }
  return machines;
}

async function loadPermissions(pool: Queryable): Promise<Permission[]> {
  const result = await pool.query(
    "SELECT id, entity, action, roles, conditions FROM _permissions ORDER BY entity, action",
  );
  const permissions: Permission[] = [];
  for (const row of result.rows) {
    try {
      const conditions: PermissionCondition[] =
        typeof row.conditions === "string"
          ? JSON.parse(row.conditions)
          : (row.conditions ?? []);
      permissions.push({
        id: row.id,
        entity: row.entity,
        action: row.action,
        roles: row.roles ?? [],
        conditions,
      });
    } catch (err) {
      console.warn(`WARN: skipping permission ${row.id} (invalid JSON):`, err);
    }
  }
  return permissions;
}

async function loadWorkflows(pool: Queryable): Promise<Workflow[]> {
  const result = await pool.query(
    "SELECT id, name, trigger, context, steps, active FROM _workflows ORDER BY name",
  );
  const workflows: Workflow[] = [];
  for (const row of result.rows) {
    try {
      const trigger: WorkflowTrigger =
        typeof row.trigger === "string"
          ? JSON.parse(row.trigger)
          : row.trigger;
      const context: Record<string, string> =
        typeof row.context === "string"
          ? JSON.parse(row.context)
          : (row.context ?? {});
      const rawSteps: any[] =
        typeof row.steps === "string"
          ? JSON.parse(row.steps)
          : (row.steps ?? []);
      workflows.push({
        id: row.id,
        name: row.name,
        trigger,
        context,
        steps: normalizeWorkflowSteps(rawSteps),
        active: row.active,
      });
    } catch (err) {
      console.warn(`WARN: skipping workflow ${row.name} (invalid JSON):`, err);
    }
  }
  return workflows;
}

async function loadWebhooks(pool: Queryable): Promise<Webhook[]> {
  const result = await pool.query(
    "SELECT id, entity, hook, url, method, headers, condition, async, retry, active FROM _webhooks ORDER BY entity, hook",
  );
  const webhooks: Webhook[] = [];
  for (const row of result.rows) {
    try {
      const headers: Record<string, string> =
        typeof row.headers === "string"
          ? JSON.parse(row.headers)
          : (row.headers ?? {});
      const retry: WebhookRetry =
        typeof row.retry === "string"
          ? JSON.parse(row.retry)
          : (row.retry ?? { max_attempts: 3, backoff: "exponential" });
      webhooks.push({
        id: row.id,
        entity: row.entity,
        hook: row.hook,
        url: row.url,
        method: row.method,
        headers,
        condition: row.condition ?? "",
        async: row.async,
        retry,
        active: row.active,
      });
    } catch (err) {
      console.warn(`WARN: skipping webhook ${row.id} (invalid JSON):`, err);
    }
  }
  return webhooks;
}
