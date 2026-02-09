export interface Field {
  name: string;
  type: string;
  required?: boolean;
  unique?: boolean;
  default?: any;
  nullable?: boolean;
  enum?: string[];
  precision?: number;
  auto?: string; // "create" or "update"
}

export interface PrimaryKey {
  field: string;
  type: string; // uuid, int, bigint, string
  generated: boolean;
}

export interface Entity {
  name: string;
  table: string;
  primary_key: PrimaryKey;
  soft_delete: boolean;
  fields: Field[];
}

export interface Relation {
  name: string;
  type: string; // one_to_one, one_to_many, many_to_many
  source: string;
  target: string;
  source_key: string;
  target_key?: string;
  join_table?: string;
  source_join_key?: string;
  target_join_key?: string;
  ownership: string; // source, target, none
  on_delete: string; // cascade, set_null, restrict, detach
  fetch?: string; // lazy (default), eager
  write_mode?: string; // diff (default), replace, append
}

export function postgresType(f: Field): string {
  switch (f.type) {
    case "string":
    case "text":
      return "TEXT";
    case "int":
    case "integer":
      return "INTEGER";
    case "bigint":
      return "BIGINT";
    case "float":
      return "DOUBLE PRECISION";
    case "decimal":
      if (f.precision && f.precision > 0) {
        return `NUMERIC(18,${f.precision})`;
      }
      return "NUMERIC";
    case "boolean":
      return "BOOLEAN";
    case "uuid":
      return "UUID";
    case "timestamp":
      return "TIMESTAMPTZ";
    case "date":
      return "DATE";
    case "json":
    case "file":
      return "JSONB";
    default:
      return "TEXT";
  }
}

export function isAuto(f: Field): boolean {
  return f.auto === "create" || f.auto === "update";
}

export function getField(entity: Entity, name: string): Field | undefined {
  return entity.fields.find((f) => f.name === name);
}

export function hasField(entity: Entity, name: string): boolean {
  return getField(entity, name) !== undefined;
}

export function fieldNames(entity: Entity): string[] {
  return entity.fields.map((f) => f.name);
}

export function writableFields(entity: Entity): Field[] {
  return entity.fields.filter((f) => {
    if (
      f.name === entity.primary_key.field &&
      entity.primary_key.generated
    ) {
      return false;
    }
    if (isAuto(f)) return false;
    return true;
  });
}

export function updatableFields(entity: Entity): Field[] {
  return entity.fields.filter((f) => {
    if (f.name === entity.primary_key.field) return false;
    if (isAuto(f)) return false;
    if (f.name === "deleted_at") return false;
    return true;
  });
}

export function isManyToMany(r: Relation): boolean {
  return r.type === "many_to_many";
}

export function isOneToMany(r: Relation): boolean {
  return r.type === "one_to_many";
}

export function isOneToOne(r: Relation): boolean {
  return r.type === "one_to_one";
}

export function defaultWriteMode(r: Relation): string {
  return r.write_mode || "diff";
}

export function defaultFetch(r: Relation): string {
  return r.fetch || "lazy";
}
