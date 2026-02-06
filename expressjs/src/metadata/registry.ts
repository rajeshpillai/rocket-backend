import type { Entity, Relation } from "./types.js";

export class Registry {
  private entities = new Map<string, Entity>();
  private relationsBySource = new Map<string, Relation[]>();
  private relationsByName = new Map<string, Relation>();

  getEntity(name: string): Entity | undefined {
    return this.entities.get(name);
  }

  allEntities(): Entity[] {
    return Array.from(this.entities.values());
  }

  getRelation(name: string): Relation | undefined {
    return this.relationsByName.get(name);
  }

  getRelationsForSource(entityName: string): Relation[] {
    return this.relationsBySource.get(entityName) ?? [];
  }

  findRelationForEntity(
    relationName: string,
    entityName: string,
  ): Relation | undefined {
    const rel = this.relationsByName.get(relationName);
    if (rel && (rel.source === entityName || rel.target === entityName)) {
      return rel;
    }
    // Also search by target/source entity name as the include alias
    for (const r of this.relationsByName.values()) {
      if (r.source === entityName && r.target === relationName) {
        return r;
      }
      if (r.target === entityName && r.source === relationName) {
        return r;
      }
    }
    return undefined;
  }

  allRelations(): Relation[] {
    return Array.from(this.relationsByName.values());
  }

  load(entities: Entity[], relations: Relation[]): void {
    this.entities = new Map();
    for (const e of entities) {
      this.entities.set(e.name, e);
    }

    this.relationsBySource = new Map();
    this.relationsByName = new Map();
    for (const rel of relations) {
      this.relationsByName.set(rel.name, rel);
      const existing = this.relationsBySource.get(rel.source) ?? [];
      existing.push(rel);
      this.relationsBySource.set(rel.source, existing);
    }
  }
}
