export interface HelpTopic {
  slug: string;
  title: string;
  subtitle: string;
  icon: string;
  category: string;
}

export const helpTopics: HelpTopic[] = [
  { slug: "getting-started", title: "Getting Started", subtitle: "Overview, authentication, and creating your first app", icon: "\u25B6", category: "Basics" },
  { slug: "entities", title: "Entities", subtitle: "Define entities, field types, primary keys, and soft delete", icon: "\u25A1", category: "Basics" },
  { slug: "relations", title: "Relations", subtitle: "One-to-many, many-to-many, and one-to-one relationships", icon: "\u21C4", category: "Basics" },
  { slug: "crud-and-querying", title: "CRUD & Querying", subtitle: "Dynamic endpoints, filters, sorting, pagination, includes", icon: "\u25A4", category: "Data" },
  { slug: "nested-writes", title: "Nested Writes", subtitle: "Diff, replace, and append modes with transaction safety", icon: "\u2725", category: "Data" },
  { slug: "validation-rules", title: "Validation Rules", subtitle: "Field rules, expression rules, computed fields", icon: "\u2713", category: "Business Logic" },
  { slug: "state-machines", title: "State Machines", subtitle: "Transitions, guards, and actions on state fields", icon: "\u21C6", category: "Business Logic" },
  { slug: "workflows", title: "Workflows", subtitle: "Multi-step processes, approvals, conditions, timeouts", icon: "\u27F3", category: "Business Logic" },
  { slug: "webhooks", title: "Webhooks", subtitle: "Async and sync HTTP callouts, conditions, retry", icon: "\uD83D\uDD17", category: "Business Logic" },
  { slug: "permissions", title: "Permissions", subtitle: "Whitelist model, row-level security, write conditions", icon: "\uD83D\uDD12", category: "Security" },
  { slug: "file-uploads", title: "File Uploads", subtitle: "Upload, serve, and manage file fields", icon: "\uD83D\uDCC1", category: "Advanced" },
  { slug: "schema-export-import", title: "Schema Export/Import", subtitle: "Backup and portability between environments", icon: "\u21D4", category: "Advanced" },
  { slug: "api-reference", title: "API Reference", subtitle: "Complete endpoint reference for all routes", icon: "\u2630", category: "Advanced" },
];

export const categoryOrder = ["Basics", "Data", "Business Logic", "Security", "Advanced"];
