import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RocketClient } from "../rocket-client.js";

const appParam = z.string().describe("App name (e.g. 'my-app')");

export function registerEntityTools(server: McpServer, client: RocketClient): void {
  server.registerTool(
    "list_entities",
    {
      title: "List Entities",
      description: "List all entity definitions for an app. Returns name, table, fields, and metadata for each entity.",
      inputSchema: { app: appParam },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ app }) => {
      try {
        const data = await client.get(`/api/${encodeURIComponent(app)}/_admin/entities`);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: (err as Error).message }], isError: true };
      }
    }
  );

  server.registerTool(
    "get_entity",
    {
      title: "Get Entity",
      description:
        "Get the full definition of a single entity including all fields, primary key, soft_delete flag, and slug config.",
      inputSchema: {
        app: appParam,
        name: z.string().describe("Entity name (e.g. 'invoice')"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ app, name }) => {
      try {
        const data = await client.get(
          `/api/${encodeURIComponent(app)}/_admin/entities/${encodeURIComponent(name)}`
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: (err as Error).message }], isError: true };
      }
    }
  );

  server.registerTool(
    "create_entity",
    {
      title: "Create Entity",
      description:
        "Create a new entity definition. Provide the full entity JSON: name, table, primary_key ({field, type, generated}), fields ([{name, type, required?, unique?, default?, enum?, auto?}]), and optional soft_delete/slug. The database table is auto-created.",
      inputSchema: {
        app: appParam,
        definition: z.record(z.unknown()).describe(
          "Full entity definition JSON. Required: name (string), table (string), primary_key ({field, type, generated}), fields (array). Field types: string, text, int, bigint, float, decimal, boolean, uuid, timestamp, date, json, file."
        ),
      },
    },
    async ({ app, definition }) => {
      try {
        const data = await client.post(`/api/${encodeURIComponent(app)}/_admin/entities`, definition);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: (err as Error).message }], isError: true };
      }
    }
  );

  server.registerTool(
    "update_entity",
    {
      title: "Update Entity",
      description:
        "Update an existing entity definition. Provide the full updated entity JSON. New fields are auto-added to the database table. Removed fields are hidden but data is preserved (columns never dropped).",
      inputSchema: {
        app: appParam,
        name: z.string().describe("Entity name to update"),
        definition: z.record(z.unknown()).describe("Full updated entity definition JSON."),
      },
      annotations: { idempotentHint: true },
    },
    async ({ app, name, definition }) => {
      try {
        const data = await client.put(
          `/api/${encodeURIComponent(app)}/_admin/entities/${encodeURIComponent(name)}`,
          definition
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: (err as Error).message }], isError: true };
      }
    }
  );

  server.registerTool(
    "delete_entity",
    {
      title: "Delete Entity",
      description:
        "Delete an entity definition. The underlying database table is NOT dropped (data preserved). Removes the entity from the API.",
      inputSchema: {
        app: appParam,
        name: z.string().describe("Entity name to delete"),
      },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ app, name }) => {
      try {
        const data = await client.delete(
          `/api/${encodeURIComponent(app)}/_admin/entities/${encodeURIComponent(name)}`
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: (err as Error).message }], isError: true };
      }
    }
  );
}
