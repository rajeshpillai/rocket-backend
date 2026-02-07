export interface RelatedLoadSpec {
  relation: string;
  filter?: Record<string, any>;
}

export interface RuleDefinition {
  // Field rules
  field?: string;
  operator?: string;
  value?: any;

  // Expression / computed rules
  expression?: string;

  // Shared
  message?: string;
  stop_on_fail?: boolean;

  // Related data loading
  related_load?: RelatedLoadSpec[];
}

export interface Rule {
  id: string;
  entity: string;
  hook: string; // "before_write", "before_delete"
  type: string; // "field", "expression", "computed"
  definition: RuleDefinition;
  priority: number;
  active: boolean;

  // Compiled expression (set at evaluation time, not serialized)
  compiled?: any;
}
