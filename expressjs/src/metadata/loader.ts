import type { Queryable } from "../store/postgres.js";
import type { Registry } from "./registry.js";
import type { Entity, Relation } from "./types.js";
import type { Rule, RuleDefinition } from "./rule.js";

export async function loadAll(
  pool: Queryable,
  registry: Registry,
): Promise<void> {
  const entities = await loadEntities(pool);
  const relations = await loadRelations(pool);
  registry.load(entities, relations);

  const rules = await loadRules(pool);
  registry.loadRules(rules);

  console.log(
    `Loaded ${entities.length} entities, ${relations.length} relations, ${rules.length} rules into registry`,
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
