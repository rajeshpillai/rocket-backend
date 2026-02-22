import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RocketClient } from "../rocket-client.js";

export function registerAITools(server: McpServer, client: RocketClient): void {
  server.registerTool(
    "ai_status",
    {
      title: "AI Status",
      description:
        "Check whether the Rocket backend has an AI provider configured. Returns { configured: boolean, model: string }.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const data = await client.get("/api/_platform/ai/status");
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: (err as Error).message }], isError: true };
      }
    }
  );

  server.registerTool(
    "generate_schema",
    {
      title: "Generate Schema with AI",
      description:
        "Use AI to generate a complete Rocket schema from a natural language description. Returns a schema JSON with entities, relations, rules, state_machines, permissions, ui_configs, and sample_data. The result can be reviewed then imported via import_schema. Requires AI to be configured on the backend.",
      inputSchema: {
        app: z.string().describe("App name to generate schema for"),
        prompt: z
          .string()
          .max(5000)
          .describe(
            "Natural language description of the application. Max 5000 chars. Example: 'A project management tool with projects, tasks, and team members.'"
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ app, prompt }) => {
      try {
        const data = await client.post(
          `/api/${encodeURIComponent(app)}/_admin/ai/generate`,
          { prompt }
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: (err as Error).message }], isError: true };
      }
    }
  );
}
