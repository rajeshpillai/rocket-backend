# UI Metadata Layer

The client app supports per-entity UI customization through a metadata-driven configuration system. Configurations are stored in the `_ui_configs` system table and consumed by the client at runtime.

## How It Works

1. **Backend** stores UI configs as JSONB in `_ui_configs` (one row per entity + scope)
2. **Client** fetches all configs on login via `GET /_ui/configs` and caches them in a SolidJS store
3. **Generic pages** (entity-list, entity-detail) read the cached config and adjust their rendering accordingly
4. **Custom pages** can completely replace the generic pages for specific entities via the custom page registry

## Configuration Shape

All sections are optional. The client falls back to default behavior for anything not specified.

```json
{
  "list": {
    "title": "Blog Posts",
    "columns": ["title", "status", "author_id", "created_at"],
    "default_sort": "-created_at",
    "per_page": 25,
    "searchable_fields": ["title", "body"]
  },
  "detail": {
    "title": "Post Details",
    "sections": [
      { "title": "Basic Info", "fields": ["title", "slug", "status"] },
      { "title": "Content", "fields": ["body", "excerpt"] },
      { "title": "Metadata", "fields": ["author_id", "category_id"] }
    ]
  },
  "form": {
    "field_overrides": {
      "body": { "widget": "textarea", "rows": 10, "label": "Post Content" },
      "status": { "label": "Publication Status" },
      "slug": { "readonly": true, "help": "Auto-generated from title" }
    },
    "hidden_fields": ["internal_notes"],
    "readonly_fields": ["created_at", "updated_at"]
  },
  "sidebar": {
    "icon": "document",
    "label": "Blog Posts",
    "group": "Content"
  }
}
```

## Config Sections

### `list` — Entity List Page

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Page heading (defaults to entity name) |
| `columns` | string[] | Which fields to show as table columns, in order. Defaults to first 8 non-hidden fields. |
| `default_sort` | string | Initial sort field. Prefix with `-` for descending (e.g. `"-created_at"`). |
| `per_page` | number | Initial page size (default 25) |
| `searchable_fields` | string[] | Fields available for text search (reserved for future use) |

### `detail` — Entity Detail Page

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Page heading (defaults to entity name) |
| `sections` | array | Groups fields into titled sections. Each section has `title` (string) and `fields` (string[]). When sections are defined, each renders as a separate form group. |

### `form` — Record Form (used by both list and detail pages)

| Field | Type | Description |
|-------|------|-------------|
| `field_overrides` | object | Per-field display overrides (keyed by field name) |
| `hidden_fields` | string[] | Fields to hide from forms and tables |
| `readonly_fields` | string[] | Fields that cannot be edited |

**Field Override Options:**

| Option | Type | Description |
|--------|------|-------------|
| `label` | string | Custom display label (replaces field name) |
| `widget` | string | Input widget type (e.g. `"textarea"`) |
| `rows` | number | Rows for textarea widget (default 4) |
| `readonly` | boolean | Make this field read-only |
| `help` | string | Help text shown below the input |

### `sidebar` — Navigation Sidebar

| Field | Type | Description |
|-------|------|-------------|
| `icon` | string | Icon identifier (reserved for future use) |
| `label` | string | Display label in sidebar (defaults to entity name) |
| `group` | string | Group heading in sidebar (defaults to "Data") |

## Client Architecture

### Files

| File | Purpose |
|------|---------|
| `src/types/ui-config.ts` | TypeScript interfaces for config shape |
| `src/stores/ui-config.ts` | Cached config store (`loadUIConfigs()`, `getEntityUIConfig()`) |
| `src/api/data.ts` | API functions (`listUIConfigs()`, `getUIConfig()`) |
| `src/components/sidebar.tsx` | Reads sidebar config for grouping and labels |
| `src/components/record-form.tsx` | Applies form config (hidden, readonly, labels, help) |
| `src/pages/entity-list.tsx` | Applies list config (columns, sort, title, per_page) |
| `src/pages/entity-detail.tsx` | Applies detail config (sections, title) |

### Store Usage

```typescript
import { loadUIConfigs, getEntityUIConfig } from "../stores/ui-config";

// On app login, load all configs (called once in sidebar)
await loadUIConfigs();

// In any page or component, get config for an entity
const config = getEntityUIConfig("post");
if (config?.list?.columns) {
  // Use configured columns
}
```

### API Endpoints (Non-Admin)

These endpoints require authentication but not admin role:

```
GET /api/:app/_ui/configs          # All configs (for sidebar grouping on load)
GET /api/:app/_ui/config/:entity   # Single entity config (default scope)
```

### Admin CRUD Endpoints

Full management via the admin API:

```
GET    /api/:app/_admin/ui-configs
GET    /api/:app/_admin/ui-configs/:id
POST   /api/:app/_admin/ui-configs      # { entity, scope?, config }
PUT    /api/:app/_admin/ui-configs/:id
DELETE /api/:app/_admin/ui-configs/:id
```

## Custom Page Registry

For cases where metadata-driven customization isn't enough, entities can have fully custom page components that replace the generic list or detail page.

### Files

| File | Purpose |
|------|---------|
| `src/pages/custom/registry.ts` | Central mapping of entity → custom components |

### Registering a Custom Page

```typescript
// src/pages/custom/registry.ts
import { lazy } from "solid-js";

const customPages = {
  "post": {
    list: lazy(() => import("./post-list")),
    detail: lazy(() => import("./post-detail")),
  },
};
```

Or register dynamically:

```typescript
import { registerCustomPage } from "./pages/custom/registry";
import { lazy } from "solid-js";

registerCustomPage("post", "list", lazy(() => import("./pages/custom/post-list")));
```

### How Fallback Works

The generic `entity-list.tsx` and `entity-detail.tsx` pages check the registry first:

```tsx
const CustomPage = () => params.entity ? getCustomPage(params.entity, "list") : null;

return (
  <Show when={!CustomPage()} fallback={<CustomPage />}>
    {/* generic page content */}
  </Show>
);
```

If a custom component is registered for the entity+page type, it renders instead of the generic page. The custom component receives no props — it uses `useParams()` to get the entity name and record ID.

### Building a Custom Page

Custom pages can reuse all existing components:

```tsx
// src/pages/custom/post-list.tsx
import { useParams } from "@solidjs/router";
import DataTable from "../../components/data-table";
import Pagination from "../../components/pagination";
import FilterBar from "../../components/filter-bar";

export default function PostList() {
  const params = useParams();
  // Custom layout using shared components
  // ...
}
```

## Examples

### Minimal Config (just sidebar label)

```json
{
  "sidebar": { "label": "Orders", "group": "Commerce" }
}
```

### Full Config

```json
{
  "list": {
    "title": "Customer Orders",
    "columns": ["order_number", "customer_name", "total", "status", "created_at"],
    "default_sort": "-created_at",
    "per_page": 50
  },
  "detail": {
    "title": "Order Details",
    "sections": [
      { "title": "Order Info", "fields": ["order_number", "status", "total"] },
      { "title": "Customer", "fields": ["customer_name", "customer_email"] },
      { "title": "Timestamps", "fields": ["created_at", "updated_at"] }
    ]
  },
  "form": {
    "field_overrides": {
      "order_number": { "label": "Order #", "readonly": true },
      "total": { "label": "Total Amount" },
      "status": { "label": "Order Status", "help": "Changes trigger workflow notifications" }
    },
    "hidden_fields": ["internal_tracking_id"],
    "readonly_fields": ["created_at", "updated_at"]
  },
  "sidebar": {
    "label": "Orders",
    "group": "Commerce"
  }
}
```
