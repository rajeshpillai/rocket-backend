import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RocketClient } from "../rocket-client.js";

export function registerResources(server: McpServer, client: RocketClient): void {
  server.registerResource(
    "apps-list",
    "rocket://apps",
    {
      title: "Rocket Apps",
      description: "List of all apps on the Rocket platform with names, display names, and database drivers.",
      mimeType: "application/json",
    },
    async (uri) => {
      try {
        const data = await client.get("/api/_platform/apps");
        return {
          contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          contents: [{ uri: uri.href, mimeType: "text/plain", text: `Error: ${(err as Error).message}` }],
        };
      }
    }
  );

  server.registerResource(
    "app-schema",
    new ResourceTemplate("rocket://apps/{app}/schema", {
      list: async () => {
        try {
          const result = (await client.get("/api/_platform/apps")) as { data: Array<{ name: string; display_name?: string }> };
          const apps = result?.data ?? [];
          return {
            resources: apps.map((a) => ({
              uri: `rocket://apps/${a.name}/schema`,
              name: `${a.display_name || a.name} Schema`,
              description: `Full schema export for the '${a.name}' app`,
              mimeType: "application/json" as const,
            })),
          };
        } catch {
          return { resources: [] };
        }
      },
    }),
    {
      title: "App Schema",
      description:
        "Full schema export for a Rocket app — entities, relations, rules, state machines, workflows, permissions, webhooks, and UI configs.",
      mimeType: "application/json",
    },
    async (uri, { app }) => {
      try {
        const data = await client.get(`/api/${encodeURIComponent(app as string)}/_admin/export`);
        return {
          contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          contents: [{ uri: uri.href, mimeType: "text/plain", text: `Error: ${(err as Error).message}` }],
        };
      }
    }
  );
}
