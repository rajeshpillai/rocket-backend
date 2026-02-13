# Client UI — Deployment Guide

## Overview

The client UI is a **SolidJS** single-page application that renders config-driven public pages for any Rocket app. Unlike the admin UI (which manages metadata), the client UI is the **end-user-facing frontend** — blog listings, support portals, customer directories, etc.

All rendering is driven by **UI configs** stored in the `_ui_configs` table. No code changes are needed to add new entities or page layouts — just update the JSON config.

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | SolidJS |
| Build tool | Vite |
| Routing | @solidjs/router |
| HTTP client | fetch (native) |
| Styling | Tailwind CSS |
| State | SolidJS signals |

## Project Structure

```
client/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── .env.helpdesk          # Standalone helpdesk build config
├── .env.cms               # Standalone CMS build config
└── src/
    ├── app.tsx             # Router, auth guard, layout wiring
    ├── api/
    │   ├── client.ts       # Base HTTP client (auto-prefixes /api/{app})
    │   ├── data.ts         # Entity CRUD, UI config, file operations
    │   └── platform.ts     # Platform auth + app listing
    ├── components/
    │   ├── layout.tsx       # Admin layout (sidebar + content)
    │   ├── public-layout.tsx # Public pages layout (header + nav + footer)
    │   ├── sidebar.tsx      # Admin sidebar with dynamic entity links
    │   ├── comment-section.tsx # Reusable comments/conversation component
    │   └── toast.tsx        # Notification toasts
    ├── pages/
    │   ├── login.tsx        # Platform login
    │   ├── apps.tsx         # App selector
    │   ├── app-login.tsx    # Per-app login
    │   ├── dashboard.tsx    # Admin dashboard
    │   ├── entity-list.tsx  # Admin data browser
    │   ├── entity-detail.tsx # Admin record detail
    │   └── public/
    │       ├── entity-landing.tsx  # Config-driven landing page (card grid)
    │       └── entity-detail.tsx   # Config-driven detail page (article layout)
    ├── stores/
    │   ├── app.ts           # Selected app + VITE_FIXED_APP support
    │   ├── app-auth.ts      # Per-app JWT tokens
    │   ├── auth.ts          # Platform JWT tokens
    │   ├── ui-config.ts     # UI config loading + caching
    │   └── notifications.ts # Toast state
    └── types/
        ├── ui-config.ts     # UIConfig, PagesConfig, CardConfig, etc.
        └── api.ts           # API error types
```

## Development

```bash
cd client
npm install

# Multi-app mode (platform login → app selector → app login)
npm run dev

# Standalone mode — locked to a specific app
npm run dev:helpdesk    # Uses .env.helpdesk
npm run dev:cms         # Uses .env.cms
```

The Vite dev server (port 3001) proxies `/api/*` requests to `http://localhost:8080`.

## Independent Deployment

The client supports **standalone deployment** for individual apps via the `VITE_FIXED_APP` environment variable. When set, the app:

1. **Skips platform login** — no need for `platform@localhost` credentials
2. **Skips app selection** — goes directly to the fixed app
3. **Redirects `/` to public pages** — lands on the first entity with a `pages.landing` config
4. **Admin routes still work** — `/dashboard`, `/data/*` require per-app login as usual

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_FIXED_APP` | Yes | App name in Rocket (e.g., `helpdesk`, `cms`) |
| `VITE_SITE_NAME` | No | Header branding text (e.g., `Support Center`, `Our Blog`). Falls back to app name. |

### Build Commands

```bash
cd client

# Build standalone HelpDesk frontend
npm run build:helpdesk
# Output: dist-helpdesk/

# Build standalone CMS frontend
npm run build:cms
# Output: dist-cms/

