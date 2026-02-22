import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "design_schema",
    {
      title: "Design Schema",
      description:
        "Generate a structured prompt to help design a Rocket schema from business requirements. Covers entities, fields, relations, rules, state machines, and permissions.",
      argsSchema: {
        requirements: z
          .string()
          .describe(
            "Business requirements or domain description. Example: 'An e-commerce platform with products, categories, orders, and customers.'"
          ),
      },
    },
    ({ requirements }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `You are designing a database schema for a Rocket Backend application. Rocket is a metadata-driven backend where entities, relations, and business logic are defined as JSON and interpreted at runtime — no code generation needed.

## Business Requirements
${requirements}

## Your Task
Design a complete schema following these steps:

### Step 1: Identify Entities
List each entity with:
- name (lowercase, singular: "invoice" not "invoices")
- table (plural: "invoices")
- primary_key (usually { field: "id", type: "uuid", generated: true })
- soft_delete (true for business data, false for lookup/audit tables)
- fields array with: name, type (string/text/int/bigint/float/decimal/boolean/uuid/timestamp/date/json/file), required, unique, default, enum, auto (create/update), precision (for decimal)

Standard fields every entity should have:
- id: uuid, required (primary key)
- created_at: timestamp, auto: "create"
- updated_at: timestamp, auto: "update"

### Step 2: Define Relations
For each relationship:
- name (descriptive: "invoice_items", "order_customer")
- type: one_to_one, one_to_many, or many_to_many
- source and target entity names
- source_key (usually "id") and target_key (FK field on target)
- For many_to_many: join_table, source_join_key, target_join_key
- ownership: "source" (parent owns children), "target", or "none" (M:N)
- on_delete: cascade (delete children), set_null (nullify FK), restrict (prevent), detach (M:N only)

### Step 3: Validation Rules
For entities that need validation:
- Field rules: min_length, max_length, pattern (regex), min, max
- Expression rules: cross-field boolean expressions
- Hook: before_write (validate on create/update), before_delete

### Step 4: State Machines (if applicable)
For entities with status/workflow fields:
- field: the status field name
- initial: starting state
- transitions: array of { from, to } with optional role guards and actions (e.g., set_field)

### Step 5: Permissions
For each entity + action (read/create/update/delete):
- roles that can perform the action
- optional row-level conditions

Output the complete schema as a single JSON object:
{
  "version": 1,
  "entities": [...],
  "relations": [...],
  "rules": [...],
  "state_machines": [...],
  "permissions": [...]
}`,
          },
        },
      ],
    })
  );
}
