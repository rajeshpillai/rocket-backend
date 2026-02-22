#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { RocketClient } from "./rocket-client.js";
import { registerAppTools } from "./tools/apps.js";
import { registerEntityTools } from "./tools/entities.js";
import { registerRelationTools } from "./tools/relations.js";
import { registerSchemaTools } from "./tools/schema.js";
import { registerAITools } from "./tools/ai.js";
import { registerRecordTools } from "./tools/records.js";
import { registerResources } from "./resources/index.js";
import { registerPrompts } from "./prompts/index.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const client = new RocketClient(config);
  try {
    await client.login();
    console.error("Authenticated to Rocket platform");
  } catch (err: unknown) {
    console.error(`Failed to authenticate: ${(err as Error).message}`);
    process.exit(1);
  }

  const server = new McpServer(
    { name: "rocket-backend", version: "0.1.0" },
    { capabilities: { logging: {} } }
  );

  registerAppTools(server, client);
  registerEntityTools(server, client);
  registerRelationTools(server, client);
  registerSchemaTools(server, client);
  registerAITools(server, client);
  registerRecordTools(server, client);
  registerResources(server, client);
  registerPrompts(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Rocket MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
