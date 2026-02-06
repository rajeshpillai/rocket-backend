import type { Store } from "./postgres.js";
import type { Entity, Relation } from "../metadata/types.js";
import { getField, postgresType } from "../metadata/types.js";

export class Migrator {
  private store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  async migrate(entity: Entity): Promise<void> {
    const exists = await this.tableExists(entity.table);
    if (!exists) {
      await this.createTable(entity);
    } else {
      await this.alterTable(entity);
    }
  }

  async migrateJoinTable(
    rel: Relation,
    sourceEntity: Entity,
    targetEntity: Entity,
  ): Promise<void> {
    if (!rel.join_table) return;
    const exists = await this.tableExists(rel.join_table);
    if (exists) return;

    const sourceField = getField(sourceEntity, rel.source_key);
    const targetField = getField(
      targetEntity,
      targetEntity.primary_key.field,
    );
    if (!sourceField || !targetField) {
      throw new Error(
        `Cannot resolve key types for join table ${rel.join_table}`,
      );
    }

    const sql = `CREATE TABLE ${rel.join_table} (
      ${rel.source_join_key} ${postgresType(sourceField)} NOT NULL,
      ${rel.target_join_key} ${postgresType(targetField)} NOT NULL,
      PRIMARY KEY (${rel.source_join_key}, ${rel.target_join_key})
    )`;
    await this.store.pool.query(sql);
  }

  private async tableExists(tableName: string): Promise<boolean> {
    const result = await this.store.pool.query(
      `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = $1 AND table_schema = 'public')`,
      [tableName],
    );
    return result.rows[0].exists;
  }

  private async createTable(entity: Entity): Promise<void> {
    const cols: string[] = [];
    for (const f of entity.fields) {
      cols.push(this.buildColumnDef(entity, f));
    }

    if (entity.soft_delete && !getField(entity, "deleted_at")) {
      cols.push("deleted_at TIMESTAMPTZ");
    }

    const sql = `CREATE TABLE ${entity.table} (\n  ${cols.join(",\n  ")}\n)`;
    await this.store.pool.query(sql);
    await this.createIndexes(entity);
  }

  private async alterTable(entity: Entity): Promise<void> {
    const existing = await this.getColumns(entity.table);

    for (const f of entity.fields) {
      if (!existing.has(f.name)) {
        const colType = postgresType(f);
        let notNull = "";
        if (f.required && !f.nullable) {
          notNull = " NOT NULL DEFAULT ''";
        }
        const sql = `ALTER TABLE ${entity.table} ADD COLUMN ${f.name} ${colType}${notNull}`;
        await this.store.pool.query(sql);
      }
    }

    if (entity.soft_delete && !existing.has("deleted_at")) {
      const sql = `ALTER TABLE ${entity.table} ADD COLUMN deleted_at TIMESTAMPTZ`;
      await this.store.pool.query(sql);
    }

    await this.createIndexes(entity);
  }

  private buildColumnDef(
    entity: Entity,
    f: { name: string; type: string; required?: boolean; nullable?: boolean; default?: any },
  ): string {
    let col = `${f.name} ${postgresType(f as any)}`;

    if (f.name === entity.primary_key.field) {
      col += " PRIMARY KEY";
      if (
        entity.primary_key.generated &&
        entity.primary_key.type === "uuid"
      ) {
        col += " DEFAULT gen_random_uuid()";
      }
    }

    if (f.required && !f.nullable && f.name !== entity.primary_key.field) {
      col += " NOT NULL";
    }

    if (f.default != null && f.name !== entity.primary_key.field) {
      if (typeof f.default === "string") {
        col += ` DEFAULT '${f.default}'`;
      } else if (typeof f.default === "boolean") {
        col += ` DEFAULT ${f.default}`;
      } else if (typeof f.default === "number") {
        col += ` DEFAULT ${f.default}`;
      } else {
        col += ` DEFAULT '${f.default}'`;
      }
    }

    return col;
  }

  private async getColumns(tableName: string): Promise<Map<string, string>> {
    const result = await this.store.pool.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'`,
      [tableName],
    );
    const cols = new Map<string, string>();
    for (const row of result.rows) {
      cols.set(row.column_name, row.data_type);
    }
    return cols;
  }

  private async createIndexes(entity: Entity): Promise<void> {
    for (const f of entity.fields) {
      if (f.unique) {
        const sql = `CREATE UNIQUE INDEX IF NOT EXISTS idx_${entity.table}_${f.name} ON ${entity.table} (${f.name})`;
        await this.store.pool.query(sql);
      }
    }

    if (entity.soft_delete) {
      const sql = `CREATE INDEX IF NOT EXISTS idx_${entity.table}_deleted_at ON ${entity.table} (deleted_at) WHERE deleted_at IS NULL`;
      await this.store.pool.query(sql);
    }
  }
}
