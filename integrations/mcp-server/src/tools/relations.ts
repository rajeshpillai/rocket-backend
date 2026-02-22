import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RocketClient } from "../rocket-client.js";

const appParam = z.string().describe("App name");

export function registerRelationTools(server: McpServer, client: RocketClient): void {
  server.registerTool(
    "list_relations",
    {
      title: "List Relations",
      description: "List all relation definitions for an app. Returns name, type, source, target, and config for each relation.",
      inputSchema: { app: appParam },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ app }) => {
      try {
        const data = await client.get(`/api/${encodeURIComponent(app)}/_admin/relations`);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: (err as Error).message }], isError: true };
      }
    }
  );

  server.registerTool(
    "create_relation",
    {
      title: "Create Relation",
      description:
        "Create a relation between two entities. Provide the full relation JSON: name, type (one_to_one/one_to_many/many_to_many), source, target, source_key, target_key, ownership (source/target/none), on_delete (cascade/set_null/restrict/detach). For many_to_many also: join_table, source_join_key, target_join_key.",
      inputSchema: {
        app: appParam,
        definition: z.record(z.unknown()).describe(
          "Full relation definition JSON. Required: name, type, source, target, source_key, target_key, ownership, on_delete. Optional: fetch (lazy/eager), write_mode (diff/replace/append)."
        ),
      },
    },
    async ({ app, definition }) => {
      try {
        const data = await client.post(`/api/${encodeURIComponent(app)}/_admin/relations`, definition);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: (err as Error).message }], isError: true };
      }
    }
  );

  server.registerTool(
    "update_relation",
    {
      title: "Update Relation",
      description: "Update an existing relation definition. Provide the full updated relation JSON.",
      inputSchema: {
        app: appParam,
        name: z.string().describe("Relation name to update"),
        definition: z.record(z.unknown()).describe("Full updated relation definition JSON."),
      },
      annotations: { idempotentHint: true },
    },
    async ({ app, name, definition }) => {
      try {
        const data = await client.put(
          `/api/${encodeURIComponent(app)}/_admin/relations/${encodeURIComponent(name)}`,
          definition
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: (err as Error).message }], isError: true };
      }
    }
  );

  server.registerTool(
    "delete_relation",
    {
      title: "Delete Relation",
      description: "Delete a relation definition. For many_to_many, the join table is NOT dropped.",
      inputSchema: {
        app: appParam,
        name: z.string().describe("Relation name to delete"),
      },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ app, name }) => {
      try {
        const data = await client.delete(
          `/api/${encodeURIComponent(app)}/_admin/relations/${encodeURIComponent(name)}`
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: (err as Error).message }], isError: true };
      }
    }
  );
}
