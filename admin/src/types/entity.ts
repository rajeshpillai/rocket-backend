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
  | "json";

export const FIELD_TYPES: FieldType[] = [
  "string",
  "text",
  "int",
  "bigint",
  "decimal",
  "boolean",
  "uuid",
  "timestamp",
  "date",
  "json",
];

export const PK_TYPES = ["uuid", "int", "bigint", "string"] as const;

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

/** Shape returned by GET /api/_admin/entities and GET /api/_admin/entities/:name */
export interface EntityRow {
  name: string;
  table_name: string;
  definition: string | EntityDefinition;
  created_at: string;
  updated_at: string;
}

/** Parse the definition field which may be a JSON string or already-parsed object */
export function parseDefinition(row: EntityRow): EntityDefinition {
  if (typeof row.definition === "string") {
    return JSON.parse(row.definition);
  }
  return row.definition;
}
