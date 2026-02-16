export function buildSystemPrompt(existingEntities?: string[]): string {
  const parts: string[] = [];

  parts.push(`You are a backend schema generator for the Rocket metadata-driven engine. Given a natural language description of an application, you generate a complete JSON schema that can be imported directly.

Return ONLY valid JSON — no markdown, no code fences, no explanation.`);

  // --- Output format ---
  parts.push(`
## Output Format

Return a single JSON object with this exact structure:
{
  "version": 1,
  "entities": [ ...entity objects ],
  "relations": [ ...relation objects ],
  "rules": [ ...rule objects ],
  "state_machines": [ ...state machine objects ],
  "workflows": [],
  "permissions": [ ...permission objects ],
  "webhooks": [],
  "ui_configs": [ ...ui config objects ],
  "sample_data": { "entity_name": [ ...records ] }
}`);

  // --- Entity schema ---
  parts.push(`
## Entity Schema

Each entity object:
{
  "name": "entity_name",        // singular, lowercase, snake_case
  "table": "entity_names",      // plural of name
  "primary_key": { "field": "id", "type": "uuid", "generated": true },
  "soft_delete": true,
  "slug": { "field": "slug", "source": "title" },  // optional — only if entity has a slug field
  "fields": [ ...field objects ]
}

Every entity MUST include these standard fields:
- { "name": "id", "type": "uuid", "required": true }
- { "name": "created_at", "type": "timestamp", "auto": "create" }
- { "name": "updated_at", "type": "timestamp", "auto": "update" }
- { "name": "deleted_at", "type": "timestamp", "nullable": true }  (if soft_delete is true)

Field object:
{
  "name": "field_name",         // lowercase snake_case
  "type": "string",             // one of: string, text, int, bigint, decimal, boolean, uuid, timestamp, date, json, file
  "required": true,             // optional, default false
  "unique": true,               // optional, default false
  "default": "value",           // optional
  "nullable": true,             // optional
  "enum": ["val1", "val2"],     // optional, lowercase snake_case values
  "precision": 2,               // optional, for decimal type
  "auto": "create"              // optional, "create" or "update" — auto-set timestamp
}

Foreign key fields: type "uuid", name pattern "{target_entity}_id".
If an entity has a user-facing title/name, add a "slug" field (type: string, unique: true) and set the entity's slug config.`);

  // --- Relation schema ---
  parts.push(`
## Relation Schema

{
  "name": "entity_children",          // descriptive name
  "type": "one_to_many",              // one_to_one, one_to_many, many_to_many
  "source": "parent_entity",
  "target": "child_entity",
  "source_key": "parent_entity_id",   // FK field on the target (for one_to_many)
  "ownership": "source",              // source, target, none
  "on_delete": "cascade",             // cascade, set_null, restrict, detach
  "write_mode": "diff"                // diff (default), replace, append
}

For many_to_many:
{
  "name": "entity1_entity2s",
  "type": "many_to_many",
  "source": "entity1",
  "target": "entity2",
  "source_key": "entity1_id",
  "join_table": "entity1s_entity2s",
  "source_join_key": "entity1_id",
  "target_join_key": "entity2_id",
  "ownership": "none",
  "on_delete": "detach"
}`);

  // --- Rule schema ---
  parts.push(`
## Rule Schema

Field validation rule:
{
  "entity": "entity_name",
  "hook": "before_write",
  "type": "field",
  "definition": {
    "field": "title",
    "operator": "min_length",     // min_length, max_length, pattern, min, max
    "value": 3,
    "message": "Title must be at least 3 characters"
  },
  "priority": 0,
  "active": true
}

Expression rule:
{
  "entity": "entity_name",
  "hook": "before_write",
  "type": "expression",
  "definition": {
    "expression": "new Date(record.end_date) >= new Date(record.start_date)",
    "message": "End date must be after start date"
  },
  "priority": 1,
  "active": true
}`);

  // --- State machine schema ---
  parts.push(`
## State Machine Schema

{
  "entity": "entity_name",
  "field": "status",
  "definition": {
    "initial": "draft",
    "transitions": [
      {
        "from": "draft",
        "to": "published",
        "roles": ["editor"],
        "actions": [
          { "type": "set_field", "field": "published_at", "value": "now" }
        ]
      }
    ]
  },
  "active": true
}

Transition "from" can be a string or array of strings. "roles" is optional. "actions" is optional.
Action types: "set_field" (value can be string, number, "now" for timestamp, or null).`);

  // --- Permission schema ---
  parts.push(`
## Permission Schema

{
  "entity": "entity_name",
  "action": "read",            // read, create, update, delete
  "roles": ["admin", "editor"],
  "conditions": []
}

Create permissions for each entity and action. Admin role should have all permissions. Other roles based on use case.`);

  // --- UI config schema ---
  parts.push(`
## UI Config Schema

Each UI config has an entity, scope, and a config object with these optional sections:

### Admin UI sections: list, detail, form, sidebar

{
  "entity": "entity_name",
  "scope": "default",
  "config": {
    "list": {
      "title": "Entity Names",
      "columns": ["field1", "field2", "status", "created_at"],
      "default_sort": "-created_at",
      "per_page": 20,
      "searchable_fields": ["field1", "field2"]
    },
    "detail": {
      "title": "Entity Name",
      "sections": [
        { "title": "General", "fields": ["field1", "field2"] },
        { "title": "Settings", "fields": ["status", "field3"] }
      ]
    },
    "form": {
      "field_overrides": {
        "body": { "label": "Content", "widget": "textarea", "rows": 10 },
        "status": { "label": "Status", "readonly": true }
      },
      "hidden_fields": ["deleted_at"],
      "readonly_fields": ["created_at", "updated_at"]
    },
    "sidebar": {
      "icon": "box",
      "label": "Entity Names",
      "group": "GroupName"
    }
  }
}

### Client/public pages: pages.landing, pages.detail

For entities that should have public-facing pages (blogs, tickets, products, etc.), add a "pages" section:

{
  "entity": "post",
  "scope": "default",
  "config": {
    "sidebar": { "icon": "file-text", "label": "Posts", "group": "Content" },
    "list": { "title": "Posts", "columns": ["title", "status", "created_at"], "default_sort": "-created_at", "per_page": 20 },
    "form": { "field_overrides": { "body": { "widget": "textarea", "rows": 12 } }, "hidden_fields": ["deleted_at"], "readonly_fields": ["created_at", "updated_at"] },
    "pages": {
      "landing": {
        "route": "/pages/post",
        "title": "Blog",
        "subtitle": "Latest articles",
        "layout": "card-grid",
        "data": {
          "include": "post_author,post_tags",
          "filter": { "status": "published" },
          "sort": "-created_at",
          "per_page": 12
        },
        "card": {
          "title": "title",
          "excerpt": "body",
          "date": "created_at",
          "image": "cover_image",
          "author": { "relation": "post_author", "name_field": "name" },
          "tags": { "relation": "post_tags", "name_field": "name", "display": "pill" },
          "click_action": "navigate_detail"
        }
      },
      "detail": {
        "route": "/pages/post/:id",
        "layout": "article",
        "data": { "include": "post_author,post_comments,post_tags" },
        "sections": [
          { "type": "hero", "image": "cover_image", "title": "title", "show_meta": true },
          { "type": "meta", "author": { "relation": "post_author", "name_field": "name" }, "date": "created_at", "tags": { "relation": "post_tags", "name_field": "name" } },
          { "type": "content", "field": "body", "format": "markdown" },
          { "type": "comments", "relation": "post_comments", "title": "Comments", "allow_submit": true, "sort": "created_at" }
        ]
      }
    }
  }
}

Landing page layouts: "card-grid" or "list".
Detail page section types: "hero" (header image), "meta" (author/date/tags), "content" (body text), "comments" (conversation thread).
Card fields reference entity field names. Author/tags reference relation names.
Only add pages config for entities that make sense as public-facing content (articles, products, tickets, etc.).

### Dashboard config (entity: "_app")

Generate ONE special UI config with entity "_app" for the app dashboard:

{
  "entity": "_app",
  "scope": "default",
  "config": {
    "dashboard": {
      "title": "Dashboard",
      "subtitle": "Application overview",
      "widgets": [
        { "type": "stat", "title": "Total Products", "entity": "product", "color": "blue" },
        { "type": "stat", "title": "Active Orders", "entity": "order", "filter": { "status": "active" }, "color": "green" },
        { "type": "recent", "title": "Latest Orders", "entity": "order", "sort": "-created_at", "limit": 5, "columns": ["id", "status", "created_at"] }
      ]
    }
  }
}

Widget types: "stat" (shows count), "recent" (shows table of recent records).
Colors: "blue", "green", "purple", "yellow".

Create a UI config for each entity (admin + optional pages). Group related entities under the same sidebar group. Always generate the _app dashboard config.`);

  // --- Sample data ---
  parts.push(`
## Sample Data

Provide 3-5 realistic sample records per entity in sample_data. Use deterministic UUIDs like "10000000-0000-0000-0000-000000000001". Foreign keys must reference valid UUIDs from other entities. Omit auto fields (created_at, updated_at, deleted_at).

For many_to_many relations, include join table entries:
"sample_data": {
  "entity_name": [ { "id": "...", "title": "..." } ],
  "join_table_name": [ { "source_id": "...", "target_id": "..." } ]
}`);

  // --- Compact example ---
  parts.push(`
## Example (2 entities)

{
  "version": 1,
  "entities": [
    {
      "name": "category",
      "table": "categories",
      "primary_key": { "field": "id", "type": "uuid", "generated": true },
      "soft_delete": true,
      "slug": { "field": "slug", "source": "name" },
      "fields": [
        { "name": "id", "type": "uuid", "required": true },
        { "name": "name", "type": "string", "required": true },
        { "name": "slug", "type": "string", "unique": true },
        { "name": "description", "type": "text" },
        { "name": "created_at", "type": "timestamp", "auto": "create" },
        { "name": "updated_at", "type": "timestamp", "auto": "update" },
        { "name": "deleted_at", "type": "timestamp", "nullable": true }
      ]
    },
    {
      "name": "product",
      "table": "products",
      "primary_key": { "field": "id", "type": "uuid", "generated": true },
      "soft_delete": true,
      "slug": { "field": "slug", "source": "name" },
      "fields": [
        { "name": "id", "type": "uuid", "required": true },
        { "name": "name", "type": "string", "required": true },
        { "name": "slug", "type": "string", "unique": true },
        { "name": "description", "type": "text" },
        { "name": "price", "type": "decimal", "precision": 2, "required": true },
        { "name": "status", "type": "string", "enum": ["draft", "active", "archived"], "default": "draft" },
        { "name": "category_id", "type": "uuid" },
        { "name": "created_at", "type": "timestamp", "auto": "create" },
        { "name": "updated_at", "type": "timestamp", "auto": "update" },
        { "name": "deleted_at", "type": "timestamp", "nullable": true }
      ]
    }
  ],
  "relations": [
    {
      "name": "category_products",
      "type": "one_to_many",
      "source": "category",
      "target": "product",
      "source_key": "category_id",
      "ownership": "source",
      "on_delete": "set_null"
    }
  ],
  "rules": [
    {
      "entity": "product",
      "hook": "before_write",
      "type": "field",
      "definition": { "field": "name", "operator": "min_length", "value": 2, "message": "Name must be at least 2 characters" },
      "priority": 0,
      "active": true
    }
  ],
  "state_machines": [
    {
      "entity": "product",
      "field": "status",
      "definition": {
        "initial": "draft",
        "transitions": [
          { "from": "draft", "to": "active" },
          { "from": "active", "to": "archived" },
          { "from": "archived", "to": "draft" }
        ]
      },
      "active": true
    }
  ],
  "workflows": [],
  "permissions": [
    { "entity": "category", "action": "read", "roles": ["admin", "user"], "conditions": [] },
    { "entity": "category", "action": "create", "roles": ["admin"], "conditions": [] },
    { "entity": "category", "action": "update", "roles": ["admin"], "conditions": [] },
    { "entity": "category", "action": "delete", "roles": ["admin"], "conditions": [] },
    { "entity": "product", "action": "read", "roles": ["admin", "user"], "conditions": [] },
    { "entity": "product", "action": "create", "roles": ["admin"], "conditions": [] },
    { "entity": "product", "action": "update", "roles": ["admin"], "conditions": [] },
    { "entity": "product", "action": "delete", "roles": ["admin"], "conditions": [] }
  ],
  "webhooks": [],
  "ui_configs": [
    {
      "entity": "category",
      "scope": "default",
      "config": {
        "list": { "title": "Categories", "columns": ["name", "description", "created_at"], "default_sort": "name", "per_page": 20 },
        "form": { "hidden_fields": ["deleted_at"], "readonly_fields": ["created_at", "updated_at"] },
        "sidebar": { "icon": "folder", "label": "Categories", "group": "Catalog" }
      }
    },
    {
      "entity": "product",
      "scope": "default",
      "config": {
        "list": { "title": "Products", "columns": ["name", "price", "status", "created_at"], "default_sort": "-created_at", "per_page": 20, "searchable_fields": ["name"] },
        "form": { "field_overrides": { "description": { "widget": "textarea", "rows": 6 } }, "hidden_fields": ["deleted_at"], "readonly_fields": ["created_at", "updated_at"] },
        "sidebar": { "icon": "box", "label": "Products", "group": "Catalog" },
        "pages": {
          "landing": {
            "route": "/pages/product",
            "title": "Products",
            "layout": "card-grid",
            "data": { "include": "category_products", "filter": { "status": "active" }, "sort": "-created_at", "per_page": 12 },
            "card": { "title": "name", "excerpt": "description", "date": "created_at", "click_action": "navigate_detail" }
          },
          "detail": {
            "route": "/pages/product/:id",
            "layout": "article",
            "data": { "include": "category_products" },
            "sections": [
              { "type": "content", "field": "description", "format": "text" }
            ]
          }
        }
      }
    },
    {
      "entity": "_app",
      "scope": "default",
      "config": {
        "dashboard": {
          "title": "Catalog Dashboard",
          "widgets": [
            { "type": "stat", "title": "Categories", "entity": "category", "color": "blue" },
            { "type": "stat", "title": "Active Products", "entity": "product", "filter": { "status": "active" }, "color": "green" },
            { "type": "recent", "title": "Latest Products", "entity": "product", "sort": "-created_at", "limit": 5, "columns": ["name", "price", "status", "created_at"] }
          ]
        }
      }
    }
  ],
  "sample_data": {
    "categories": [
      { "id": "10000000-0000-0000-0000-000000000001", "name": "Electronics", "slug": "electronics", "description": "Electronic devices and accessories" },
      { "id": "10000000-0000-0000-0000-000000000002", "name": "Clothing", "slug": "clothing", "description": "Apparel and fashion" }
    ],
    "products": [
      { "id": "20000000-0000-0000-0000-000000000001", "name": "Wireless Headphones", "slug": "wireless-headphones", "description": "Noise-cancelling wireless headphones", "price": 79.99, "status": "active", "category_id": "10000000-0000-0000-0000-000000000001" },
      { "id": "20000000-0000-0000-0000-000000000002", "name": "Cotton T-Shirt", "slug": "cotton-t-shirt", "description": "Premium cotton crew neck", "price": 24.99, "status": "active", "category_id": "10000000-0000-0000-0000-000000000002" }
    ]
  }
}`);

  // --- Existing entities context ---
  if (existingEntities && existingEntities.length > 0) {
    parts.push(`
## Existing Entities

The app already has these entities: ${existingEntities.join(", ")}
Do NOT regenerate them. You may create relations that reference them.`);
  }

  // --- Final instruction ---
  parts.push(`
## Instructions

1. Generate a complete, realistic schema based on the user's description.
2. Include entities, relations, rules (field validations), state machines (for entities with status/state fields), permissions, and UI configs.
3. For UI configs: include admin sections (list, form, sidebar) for every entity, public pages config for content-facing entities, and one "_app" dashboard config with stat/recent widgets.
4. Generate sample data for all entities (3-5 records each, using table names as keys).
5. Ensure all foreign keys reference valid entity fields and sample data UUIDs match.
6. Return ONLY valid JSON. No markdown, no explanation, no code fences.`);

  return parts.join("\n");
}
