export type FieldType =
  | "string"
  | "text"
  | "int"
  | "bigint"
  | "decimal"
  | "boolean"
  | "uuid"
  | "timestamp"
  | "date"
  | "json"
  | "file";

export interface Field {
  name: string;
  type: FieldType;
  required?: boolean;
  unique?: boolean;
  default?: unknown;
  nullable?: boolean;
  enum?: string[];
  precision?: number;
  auto?: "create" | "update";
}

export interface PrimaryKey {
  field: string;
  type: string;
  generated: boolean;
}

export interface EntityDefinition {
  name: string;
  table: string;
  primary_key: PrimaryKey;
  soft_delete: boolean;
  fields: Field[];
}

export interface EntityRow {
  name: string;
  table_name: string;
  definition: string | EntityDefinition;
  created_at: string;
  updated_at: string;
}

export interface RelationRow {
  name: string;
  source: string;
  target: string;
  definition: string | RelationDefinition;
  created_at: string;
  updated_at: string;
}

export interface RelationDefinition {
  name: string;
  type: "one_to_one" | "one_to_many" | "many_to_many";
  source: string;
  target: string;
  source_key: string;
  target_key: string;
  ownership: string;
  on_delete: string;
  fetch: string;
  write_mode: string;
}

export function parseDefinition(row: EntityRow): EntityDefinition {
  if (typeof row.definition === "string") {
    return JSON.parse(row.definition) as EntityDefinition;
  }
  return row.definition;
}

export function parseRelationDefinition(row: RelationRow): RelationDefinition {
  if (typeof row.definition === "string") {
    return JSON.parse(row.definition) as RelationDefinition;
  }
  return row.definition;
}

export function isEditableField(field: Field): boolean {
  return !field.auto && field.name !== "id" && field.name !== "deleted_at";
}
