import type { Queryable } from "../store/postgres.js";
import type { Registry } from "./registry.js";
import type { Entity, Relation } from "./types.js";

export async function loadAll(
  pool: Queryable,
  registry: Registry,
): Promise<void> {
  const entities = await loadEntities(pool);
  const relations = await loadRelations(pool);
  registry.load(entities, relations);
  console.log(
    `Loaded ${entities.length} entities, ${relations.length} relations into registry`,
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
