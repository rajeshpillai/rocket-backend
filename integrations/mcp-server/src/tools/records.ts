import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RocketClient } from "../rocket-client.js";

const appParam = z.string().describe("App name");
const entityParam = z.string().describe("Entity name (e.g. 'invoice', 'customer')");

export function registerRecordTools(server: McpServer, client: RocketClient): void {
  server.registerTool(
    "query_records",
    {
      title: "Query Records",
      description:
        "Query records from a dynamic entity with filtering, sorting, pagination, and relation includes. Returns { data: [...], meta: { page, per_page, total } }.",
      inputSchema: {
        app: appParam,
        entity: entityParam,
        filter: z
          .record(z.string())
          .optional()
          .describe(
            "Filter object. Keys are 'field' or 'field.operator'. Operators: eq, neq, gt, gte, lt, lte, in, contains, starts_with, ends_with. Example: { 'status': 'active', 'total.gte': '1000' }"
          ),
        sort: z
          .string()
          .optional()
          .describe("Comma-separated sort fields. Prefix with '-' for descending. Example: '-created_at,name'"),
        page: z.number().int().positive().optional().describe("Page number (default: 1)"),
        per_page: z
          .number()
          .int()
          .positive()
          .max(100)
          .optional()
          .describe("Records per page (default: 25, max: 100)"),
        include: z
          .string()
          .optional()
          .describe("Comma-separated relation names to include. Example: 'items,customer'"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ app, entity, filter, sort, page, per_page, include }) => {
      try {
        const params = new URLSearchParams();
        if (filter) {
          for (const [key, val] of Object.entries(filter)) {
            params.append(`filter[${key}]`, val);
          }
        }
        if (sort) params.set("sort", sort);
        if (page) params.set("page", String(page));
        if (per_page) params.set("per_page", String(per_page));
        if (include) params.set("include", include);

        const qs = params.toString();
        const path = `/api/${encodeURIComponent(app)}/${encodeURIComponent(entity)}${qs ? "?" + qs : ""}`;
        const data = await client.get(path);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: (err as Error).message }], isError: true };
      }
    }
  );

  server.registerTool(
    "get_record",
    {
      title: "Get Record",
      description: "Get a single record by ID or slug. Optionally include related records.",
      inputSchema: {
        app: appParam,
        entity: entityParam,
        id: z.string().describe("Record ID (UUID or integer) or slug value."),
        include: z.string().optional().describe("Comma-separated relation names to include."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ app, entity, id, include }) => {
      try {
        const params = new URLSearchParams();
        if (include) params.set("include", include);
        const qs = params.toString();
        const path = `/api/${encodeURIComponent(app)}/${encodeURIComponent(entity)}/${encodeURIComponent(id)}${qs ? "?" + qs : ""}`;
        const data = await client.get(path);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: (err as Error).message }], isError: true };
      }
    }
  );

  server.registerTool(
    "create_record",
    {
      title: "Create Record",
      description:
        "Create a new record in a dynamic entity. Supports nested writes for related entities using relation names as keys.",
      inputSchema: {
        app: appParam,
        entity: entityParam,
        data: z.record(z.unknown()).describe(
          "Record data as JSON. Keys are field names, values are field values. For nested writes, use relation names as keys with { _write_mode, data } objects."
        ),
      },
    },
    async ({ app, entity, data }) => {
      try {
        const result = await client.post(
          `/api/${encodeURIComponent(app)}/${encodeURIComponent(entity)}`,
          data
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: (err as Error).message }], isError: true };
      }
    }
  );

  server.registerTool(
    "update_record",
    {
      title: "Update Record",
      description:
        "Update an existing record. Only include fields you want to change. Supports nested writes for related entities.",
      inputSchema: {
        app: appParam,
        entity: entityParam,
        id: z.string().describe("Record ID to update"),
        data: z.record(z.unknown()).describe("Fields to update as JSON. Only include fields that should change."),
      },
      annotations: { idempotentHint: true },
    },
    async ({ app, entity, id, data }) => {
      try {
        const result = await client.put(
          `/api/${encodeURIComponent(app)}/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`,
          data
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: (err as Error).message }], isError: true };
      }
    }
  );

  server.registerTool(
    "delete_record",
    {
      title: "Delete Record",
      description:
        "Delete a record. Soft-delete entities mark the record with deleted_at. Hard-delete entities permanently remove it. Cascade policies apply to related records.",
      inputSchema: {
        app: appParam,
        entity: entityParam,
        id: z.string().describe("Record ID to delete"),
      },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ app, entity, id }) => {
      try {
        const result = await client.delete(
          `/api/${encodeURIComponent(app)}/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: (err as Error).message }], isError: true };
      }
    }
  );
}
