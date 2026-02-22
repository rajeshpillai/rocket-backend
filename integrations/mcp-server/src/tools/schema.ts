import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RocketClient } from "../rocket-client.js";

const appParam = z.string().describe("App name");

export function registerSchemaTools(server: McpServer, client: RocketClient): void {
  server.registerTool(
    "export_schema",
    {
      title: "Export Schema",
      description:
        "Export the complete schema for an app. Returns entities, relations, rules, state_machines, workflows, permissions, webhooks, and ui_configs as JSON. Useful for backup, review, or migration.",
      inputSchema: { app: appParam },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ app }) => {
      try {
        const data = await client.get(`/api/${encodeURIComponent(app)}/_admin/export`);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: (err as Error).message }], isError: true };
      }
    }
  );

  server.registerTool(
    "import_schema",
    {
      title: "Import Schema",
      description:
        "Import a schema JSON into an app. Additive — existing entities/relations are skipped, not overwritten. Must include 'version: 1'. Supports: entities, relations, rules, state_machines, workflows, permissions, webhooks, ui_configs, sample_data.",
      inputSchema: {
        app: appParam,
        schema: z.record(z.unknown()).describe(
          "Full schema JSON. Must include 'version: 1'. May include: entities, relations, rules, state_machines, workflows, permissions, webhooks, ui_configs, sample_data."
        ),
      },
      annotations: { idempotentHint: true },
    },
    async ({ app, schema }) => {
      try {
        const data = await client.post(`/api/${encodeURIComponent(app)}/_admin/import`, schema);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: (err as Error).message }], isError: true };
      }
    }
  );
}