# Build multi-app frontend (original behavior)
npm run build
# Output: dist/
```

### Env Files

Each build mode reads from its corresponding `.env.{mode}` file:

**`.env.helpdesk`**
```
VITE_FIXED_APP=helpdesk
VITE_SITE_NAME=Support Center
```

**`.env.cms`**
```
VITE_FIXED_APP=cms
VITE_SITE_NAME=Our Blog
```

To add a new standalone app build, create `.env.myapp` and add scripts to `package.json`:
```json
{
  "build:myapp": "tsc && vite build --mode myapp --outDir dist-myapp",
  "dev:myapp": "vite --mode myapp"
}
```

### Production Deployment

Each `dist-*` folder is a static SPA. Deploy behind a reverse proxy that:

1. **Serves static files** from `dist-helpdesk/` (or `dist-cms/`)
2. **Forwards `/api/*`** to the Rocket backend (`http://backend:8080`)

**Nginx example:**

```nginx
server {
    listen 80;
    server_name helpdesk.example.com;

    root /var/www/helpdesk;
    index index.html;

    # SPA fallback — all routes serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API calls to Rocket backend
    location /api/ {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

**Docker example:**

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY client/ .
RUN npm ci && npm run build:helpdesk

FROM nginx:alpine
COPY --from=build /app/dist-helpdesk /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

### Multiple Apps on One Backend

A single Rocket backend can serve multiple standalone frontends simultaneously. Each frontend is built with a different `VITE_FIXED_APP` and deployed to a different domain or port — they all proxy to the same backend:

```
helpdesk.example.com  →  dist-helpdesk/  →  /api/helpdesk/*  →  backend:8080
blog.example.com      →  dist-cms/       →  /api/cms/*       →  backend:8080
```

## UI Config System

Public pages are entirely driven by UI config JSON stored per-entity in the `_ui_configs` table.

### Loading UI Configs

Import configs via the admin API:

```bash
# Import helpdesk UI configs
curl -X POST http://localhost:8080/api/helpdesk/_admin/import \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @examples/frontend/ui-configs-helpdesk.json

# Import CMS UI configs
curl -X POST http://localhost:8080/api/cms/_admin/import \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @examples/frontend/ui-configs-cms.json
```

### Page Types

**Landing Page (`pages.landing`)** — Card grid of entity records

| Field | Description |
|-------|-------------|
| `route` | URL path (e.g., `/pages/ticket`) |
| `title` / `subtitle` | Page header text |
| `layout` | `card-grid` or `list` |
| `data` | Query params: `include`, `filter`, `sort`, `per_page` |
| `card` | Card rendering: `title`, `excerpt`, `date`, `image`, `author`, `tags` |

**Detail Page (`pages.detail`)** — Article-style single record view

| Field | Description |
|-------|-------------|
| `route` | URL path with `:id` param (e.g., `/pages/ticket/:id`) |
| `layout` | `article` |
| `data` | Query params: `include` |
| `sections` | Ordered list of section configs |

### Section Types

| Type | Purpose | Key Fields |
|------|---------|------------|
| `hero` | Full-width header image | `image`, `title`, `show_meta` |
| `meta` | Author, date, tags bar | `author.relation`, `date`, `tags.relation` |
| `content` | Main body text | `field`, `format` (`markdown` / `html` / `text`) |
| `comments` | Conversation thread | `relation`, `allow_submit`, `submit_fields`, `display_fields`, `filter` |

### Example: Helpdesk Ticket Config

```json
{
  "entity": "ticket",
  "config": {
    "sidebar": {
      "icon": "ticket",
      "label": "Tickets",
      "group": "Support Desk"
    },
    "pages": {
      "landing": {
        "route": "/pages/ticket",
        "title": "Support Center",
        "layout": "card-grid",
        "data": {
          "include": "ticket_customer,ticket_agent",
          "sort": "-updated_at",
          "per_page": 20
        },
        "card": {
          "title": "title",
          "excerpt": "description",
          "date": "updated_at",
          "author": { "relation": "ticket_customer", "name_field": "name" },
          "click_action": "navigate_detail"
        }
      },
      "detail": {
        "route": "/pages/ticket/:id",
        "layout": "article",
        "data": { "include": "ticket_customer,ticket_agent,ticket_responses" },
        "sections": [
          { "type": "meta", "author": { "relation": "ticket_customer", "name_field": "name" }, "date": "created_at" },
          { "type": "content", "field": "description", "format": "text" },
          {
            "type": "comments",
            "relation": "ticket_responses",
            "title": "Conversation",
            "allow_submit": true,
            "filter": { "internal_note": false },
            "sort": "created_at"
          }
        ]
      }
    }
  }
}
```

## Route Summary

| Route | Auth | Description |
|-------|------|-------------|
| `/login` | None | Platform login (skipped in fixed-app mode) |
| `/apps` | Platform | App selector (skipped in fixed-app mode) |
| `/app-login` | None | Per-app login |
| `/pages/:entity` | None | Public landing page |
| `/pages/:entity/:id` | None | Public detail page |
| `/dashboard` | App | Admin dashboard |
| `/data/:entity` | App | Admin data browser |
| `/data/:entity/:id` | App | Admin record detail |

In fixed-app mode, `/` redirects to `/pages` which resolves to the first entity with public pages configured.
