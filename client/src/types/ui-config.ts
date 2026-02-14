export interface UIConfig {
  list?: ListConfig;
  detail?: DetailConfig;
  form?: FormConfig;
  sidebar?: SidebarConfig;
  pages?: PagesConfig;
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

// ── Public Pages Configuration ──

export interface PagesConfig {
  landing?: LandingPageConfig;
  detail?: DetailPageConfig;
}

export interface LandingPageConfig {
  route: string;
  title?: string;
  subtitle?: string;
  layout: "card-grid" | "list";
  data: PageDataConfig;
  card?: CardConfig;
}

export interface DetailPageConfig {
  route: string;
  layout: "article";
  data: PageDataConfig;
  sections: PageSection[];
}

export interface PageDataConfig {
  include?: string;
  filter?: Record<string, unknown>;
  sort?: string;
  per_page?: number;
}

export interface CardConfig {
  image?: string;
  title: string;
  excerpt?: string;
  date?: string;
  author?: RelationFieldConfig;
  tags?: TagsFieldConfig;
  click_action?: "navigate_detail";
}

export interface RelationFieldConfig {
  relation: string;
  name_field: string;
  avatar_field?: string;
  show_avatar?: boolean;
}

export interface TagsFieldConfig {
  relation: string;
  name_field: string;
  display?: "pill" | "text";
  max?: number;
}

export interface PageSection {
  type: "hero" | "meta" | "content" | "comments";
}

export interface HeroSection extends PageSection {
  type: "hero";
  image?: string;
  title: string;
  show_meta?: boolean;
}

export interface MetaSection extends PageSection {
  type: "meta";
  author?: RelationFieldConfig;
  date?: string;
  tags?: TagsFieldConfig;
}

export interface ContentSection extends PageSection {
  type: "content";
  field: string;
  format?: "markdown" | "html" | "text";
}

export interface CommentSection extends PageSection {
  type: "comments";
  relation: string;
  entity?: string;
  title?: string;
  allow_submit?: boolean;
  submit_fields?: Record<string, CommentFieldConfig>;
  display_fields?: {
    author?: string;
    date?: string;
    body?: string;
  };
  filter?: Record<string, unknown>;
  sort?: string;
  pending_message?: string;
}

export interface CommentFieldConfig {
  label: string;
  widget?: string;
  rows?: number;
  required?: boolean;
}

export interface UIConfigRow {
  id: string;
  entity: string;
  scope: string;
  config: UIConfig;
  created_at: string;
  updated_at: string;
}
