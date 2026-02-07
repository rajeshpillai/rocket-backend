export type RuleType = "field" | "expression" | "computed";
export type RuleHook = "before_write" | "before_delete";
export type FieldOperator = "min" | "max" | "min_length" | "max_length" | "pattern";

export const RULE_TYPES: RuleType[] = ["field", "expression", "computed"];
export const RULE_HOOKS: RuleHook[] = ["before_write", "before_delete"];
export const FIELD_OPERATORS: FieldOperator[] = [
  "min",
  "max",
  "min_length",
  "max_length",
  "pattern",
];

export interface RuleDefinition {
  field?: string;
  operator?: FieldOperator;
  value?: any;
  expression?: string;
  message?: string;
  stop_on_fail?: boolean;
}

export interface RulePayload {
  id?: string;
  entity: string;
  hook: RuleHook;
  type: RuleType;
  definition: RuleDefinition;
  priority: number;
  active: boolean;
}

/** Shape returned by GET /api/_admin/rules */
export interface RuleRow {
  id: string;
  entity: string;
  hook: string;
  type: string;
  definition: string | RuleDefinition;
  priority: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export function parseRuleDefinition(row: RuleRow): RuleDefinition {
  if (typeof row.definition === "string") {
    return JSON.parse(row.definition);
  }
  return row.definition;
}

export function emptyRule(): RulePayload {
  return {
    entity: "",
    hook: "before_write",
    type: "field",
    definition: {
      field: "",
      operator: "min",
      value: 0,
      message: "",
    },
    priority: 0,
    active: true,
  };
}
