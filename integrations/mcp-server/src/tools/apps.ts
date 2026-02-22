import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RocketClient } from "../rocket-client.js";

export function registerAppTools(server: McpServer, client: RocketClient): void {
  server.registerTool(
    "list_apps",
    {
      title: "List Apps",
      description:
        "List all apps on the Rocket platform. Returns name, display_name, db_driver, and status for each app.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const data = await client.get("/api/_platform/apps");
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: (err as Error).message }], isError: true };
      }
    }
  );

  server.registerTool(
    "create_app",
    {
      title: "Create App",
      description:
        "Create a new Rocket app. Provisions a database, bootstraps system tables, and seeds an admin user (admin@localhost / changeme). The app is immediately usable with REST endpoints.",
      inputSchema: {
        name: z
          .string()
          .regex(/^[a-z][a-z0-9_-]{0,62}$/)
          .describe("App name. Lowercase letters, numbers, hyphens, underscores. Must start with a letter."),
        display_name: z.string().optional().describe("Human-readable display name. Defaults to the app name."),
        db_driver: z
          .enum(["postgres", "sqlite"])
          .optional()
          .describe("Database driver. 'postgres' (default) or 'sqlite'."),
      },
    },
    async ({ name, display_name, db_driver }) => {
      try {
        const body: Record<string, unknown> = { name };
        if (display_name) body.display_name = display_name;
        if (db_driver) body.db_driver = db_driver;
        const data = await client.post("/api/_platform/apps", body);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: (err as Error).message }], isError: true };
      }
    }
  );

  server.registerTool(
    "delete_app",
    {
      title: "Delete App",
      description:
        "Permanently delete an app and its database. Irreversible. All data, entities, relations, users, and records will be destroyed.",
      inputSchema: {
        name: z.string().describe("The name of the app to delete."),
      },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ name }) => {
      try {
        const data = await client.delete(`/api/_platform/apps/${encodeURIComponent(name)}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: (err as Error).message }], isError: true };
      }
    }
  );
}
