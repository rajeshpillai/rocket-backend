export type RelationType = "one_to_one" | "one_to_many" | "many_to_many";
export type Ownership = "source" | "target" | "none";
export type OnDelete = "cascade" | "set_null" | "restrict" | "detach";
export type FetchStrategy = "lazy" | "eager";
export type WriteMode = "diff" | "replace" | "append";

export const RELATION_TYPES: RelationType[] = [
  "one_to_one",
  "one_to_many",
  "many_to_many",
];

export const OWNERSHIP_OPTIONS: Ownership[] = ["source", "target", "none"];
export const ON_DELETE_OPTIONS: OnDelete[] = [
  "cascade",
  "set_null",
  "restrict",
  "detach",
];
export const FETCH_OPTIONS: FetchStrategy[] = ["lazy", "eager"];
export const WRITE_MODE_OPTIONS: WriteMode[] = ["diff", "replace", "append"];

export interface RelationDefinition {
  name: string;
  type: RelationType;
  source: string;
  target: string;
  source_key: string;
  target_key?: string;
  join_table?: string;
  source_join_key?: string;
  target_join_key?: string;
  ownership: Ownership;
  on_delete: OnDelete;
  fetch?: FetchStrategy;
  write_mode?: WriteMode;
}

/** Shape returned by GET /api/_admin/relations */
export interface RelationRow {
  name: string;
  source: string;
  target: string;
  definition: string | RelationDefinition;
  created_at: string;
  updated_at: string;
}

export function parseRelationDefinition(row: RelationRow): RelationDefinition {
  if (typeof row.definition === "string") {
    return JSON.parse(row.definition);
  }
  return row.definition;
}
