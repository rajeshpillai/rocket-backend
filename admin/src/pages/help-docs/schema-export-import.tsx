import { Section, CodeBlock, InfoBox, PropsTable, EndpointBlock, C } from "./help-components";

export default function SchemaExportImport() {
  return (
    <div>
      {/* ── Overview ── */}
      <Section title="Overview" id="overview">
        <p>
          Rocket Backend supports full schema portability through export and import endpoints.
          You can export all metadata from an app as a single JSON document and import it into
          another app or environment to recreate the entire schema -- entities, relations,
          business logic, permissions, and webhooks.
        </p>
        <p>
          This enables version control of your schema, environment promotion (dev to staging to
          production), backup and restore, and sharing schema templates between teams or
          organizations.
        </p>
      </Section>

      {/* ── What's Included ── */}
      <Section title="What's Included" id="whats-included">
        <p>
          The export document contains all metadata types that define your app's schema and
          business logic:
        </p>
        <PropsTable
          columns={["Metadata Type", "Description"]}
          rows={[
            [<C>entities</C>, "Entity definitions including fields, primary keys, soft delete configuration, and table names"],
            [<C>relations</C>, "All relation definitions linking entities together (one-to-many, many-to-many, one-to-one)"],
            [<C>rules</C>, "Validation rules, computed fields, and side-effect logic attached to entities"],
            [<C>state_machines</C>, "State machine definitions with transitions, guards, and actions"],
            [<C>workflows</C>, "Multi-step workflow definitions with triggers, steps, and context"],
            [<C>permissions</C>, "Permission policies per entity and action, including row-level security conditions"],
            [<C>webhooks</C>, "Webhook definitions with URLs, conditions, headers, and retry configuration"],
          ]}
        />
        <p>
          The export may also include optional <C>sample_data</C> if entities are configured with
          sample data in their definitions.
        </p>
        <InfoBox type="note">
          <p>
            The export captures <strong>metadata only</strong> -- it does not include actual
            business data stored in your entity tables. This keeps exports lightweight and
            focused on schema portability. Use database backups for full data exports.
          </p>
        </InfoBox>
      </Section>

      {/* ── Export ── */}
      <Section title="Export" id="export">
        <EndpointBlock method="GET" url="/api/:app/_admin/export" description="Export all metadata as a single JSON document" />
        <p>
          The export endpoint returns the complete schema as a structured JSON document. Every
          metadata type is included as a top-level array, giving you everything needed to
          recreate the full schema in another app or environment.
        </p>
        <CodeBlock language="bash" title="Export schema via curl">{`curl http://localhost:8080/api/myapp/_admin/export \\
  -H "Authorization: Bearer <token>"`}</CodeBlock>
        <CodeBlock language="json" title="Export response structure">{`{
  "entities": [
    {
      "name": "customer",
      "table_name": "customer",
      "primary_key": { "field": "id", "type": "uuid", "generated": true },
      "fields": [ ... ]
    },
    {
      "name": "invoice",
      "table_name": "invoice",
      "primary_key": { "field": "id", "type": "uuid", "generated": true },
      "soft_delete": { "enabled": true, "field": "deleted_at" },
      "fields": [ ... ]
    }
  ],
  "relations": [
    {
      "name": "items",
      "source": "invoice",
      "target": "invoice_item",
      "type": "one_to_many",
      ...
    }
  ],
  "rules": [ ... ],
  "state_machines": [ ... ],
  "workflows": [ ... ],
  "permissions": [ ... ],
  "webhooks": [ ... ]
}`}</CodeBlock>
        <InfoBox type="tip">
          <p>
            Save the export to a file for version control:
          </p>
        </InfoBox>
        <CodeBlock language="bash" title="Save export to file">{`curl http://localhost:8080/api/myapp/_admin/export \\
  -H "Authorization: Bearer <token>" \\
  -o myapp-schema.json`}</CodeBlock>
      </Section>

      {/* ── Import ── */}
      <Section title="Import" id="import">
        <EndpointBlock method="POST" url="/api/:app/_admin/import" description="Import schema JSON and recreate all metadata" />
        <p>
          The import endpoint accepts the same JSON format as the export response. It processes
          each metadata type in order -- entities first (triggering auto-migration to create
          tables), then relations, rules, state machines, workflows, permissions, and webhooks.
        </p>
        <CodeBlock language="bash" title="Import schema via curl">{`curl -X POST http://localhost:8080/api/myapp/_admin/import \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d @myapp-schema.json`}</CodeBlock>
        <CodeBlock language="json" title="Import response with counts">{`{
  "data": {
    "imported": {
      "entities": 3,
      "relations": 2,
      "rules": 5,
      "state_machines": 1,
      "workflows": 2,
      "permissions": 8,
      "webhooks": 3
    },
    "errors": []
  }
}`}</CodeBlock>
        <p>
          If any individual items fail to import (e.g., a relation references a non-existent
          entity), the error is captured in the <C>errors</C> array and processing continues
          with the remaining items.
        </p>
        <CodeBlock language="json" title="Import response with partial errors">{`{
  "data": {
    "imported": {
      "entities": 3,
      "relations": 1,
      "rules": 5,
      "state_machines": 1,
      "workflows": 2,
      "permissions": 8,
      "webhooks": 3
    },
    "errors": [
      "relation 'items': target entity 'line_item' not found"
    ]
  }
}`}</CodeBlock>
      </Section>

      {/* ── Idempotent Behavior ── */}
      <Section title="Idempotent Behavior" id="idempotent-behavior">
        <p>
          The import process uses <strong>deduplication rules</strong> to avoid creating
          duplicate metadata. If a matching item already exists, it is skipped rather than
          duplicated. This makes it safe to run the same import multiple times.
        </p>
        <PropsTable
          columns={["Metadata Type", "Dedup Key"]}
          rows={[
            [<C>entities</C>, <>Matched by <C>name</C> -- if an entity with the same name exists, it is skipped</>],
            [<C>relations</C>, <>Matched by <C>name</C> -- if a relation with the same name exists, it is skipped</>],
            [<C>rules</C>, <>Matched by <C>entity</C> + <C>hook</C> + <C>type</C> + <C>definition</C> combination</>],
            [<C>state_machines</C>, <>Matched by <C>entity</C> + <C>field</C> combination</>],
            [<C>workflows</C>, <>Matched by <C>name</C> -- if a workflow with the same name exists, it is skipped</>],
            [<C>permissions</C>, <>Matched by <C>entity</C> + <C>action</C> combination</>],
            [<C>webhooks</C>, <>Matched by <C>entity</C> + <C>hook</C> + <C>url</C> combination</>],
          ]}
        />
        <InfoBox type="tip" title="Safe to re-import">
          <p>
            Because of idempotent deduplication, you can safely import the same schema file
            multiple times without creating duplicates. This is especially useful in CI/CD
            pipelines where you want to ensure the target environment matches the schema
            definition without worrying about prior state.
          </p>
        </InfoBox>
      </Section>

      {/* ── Use Cases ── */}
      <Section title="Use Cases" id="use-cases">
        <PropsTable
          columns={["Use Case", "Description"]}
          rows={[
            ["Version control", "Commit the exported JSON to Git alongside your application code. Track schema changes over time with full diff visibility."],
            ["Dev to Staging to Prod", "Export from your development app and import into staging or production. Ensures all environments have identical schema definitions."],
            ["Backup", "Schedule periodic exports to maintain point-in-time snapshots of your schema. Restore by importing into a fresh app if needed."],
            ["Template sharing", "Create reusable schema templates (e.g., a CRM template, an e-commerce template) and share them between organizations or teams."],
            ["App cloning", "Create a new app via the platform API, then import an existing schema to instantly clone the full configuration without manually recreating each entity and rule."],
          ]}
        />
      </Section>

      {/* ── Admin UI ── */}
      <Section title="Admin UI" id="admin-ui">
        <p>
          The Admin UI provides Export and Import buttons on the <strong>Entities</strong> page
          for convenient schema management without using the API directly.
        </p>
        <h3>Export</h3>
        <p>
          Click the <strong>Export</strong> button to download the full schema as a JSON file.
          The file is named with the app name and a timestamp (e.g.,{" "}
          <C>myapp-schema-2025-01-15.json</C>).
        </p>
        <h3>Import</h3>
        <p>
          Click the <strong>Import</strong> button and select a previously exported JSON file.
          After processing, the UI displays a results summary showing how many of each metadata
          type were imported and any errors that occurred.
        </p>
        <InfoBox type="note">
          <p>
            After importing, the entity list and other admin pages will automatically reflect
            the newly imported metadata. You may need to refresh the page if the entity list
            does not update immediately.
          </p>
        </InfoBox>
      </Section>
    </div>
  );
}
