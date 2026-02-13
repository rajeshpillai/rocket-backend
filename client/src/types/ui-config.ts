export interface UIConfig {
  list?: ListConfig;
  detail?: DetailConfig;
  form?: FormConfig;
  sidebar?: SidebarConfig;
}

export interface ListConfig {
  title?: string;
  columns?: string[];
  default_sort?: string;
  per_page?: number;
  searchable_fields?: string[];
}

export interface DetailConfig {
  title?: string;
  sections?: SectionConfig[];
}

export interface SectionConfig {
  title: string;
  fields: string[];
}

export interface FormConfig {
  field_overrides?: Record<string, FieldOverride>;
  hidden_fields?: string[];
  readonly_fields?: string[];
}

export interface FieldOverride {
  label?: string;
  widget?: string;
  rows?: number;
  readonly?: boolean;
  help?: string;
}

export interface SidebarConfig {
  icon?: string;
  label?: string;
  group?: string;
}

export interface UIConfigRow {
  id: string;
  entity: string;
  scope: string;
  config: UIConfig;
  created_at: string;
  updated_at: string;
}
