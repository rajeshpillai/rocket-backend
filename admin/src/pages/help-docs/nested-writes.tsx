import { Section, CodeBlock, InfoBox, PropsTable, C, EndpointBlock } from "./help-components";

export default function NestedWrites() {
  return (
    <div>
      <Section title="Overview" id="overview">
        <p>
          Nested writes let you create or update a <strong>parent record and its children</strong> in
          a single API call, inside a single database transaction. Instead of making separate requests
          to create an invoice and then each line item, you send one payload and the engine handles
          everything atomically.
        </p>
        <p>
          Nested writes work with all relation types — <strong>one-to-many</strong>,{" "}
          <strong>many-to-many</strong>, and <strong>one-to-one</strong>. They support any nesting
          depth, so you can write Invoice, Items, and Tax Lines in a single request.
        </p>
        <InfoBox type="tip" title="When to use nested writes">
          <p>
            Nested writes are ideal for form submissions where a parent and its children are edited
            together — for example, an invoice editor where line items are added, updated, and removed
            inline. Without nested writes, you would need multiple API calls and manual transaction
            coordination.
          </p>
        </InfoBox>
      </Section>

      <Section title="Payload Structure" id="payload-structure">
        <p>
          When a request body contains a key that matches a <strong>relation name</strong>, the engine
          treats it as a nested write. Top-level keys are split into two categories:
        </p>
        <ul class="help-list">
          <li>
            <strong>Entity fields</strong> — keys that match a field in the entity definition go into
            the parent INSERT or UPDATE.
          </li>
          <li>
            <strong>Relation keys</strong> — keys that match a relation name in the registry trigger
            nested writes for child records.
          </li>
        </ul>
        <p>
          Each relation key is an object containing <C>_write_mode</C> and <C>data</C>:
        </p>
        <CodeBlock language="json" title="Create an invoice with line items">
{`{
  "number": "INV-001",
  "status": "draft",
  "customer_id": "cust-uuid",
  "total": 1500.00,
  "items": {
    "_write_mode": "diff",
    "data": [
      { "description": "Widget A", "quantity": 10, "unit_price": 100.00 },
      { "description": "Widget B", "quantity": 5, "unit_price": 200.00 }
    ]
  }
}`}
        </CodeBlock>
        <p>
          In this example, <C>number</C>, <C>status</C>, <C>customer_id</C>, and <C>total</C> are
          entity fields that go into the invoice INSERT. The <C>items</C> key matches a relation and
          triggers nested writes — two new invoice items are created and automatically linked to the
          parent invoice via the foreign key.
        </p>
        <PropsTable
          columns={["Property", "Type", "Description"]}
          rows={[
            [<C>_write_mode</C>, "string", <>One of <C>"diff"</C> (default), <C>"replace"</C>, or <C>"append"</C>. Controls how existing children are handled.</>],
            [<C>data</C>, "array", "The child records to create, update, or delete."],
          ]}
        />
        <p>Each item in <C>data</C> can be:</p>
        <PropsTable
          columns={["Shape", "Meaning"]}
          rows={[
            ["Fields without a primary key", "New record — will be INSERTed."],
            ["Fields with a primary key (e.g., id)", "Existing record — will be UPDATEd (in diff/replace modes)."],
            [<>Fields with <C>_delete: true</C></>, "Marked for deletion (soft-delete or hard-delete depending on entity config)."],
          ]}
        />
      </Section>

      <Section title="Diff Mode (Default)" id="diff-mode">
        <p>
          Diff mode compares incoming data against the current database state and only acts on what
          is explicitly provided. It is the <strong>safest and most common</strong> mode.
        </p>
        <ul class="help-list">
          <li>Items <strong>with an ID</strong> that exist in the database are <strong>updated</strong> (only changed fields).</li>
          <li>Items <strong>without an ID</strong> are <strong>created</strong> as new child records.</li>
          <li>Items with <C>_delete: true</C> are <strong>deleted</strong> (soft-delete or hard-delete based on entity config).</li>
          <li>Existing items <strong>NOT in the payload are left untouched</strong>.</li>
        </ul>
        <InfoBox type="note" title="Missing rows are safe">
          <p>
            The key behavior of diff mode is that rows not included in the payload are
            not deleted. This makes it safe for <strong>partial updates</strong> — you can send only
            the rows you want to change without worrying about accidentally removing others.
          </p>
        </InfoBox>
      </Section>

      <Section title="Replace Mode" id="replace-mode">
        <p>
          Replace mode treats the incoming payload as the <strong>complete truth</strong>. Anything
          not in the payload is removed.
        </p>
        <ul class="help-list">
          <li>Items <strong>with an ID</strong> that exist in the database are <strong>updated</strong>.</li>
          <li>Items <strong>without an ID</strong> are <strong>created</strong>.</li>
          <li>Existing items <strong>NOT in the payload are deleted</strong>.</li>
        </ul>
        <InfoBox type="warning" title="Destructive by design">
          <p>
            Replace mode deletes any existing children that are not present in the payload. Use it
            when the UI sends the <strong>complete list</strong> of children — for example, a tag
            picker that sends all currently selected tags.
          </p>
        </InfoBox>
      </Section>

      <Section title="Append Mode" id="append-mode">
        <p>
          Append mode is purely additive. It only creates new records and <strong>never updates or
          deletes</strong> existing ones.
        </p>
        <ul class="help-list">
          <li>Items <strong>without an ID</strong> are <strong>created</strong>.</li>
          <li>Items <strong>with an ID</strong> are <strong>skipped</strong> (ignored, no update).</li>
          <li>No deletes ever happen.</li>
        </ul>
        <p>
          Append is best for <strong>comment threads</strong>, <strong>activity logs</strong>, or any
          case where existing records should never be modified.
        </p>
      </Section>

      <Section title="Mode Comparison" id="mode-comparison">
        <PropsTable
          columns={["Mode", "New items (no ID)", "Existing items (with ID)", "Missing items (in DB, not in payload)"]}
          rows={[
            [<C>diff</C>, "Created", "Updated", "Untouched"],
            [<C>replace</C>, "Created", "Updated", "Deleted"],
            [<C>append</C>, "Created", "Skipped", "Untouched"],
          ]}
        />
      </Section>

      <Section title="Diff Mode Example" id="diff-example">
        <p>
          This example updates an existing invoice. It demonstrates all three diff operations in a
          single request: updating an existing item, creating a new item, and deleting an item.
        </p>
        <EndpointBlock method="PUT" url="/api/myapp/invoice/:id" description="Update invoice with nested diff writes" />
        <CodeBlock language="json" title="Diff mode: update, create, and delete in one request">
{`{
  "total": 2800.00,
  "items": {
    "_write_mode": "diff",
    "data": [
      {
        "id": "item-uuid-1",
        "quantity": 20
      },
      {
        "description": "Widget C",
        "quantity": 3,
        "unit_price": 50.00
      },
      {
        "id": "item-uuid-3",
        "_delete": true
      }
    ]
  }
}`}
        </CodeBlock>
        <p>What happens:</p>
        <ul class="help-list">
          <li>
            <strong>Item 1</strong> (<C>item-uuid-1</C>) — exists in the database. Its <C>quantity</C> is
            updated to 20. Other fields on this item remain unchanged.
          </li>
          <li>
            <strong>Item 2</strong> (no ID) — new record. A new invoice item is created with the given
            description, quantity, and unit price. The parent invoice's ID is automatically set as the
            foreign key.
          </li>
          <li>
            <strong>Item 3</strong> (<C>item-uuid-3</C>) — marked with <C>_delete: true</C>. This item
            is soft-deleted (or hard-deleted if the entity does not use soft delete).
          </li>
          <li>
            <strong>Any other existing items</strong> not mentioned in the payload are left completely
            untouched.
          </li>
        </ul>
      </Section>

      <Section title="Replace Mode Example" id="replace-example">
        <p>
          This example replaces all tags on a product. Any tags currently associated with the product
          that are not in the payload will be removed.
        </p>
        <EndpointBlock method="PUT" url="/api/myapp/product/:id" description="Replace product tags" />
        <CodeBlock language="json" title="Replace mode: set the complete tag list">
{`{
  "tags": {
    "_write_mode": "replace",
    "data": [
      { "id": "tag-electronics" },
      { "id": "tag-sale" },
      { "id": "tag-featured" }
    ]
  }
}`}
        </CodeBlock>
        <p>
          If the product previously had tags <C>tag-electronics</C>, <C>tag-clearance</C>, and{" "}
          <C>tag-new</C>, after this request:
        </p>
        <ul class="help-list">
          <li><C>tag-electronics</C> — kept (exists in both the database and the payload).</li>
          <li><C>tag-clearance</C> — removed (exists in the database but not in the payload).</li>
          <li><C>tag-new</C> — removed (exists in the database but not in the payload).</li>
          <li><C>tag-sale</C> — added (not in the database, present in the payload).</li>
          <li><C>tag-featured</C> — added (not in the database, present in the payload).</li>
        </ul>
      </Section>

      <Section title="Append Mode Example" id="append-example">
        <p>
          This example adds new comments to a ticket without touching any existing comments.
        </p>
        <EndpointBlock method="PUT" url="/api/myapp/ticket/:id" description="Append new comments" />
        <CodeBlock language="json" title="Append mode: add new items only">
{`{
  "comments": {
    "_write_mode": "append",
    "data": [
      {
        "body": "Escalating this to the engineering team.",
        "author_id": "user-uuid-1"
      },
      {
        "body": "Attached the error logs from production.",
        "author_id": "user-uuid-2"
      }
    ]
  }
}`}
        </CodeBlock>
        <p>
          Only the two new comments are created. All existing comments on the ticket remain
          unchanged. If any item in <C>data</C> included an <C>id</C>, it would be silently
          skipped — append mode never updates existing records.
        </p>
      </Section>

      <Section title="Transaction Safety" id="transaction-safety">
        <p>
          All nested write operations execute inside a <strong>single PostgreSQL transaction</strong>.
          The full execution order is:
        </p>
        <ol class="help-list">
          <li>Parse the request body and separate entity fields from relation keys.</li>
          <li>Run validation: field rules, expression rules, computed fields, and state machine guards.</li>
          <li>Plan the write — build an ordered operation list before <C>BEGIN</C>.</li>
          <li><C>BEGIN</C> transaction.</li>
          <li>Execute the parent INSERT or UPDATE. For inserts, capture the generated primary key via <C>RETURNING</C>.</li>
          <li>Propagate the parent primary key as the foreign key to all child records.</li>
          <li>Execute child writes for each one-to-many and one-to-one relation (per write mode).</li>
          <li>Execute join table writes for each many-to-many relation.</li>
          <li><C>COMMIT</C> transaction.</li>
        </ol>
        <InfoBox type="important" title="All or nothing">
          <p>
            If <strong>any</strong> step fails — a validation error, a SQL constraint violation, a
            rule failure — the entire transaction is rolled back. Partial updates never happen. Either
            everything succeeds or nothing does.
          </p>
        </InfoBox>
        <p>
          Foreign keys are automatically propagated from parent to children. When creating a new
          invoice with items, the engine captures the generated invoice <C>id</C> from the INSERT
          and injects it as <C>invoice_id</C> on every child item before their INSERTs run.
        </p>
      </Section>

      <Section title="Many-to-Many Writes" id="many-to-many">
        <p>
          Many-to-many relations operate on the <strong>join table</strong>, not the target entity
          directly. The items in <C>data</C> reference existing records by their primary key.
        </p>
        <CodeBlock language="json" title="Diff mode with many-to-many tags">
{`{
  "tags": {
    "_write_mode": "diff",
    "data": [
      { "id": "tag-1" },
      { "id": "tag-3" }
    ]
  }
}`}
        </CodeBlock>
        <p>
          If the current join table has associations <C>tag-1</C> and <C>tag-2</C>:
        </p>
        <ul class="help-list">
          <li><C>tag-1</C> — already associated, no action taken.</li>
          <li><C>tag-2</C> — not in the payload, but in diff mode <strong>not removed</strong>.</li>
          <li><C>tag-3</C> — new association, a row is INSERTed into the join table.</li>
        </ul>
        <p>
          In <strong>replace mode</strong>, <C>tag-2</C> would be removed because it is missing from
          the payload.
        </p>
        <InfoBox type="note" title="Hard deletes on join tables">
          <p>
            Join table rows are always <strong>hard-deleted</strong> (not soft-deleted), regardless
            of the entity's soft delete configuration. Join rows carry no business data — they only
            represent a link between two records. Soft-deleting them would create orphaned
            associations that serve no purpose.
          </p>
        </InfoBox>
      </Section>

      <Section title="Nested Depth > 1" id="nested-depth">
        <p>
          Nested writes support arbitrary depth. You can write three or more levels in a single
          request. The engine processes children recursively, propagating primary keys at each level.
        </p>
        <CodeBlock language="json" title="Three levels deep: Invoice, Items, and Tax Lines">
{`{
  "number": "INV-042",
  "status": "draft",
  "items": {
    "_write_mode": "diff",
    "data": [
      {
        "description": "Consulting Services",
        "quantity": 10,
        "unit_price": 150.00,
        "tax_lines": {
          "_write_mode": "replace",
          "data": [
            { "tax_type": "GST", "rate": 0.18 },
            { "tax_type": "CESS", "rate": 0.01 }
          ]
        }
      },
      {
        "description": "Travel Expenses",
        "quantity": 1,
        "unit_price": 500.00,
        "tax_lines": {
          "_write_mode": "replace",
          "data": [
            { "tax_type": "GST", "rate": 0.18 }
          ]
        }
      }
    ]
  }
}`}
        </CodeBlock>
        <p>The engine processes this as:</p>
        <ol class="help-list">
          <li>INSERT the invoice and capture <C>invoice.id</C>.</li>
          <li>INSERT the first invoice item with <C>invoice_id = invoice.id</C>, capture <C>item.id</C>.</li>
          <li>INSERT two tax lines for the first item with <C>item_id = item.id</C>.</li>
          <li>INSERT the second invoice item with <C>invoice_id = invoice.id</C>, capture <C>item.id</C>.</li>
          <li>INSERT one tax line for the second item with <C>item_id = item.id</C>.</li>
        </ol>
        <p>
          Each level's primary key is captured and propagated down before the next level's writes
          execute. The plan-then-execute approach ensures the full operation tree is validated before
          any SQL runs.
        </p>
      </Section>
    </div>
  );
}
