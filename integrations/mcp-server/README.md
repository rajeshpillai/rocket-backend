# Rocket MCP Server

A generic [Model Context Protocol](https://modelcontextprotocol.io/) server that wraps Rocket Backend's REST API. Enables any MCP-compatible AI assistant (Claude Code, Claude Desktop, Cursor, Windsurf, etc.) to manage Rocket backends through conversation.

## Prerequisites

- Node.js 18+
- A running Rocket Backend instance (Go, Express, or Elixir)
- Platform admin credentials

## Setup

```bash
cd integrations/mcp-server
npm install
npm run build
```

## Configuration

Three environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ROCKET_URL` | No | `http://localhost:8080` | Rocket backend base URL |
| `ROCKET_EMAIL` | Yes | — | Platform admin email |
| `ROCKET_PASSWORD` | Yes | — | Platform admin password |

## Running

Shell scripts are provided with sensible defaults (localhost:8080, platform@localhost / changeme). Override via environment variables if needed.

### Standalone (for testing)

```bash
./start.sh

# or with custom credentials:
ROCKET_URL=http://myhost:9090 ROCKET_EMAIL=admin@example.com ROCKET_PASSWORD=secret ./start.sh
```

### Development mode (no build step)

```bash
./dev.sh
```

Uses `tsx` to run TypeScript directly — no `npm run build` needed. Useful during development.

### MCP Inspector (interactive testing)

```bash
./inspect.sh
```

Auto-builds first, then opens the MCP Inspector — a browser UI where you can invoke each tool, read resources, and test prompts interactively.

## Client Configuration

### Claude Code

Add to your project's `.mcp.json` (or `~/.claude/settings.json` for global):

```json
{
  "mcpServers": {
    "rocket": {
      "command": "node",
      "args": ["/absolute/path/to/integrations/mcp-server/dist/index.js"],
      "env": {
        "ROCKET_URL": "http://localhost:8080",
        "ROCKET_EMAIL": "platform@localhost",
        "ROCKET_PASSWORD": "changeme"
      }
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "rocket": {
      "command": "node",
      "args": ["/absolute/path/to/integrations/mcp-server/dist/index.js"],
      "env": {
        "ROCKET_URL": "http://localhost:8080",
        "ROCKET_EMAIL": "platform@localhost",
        "ROCKET_PASSWORD": "changeme"
      }
    }
  }
}
```

### Cursor / Windsurf

Both support MCP servers. Add the same configuration to their respective settings files. Refer to their documentation for the exact config file location.

## Tools (21)

### Platform Management

| Tool | Description |
|------|-------------|
| `list_apps` | List all apps on the platform |
| `create_app` | Create a new app (provisions DB, system tables, admin user) |
| `delete_app` | Permanently delete an app and its database |

### Entity Definitions

| Tool | Description |
|------|-------------|
| `list_entities` | List all entity definitions for an app |
| `get_entity` | Get the full definition of a single entity |
| `create_entity` | Create a new entity (auto-creates DB table + REST endpoints) |
| `update_entity` | Update an entity definition (auto-migrates table, never drops columns) |
| `delete_entity` | Delete an entity definition (table preserved, API removed) |

### Relation Definitions

| Tool | Description |
|------|-------------|
| `list_relations` | List all relation definitions for an app |
| `create_relation` | Create a relation between two entities |
| `update_relation` | Update a relation definition |
| `delete_relation` | Delete a relation definition |

### Bulk Schema Operations

| Tool | Description |
|------|-------------|
| `export_schema` | Export complete app schema (entities, relations, rules, state machines, permissions, webhooks, UI configs) |
| `import_schema` | Import a schema JSON into an app (additive, skips duplicates) |

### AI Schema Generation

| Tool | Description |
|------|-------------|
| `ai_status` | Check if AI provider is configured on the backend |
| `generate_schema` | Generate a complete schema from natural language description |

### Record CRUD

| Tool | Description |
|------|-------------|
| `query_records` | Query records with filters, sorting, pagination, and relation includes |
| `get_record` | Get a single record by ID or slug |
| `create_record` | Create a record (supports nested writes) |
| `update_record` | Update a record (supports nested writes) |
| `delete_record` | Delete a record (soft or hard, cascades apply) |

## Resources (2)

| URI | Description |
|-----|-------------|
| `rocket://apps` | List of all apps on the platform |
| `rocket://apps/{app}/schema` | Full schema export for a specific app |

Resources provide read-only context that AI assistants can pull into their conversation automatically.

## Prompts (1)

| Prompt | Description |
|--------|-------------|
| `design_schema` | Structured template to guide schema design from business requirements |

## Example Conversations

Once configured, you can interact with your Rocket backend naturally:

**Create an app and schema:**
> "Create a new app called 'blog' and set up entities for posts, comments, and tags with appropriate relations"

**AI-powered schema generation:**
> "Generate a schema for an e-commerce platform with products, categories, orders, and customers"

**Query data:**
> "Show me all active invoices sorted by creation date, include the customer relation"

**Schema introspection:**
> "What entities exist in the 'blog' app? Show me the fields for the 'post' entity"

## Authentication

The MCP server authenticates to Rocket as a platform admin on startup. Token lifecycle is fully automatic:

- JWT access tokens (15 min TTL) are pre-emptively refreshed at the 14-minute mark
- If a request gets a 401, the token is refreshed and the request retried once
- If the refresh token expires (7 day TTL), the server re-authenticates with credentials
- All API calls use the platform admin token, which has full access to all apps

## Architecture

```
AI Assistant ↔ stdio (JSON-RPC) ↔ MCP Server ↔ HTTP ↔ Rocket REST API ↔ Database
```

The MCP server is a thin stateless bridge. No business logic, no database access — it translates MCP tool calls into Rocket REST API calls and returns the responses. Works with any Rocket backend implementation (Go, Express, Elixir).

## Project Structure

```
src/
├── index.ts              # Entry point: auth → register tools/resources/prompts → stdio
├── config.ts             # Environment variable loading
├── rocket-client.ts      # HTTP client with JWT auth, auto-refresh, error handling
├── tools/
│   ├── apps.ts           # Platform app management (3 tools)
│   ├── entities.ts       # Entity definition CRUD (5 tools)
│   ├── relations.ts      # Relation definition CRUD (4 tools)
│   ├── schema.ts         # Bulk export/import (2 tools)
│   ├── ai.ts             # AI status + generation (2 tools)
│   └── records.ts        # Dynamic record CRUD (5 tools)
├── resources/
│   └── index.ts          # MCP resources (2 resources)
└── prompts/
    └── index.ts          # MCP prompt templates (1 prompt)
```
