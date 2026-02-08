import { Section, CodeBlock, InfoBox, PropsTable, C } from "./help-components";

export default function GettingStarted() {
  return (
    <div>
      <Section title="What is Rocket Backend" id="what-is-rocket">
        <p>
          Rocket Backend is a <strong>metadata-driven backend engine</strong>. Instead of writing
          code for each entity, you define entities, relations, and business logic as JSON metadata
          and the engine interprets it at runtime. Define an entity via the admin API (or Admin UI),
          and <strong>five REST endpoints</strong> are instantly available — list, get, create,
          update, and delete.
        </p>
        <p>
          There is no code generation. Everything is dynamic: entities, relations, validation rules,
          state machines, workflows, webhooks, and permissions are all stored as metadata in
          PostgreSQL and evaluated at runtime.
        </p>
        <InfoBox type="tip" title="Two implementations, one API">
          <p>
            Rocket Backend ships with both a <strong>Go (Fiber)</strong> and a{" "}
            <strong>TypeScript (Express)</strong> implementation. Both produce identical API
            responses and share the same PostgreSQL database. Pick whichever suits your stack.
          </p>
        </InfoBox>
      </Section>

      <Section title="Key Concepts" id="key-concepts">
        <PropsTable
          columns={["Concept", "Description"]}
          rows={[
            [<C>Entity</C>, "A table definition — fields, primary key, soft delete configuration. Each entity gets five REST endpoints automatically."],
            [<C>Relation</C>, "An association between two entities (one-to-many, many-to-many, or one-to-one). Enables includes and nested writes."],
            [<C>Rule</C>, "Validation, computed fields, or side-effect logic that runs on create/update hooks. Defined as expressions."],
            [<C>State Machine</C>, "A named field whose value transitions through defined states with guard conditions and actions."],
            [<C>Workflow</C>, "A multi-step process triggered by entity writes — supports approvals, conditions, timeouts, and automatic actions."],
            [<C>Webhook</C>, "An HTTP callout fired on entity writes or deletes. Can be async (fire-and-forget) or sync (blocks the transaction)."],
            [<C>Permission</C>, "Access control policy per entity and action. Whitelist model — no permission row means denied. Supports row-level security."],
          ]}
        />
      </Section>

      <Section title="Quick Start" id="quick-start">
        <p>
          You need <strong>Docker</strong> (for PostgreSQL) and either <strong>Go 1.21+</strong> or{" "}
          <strong>Node.js 18+</strong> installed.
        </p>

        <h3>1. Start the database</h3>
        <CodeBlock language="bash" title="Start PostgreSQL via Docker Compose">
{`docker compose up -d`}
        </CodeBlock>
        <p>
          This starts PostgreSQL 15 on port <C>5433</C> (remapped to avoid conflicts with any local
          Postgres). Credentials are <C>rocket/rocket</C>.
        </p>

        <h3>2. Start the backend</h3>
        <p>Choose either the Go or Express implementation. Both use port 8080.</p>
        <CodeBlock language="bash" title="Option A: Go implementation">
{`cd golang && go run ./cmd/server/`}
        </CodeBlock>
        <CodeBlock language="bash" title="Option B: Express implementation">
{`cd expressjs && npx tsx src/index.ts`}
        </CodeBlock>
        <InfoBox type="note">
          <p>
            Both servers bind to port <C>8080</C>. Run only one at a time, or change the port
            in <C>app.yaml</C>.
          </p>
        </InfoBox>

        <h3>3. Start the Admin UI</h3>
        <CodeBlock language="bash" title="Start the SolidJS admin panel">
{`cd admin && npm run dev`}
        </CodeBlock>
        <p>
          The Admin UI runs on <C>http://localhost:5173</C> and proxies API requests to{" "}
          <C>localhost:8080</C>.
        </p>
      </Section>

      <Section title="Authentication" id="authentication">
        <h3>Platform Login</h3>
        <p>
          On first boot, a <strong>platform admin</strong> account is seeded automatically. Use it
          to manage apps:
        </p>
        <PropsTable
          columns={["Field", "Value"]}
          rows={[
            ["Email", <C>platform@localhost</C>],
            ["Password", <C>changeme</C>],
          ]}
        />
        <CodeBlock language="bash" title="Platform login via curl">
{`curl -X POST http://localhost:8080/api/_platform/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"email": "platform@localhost", "password": "changeme"}'`}
        </CodeBlock>
        <p>This returns an <C>access_token</C> and <C>refresh_token</C>. Use the access token as a Bearer token in subsequent requests.</p>

        <h3>Create an App</h3>
        <p>
          Each app gets its own isolated database. Create one with the platform token:
        </p>
        <CodeBlock language="bash" title="Create a new app">
{`curl -X POST http://localhost:8080/api/_platform/apps \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer <platform_access_token>" \\
  -d '{"name": "myapp", "display_name": "My Application"}'`}
        </CodeBlock>

        <h3>App Login</h3>
        <p>
          Each app is seeded with its own admin user. Log in to the app scope:
        </p>
        <PropsTable
          columns={["Field", "Value"]}
          rows={[
            ["Email", <C>admin@localhost</C>],
            ["Password", <C>changeme</C>],
          ]}
        />
        <CodeBlock language="bash" title="App login via curl">
{`curl -X POST http://localhost:8080/api/myapp/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"email": "admin@localhost", "password": "changeme"}'`}
        </CodeBlock>
        <InfoBox type="important">
          <p>
            Platform tokens work across all apps (dual-auth). App tokens only work within their own
            app. Change the default passwords after first login.
          </p>
        </InfoBox>
      </Section>

      <Section title="Your First Entity" id="first-entity">
        <p>
          Let's create a simple <strong>task</strong> entity using the Admin UI.
        </p>

        <h3>Step 1: Open the Admin UI</h3>
        <p>
          Navigate to <C>http://localhost:5173</C>, log in with the platform credentials, and select
          your app.
        </p>

        <h3>Step 2: Create the Entity</h3>
        <p>
          Go to the <strong>Entities</strong> page and click <strong>Create Entity</strong>. Enter{" "}
          <C>task</C> as the entity name.
        </p>

        <h3>Step 3: Add Fields</h3>
        <p>Add the following fields to your task entity:</p>
        <PropsTable
          columns={["Field Name", "Type", "Properties"]}
          rows={[
            [<C>title</C>, "string", "required: true"],
            [<C>description</C>, "text", ""],
            [<C>priority</C>, "string", <>enum: <C>["low", "medium", "high"]</C></>],
            [<C>done</C>, "boolean", <>default: <C>false</C></>],
            [<C>created_at</C>, "timestamp", <>auto: <C>"create"</C></>],
          ]}
        />
        <p>Here is the equivalent JSON definition for reference:</p>
        <CodeBlock language="json" title="Task entity definition">
{`{
  "name": "task",
  "primary_key": {
    "field": "id",
    "type": "uuid",
    "generated": true
  },
  "fields": [
    { "name": "title", "type": "string", "required": true },
    { "name": "description", "type": "text" },
    { "name": "priority", "type": "string", "enum": ["low", "medium", "high"] },
    { "name": "done", "type": "boolean", "default": false },
    { "name": "created_at", "type": "timestamp", "auto": "create" }
  ]
}`}
        </CodeBlock>

        <h3>Step 4: Create a Record</h3>
        <p>
          Switch to the <strong>Data Browser</strong>, select the <C>task</C> entity, and click{" "}
          <strong>Create Record</strong>. Fill in the title and priority, then save. Your record is
          immediately available via the REST API:
        </p>
        <CodeBlock language="bash" title="List all tasks via the API">
{`curl http://localhost:8080/api/myapp/task \\
  -H "Authorization: Bearer <app_access_token>"`}
        </CodeBlock>
        <InfoBox type="tip" title="Five endpoints, no code">
          <p>
            That single entity definition gave you <C>GET /api/myapp/task</C> (list),{" "}
            <C>GET /api/myapp/task/:id</C> (get), <C>POST /api/myapp/task</C> (create),{" "}
            <C>PUT /api/myapp/task/:id</C> (update), and <C>DELETE /api/myapp/task/:id</C> (delete)
            — all fully functional with filtering, sorting, and pagination.
          </p>
        </InfoBox>
      </Section>

      <Section title="What's Next" id="whats-next">
        <p>Now that you have an entity up and running, explore the rest of Rocket Backend:</p>
        <ul class="help-list">
          <li>See <strong>Entities</strong> for a deep dive into field types, primary key options, soft delete, and auto-migration.</li>
          <li>See <strong>Relations</strong> for linking entities together with one-to-many, many-to-many, and one-to-one associations.</li>
          <li>See <strong>CRUD & Querying</strong> for filters, sorting, pagination, and includes.</li>
          <li>See <strong>Nested Writes</strong> for creating/updating related records in a single request.</li>
          <li>See <strong>Validation Rules</strong> for field-level and expression-based validation.</li>
          <li>See <strong>State Machines</strong> for managing status transitions with guards and actions.</li>
          <li>See <strong>Workflows</strong> for multi-step approval processes and automated actions.</li>
          <li>See <strong>Webhooks</strong> for sending HTTP callouts on entity events.</li>
          <li>See <strong>Permissions</strong> for role-based access control and row-level security.</li>
          <li>See <strong>File Uploads</strong> for uploading and serving files through file fields.</li>
          <li>See <strong>Schema Export/Import</strong> for backing up and porting your schema between environments.</li>
          <li>See <strong>API Reference</strong> for the complete endpoint listing.</li>
        </ul>
      </Section>
    </div>
  );
}
